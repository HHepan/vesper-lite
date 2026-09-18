// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Loop Detection (4 detectors, adapted from OpenClaw)
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import type { AgentState, LoopHistoryEntry, ToolResult } from '@vesper/shared';
import { LoopCircuitBreakerError } from '@vesper/shared';
import { createLoopWarningReminder } from './reminder.js';
import { addReminder } from './reminder.js';
import {
  circuitBreakerMessage,
  noProgressCriticalMessage,
  pingPongCriticalMessage,
  noProgressWarningMessage,
  pingPongWarningMessage,
  genericRepeatWarningMessage,
} from './prompts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoopDetectorKind =
  | 'generic_repeat'
  | 'no_progress'
  | 'ping_pong'
  | 'circuit_breaker';

export type LoopDetectionResult =
  | { stuck: false }
  | {
      stuck: true;
      level: 'warning' | 'critical';
      detector: LoopDetectorKind;
      count: number;
      message: string;
    };

// ---------------------------------------------------------------------------
// Hashing Utilities
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).toSorted();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function digestStable(value: unknown): string {
  let serialized: string;
  try {
    serialized = stableStringify(value);
  } catch {
    serialized = String(value);
  }
  return createHash('sha256').update(serialized).digest('hex');
}

export function hashToolCall(toolName: string, args: Record<string, any>): string {
  return `${toolName}:${digestStable(args)}`;
}

function hashToolResult(result: ToolResult): string {
  const attachSig = result.attachments?.map(a => `${a.filename}:${a.sizeBytes}`).join(',') ?? '';
  return digestStable({ content: result.content, isError: result.isError ?? false, attachments: attachSig });
}

// ---------------------------------------------------------------------------
// Streak Detectors
// ---------------------------------------------------------------------------

/**
 * Count consecutive no-progress entries (same tool+args+result hash).
 */
function getNoProgressStreak(
  history: LoopHistoryEntry[],
  toolName: string,
  argsHash: string,
): { count: number; latestResultHash?: string } {
  let streak = 0;
  let latestResultHash: string | undefined;

  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i];
    if (record.toolName !== toolName || record.argsHash !== argsHash) continue;
    if (!record.resultHash) continue;

    if (!latestResultHash) {
      latestResultHash = record.resultHash;
      streak = 1;
      continue;
    }
    if (record.resultHash !== latestResultHash) break;
    streak++;
  }

  return { count: streak, latestResultHash };
}

/**
 * Detect ping-pong alternation pattern between two different call signatures.
 */
function getPingPongStreak(
  history: LoopHistoryEntry[],
  currentArgsHash: string,
): { count: number; pairedToolName?: string; noProgressEvidence: boolean } {
  const last = history.at(-1);
  if (!last) return { count: 0, noProgressEvidence: false };

  // Find the "other" signature
  let otherArgsHash: string | undefined;
  let otherToolName: string | undefined;
  for (let i = history.length - 2; i >= 0; i--) {
    const call = history[i];
    if (call.argsHash !== last.argsHash) {
      otherArgsHash = call.argsHash;
      otherToolName = call.toolName;
      break;
    }
  }

  if (!otherArgsHash || !otherToolName) return { count: 0, noProgressEvidence: false };

  // Count alternating tail
  let alternatingTailCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const call = history[i];
    const expected = alternatingTailCount % 2 === 0 ? last.argsHash : otherArgsHash;
    if (call.argsHash !== expected) break;
    alternatingTailCount++;
  }

  if (alternatingTailCount < 2) return { count: 0, noProgressEvidence: false };

  // Current call should match the "other" to continue the pattern
  if (currentArgsHash !== otherArgsHash) return { count: 0, noProgressEvidence: false };

  // Check no-progress evidence
  const tailStart = Math.max(0, history.length - alternatingTailCount);
  let firstHashA: string | undefined;
  let firstHashB: string | undefined;
  let noProgressEvidence = true;

  for (let i = tailStart; i < history.length; i++) {
    const call = history[i];
    if (!call.resultHash) {
      noProgressEvidence = false;
      break;
    }
    if (call.argsHash === last.argsHash) {
      if (!firstHashA) firstHashA = call.resultHash;
      else if (firstHashA !== call.resultHash) { noProgressEvidence = false; break; }
    } else if (call.argsHash === otherArgsHash) {
      if (!firstHashB) firstHashB = call.resultHash;
      else if (firstHashB !== call.resultHash) { noProgressEvidence = false; break; }
    } else {
      noProgressEvidence = false;
      break;
    }
  }

  if (!firstHashA || !firstHashB) noProgressEvidence = false;

  return {
    count: alternatingTailCount + 1,
    pairedToolName: last.toolName,
    noProgressEvidence,
  };
}

// ---------------------------------------------------------------------------
// Main Detection Function
// ---------------------------------------------------------------------------

/**
 * Detect if the agent is stuck in a tool call loop.
 *
 * 4 detectors (priority order):
 *  1. circuit_breaker — global no-progress count exceeds threshold
 *  2. no_progress — same tool+args with identical results
 *  3. ping_pong — alternating between two call patterns
 *  4. generic_repeat — same tool+args repeated many times
 */
