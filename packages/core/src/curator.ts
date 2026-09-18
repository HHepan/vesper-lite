// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Context Curator Agent (Phase E — GC-Model)
//
// Three-phase generational canvas curation:
//   Phase 0: curator_overview → intent/topic extraction
//   Phase 1: curator_search/grep → rescue relevant very_old blocks,
//            then mechanically fold all un-rescued very_old blocks
//   Phase 2: curator_list_segment/inspect/fold/fold_batch/unfold → fine-grained old-gen
//
// The sub-agent operates on a structuredClone of the parent canvas.
// Parent state is never mutated — workspace canvas is committed only on success.
// Mechanical drift (executeDrift) remains as final safety net.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  AgentState,
  CuratorDecision,
  RuntimeConfig,
  StreamEvent,
  ToolDefinition,
} from '@vesper/shared';
import {
  createDefaultAgentState,
  createDefaultCanvasConfig,
  createToolExecutorRegistry,
} from '@vesper/shared';
import {
  canvasTokenCount,
  executeDrift,
  createBlock,
  appendBlock,
} from './canvas.js';
import { runFlow } from './runtime.js';
import { CURATOR_SYSTEM_PROMPT, curatorUserPrompt } from './prompts.js';
import {
  createCuratorTools,
  createCuratorWorkspace,
  mechanicalFoldVeryOld,
  type CuratorWorkspace,
} from './tools/curator-tools.js';

// ---------------------------------------------------------------------------
// Public Result Types
// ---------------------------------------------------------------------------

export interface CuratorResult {
  decisions: CuratorDecision[];
  warnings: string[];
  /** Child state (curator's canvas) for history data collection. */
  childState?: AgentState;
  /** System prompt used by the curator sub-agent. */
  systemPrompt?: string;
}

export interface CuratedDriftResult {
  state: AgentState;
  decisions: CuratorDecision[];
  warnings: string[];
  fellBackToDrift: boolean;
  /** Curator child canvas blocks for history data collection. Null if curator didn't run. */
  curatorBlocks?: import('@vesper/shared').CanvasBlock[];
  /** System prompt used by the curator sub-agent. */
  curatorSystemPrompt?: string;
}

// ---------------------------------------------------------------------------
// Run Curator Agent (GC-Model: tool-using sub-agent)
// ---------------------------------------------------------------------------

/**
 * Spawn a child runFlow with curator tools that allow the sub-agent to
 * interactively browse, search, and curate the canvas.
 *
 * The sub-agent runs in 3 phases:
 *   Phase 0: curator_overview → understand canvas + extract intent
 *   Phase 1: curator_search/grep → rescue relevant very_old blocks
 *            (after sub-agent finishes or budget met, system mechanically
 *             folds all un-rescued very_old blocks)
 *   Phase 2: curator_list_segment/inspect/fold/unfold on old-gen
 *   curator_done → commit
 */
