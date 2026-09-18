// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Hook System (plugin extensibility)
// ═══════════════════════════════════════════════════════════════════════════

import type { AgentState, ToolCall, ToolResult, HookEvent, ToolExecutorRegistry, HookHandler, HookRegistry, SystemPromptSection } from '@vesper/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { HookEvent, HookHandler, HookRegistry };

export interface PromptBuildHookContext {
  systemPrompt: string;
  sections?: SystemPromptSection[];
  state: AgentState;
}

export interface BeforeToolHookContext {
  toolCall: ToolCall;
  state: AgentState;
  cancel?: boolean;
  modifiedArgs?: Record<string, any>;
}

export interface AfterToolHookContext {
  toolCall: ToolCall;
  result: ToolResult;
  state: AgentState;
  modifiedResult?: ToolResult;
  executors?: ToolExecutorRegistry;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHookRegistry(): HookRegistry {
  const handlers = new Map<HookEvent, HookHandler[]>();

  function ensureList(event: HookEvent): HookHandler[] {
    let list = handlers.get(event);
    if (!list) {
      list = [];
      handlers.set(event, list);
    }
    return list;
  }

  function register<T>(event: HookEvent, handler: HookHandler<T>): void {
    const list = ensureList(event);
    list.push(handler as HookHandler);
    // Keep sorted by priority (ascending)
    list.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  function unregister(event: HookEvent, handlerName: string): void {
    const list = handlers.get(event);
    if (!list) return;
    const idx = list.findIndex((h) => h.name === handlerName);
    if (idx !== -1) list.splice(idx, 1);
  }

  async function run<T>(event: HookEvent, ctx: T): Promise<T> {
    const list = handlers.get(event);
    if (!list || list.length === 0) return ctx;

    let current = ctx;
    for (const h of list) {
      try {
        const result = await h.handler(current);
        if (result !== undefined && result !== null) {
          current = result as T;
        }
      } catch (err) {
        // Single handler failure does not block pipeline — log warning
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[hooks] handler "${h.name}" on "${event}" failed: ${msg}`);
      }
    }
    return current;
  }

  return { register, unregister, run };
}