export function detectLoop(
  state: AgentState,
  toolName: string,
  args: Record<string, any>,
): LoopDetectionResult {
  const { loopState } = state;
  if (!loopState.config.enabled) return { stuck: false };

  const { history, config } = loopState;
  const currentArgsHash = hashToolCall(toolName, args);
  const noProgress = getNoProgressStreak(history, toolName, currentArgsHash);
  const pingPong = getPingPongStreak(history, currentArgsHash);

  // Special handling for "pass" tool — it's a terminal action, multiple calls are less harmful
  // Use higher thresholds to give the model more tolerance
  const isPassTool = toolName === 'pass';
  const warningThreshold = isPassTool ? 15 : config.warningThreshold;
  const criticalThreshold = isPassTool ? 20 : config.criticalThreshold;
  const circuitBreakerThreshold = isPassTool ? 25 : config.globalCircuitBreakerThreshold;

  // 1. Global circuit breaker
  if (noProgress.count >= circuitBreakerThreshold) {
    return {
      stuck: true,
      level: 'critical',
      detector: 'circuit_breaker',
      count: noProgress.count,
      message: circuitBreakerMessage(toolName, noProgress.count),
    };
  }

  // 2. No-progress (critical)
  if (noProgress.count >= criticalThreshold) {
    return {
      stuck: true,
      level: 'critical',
      detector: 'no_progress',
      count: noProgress.count,
      message: noProgressCriticalMessage(toolName, noProgress.count),
    };
  }

  // 3. Ping-pong (critical)
  if (pingPong.count >= criticalThreshold && pingPong.noProgressEvidence) {
    return {
      stuck: true,
      level: 'critical',
      detector: 'ping_pong',
      count: pingPong.count,
      message: pingPongCriticalMessage(pingPong.count),
    };
  }

  // 4. No-progress (warning)
  if (noProgress.count >= warningThreshold) {
    return {
      stuck: true,
      level: 'warning',
      detector: 'no_progress',
      count: noProgress.count,
      message: noProgressWarningMessage(toolName, noProgress.count),
    };
  }

  // 5. Ping-pong (warning)
  if (pingPong.count >= warningThreshold) {
    return {
      stuck: true,
      level: 'warning',
      detector: 'ping_pong',
      count: pingPong.count,
      message: pingPongWarningMessage(pingPong.count),
    };
  }

  // 6. Generic repeat (warning only)
  const recentCount = history.filter(
    (h) => h.toolName === toolName && h.argsHash === currentArgsHash,
  ).length;

  // Also apply higher threshold for pass in generic repeat
  const genericThreshold = isPassTool ? 15 : config.warningThreshold;

  if (recentCount >= genericThreshold) {
    return {
      stuck: true,
      level: 'warning',
      detector: 'generic_repeat',
      count: recentCount,
      message: genericRepeatWarningMessage(toolName, recentCount),
    };
  }

  return { stuck: false };
}

// ---------------------------------------------------------------------------
// Record Tool Call / Outcome
// ---------------------------------------------------------------------------

/**
 * Record a tool call in the loop state history.
 * Returns new AgentState (immutable).
 */
export function recordToolCall(
  state: AgentState,
  toolName: string,
  args: Record<string, any>,
): AgentState {
  const { loopState } = state;
  const entry: LoopHistoryEntry = {
    toolName,
    argsHash: hashToolCall(toolName, args),
    timestamp: Date.now(),
    canvasOffset: state.canvas.blocks.length,
  };

  const history = [...loopState.history, entry];

  // Sliding window
  while (history.length > loopState.config.historySize) {
    history.shift();
  }

  return {
    ...state,
    loopState: {
      ...loopState,
      history,
    },
  };
}

/**
 * Record a tool call outcome (result hash) in the most recent matching entry.
 * Returns new AgentState (immutable).
 */
export function recordToolOutcome(
  state: AgentState,
  toolName: string,
  args: Record<string, any>,
  result: ToolResult,
): AgentState {
  const { loopState } = state;
  const argsHash = hashToolCall(toolName, args);
  const resultHash = hashToolResult(result);
  const history = [...loopState.history];

  // Find the most recent matching entry without a resultHash
  for (let i = history.length - 1; i >= 0; i--) {
    const call = history[i];
    if (
      call.toolName === toolName &&
      call.argsHash === argsHash &&
      call.resultHash === undefined
    ) {
      history[i] = { ...call, resultHash };
      break;
    }
  }

  return {
    ...state,
    loopState: {
      ...loopState,
      history,
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: detect + inject reminder or throw
// ---------------------------------------------------------------------------

/**
 * Run loop detection and either:
 * - Return unchanged state (no loop)
 * - Return state with injected warning reminder
 * - Throw LoopCircuitBreakerError (critical)
 */
export function detectAndHandle(
  state: AgentState,
  toolName: string,
  args: Record<string, any>,
  currentStep: number,
): AgentState {
  const result = detectLoop(state, toolName, args);
  if (!result.stuck) return state;

  if (result.level === 'critical') {
    throw new LoopCircuitBreakerError(result.detector, result.count, result.message);
  }

  // Warning: inject ephemeral reminder
  const reminder = createLoopWarningReminder(result.detector, result.count, result.message);
  return addReminder(state, reminder, currentStep);
}
