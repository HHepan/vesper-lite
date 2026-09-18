// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Prompt Builder (System prompt modular assembler)
// Cleaned open-source edition: unified assistant, canvas history, tools, env.
// ═══════════════════════════════════════════════════════════════════════════

import type { AgentState, PromptSection, PromptOptions, SystemPromptSection } from '@vesper/shared';
import {
  SYSTEM,
  CANVAS_PROTOCOL,
  DOING_TASKS,
  TOOL_USAGE_POLICY,
  TONE_AND_STYLE,
  workspaceContextHeader,
  ARTIFACTS_HEADER,
  STATE_HEADER,
  CRITICAL_RULES_HEADER,
} from './prompts.js';
import { serializeCanvasMarkdown } from './canvas.js';
import { serializeReminders } from './reminder.js';

// Identity and protocol constants are imported from prompts.js (store-backed)

export function buildEnvironmentBlock(env?: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) return '';
  const lines = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}: ${value}`);
  return `<env>\n${lines.join('\n')}\n</env>`;
}

export function buildWorkspaceContext(context?: string): string {
  if (!context) return '';
  return `${workspaceContextHeader(context)}`;
}

export function serializeStructuredState(state: AgentState): string {
  const parts: string[] = [];

  if (Object.keys(state.artifacts).length > 0) {
    parts.push(ARTIFACTS_HEADER);
    for (const [key, value] of Object.entries(state.artifacts).sort(([a], [b]) => a.localeCompare(b))) {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      parts.push(`\n## ${key}\n${serialized}`);
    }
  }

  const publicMeta = Object.entries(state.metadata).filter(
    ([key]) => !key.startsWith('_') && key !== 'criticalSections',
  ).sort(([a], [b]) => a.localeCompare(b));
  if (publicMeta.length > 0) {
    parts.push(`\n${STATE_HEADER}`);
    for (const [key, value] of publicMeta) {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      parts.push(`${key}: ${serialized}`);
    }
  }

  return parts.join('\n');
}

export function buildCriticalRules(sections: PromptSection[]): string {
  const criticalSections = sections.filter((s) => s.priority === 'critical');
  if (criticalSections.length === 0) return '';

  const lines: string[] = [CRITICAL_RULES_HEADER];
  for (const section of criticalSections) {
    const repeatCount = section.repeatCount ?? 1;
    for (let i = 0; i < repeatCount; i++) {
      lines.push('');
      lines.push(section.content);
    }
  }
  return lines.join('\n');
}

export function buildStructuredSystemPrompt(
  state: AgentState,
  options?: PromptOptions,
): SystemPromptSection[] {
  const sections: SystemPromptSection[] = [];

  // 1. Identity & Role
  sections.push({
    name: 'identity',
    content: state.systemPrompt || SYSTEM,
  });

  // 2. Protocols
  sections.push({ name: 'canvas_protocol', content: CANVAS_PROTOCOL });
  sections.push({ name: 'doing_tasks', content: DOING_TASKS });
  sections.push({ name: 'tool_usage_policy', content: TOOL_USAGE_POLICY });
  sections.push({ name: 'tone_and_style', content: TONE_AND_STYLE });

  // 3. Extra instructions
  if (state.provider.extraInstructions) {
    sections.push({ name: 'provider_extra_instructions', content: state.provider.extraInstructions });
  }

  // 4. Workspace context / user instructions
  const wsContext = buildWorkspaceContext(options?.userInstructions);
  if (wsContext) {
    sections.push({ name: 'workspace_context', content: wsContext });
  }

  // 5. Structured state
  const structuredState = serializeStructuredState(state);
  if (structuredState) {
    sections.push({ name: 'structured_state', content: structuredState });
  }

  // 6. Environment
  const envBlock = buildEnvironmentBlock(options?.env);
  if (envBlock) {
    sections.push({ name: 'environment', content: envBlock });
  }

  // 7. Canvas History
  const canvasMarkdown = options?.injectCanvasHistory
    ? serializeCanvasMarkdown(state.canvas)
    : serializeCanvasMarkdown(state.canvas, undefined, true /* activeOnly */);
  if (canvasMarkdown) {
    sections.push({ name: 'canvas_history', content: canvasMarkdown });
  }

  // 8. Reminders
  if (options?.reminders && options.reminders.length > 0) {
    const reminderContent = serializeReminders(options.reminders);
    if (reminderContent) {
      sections.push({ name: 'reminders', content: reminderContent });
    }
  }

  return sections;
}

export function buildSystemPrompt(state: AgentState, options?: PromptOptions): string {
  return buildStructuredSystemPrompt(state, options)
    .map(s => s.content)
    .join('\n\n');
}
