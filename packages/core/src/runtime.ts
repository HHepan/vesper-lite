import { loadImageAsDataUri } from './image-store.js';
// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Agent Flow Runtime
// Core single-turn flow engine with Waterfall Canvas & Tool Loop
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type {
  Canvas,
  CanvasBlock,
  ProviderConfig,
  ToolDefinition,
  StreamEvent,
  ApiToolCall,
  ImageAttachment,
  RuntimeConfig,
  AgentState,
  ToolResult,
  ToolCall,
} from '@vesper/shared';
import {
  createBlock,
  appendBlock,
  canvasTokenCount,
  shouldDrift,
  executeDrift,
  rebuildHistoryMessages,
  formatCompletedInteraction,
} from './canvas.js';
import { createStream, toApiToolDefs, ToolCallAccumulator, type ChatMessage } from './provider.js';
import { PathGuard } from './path-guard.js';
import { buildStructuredSystemPrompt } from './prompt-builder.js';
import { applyPipeline } from './tools/policy.js';
import { countTokens } from './tokenizer/index.js';
import { processReminders, addReminder } from './reminder.js';
import { detectAndHandle, recordToolCall, recordToolOutcome } from './loop-detection.js';
import { cloneState } from './clone.js';
import { createCheckpointManager } from './checkpoint.js';
import { createDiagnosticsCollector } from './diagnostics.js';