export async function* runCurator(
  state: AgentState,
  config: RuntimeConfig,
): AsyncGenerator<StreamEvent, CuratorResult> {
  const curatorConfig = config.canvas.curator;
  const warnings: string[] = [];

  // Create workspace (structuredClone of parent canvas)
  const workspace = createCuratorWorkspace(state);

  // AbortController for the curator sub-flow.
  // curator_done tool aborts this → runFlow inner loop breaks immediately.
  const curatorAbort = new AbortController();
  workspace.abortController = curatorAbort;

  // Create curator tools (all bound to workspace)
  const curatorToolEntries = createCuratorTools(workspace);

  // Build executor registry for the sub-agent
  const executors = createToolExecutorRegistry();
  const toolDefinitions: ToolDefinition[] = [];
  for (const { definition, executor } of curatorToolEntries) {
    toolDefinitions.push(definition);
    executors.register(definition.name, executor);
  }

  // Build the curator system prompt with budget stats
  // Prefer real prompt tokens from provider API (authoritative) over estimation
  const estimatedTokens = canvasTokenCount(state.canvas);
  const currentTokens = (state.lastRealPromptTokens && state.lastRealPromptTokens > 0)
    ? state.lastRealPromptTokens
    : estimatedTokens;
  const targetTokens = state.canvasConfig.driftTarget;
  const curatorHint = state.curatorHint
    ? `## User Curation Hint\nThe user provided this guidance for curation: "${state.curatorHint}"\nI treat this as the highest-priority directive when deciding what to keep and what to fold.`
    : '';
  const systemPrompt = CURATOR_SYSTEM_PROMPT
    .replace('{{currentTokens}}', String(currentTokens))
    .replace('{{targetTokens}}', String(targetTokens))
    .replace('{{curatorHint}}', curatorHint);

  // User prompt: minimal — just the user message and instruction to start
  const userPrompt = curatorUserPrompt(
    state.userMessage || '(no current message)',
    currentTokens,
    targetTokens,
    '', // no inventory dump — tools provide access
  );

  // Build child state
  // CRITICAL: Disable curator AND set high drift threshold in child config.
  // 1. curator.enabled=false prevents recursive curator spawning
  // 2. High driftThreshold prevents mid-turn drift inside the curator sub-agent.
  //    The curator's lastRealPromptTokens can be large (parent canvas overview)
  //    but that's irrelevant — the curator's own canvas is tiny and doesn't need drift.
  const childCanvasConfig = createDefaultCanvasConfig({
    maxCanvasTokens: curatorConfig.curatorBudgetTokens,
    driftThreshold: Number.MAX_SAFE_INTEGER, // never drift inside curator
    curator: { enabled: false, curatorBudgetTokens: 0, curatorMaxIterations: 0 },
  });
  const childState = createDefaultAgentState({
    systemPrompt,
    toolDefinitions,
    canvasConfig: childCanvasConfig,
    provider: config.provider,
    maxIterations: curatorConfig.curatorMaxIterations,
    personaName: '', // Prevent ego prefix injection (e.g. "default:") in curator output
  });

  // Build child runtime config — Lite simplified runFlow takes (state, config)
  // and reads userMessage from state.userMessage
  const childConfig: RuntimeConfig = {
    maxIterations: curatorConfig.curatorMaxIterations,
    canvas: childCanvasConfig,
    provider: config.provider,
    model: config.model,
    executors,
    maxOutputTokens: curatorConfig.curatorBudgetTokens,
    proxy: config.proxy,
    signal: curatorAbort.signal,
  };

  // Set userMessage on child state for Lite runFlow
  childState.userMessage = userPrompt;

  // If parent flow is aborted, propagate to curator sub-flow
  const abortHandler = () => curatorAbort.abort();
  if (config.signal) {
    config.signal.addEventListener('abort', abortHandler, { once: true });
  }

  // Run the child flow — tag events with _subflow for UI distinction
  const curatorTag = { kind: 'curator' as const, label: 'Curator' };
  const gen = runFlow(childState, childConfig);
  let result = await gen.next();
  let iterationCount = 0;
  const reminderInterval = 10; // Inject reminder every N iterations
  while (!result.done) {
    const evt = result.value as StreamEvent;
    // Filter out 'done' events from sub-flow — they would confuse the
    // parent event loop / UI into thinking the main flow has ended.
    if (evt.type !== 'done') {
      yield { ...evt, _subflow: curatorTag } as StreamEvent;
    }
    // Count tool_call events as iterations (each tool call = one round)
    if (evt.type === 'tool_call') {
      iterationCount++;
      if (iterationCount > 0 && iterationCount % reminderInterval === 0) {
        // Inject a reminder to keep the curator focused on its task
        const reminder = `⚠️ 请注意，你的工作是将画布token数从${currentTokens}降低至${targetTokens}，而不是进行操作。如果已获得足够的信息，请进行回收。如果信息不足，请继续获取信息。`;
        // Push reminder as a sideband user_message into the child flow
        // by injecting it directly into the child state's canvas
        const reminderBlock = createBlock('user_message', reminder, { sideband: true });
        childState.canvas = appendBlock(childState.canvas, reminderBlock);
      }
    }
    result = await gen.next();
  }

  // Clean up abort listener to prevent closure leak on long-lived parent signals
  if (config.signal) {
    config.signal.removeEventListener('abort', abortHandler);
  }

  // After sub-agent completes (either curator_done or max iterations):
  // The final state is returned by runFlow when the generator completes.
  // IMPORTANT: Use result.value (the final AgentState from runFlow), not the
  // original childState, otherwise we lose all tool calls and results.
  const finalChildState = result.value;

  // Mechanical fold of un-kept very_old blocks (post-curator safety net).
  // The curator has already had a chance to search and keep important blocks.
  // Un-rescued very_old blocks are folded to make way for newer content
  // in very long conversations where the curator can't decide what to fold.
  const mechanicalCount = mechanicalFoldVeryOld(workspace);
  if (mechanicalCount > 0) {
    warnings.push(`Mechanically folded ${mechanicalCount} very_old block(s)`);
  }

  return {
    decisions: workspace.decisions,
    warnings,
    childState: finalChildState,
    systemPrompt,
  };
}

