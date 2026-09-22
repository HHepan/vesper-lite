// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Wire Protocol (NDJSON stdio protocol for core/TUI separation)
// Stripped to the open-source subset: session, canvas, provider, permissions.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  StreamEvent,
  SubflowTag,
  ToolCall,
  ToolResult,
  ToolResultMeta,
  TokenBudgetSnapshot,
  DiagnosticsReport,
  Checkpoint,
  AgentState,
  SessionManifest,
  PermissionDecision,
  CuratorDecision,
  TaskItem,
  CanvasBrowserSnapshot,
  CanvasBlock,
  AskUserQuestion,
  AskUserAnswers,
  ProviderRequestInfo,
  RetryReason,
} from './types.js';
import type { Readable, Writable } from 'node:stream';

// ---------------------------------------------------------------------------
// Wire Config (Host → Core init payload)
// ---------------------------------------------------------------------------

export interface WireConfig {
  model: string;
  apiKey: string;
  baseURL: string;
  maxIterations: number;
  maxCanvasTokens: number;
  noTools: boolean;
  prompts?: string;
  proxy?: string;
  profile?: string;
  toolset?: string;
  /** Human-readable session name. */
  sessionName?: string;
  /** Stable short session ID (e.g. "s30") assigned by the server's session manager. */
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Commands: Host → Core (core's stdin)
// ---------------------------------------------------------------------------

export type CoreCommand =
  | { cmd: 'init'; id: string; config: WireConfig }
  | { cmd: 'run'; id: string; input: string; images?: import('./types.js').ImageAttachment[]; regenerate?: boolean; saveDataDir?: string }
  | { cmd: 'sideband'; id: string; message: string; saveDataDir?: string }
  | { cmd: 'abort'; id: string }
  | { cmd: 'pin'; id: string; content: string }
  | { cmd: 'session_save'; id: string; name?: string; description?: string }
  | { cmd: 'session_load'; id: string; sessionId: string; checkpointId?: string }
  | { cmd: 'session_list'; id: string }
  | { cmd: 'session_rollback'; id: string; checkpointId: string }
  | { cmd: 'session_delete'; id: string; sessionId: string }
  | { cmd: 'session_rename'; id: string; sessionId: string; newName: string; activeSessionId?: string }
  | { cmd: 'session_export'; id: string; sessionIdOrName: string; outputPath?: string }
  | { cmd: 'session_import'; id: string; filePath: string }
  | { cmd: 'permission_respond'; id: string; requestId: string;
      decision: PermissionDecision; denyReason?: string }
  | { cmd: 'ask_user_respond'; id: string; requestId: string; answers: AskUserAnswers }
  | { cmd: 'compact'; id: string; message?: string }
  | { cmd: 'call_curator'; id: string; message?: string }
  | { cmd: 'task_query'; id: string }
  | { cmd: 'dump'; id: string }
  | { cmd: 'clear'; id: string }
  // Canvas browser commands:
  | { cmd: 'canvas_browse'; id: string }
  | { cmd: 'canvas_op'; id: string; op: 'fold' | 'unfold' | 'delete'; blockId: string }
  | { cmd: 'canvas_inspect'; id: string; blockId: string }
  | { cmd: 'canvas_edit'; id: string; blockId: string; content: string }
  | { cmd: 'slash'; id: string; input: string }
  // Provider request control:
  | { cmd: 'provider_request_pause'; id: string; requestId: string }
  | { cmd: 'provider_request_resume'; id: string; requestId: string }
  | { cmd: 'provider_request_retry'; id: string; requestId: string }
  | { cmd: 'provider_request_abort'; id: string; requestId: string }
  | { cmd: 'provider_request_query'; id: string }
  // Dynamic provider switch:
  | { cmd: 'switch_provider'; id: string; profile?: string; model?: string; baseURL?: string; apiKey?: string }
  | { cmd: 'query_provider'; id: string }
  // Public mode toggle:
  | { cmd: 'toggle_public_mode'; id: string }
  | { cmd: 'set_permission_mode'; id: string; mode: 'manual' | 'auto' }
  // Config hot reload:
  | { cmd: 'reload_config'; id: string; scope?: 'global' | 'project' }
  | { cmd: 'shutdown' };

// ---------------------------------------------------------------------------
// Wire Tool Call / Result (serializable versions)
// ---------------------------------------------------------------------------

export interface WireToolCall {
  name: string;
  arguments: Record<string, any>;
  raw: string;
}

export interface WireToolResult {
  content: string;
  isError?: boolean;
  meta?: ToolResultMeta;
  hasAttachments?: boolean;
  attachmentCount?: number;
}

// ---------------------------------------------------------------------------
// Serialized Checkpoint (state as JSON-safe object)
// ---------------------------------------------------------------------------

export interface SerializedCheckpoint {
  id: string;
  timestamp: number;
  step: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Events: Core → Host (core's stdout)
// ---------------------------------------------------------------------------

export type WireEvent =
  // StreamEvent variants:
  | { id: string; type: 'text'; value: string; subflow?: SubflowTag }
  | { id: string; type: 'thinking'; value: string; subflow?: SubflowTag }
  | { id: string; type: 'tool_call'; call: WireToolCall; subflow?: SubflowTag }
  | { id: string; type: 'tool_result'; result: WireToolResult; call: WireToolCall; subflow?: SubflowTag }
  | { id: string; type: 'tool_call_progress'; index: number; name?: string; argumentsPartial?: string; subflow?: SubflowTag }
  | { id: string; type: 'done' }
  | { id: string; type: 'error'; error: { name: string; message: string; stack?: string } }
  | { id: string; type: 'canvas_drift'; before: number; after: number }
  | { id: string; type: 'loop_warning'; detector: string; count: number }
  | { id: string; type: 'token_budget'; snapshot: TokenBudgetSnapshot }
  | { id: string; type: 'checkpoint_created'; checkpoint: SerializedCheckpoint }
  | { id: string; type: 'diagnostics_update'; report: DiagnosticsReport }
  | { id: string; type: 'sideband_injected'; message: string }
  | { id: string; type: 'sideband_consumed'; message: string }
  | { id: string; type: 'permission_request'; requestId: string;
      toolName: string; args: Record<string, any>; argsPreview: string; requiresHumanApproval?: boolean }
  | { id: string; type: 'ask_user_request'; requestId: string; questions: AskUserQuestion[] }
  | { id: string; type: 'permission_resolved'; requestId: string }
  | { id: string; type: 'ask_user_resolved'; requestId: string }
  | { id: string; type: 'reminder_injected'; content: string }
  // Session events:
  | { id: string; type: 'session_saved'; sessionId: string; name: string }
  | { id: string; type: 'session_loaded'; sessionId: string; checkpointId?: string; canvasBlocks?: CanvasBlock[]; tasks?: TaskItem[]; uiState?: any }
  | { id: string; type: 'session_list_result'; sessions: SessionManifest[] }
  | { id: string; type: 'session_rollback_result'; checkpointId: string; step: number }
  | { id: string; type: 'session_deleted'; sessionId: string; name: string }
  | { id: string; type: 'session_renamed'; sessionId: string; name: string }
  | { id: string; type: 'session_exported'; name: string; filePath: string }
  | { id: string; type: 'session_imported'; name: string; sessionId: string }
  // Curator events:
  | { id: string; type: 'curator_run'; decisions: CuratorDecision[]; foldCount: number; unfoldCount: number; fellBackToDrift: boolean }
  | { id: string; type: 'curator_done'; decisions: CuratorDecision[]; foldCount: number; unfoldCount: number; fellBackToDrift: boolean }
  | { id: string; type: 'provider_usage'; promptTokens: number; completionTokens: number }
  | { id: string; type: 'compact_complete'; foldCount: number; unfoldCount: number }
  // Task events:
  | { id: string; type: 'task_snapshot'; tasks: TaskItem[] }
  // Dump events:
  | { id: string; type: 'dump_complete'; filePath: string }
  // Clear events:
  | { id: string; type: 'canvas_cleared' }
  // Canvas browser events:
  | { id: string; type: 'canvas_browse_result'; snapshot: CanvasBrowserSnapshot }
  | { id: string; type: 'canvas_op_result'; success: boolean; message: string;
      snapshot: CanvasBrowserSnapshot }
  | { id: string; type: 'canvas_inspect_result'; blockId: string; content: string;
      blockType: CanvasBlock['type']; tokens: number; folded: boolean }
  | { id: string; type: 'canvas_edit_result'; success: boolean; message: string;
      snapshot: CanvasBrowserSnapshot }
  // Status messages:
  | { id: string; type: 'status'; message: string }
  // Meta-events:
  | { id: string; type: 'ready' }
  | { id: string; type: 'run_started'; prompt: string }
  | { id: string; type: 'run_complete' }
  | { id: string; type: 'init_error'; message: string }
  // Provider request control:
  | { id: string; type: 'provider_request_start'; request: ProviderRequestInfo }
  | { id: string; type: 'provider_request_update'; request: ProviderRequestInfo }
  | { id: string; type: 'provider_request_end'; requestId: string; status: 'completed' | 'failed'; error?: string }
  | { id: string; type: 'provider_request_snapshot'; requests: ProviderRequestInfo[] }
  // Retry status:
  | { id: string; type: 'retry_status'; attempt: number; maxRetries: number;
      status: 'waiting_retry' | 'retrying' | 'waiting_extended_retry';
      retryReason: RetryReason; retryDelayMs: number; error: string;
      extendedRetry?: boolean; extendedRetryCount?: number }
  // Dynamic provider switch:
  | { id: string; type: 'provider_switched'; profile?: string; model: string; baseURL: string; providerType: string }
  | { id: string; type: 'provider_state'; currentProfile?: string; model: string; baseURL: string; providerType: string; availableProfiles: Array<{ name: string; model?: string }> }
  // Config updated notification:
  | { id: string; type: 'config_updated' };

// ---------------------------------------------------------------------------
// Serialization: StreamEvent → WireEvent
// ---------------------------------------------------------------------------

/** Spread _subflow → subflow for wire format (only when present). */
function sf(event: StreamEvent): { subflow?: SubflowTag } {
  return '_subflow' in event && event._subflow ? { subflow: event._subflow } : {};
}

export function serializeEvent(id: string, event: StreamEvent): WireEvent {
  switch (event.type) {
    case 'text':
      return { id, type: 'text', value: event.value, ...sf(event) };
    case 'thinking':
      return { id, type: 'thinking', value: event.value, ...sf(event) };
    case 'tool_call':
      return { id, type: 'tool_call', call: serializeToolCall(event.call), ...sf(event) };
    case 'tool_result':
      return {
        id,
        type: 'tool_result',
        result: {
          content: event.result.content,
          isError: event.result.isError,
          ...(event.result.meta ? { meta: event.result.meta } : {}),
          ...(event.result.attachments?.length ? {
            hasAttachments: true,
            attachmentCount: event.result.attachments.length,
          } : {}),
        },
        call: serializeToolCall(event.call),
        ...sf(event),
      };
    case 'tool_call_progress':
      return { id, type: 'tool_call_progress', index: event.index, name: event.name, argumentsPartial: event.argumentsPartial, ...sf(event) };
    case 'done':
      return { id, type: 'done' };
    case 'error':
      return {
        id,
        type: 'error',
        error: {
          name: event.error.name,
          message: event.error.message,
          stack: event.error.stack,
        },
      };
    case 'canvas_drift':
      return { id, type: 'canvas_drift', before: event.before, after: event.after };
    case 'loop_warning':
      return { id, type: 'loop_warning', detector: event.detector, count: event.count };
    case 'token_budget':
      return { id, type: 'token_budget', snapshot: event.snapshot };
    case 'checkpoint_created':
      return {
        id,
        type: 'checkpoint_created',
        checkpoint: {
          id: event.checkpoint.id,
          timestamp: event.checkpoint.timestamp,
          step: event.checkpoint.step,
          description: event.checkpoint.description,
        },
      };
    case 'diagnostics_update':
      return { id, type: 'diagnostics_update', report: event.report };
    case 'sideband_injected':
      return { id, type: 'sideband_injected', message: event.message };
    case 'sideband_consumed':
      return { id, type: 'sideband_consumed', message: event.message };
    case 'permission_request':
      return {
        id,
        type: 'permission_request',
        requestId: event.requestId,
        toolName: event.toolName,
        args: event.args,
        argsPreview: event.argsPreview,
        requiresHumanApproval: event.requiresHumanApproval,
      };
    case 'ask_user_request':
      return {
        id,
        type: 'ask_user_request',
        requestId: event.requestId,
        questions: event.questions,
      };
    case 'permission_resolved':
      return { id, type: 'permission_resolved', requestId: event.requestId };
    case 'ask_user_resolved':
      return { id, type: 'ask_user_resolved', requestId: event.requestId };
    case 'reminder_injected':
      return { id, type: 'reminder_injected', content: event.reminder.content };
    case 'curator_run':
      return { id, type: 'curator_run', decisions: event.decisions, foldCount: event.foldCount, unfoldCount: event.unfoldCount, fellBackToDrift: event.fellBackToDrift };
    case 'curator_done':
      return { id, type: 'curator_done', decisions: event.decisions, foldCount: event.foldCount, unfoldCount: event.unfoldCount, fellBackToDrift: event.fellBackToDrift };
    case 'provider_usage':
      return {
        id, type: 'provider_usage',
        promptTokens: event.promptTokens,
        completionTokens: event.completionTokens,
        ...(event.cachedTokens !== undefined ? { cachedTokens: event.cachedTokens } : {}),
        ...(event.cost !== undefined ? { cost: event.cost } : {}),
      };
    case 'task_snapshot':
      return { id, type: 'task_snapshot', tasks: event.tasks };
    case 'provider_request_start':
      return { id, type: 'provider_request_start', request: event.request };
    case 'provider_request_update':
      return { id, type: 'provider_request_update', request: event.request };
    case 'provider_request_end':
      return { id, type: 'provider_request_end', requestId: event.requestId, status: event.status, error: event.error };
    case 'config_updated':
      return { id, type: 'config_updated' };
    case 'retry_status':
      return {
        id, type: 'retry_status',
        attempt: event.attempt, maxRetries: event.maxRetries,
        status: event.status, retryReason: event.retryReason,
        retryDelayMs: event.retryDelayMs, error: event.error,
        ...(event.extendedRetry !== undefined ? { extendedRetry: event.extendedRetry } : {}),
        ...(event.extendedRetryCount !== undefined ? { extendedRetryCount: event.extendedRetryCount } : {}),
      };
  }
  // Exhaustive guard — all StreamEvent types must be handled above.
  const _exhaustive: any = event;
  return _exhaustive;
}

function serializeToolCall(tc: ToolCall): WireToolCall {
  return { name: tc.name, arguments: tc.arguments, raw: tc.raw };
}

// ---------------------------------------------------------------------------
// Deserialization: WireEvent → StreamEvent
// ---------------------------------------------------------------------------

export function deserializeEvent(wire: WireEvent): StreamEvent | null {
  switch (wire.type) {
    case 'text':
      return { type: 'text', value: wire.value, ...(wire.subflow ? { _subflow: wire.subflow } : {}) };
    case 'thinking':
      return { type: 'thinking', value: wire.value, ...(wire.subflow ? { _subflow: wire.subflow } : {}) };
    case 'tool_call':
      return { type: 'tool_call', call: wire.call, ...(wire.subflow ? { _subflow: wire.subflow } : {}) };
    case 'tool_result':
      return { type: 'tool_result', result: wire.result, call: wire.call, ...(wire.subflow ? { _subflow: wire.subflow } : {}) };
    case 'tool_call_progress':
      return { type: 'tool_call_progress', index: wire.index, name: wire.name, argumentsPartial: wire.argumentsPartial, ...(wire.subflow ? { _subflow: wire.subflow } : {}) };
    case 'done':
      return { type: 'done' };
    case 'error': {
      const err = new Error(wire.error.message);
      err.name = wire.error.name;
      if (wire.error.stack) err.stack = wire.error.stack;
      return { type: 'error', error: err };
    }
    case 'canvas_drift':
      return { type: 'canvas_drift', before: wire.before, after: wire.after };
    case 'loop_warning':
      return { type: 'loop_warning', detector: wire.detector, count: wire.count };
    case 'token_budget':
      return { type: 'token_budget', snapshot: wire.snapshot };
    case 'diagnostics_update':
      return { type: 'diagnostics_update', report: wire.report };
    case 'sideband_injected':
      return { type: 'sideband_injected', message: wire.message };
    case 'sideband_consumed':
      return { type: 'sideband_consumed', message: wire.message };
    case 'permission_request':
      return {
        type: 'permission_request',
        requestId: wire.requestId,
        toolName: wire.toolName,
        args: wire.args,
        argsPreview: wire.argsPreview,
      };
    case 'ask_user_request':
      return {
        type: 'ask_user_request',
        requestId: wire.requestId,
        questions: wire.questions ?? [],
      };
    case 'permission_resolved':
      return { type: 'permission_resolved', requestId: wire.requestId };
    case 'ask_user_resolved':
      return { type: 'ask_user_resolved', requestId: wire.requestId };
    case 'reminder_injected':
      return {
        type: 'reminder_injected',
        reminder: {
          id: '',
          content: wire.content,
          placement: 'tail',
          maxDistance: 0,
          autoRemoveOn: 'distance',
          source: 'runtime',
          createdAtStep: 0,
        },
      };
    case 'curator_run':
      return {
        type: 'curator_run',
        decisions: wire.decisions ?? [],
        foldCount: wire.foldCount ?? 0,
        unfoldCount: wire.unfoldCount ?? 0,
        fellBackToDrift: wire.fellBackToDrift ?? false,
      };
    case 'curator_done':
      return {
        type: 'curator_done',
        decisions: wire.decisions ?? [],
        foldCount: wire.foldCount ?? 0,
        unfoldCount: wire.unfoldCount ?? 0,
        fellBackToDrift: wire.fellBackToDrift ?? false,
      };
    case 'provider_usage':
      return {
        type: 'provider_usage',
        promptTokens: wire.promptTokens ?? 0,
        completionTokens: wire.completionTokens ?? 0,
        ...(typeof (wire as any).cachedTokens === 'number' ? { cachedTokens: (wire as any).cachedTokens } : {}),
        ...(typeof (wire as any).cost === 'number' ? { cost: (wire as any).cost } : {}),
      };
    case 'task_snapshot':
      return { type: 'task_snapshot', tasks: wire.tasks ?? [] };
    case 'provider_request_start':
      return { type: 'provider_request_start', request: wire.request };
    case 'provider_request_update':
      return { type: 'provider_request_update', request: wire.request };
    case 'provider_request_end':
      return { type: 'provider_request_end', requestId: wire.requestId, status: wire.status, error: wire.error };
    case 'config_updated':
      return { type: 'config_updated' };
    case 'retry_status':
      return {
        type: 'retry_status',
        attempt: wire.attempt ?? 0,
        maxRetries: wire.maxRetries ?? 0,
        status: wire.status ?? 'retrying',
        retryReason: wire.retryReason ?? 'unknown',
        retryDelayMs: wire.retryDelayMs ?? 0,
        error: wire.error ?? '',
        ...(wire.extendedRetry !== undefined ? { extendedRetry: wire.extendedRetry } : {}),
        ...(wire.extendedRetryCount !== undefined ? { extendedRetryCount: wire.extendedRetryCount } : {}),
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// NDJSON Protocol Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Write a single NDJSON line to a writable stream. */
export function writeLine(stream: Writable, obj: unknown): void {
  stream.write(encoder.encode(JSON.stringify(obj) + '\n'));
}

/** Read NDJSON lines from a readable stream, calling handler for each parsed object. */
export function readLines(
  stream: Readable,
  handler: (obj: Record<string, unknown>) => void,
  onError?: (err: Error) => void,
): void {
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        handler(JSON.parse(line) as Record<string, unknown>);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
  stream.on('error', (err) => {
    onError?.(err);
  });
}


// ---------------------------------------------------------------------------

/**
 * Create an async iterable that reads NDJSON objects from a readable stream.
 * Each yielded value is a parsed JSON object.
 */
export async function* createNdjsonReader(stream: Readable): AsyncGenerator<unknown> {
  let buffer = '';

  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.substring(0, newlineIndex).trim();
      buffer = buffer.substring(newlineIndex + 1);

      if (line.length === 0) continue;

      try {
        yield JSON.parse(line);
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Process any remaining data in buffer
  const remaining = buffer.trim();
  if (remaining.length > 0) {
    try {
      yield JSON.parse(remaining);
    } catch {
      // Skip
    }
  }
}

// ---------------------------------------------------------------------------
// NDJSON Writer
// ---------------------------------------------------------------------------

export interface NdjsonWriter {
  write(obj: unknown): void;
}

/**
 * Create a writer that serializes objects as NDJSON to a writable stream.
 */
export function createNdjsonWriter(stream: Writable): NdjsonWriter {
  return {
    write(obj: unknown): void {
      stream.write(JSON.stringify(obj) + '\n');
    },
  };
}