export async function* runFlow(
  initialState: AgentState,
  config: RuntimeConfig,
): AsyncGenerator<StreamEvent, AgentState> {
  let state = cloneState(initialState);
  const diagnostics = createDiagnosticsCollector();
  const checkpoints = createCheckpointManager();

  // ── Pre-flow: drift check & reminders ──
  if (shouldDrift(state)) {
    const driftResult = executeDrift(state);
    state = driftResult.state;
    for (const _warning of driftResult.warnings) {
      yield { type: 'loop_warning', detector: 'drift', count: 1 };
    }
    yield { type: 'canvas_drift', before: canvasTokenCount(initialState.canvas), after: canvasTokenCount(state.canvas) };
  }

  // Process reminders (surviving reminders)
  state = {
    ...state,
    reminders: processReminders(state, state.reminders, 0, 0),
  };

  // ── Build system prompt ──
  const systemPromptSections = buildStructuredSystemPrompt(state, config.promptOptions);
  const systemPrompt = systemPromptSections.map(s => s.content).join('\n\n');
  state = { ...state, systemPrompt, systemPromptTokens: countTokens(systemPrompt) };

  // ── Build API messages from canvas ──
  const historyMessages = rebuildHistoryMessages(state.canvas);

  // If the last block is a user_message with imageRefs, load them for the API message
  let currentUserContent: string | import('./provider.js').ContentPart[] = state.userMessage;
  const lastBlock = state.canvas.blocks[state.canvas.blocks.length - 1];
  if (lastBlock && lastBlock.type === 'user_message' && lastBlock.imageRefs?.length && config.supportsVision !== false) {
    const imageParts: import('./provider.js').ContentPart[] = [];
    for (const ref of lastBlock.imageRefs) {
      const dataUri = loadImageAsDataUri(ref);
      if (dataUri) {
        imageParts.push({
          type: 'image_url',
          image_url: { url: dataUri, detail: 'auto' },
        });
      }
    }
    if (imageParts.length > 0) {
      currentUserContent = [
        { type: 'text', text: state.userMessage },
        ...imageParts,
      ];
    }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt, _sections: systemPromptSections },
    ...historyMessages,
    { role: 'user', content: currentUserContent },
  ];

  // ── Prepare tool definitions ──
  const toolDefs = state.toolDefinitions;
  const filteredTools = config.policyConfig
    ? toolDefs.filter(d => getPermissionAction(d.name, config.policyConfig!.permissions) !== 'deny')
    : toolDefs;
  const filteredApiTools = filteredTools.length > 0 ? toApiToolDefs(filteredTools) : undefined;

  // ── Stream LLM response ──
  let fullText = '';
  let toolResults: { toolCallId: string; result: ToolResult }[] = [];
  let iteration = 0;
  const maxIterations = config.maxIterations > 0 ? config.maxIterations : 25;

  while (iteration < maxIterations) {
    iteration++;

    if (config.signal?.aborted) {
      yield { type: 'error', error: new Error('Flow aborted') };
      return state;
    }

    const sideband = config.interrupt?.checkSideband?.();
    if (sideband) {
      yield { type: 'sideband_injected', message: sideband };
      yield { type: 'sideband_consumed', message: sideband };
      const sidebandBlock = createBlock('user_message', sideband, { systemInjected: true });
      state = { ...state, canvas: appendBlock(state.canvas, sidebandBlock) };
      messages.push({ role: 'user', content: sideband });
    }

    const providerUpdate = config.interrupt?.checkProviderUpdate?.();
    if (providerUpdate) {
      state = { ...state, provider: providerUpdate.provider };
      yield { type: 'config_updated' };
    }

    const stream = await createStream({
      model: config.model,
      baseURL: state.provider.baseURL,
      apiKey: state.provider.apiKey,
      messages,
      tools: filteredApiTools,
      signal: config.signal,
      proxy: config.proxy,
      maxTokens: config.maxOutputTokens,
      providerType: state.provider.providerType,
      thinking: state.provider.thinking,
      specificProvider: state.provider.specificProvider,
    });

    const accumulator = new ToolCallAccumulator();
    let turnText = '';
    let hasToolCalls = false;

    for await (const chunk of stream) {
      if (config.signal?.aborted) {
        yield { type: 'error', error: new Error('Flow aborted') };
        return state;
      }

      switch (chunk.type) {
        case 'content':
          turnText += chunk.value;
          yield { type: 'text', value: chunk.value };
          break;
        case 'reasoning':
          yield { type: 'thinking', value: chunk.value };
          break;
        case 'tool_call_delta':
          accumulator.feed(chunk);
          break;
        case 'tool_calls_done':
          break;
        case 'finish':
          break;
        case 'usage':
          yield { type: 'provider_usage', promptTokens: chunk.promptTokens, completionTokens: chunk.completionTokens, cachedTokens: chunk.cachedTokens, cost: chunk.cost };
          diagnostics.recordProviderUsage(chunk.promptTokens, chunk.completionTokens);
          break;
        case 'stream_error':
          yield { type: 'error', error: new Error(chunk.error) };
          return state;
      }
    }

    fullText += turnText;
    diagnostics.recordResponseTokens(countTokens(turnText));

    const pendingCalls = accumulator.flush();
    // Execute accumulated tool calls whenever the accumulator produced any.
    // (Don't gate on the `tool_calls_done` stream flag — some providers omit
    // the explicit finish reason on tool-call turns.)
    if (pendingCalls.length === 0) {
      break;
    }

    for (const tc of pendingCalls) {
      const toolName = tc.function.name;
      const callId = tc.id || randomUUID();

      let args: Record<string, any> = {};
      try {
        args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments;
      } catch {
        args = {};
      }

      const toolCall: ToolCall = { name: toolName, arguments: args, raw: tc.function.arguments };
      yield { type: 'tool_call', call: toolCall };

      const permissionAction = config.policyConfig
        ? getPermissionAction(toolName, config.policyConfig.permissions)
        : 'allow';

      if (permissionAction === 'deny') {
        const denyResult: ToolResult = { content: `Tool '${toolName}' is denied by policy.`, isError: true };
        toolResults.push({ toolCallId: callId, result: denyResult });
        yield { type: 'tool_result', result: denyResult, call: toolCall };
        diagnostics.recordToolCall(toolName, false);
        continue;
      }

      if (permissionAction === 'ask' && config.interrupt?.waitForPermission) {
        const requestId = randomUUID();
        yield { type: 'permission_request', requestId, toolName, args, argsPreview: JSON.stringify(args).slice(0, 200) };
        const response = await config.interrupt.waitForPermission(requestId);
        yield { type: 'permission_resolved', requestId };
        if (response.decision === 'deny_once' || response.decision === 'deny_always') {
          const denyResult: ToolResult = { content: `Permission denied: ${response.denyReason ?? 'User denied'}`, isError: true };
          toolResults.push({ toolCallId: callId, result: denyResult });
          yield { type: 'tool_result', result: denyResult, call: toolCall };
          diagnostics.recordToolCall(toolName, false);
          continue;
        }
      }

      const pathGuard = config.internals?.pathGuard;
      if (pathGuard && (args.path || args.file_path)) {
        const targetPath = args.path || args.file_path;
        const mode = toolName.startsWith('write') || toolName === 'edit' ? 'write' : 'read';
        if (!pathGuard.isAllowed(targetPath, mode)) {
          const denyResult: ToolResult = { content: `Path access denied: ${targetPath}`, isError: true };
          toolResults.push({ toolCallId: callId, result: denyResult });
          yield { type: 'tool_result', result: denyResult, call: toolCall };
          diagnostics.recordToolCall(toolName, false);
          continue;
        }
      }

      const executor = config.executors.get(toolName);
      if (!executor) {
        const errResult: ToolResult = { content: `Unknown tool: ${toolName}`, isError: true };
        toolResults.push({ toolCallId: callId, result: errResult });
        yield { type: 'tool_result', result: errResult, call: toolCall };
        diagnostics.recordToolCall(toolName, false);
        continue;
      }

      state = recordToolCall(state, toolName, args);

      try {
        const timeout = config.policyConfig?.defaultTimeout ?? 120_000;
        const result = await Promise.race([
          executor(args),
          new Promise<ToolResult>((_, reject) =>
            setTimeout(() => reject(new Error(`Tool timeout after ${timeout}ms`)), timeout),
          ),
        ]);

        const maxLen = config.policyConfig?.maxResultLength ?? 20_000;
        if (result.content && result.content.length > maxLen) {
          result.content = result.content.slice(0, maxLen) + '\n... (truncated)';
        }

        toolResults.push({ toolCallId: callId, result });
        yield { type: 'tool_result', result, call: toolCall };
        diagnostics.recordToolCall(toolName, !result.isError);

        state = recordToolOutcome(state, toolName, args, result);
        state = detectAndHandle(state, toolName, args, iteration);
      } catch (err: any) {
        const errResult: ToolResult = {
          content: `Tool error: ${err.message || String(err)}`,
          isError: true,
        };
        toolResults.push({ toolCallId: callId, result: errResult });
        yield { type: 'tool_result', result: errResult, call: toolCall };
        diagnostics.recordToolCall(toolName, false);
      }
    }

    const newBlocks = formatCompletedInteraction(turnText, pendingCalls, toolResults, state.canvasConfig);
    for (const block of newBlocks) {
      state = { ...state, canvas: appendBlock(state.canvas, block) };
    }

    messages.push(
      { role: 'assistant', content: turnText || null, tool_calls: pendingCalls },
      ...toolResults.map(tr => ({
        role: 'tool' as const,
        content: tr.result.content,
        tool_call_id: tr.toolCallId,
      })),
    );
    toolResults = [];
  }

  const cp = checkpoints.save(state, iteration);
  yield { type: 'checkpoint_created', checkpoint: cp };

  const report = diagnostics.getReport(config.model);
  yield { type: 'diagnostics_update', report };

  const snapshot = diagnostics.getTokenBudgetSnapshot(state);
  yield { type: 'token_budget', snapshot };

  yield { type: 'done' };
  return state;
}

function getPermissionAction(
  toolName: string,
  rules: import('@vesper/shared').ToolPermissionRule[],
): 'allow' | 'deny' | 'ask' {
  for (const rule of rules) {
    if (matchGlob(toolName, rule.pattern)) {
      return rule.action;
    }
  }
  return 'deny';
}

function matchGlob(str: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) {
    return str.startsWith(pattern.slice(0, -1));
  }
  if (pattern.startsWith('*')) {
    return str.endsWith(pattern.slice(1));
  }
  return str === pattern;
}

