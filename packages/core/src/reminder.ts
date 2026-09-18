// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Ephemeral Reminder lifecycle management
// ═══════════════════════════════════════════════════════════════════════════

import type { AgentState, EphemeralReminder } from '@vesper/shared';
import { randomUUID } from 'node:crypto';
import {
  loopWarningContent,
  formatReminderContent,
  errorRecoveryContent,
  userSidebandContent,
  flowAbortedContent,
  subagentCompletedContent,
  CONTEXT_BUDGET_WARNING,
} from './prompts.js';

// ---------------------------------------------------------------------------
// Add Reminder
// ---------------------------------------------------------------------------

/**
 * Add a new ephemeral reminder to the agent state.
 * Returns new AgentState (immutable).
 */
export function addReminder(
  state: AgentState,
  reminder: Omit<EphemeralReminder, 'id' | 'createdAtStep'>,
  currentStep: number = 0,
): AgentState {
  const newReminder: EphemeralReminder = {
    ...reminder,
    id: randomUUID(),
    createdAtStep: currentStep,
  };

  return {
    ...state,
    reminders: [...state.reminders, newReminder],
  };
}

// ---------------------------------------------------------------------------
// Get Recent Canvas Text (§4B helper)
// ---------------------------------------------------------------------------

/**
 * Collect recent text from canvas blocks (reverse order) up to maxTokens.
 * Used for acknowledgement detection against canvas content.
 */