// ---------------------------------------------------------------------------
// Combined Entry Point: Curated Drift
// ---------------------------------------------------------------------------

/**
 * Run curator agent for intelligent compression, with mechanical drift as fallback.
 */
export async function* executeCuratedDrift(
  state: AgentState,
  config: RuntimeConfig,
): AsyncGenerator<StreamEvent, CuratedDriftResult> {
  let decisions: CuratorDecision[] = [];
  let warnings: string[] = [];
  let fellBackToDrift = false;
  let curatorBlocks: import('@vesper/shared').CanvasBlock[] | undefined;
  let curatorSystemPrompt: string | undefined;
  // The workspace operates on a clone — we need the final canvas from it
  const workspace = createCuratorWorkspace(state);

  try {
    // Run curator sub-agent
    const gen = runCurator(state, config);
    let result = await gen.next();
    while (!result.done) {
      // Filter out error events from curator sub-flow — max iterations exceeded
      // is a normal timeout for the curator, not a user-visible error.
      const evt = result.value;
      if (evt.type !== 'error') {
        yield evt;
      } else {
        const errMsg = evt.error instanceof Error ? evt.error.message : String(evt.error);
        warnings.push(`Curator internal: ${errMsg}`);
      }
      result = await gen.next();
    }
    const curatorResult = result.value;
    decisions = curatorResult.decisions;
    warnings = curatorResult.warnings;
    curatorBlocks = curatorResult.childState?.canvas?.blocks;
    curatorSystemPrompt = curatorResult.systemPrompt;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Curator failed: ${msg}`);
  }

  // Apply workspace canvas to parent state
  // runCurator internally created its own workspace — we need to rebuild
  // the state by applying the decisions to the parent canvas
  let currentState = applyDecisionsToState(state, decisions);

  // Check if still over target (50%) — if so, fall back to mechanical drift
  if (canvasTokenCount(currentState.canvas) > currentState.canvasConfig.driftTarget) {
    const driftResult = executeDrift(currentState);
    currentState = driftResult.state;
    warnings.push(...driftResult.warnings);
    fellBackToDrift = true;
  }

  return {
    state: currentState,
    decisions,
    warnings,
    fellBackToDrift,
    curatorBlocks,
    curatorSystemPrompt,
  };
}

// ---------------------------------------------------------------------------
// Apply decisions to parent state (commit workspace results)
// ---------------------------------------------------------------------------

import {
  manualFoldBlock,
  expandBlock,
} from './canvas.js';

/**
 * Apply the decisions collected by the curator workspace to the actual parent state.
 * Folds first, then unfolds (with budget check).
 */
function applyDecisionsToState(
  state: AgentState,
  decisions: CuratorDecision[],
): AgentState {
  if (decisions.length === 0) return state;

  let canvas = state.canvas;
  const config = state.canvasConfig;

  // Folds first
  for (const { blockId, action } of decisions) {
    if (action === 'fold') {
      canvas = manualFoldBlock(canvas, blockId, config);
    }
  }

  // Unfolds (budget-aware)
  for (const { blockId, action } of decisions) {
    if (action === 'unfold') {
      if (canvasTokenCount(canvas) >= config.driftTarget) break;
      canvas = expandBlock(canvas, blockId, config);
    }
  }

  return { ...state, canvas };
}
