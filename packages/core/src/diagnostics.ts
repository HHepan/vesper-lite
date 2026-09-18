// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Diagnostics Collector (model diagnostics + token budget)
// ═══════════════════════════════════════════════════════════════════════════

import type { AgentState, DiagnosticsReport, TokenBudgetSnapshot } from '@vesper/shared';
import { countTokens } from './tokenizer/index.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface DiagnosticsCollector {
  recordToolCall(name: string, success: boolean): void;
  recordResponseTokens(count: number): void;
  recordCanvasDrift(): void;
  recordProviderUsage(promptTokens: number, completionTokens: number): void;
  getReport(modelName: string): DiagnosticsReport;
  getTokenBudgetSnapshot(state: AgentState): TokenBudgetSnapshot;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDiagnosticsCollector(): DiagnosticsCollector {
  let totalToolCalls = 0;
  let responseTokensSum = 0;
  let responseCount = 0;
  let canvasDriftCount = 0;
  let lastRealPromptTokens: number | undefined;
  const toolCallDist = new Map<string, number>();

  function recordToolCall(name: string, _success: boolean): void {
    totalToolCalls++;
    toolCallDist.set(name, (toolCallDist.get(name) ?? 0) + 1);
  }

  function recordResponseTokens(count: number): void {
    responseTokensSum += count;
    responseCount++;
  }

  function recordCanvasDrift(): void {
    canvasDriftCount++;
  }

  function recordProviderUsage(promptTokens: number, _completionTokens: number): void {
    lastRealPromptTokens = promptTokens;
  }

  function getReport(modelName: string): DiagnosticsReport {
    return {
      modelName,
      totalToolCalls,
      averageResponseTokens: responseCount > 0 ? Math.round(responseTokensSum / responseCount) : 0,
      canvasDriftCount,
      toolCallDistribution: Object.fromEntries(toolCallDist),
    };
  }

  function getTokenBudgetSnapshot(state: AgentState): TokenBudgetSnapshot {
    const blocks = state.canvas.blocks;
    let pinnedTokens = 0;
    let foldedTokens = 0;
    let activeTokens = 0;

    for (const block of blocks) {
      if (block.pinned) {
        pinnedTokens += block.tokens;
      } else if (block.folded) {
        foldedTokens += block.tokens;
      } else {
        activeTokens += block.tokens;
      }
    }

    const reminderTokens = state.reminders.reduce(
      (sum, r) => sum + countTokens(r.content),
      0,
    );

    const estimatedTotal = pinnedTokens + foldedTokens + activeTokens + reminderTokens;
    const budgetTokens = state.canvasConfig.maxCanvasTokens;

    // Use provider's real prompt_tokens as authoritative totalTokens when available.
    // This is the actual token count from the last LLM API call, far more accurate
    // than our character-based estimation (countTokens with BPE encoding).
    const realTokens = state.lastRealPromptTokens;
    const totalTokens = (realTokens && realTokens > 0) ? realTokens : estimatedTotal;

    // Calculate cumulative tokens for "nk总计" display (SSG feature).
    // This represents the total conversation footprint across all drifts.
    let cumulativeTokens = totalTokens;
    if (state.cumulativePromptTokens !== undefined) {
      const base = state.cumulativePromptTokens;
      const incremental = (state.lastRealPromptTokens !== undefined && state.beginWithPromptTokens !== undefined)
        ? state.lastRealPromptTokens - state.beginWithPromptTokens
        : 0;
      cumulativeTokens = base + incremental;
    }

    return {
      pinnedTokens,
      foldedTokens,
      activeTokens,
      reminderTokens,
      totalTokens,
      budgetTokens,
      utilizationPercent: budgetTokens > 0 ? Math.round((totalTokens / budgetTokens) * 100) : 0,
      realPromptTokens: realTokens ?? lastRealPromptTokens,
      source: (realTokens && realTokens > 0) ? 'provider' : 'estimated',
      cumulativeTokens,
    };
  }

  return {
    recordToolCall,
    recordResponseTokens,
    recordCanvasDrift,
    recordProviderUsage,
    getReport,
    getTokenBudgetSnapshot,
  };
}