export function getRecentCanvasText(state: AgentState, maxTokens: number): string {
  const ratio = state.canvasConfig.tokensPerChar;
  const maxChars = Math.floor(maxTokens / ratio);
  const parts: string[] = [];
  let charCount = 0;

  for (let i = state.canvas.blocks.length - 1; i >= 0; i--) {
    const block = state.canvas.blocks[i];
    if (block.folded) continue;

    const content = block.content;
    if (charCount + content.length > maxChars) {
      // Take only what fits
      const remaining = maxChars - charCount;
      if (remaining > 0) {
        parts.unshift(content.slice(-remaining));
      }
      break;
    }
    parts.unshift(content);
    charCount += content.length;
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Process Reminders (§2.4.2 aligned signature)
// ---------------------------------------------------------------------------

/**
 * Process all active reminders, removing those that have expired.
 *
 * - `acknowledged`: removed if recent canvas content contains acknowledgement keywords
 * - `distance`: removed if currentToolCallCount - createdAtStep > maxDistance
 * - `maxTokens`: removed if canvasGrowth exceeds the reminder's maxTokens threshold
 *
 * Returns surviving EphemeralReminder[] — caller updates state.
 */
export function processReminders(
  state: AgentState,
  reminders: EphemeralReminder[],
  canvasGrowth: number,
  currentToolCallCount: number,
): EphemeralReminder[] {
  // Collect recent canvas text for acknowledgement detection
  const recentText = getRecentCanvasText(state, 2000);

  return reminders.filter((reminder) => {
    // maxTokens eviction: if canvas growth exceeds reminder's token budget, evict
    if (reminder.maxTokens != null && canvasGrowth > reminder.maxTokens) {
      return false;
    }

    switch (reminder.autoRemoveOn) {
      case 'acknowledged':
        return !containsAcknowledgement(recentText, reminder);
      case 'distance':
        return (currentToolCallCount - reminder.createdAtStep) <= reminder.maxDistance;
      default:
        return true;
    }
  });
}

// ---------------------------------------------------------------------------
// Acknowledgement Detection
// ---------------------------------------------------------------------------

/**
 * Check if the text acknowledges a reminder.
 * Looks for key phrases from the reminder content in the text.
 */
export function containsAcknowledgement(
  output: string,
  reminder: EphemeralReminder,
): boolean {
  if (!output || !reminder.content) return false;

  const outputLower = output.toLowerCase();

  // Extract significant words from reminder (4+ chars to avoid noise)
  const words = reminder.content
    .split(/[\s,.:;!?<>()[\]{}\/\\|"'`~@#$%^&*+=]+/)
    .filter((w) => w.length >= 4)
    .map((w) => w.toLowerCase());

  if (words.length === 0) return false;

  // Require at least 40% of significant words to appear in output
  const threshold = Math.max(1, Math.ceil(words.length * 0.4));
  let matches = 0;
  for (const word of words) {
    if (outputLower.includes(word)) {
      matches++;
      if (matches >= threshold) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Serialize Reminders for Canvas Tail
// ---------------------------------------------------------------------------

/**
 * Serialize active reminders into XML for injection at the canvas tail.
 */
export function serializeReminders(reminders: EphemeralReminder[]): string {
  if (reminders.length === 0) return '';

  const lines = reminders.map(
    (r, i) => `<reminder index="${i}" source="${r.source}">${r.content}</reminder>`,
  );

  return `\n<!-- reminders -->\n${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Preset Reminder Factories
// ---------------------------------------------------------------------------

/**
 * Create a loop warning reminder.
 */
export function createLoopWarningReminder(
  detector: string,
  count: number,
  message: string,
): Omit<EphemeralReminder, 'id' | 'createdAtStep'> {
  return {
    content: loopWarningContent(detector, count, message),
    placement: 'tail',
    maxDistance: 3,
    autoRemoveOn: 'acknowledged',
    source: 'loop_detection',
  };
}

/**
 * Create a format correction reminder.
 */
export function createFormatReminder(
  failedTag: string,
): Omit<EphemeralReminder, 'id' | 'createdAtStep'> {
  return {
    content: formatReminderContent(failedTag),
    placement: 'tail',
    maxDistance: 2,
    autoRemoveOn: 'distance',
    source: 'runtime',
  };
}

/**
 * Create an error recovery reminder.
 */
export function createErrorRecoveryReminder(
  error: string,
): Omit<EphemeralReminder, 'id' | 'createdAtStep'> {
  return {
    content: errorRecoveryContent(error),
    placement: 'tail',
    maxDistance: 3,
    autoRemoveOn: 'acknowledged',
    source: 'error_recovery',
  };
}

// ---------------------------------------------------------------------------
// Additional Preset Reminder Factories
// ---------------------------------------------------------------------------

/**
 * Create a user sideband reminder (injected via external user input during execution).
 */
export function createUserSidebandReminder(
  message: string,
): Omit<EphemeralReminder, 'id' | 'createdAtStep'> {
  return {
    content: userSidebandContent(message),
    placement: 'tail',
    maxDistance: 5,
    autoRemoveOn: 'acknowledged',
    source: 'user',
  };
}

/**
 * Create a context budget reminder (warns the model that canvas is nearing capacity).
 */
export function createContextBudgetReminder(): Omit<EphemeralReminder, 'id' | 'createdAtStep'> {
  return {
    content: CONTEXT_BUDGET_WARNING,
    placement: 'tail',
    maxDistance: 1,
    autoRemoveOn: 'distance',
    source: 'runtime',
  };
}

/**
 * Create a flow-aborted reminder (tells the model the previous turn was interrupted).
 */
export function createFlowAbortedReminder(): Omit<EphemeralReminder, 'id' | 'createdAtStep'> {
  return {
    content: flowAbortedContent(),
    placement: 'tail',
    maxDistance: 1,
    autoRemoveOn: 'acknowledged',
    source: 'runtime',
  };
}

/**
 * Create a subagent-completed reminder (notifies the model that dispatched subagents have finished).
 */
export function createSubagentCompletedReminder(
  taskIds: string[],
): Omit<EphemeralReminder, 'id' | 'createdAtStep'> {
  return {
    content: subagentCompletedContent(taskIds),
    placement: 'tail',
    maxDistance: 3,
    autoRemoveOn: 'acknowledged',
    source: 'runtime',
  };
}
