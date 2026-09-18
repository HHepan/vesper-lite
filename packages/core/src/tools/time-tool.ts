// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Time Awareness Tool
// Provides `get_current_time` for agent time perception.
// Runtime also injects synthetic calls on a timer to give passive time sense.
// ═══════════════════════════════════════════════════════════════════════════

import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry } from '@vesper/shared';
import { resolveConstant } from '../prompt-store.js';
import { timeAwarenessFormat } from '../prompts.js';

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const timeToolDef: ToolDefinition = {
  name: 'get_current_time',
  description: 'Get the current date and time. Use this when you need to know what time it is — for example, to gauge how long you\'ve been working, or to timestamp a decision.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Format current time as a concise string.
 * Example: "Current time: 2026-03-01 00:35:47 UTC+8"
 */
export const timeExecutor: ToolExecutor = async (_args: Record<string, any>): Promise<ToolResult> => {
  return { content: formatCurrentTime() };
};

// ---------------------------------------------------------------------------
// Format Helper (shared by executor and synthetic injection)
// ---------------------------------------------------------------------------

/**
 * Produce the time string used in both real and synthetic tool results.
 * Uses the configurable timeAwarenessFormat template.
 */
export function formatCurrentTime(): string {
  const now = new Date();

  // UTC offset in ±H or ±HH:MM format
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absH = Math.floor(Math.abs(offsetMin) / 60);
  const absM = Math.abs(offsetMin) % 60;
  const tz = absM === 0 ? `UTC${sign}${absH}` : `UTC${sign}${absH}:${String(absM).padStart(2, '0')}`;

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const timeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

  // Use configurable template
  return timeAwarenessFormat(dateStr, timeStr, tz);
}

// ---------------------------------------------------------------------------
// Tool Entry (definition + executor pair)
// ---------------------------------------------------------------------------

export const timeTool: ToolEntry = {
  definition: timeToolDef,
  executor: timeExecutor,
};
