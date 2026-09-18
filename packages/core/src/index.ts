// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Barrel Export
// ═══════════════════════════════════════════════════════════════════════════

// Re-export @vesper/shared for backward compatibility
export * from '@vesper/shared';

// Core modules
export * from './provider.js';
export * from './canvas.js';
// Resolve ambiguous export between @vesper/shared (timeline.ts) and canvas.ts
export { stripEgoPrefixes } from './canvas.js';
export * from './reminder.js';
export * from './loop-detection.js';
export * from './prompt-builder.js';
export * from './runtime.js';
export * from './tools/index.js';
export * from './tools/policy.js';
export * from './clone.js';
export * from './hooks.js';
export * from './checkpoint.js';
export * from './diagnostics.js';
export * from './prompt-store.js';
export * from './session.js';
export * from './config.js';
export * from './event-loop.js';
export * from './image-store.js';
export * from './path-guard.js';
export * from './permission-store.js';
export * from './proxy-util.js';
export * from './curator.js';
export {
  _refreshPromptExports,
  workspaceContextHeader,
  loopWarningContent,
  formatReminderContent,
  errorRecoveryContent,
  userSidebandContent,
  flowAbortedContent,
  subagentCompletedContent,
  timeAwarenessFormat,
  circuitBreakerMessage,
  noProgressCriticalMessage,
  pingPongCriticalMessage,
  noProgressWarningMessage,
  pingPongWarningMessage,
  genericRepeatWarningMessage,
  unknownToolError,
  toolExecutionError,
  toolTimeoutError,
  curatorUserPrompt,
  TOOL_DESC,
  SYSTEM,
  CANVAS_PROTOCOL,
  DOING_TASKS,
  TOOL_USAGE_POLICY,
  TONE_AND_STYLE,
  CONTEXT_BUDGET_WARNING,
  TOOL_CALL_CANCELLED,
  POLICY_TRUNCATION_SUFFIX,
  CURATOR_SYSTEM_PROMPT,
} from './prompts.js';
