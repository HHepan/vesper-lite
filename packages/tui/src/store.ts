// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Event Store (bridges NDJSON wire events → React state)
//
// Timeline reduction is delegated to the shared TimelineReducer from
// @vesper/shared. This file owns session-level state (tasks, permissions,
// provider requests, canvas/session browsers) and the ~50ms debounce that
// batches stream deltas for the terminal renderer.
//
// Uses a unified timeline to preserve event ordering:
//   thinking → tool → thinking → text (not grouped by type)
// ═══════════════════════════════════════════════════════════════════════════

import {
  TimelineReducer,
  deriveFromTimeline,
  type TimelineItem,
  type TimelineTextEntry,
  type TimelineThinkingEntry,
  type TimelineToolCallEntry,
  type TimelineTurn,
} from '@vesper/shared';
import type {
  StreamEvent,
  TokenBudgetSnapshot,
  DiagnosticsReport,
  TaskItem,
  ToolResultMeta,
  CanvasBrowserSnapshot,
  AskUserQuestion,
  AskUserAnswers,
  SubflowTag,
} from '@vesper/shared';

export type { SubflowTag };

/** Re-export shared timeline types under their legacy local names. */
export type {
  TimelineItem,
  TimelineTextEntry as TextEntry,
  TimelineThinkingEntry as ThinkingEntry,
  TimelineToolCallEntry as ToolCallEntry,
  TimelineTurn as TurnEntry,
};

// ---------------------------------------------------------------------------
// Helpers — Elapsed time formatting
// ---------------------------------------------------------------------------

/** Format elapsed milliseconds as a human-readable duration string (e.g. "3s", "1m 27s"). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

// ---------------------------------------------------------------------------
// Store Types
// ---------------------------------------------------------------------------

export interface PendingPermission {
  requestId: string;
  toolName: string;
  args: Record<string, any>;
  argsPreview: string;
}

export interface PendingAskUser {
  requestId: string;
  questions: AskUserQuestion[];
}

export interface CanvasBrowserState {
  snapshot: CanvasBrowserSnapshot;
  selectedIndex: number;
  mode: 'list' | 'inspect' | 'edit';
  inspectContent?: string;
  inspectBlockId?: string;
  editBlockId?: string;
  editContent?: string;
  scrollOffset: number;
}

// ---------------------------------------------------------------------------
// Subagent Types
// ---------------------------------------------------------------------------

export interface SubagentEntry {
  taskId: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  verb: string;
  toolName?: string;
  tokenUsage?: { promptTokens: number; completionTokens: number };
  spawnedAt: number;
  completedAt?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Session Browser Types
// ---------------------------------------------------------------------------

export interface SavedSessionSummary {
  id: string;
  name: string;
  checkpointCount: number;
  updatedAt: string;
}

export interface SessionBrowserState {
  sessions: SavedSessionSummary[];
  selectedIndex: number;
  scrollOffset: number;
}

// ---------------------------------------------------------------------------
// Provider Request Types
// ---------------------------------------------------------------------------

export interface ProviderRequestEntry {
  requestId: string;
  status: string;
  model: string;
  startedAt: number;
  elapsedMs: number;
  attempt: number;
  error?: string;
  retryReason?: string;
  retryDelayMs?: number;
  retryStartedAt?: number;
  maxRetries?: number;
  extendedRetry?: boolean;
  extendedRetryCount?: number;
}

export interface TuiStoreState {
  /** Completed past turns (read-only history). */
  turns: TimelineTurn[];
  /** Current in-progress turn's assistant text. */
  assistantText: string;
  /** Frozen (completed) items from the current turn — pushed to Static for incremental rendering. */
  frozenTimeline: TimelineItem[];
  /** Active tail of the current turn — kept in dynamic zone. */
  timeline: TimelineItem[];
  /** Current in-progress turn's thinking entries (derived from timeline). */
  thinkingEntries: TimelineThinkingEntry[];
  /** Current in-progress turn's tool entries (derived from timeline). */
  toolEntries: TimelineToolCallEntry[];
  tokenBudget: TokenBudgetSnapshot | null;
  diagnostics: DiagnosticsReport | null;
  status: 'idle' | 'streaming' | 'done' | 'error';
  lastError: string | null;
  pendingSidebands: string[];
  /** Model name for StatusBar display. */
  modelName: string;
  /** Input history for up/down arrow navigation (most recent last). */
  inputHistory: string[];
  /** The user prompt for the current in-progress turn. */
  currentUserPrompt: string;
  /** Active permission request awaiting user decision (null = none). */
  pendingPermission: PendingPermission | null;
  /** Active ask_user request awaiting user answers (null = none). */
  pendingAskUser: PendingAskUser | null;
  /** Last provider usage data (real token counts from API). */
  lastProviderUsage: { promptTokens: number; completionTokens: number; cachedTokens?: number; cost?: number } | null;
  /** Accumulated provider usage across all LLM calls in the session. */
  cumulativeUsage: { promptTokens: number; completionTokens: number; cachedTokens: number; cost: number };
  /** Current task list (auto-updated by task_snapshot events). */
  tasks: TaskItem[];
  /** Active/completed subagents for status panel display. */
  subagents: SubagentEntry[];
  /** Canvas browser modal state (null = closed). */
  canvasBrowser: CanvasBrowserState | null;
  /** Session browser panel state (opened by /sessions). */
  sessionBrowser: SessionBrowserState | null;
  /** Current tool profile name (null = default/none, undefined = not yet received). */
  currentToolset: string | null | undefined;
  /** Current persona name (null = none, undefined = not yet received). */
  currentPersona: string | null | undefined;
  /** Available tool profiles. */
  availableToolsets: Array<{ name: string; description: string }>;
  /** Currently loaded skill names. */
  loadedSkills: string[];
  /** Available skills discovered from skill paths. */
  availableSkills: Array<{ name: string; description: string }>;
  /** Available personas for persona switcher. */
  availablePersonas: Array<{ name: string; displayName: string; description: string; isActive: boolean }>;
  /** Active provider requests for status display. */
  providerRequests: ProviderRequestEntry[];
  /** Supervisor mode: true when active. */
  supervisorMode: boolean;
  supervisorRules: string;
  /** Dynamic provider: current provider info. */
  currentProvider: { model: string; baseURL: string; providerType: string; profile?: string } | null;
  /** Dynamic provider: available profile names from config. */
  availableProfiles: string[];
}

export interface TuiStore {
  handleEvent(event: StreamEvent | { type: string; [key: string]: any }): void;
  toggleToolCollapse(id: string): void;
  toggleThinkingCollapse(id: string): void;
  /** Start a new turn: archives current turn (if any) and resets streaming state. */
  startNewTurn(userPrompt: string): void;
  /** Force status back to idle (call after flow completes to re-enable input). */
  markIdle(): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): TuiStoreState;
  /** Set the model name for StatusBar display. */
  setModelName(name: string): void;
  /** Push an input to the history (max 100 entries). */
  pushInputHistory(input: string): void;
  /** Add a message to the pending sideband area (e.g. queued run). */
  addPending(message: string): void;
  /** Remove a message from the pending sideband area (e.g. run_started consumed it). */
  removePending(message: string): void;
  /** Respond to a pending permission request with optional deny reason. */
  respondPermission(decision: import('@vesper/shared').PermissionDecision, denyReason?: string): void;
  /** Register the callback that sends permission responses to core. */
  setPermissionResponder(fn: (requestId: string, decision: import('@vesper/shared').PermissionDecision, denyReason?: string) => void): void;
  /** Respond to a pending ask_user request. */
  respondAskUser(answers: AskUserAnswers): void;
  /** Register the callback that sends ask_user responses to core. */
  setAskUserResponder(fn: (requestId: string, answers: AskUserAnswers) => void): void;
  /** Add a system message to the frozen timeline (for session/canvas feedback). */
  addSystemMessage(text: string): void;
  /** Update the task list (driven by task_snapshot wire events). */
  setTasks(tasks: TaskItem[]): void;
  /** Open the canvas browser modal with initial snapshot. */
  openCanvasBrowser(snapshot: CanvasBrowserSnapshot): void;
  /** Close the canvas browser modal. */
  closeCanvasBrowser(): void;
  /** Update browser snapshot (after fold/unfold/delete). Preserves selected index. */
  updateCanvasBrowser(snapshot: CanvasBrowserSnapshot): void;
  /** Navigate selection up/down in canvas browser list. */
  canvasBrowserNavigate(delta: number): void;
  /** Switch to inspect mode with full block content. */
  canvasBrowserSetInspect(blockId: string, content: string): void;
  /** Switch to edit mode. */
  canvasBrowserStartEdit(blockId: string, content: string): void;
  /** Return from inspect/edit to list mode. */
  canvasBrowserBackToList(): void;
  /** Update edit content (as user types). */
  canvasBrowserSetEditContent(content: string): void;
  /** Open the session browser modal with initial sessions list. */
  openSessionBrowser(sessions: SavedSessionSummary[]): void;
  /** Close the session browser modal. */
  closeSessionBrowser(): void;
  /** Navigate selection up/down in session browser list. */
  sessionBrowserNavigate(delta: number): void;
  /** Navigate to first item in session browser. */
  sessionBrowserNavigateTop(): void;
  /** Navigate to last item in session browser. */
  sessionBrowserNavigateBottom(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createInitialState(): TuiStoreState {
  return {
    turns: [],
    assistantText: '',
    frozenTimeline: [],
    timeline: [],
    thinkingEntries: [],
    toolEntries: [],
    tokenBudget: null,
    diagnostics: null,
    status: 'idle',
    lastError: null,
    pendingSidebands: [],
    modelName: '',
    inputHistory: [],
    currentUserPrompt: '',
    pendingPermission: null,
    pendingAskUser: null,
    lastProviderUsage: null,
    cumulativeUsage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 },
    tasks: [],
    subagents: [],
    canvasBrowser: null,
    sessionBrowser: null,
    currentToolset: undefined,
    currentPersona: undefined,
    availableToolsets: [],
    loadedSkills: [],
    availableSkills: [],
    availablePersonas: [],
    providerRequests: [],
    supervisorMode: false,
    supervisorRules: '',
    currentProvider: null,
    availableProfiles: [],
  };
}

export function createTuiStore(): TuiStore {
  const reducer = new TimelineReducer({
    defaultCollapsed: false,   // TUI always renders expanded — Ink <Static> can't toggle
    expandedToolNames: [],     // no script-tool exception needed (nothing collapses)
    maxInlineContent: undefined, // no truncation — terminal handles long output
    doneStatus: 'done',        // 'done' distinct from 'idle'; markIdle() forces idle
    linkMessageKind: false,    // TUI renders sideband-consumed as 💬 prompt items
  });

  let state = createInitialState();
  pullFromReducer();

  const listeners = new Set<() => void>();

  // Subagent auto-cleanup: completed subagents are removed after 30s
  const SUBAGENT_CLEANUP_DELAY_MS = 30000;
  const subagentCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Text debounce: batch ~50ms for ~20fps (reduces terminal repaint frequency)
  let textTimer: ReturnType<typeof setTimeout> | null = null;
  let thinkingTimer: ReturnType<typeof setTimeout> | null = null;

  let batchDepth = 0;
  let batchDirty = false;

  function notify(): void {
    if (batchDepth > 0) {
      batchDirty = true;
      return;
    }
    for (const fn of listeners) fn();
  }

  /** Mirror reducer-owned fields into state and refresh derived lists. */
  function pullFromReducer(): void {
    const rs = reducer.state;
    const all = [...rs.frozenTimeline, ...rs.timeline];
    const { thinkingEntries, toolEntries, assistantText } = deriveFromTimeline(all);
    state = {
      ...state,
      turns: rs.turns,
      frozenTimeline: rs.frozenTimeline,
      timeline: rs.timeline,
      status: rs.status,
      lastError: rs.lastError,
      currentUserPrompt: rs.currentUserPrompt,
      thinkingEntries,
      toolEntries,
      assistantText,
    };
  }

  function handleEvent(event: StreamEvent | { type: string; [key: string]: any }): void {
    batchDepth++;
    batchDirty = false;
    try {
      const consumed = reducer.handleEvent(event);
      pullFromReducer();

      if (consumed) {
        // Debounce text/thinking flushes; other consumed events flush via pull.
        if (event.type === 'text' && !textTimer) {
          textTimer = setTimeout(() => {
            textTimer = null;
            reducer.flushBuffers();
            pullFromReducer();
            notify();
          }, 50);
        } else if (event.type === 'thinking' && !thinkingTimer) {
          thinkingTimer = setTimeout(() => {
            thinkingTimer = null;
            reducer.flushBuffers();
            pullFromReducer();
            notify();
          }, 50);
        } else if (event.type !== 'text' && event.type !== 'thinking') {
          if (textTimer) { clearTimeout(textTimer); textTimer = null; }
          if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
        }

        // Session-level updates the reducer doesn't own.
        switch (event.type) {
          case 'sideband_injected':
            state = { ...state, pendingSidebands: [...state.pendingSidebands, event.message] };
            break;
          case 'sideband_consumed': {
            const idx = state.pendingSidebands.indexOf(event.message);
            if (idx !== -1) {
              const updated = [...state.pendingSidebands];
              updated.splice(idx, 1);
              state = { ...state, pendingSidebands: updated };
            }
            break;
          }
        }
        notify();
        return;
      }

      // ── Session-level events not owned by the reducer ────────────
      switch (event.type) {
        case 'token_budget': {
          state = { ...state, tokenBudget: event.snapshot };
          break;
        }

        case 'diagnostics_update': {
          state = { ...state, diagnostics: event.report };
          break;
        }

        case 'permission_request': {
          state = {
            ...state,
            pendingPermission: {
              requestId: event.requestId,
              toolName: event.toolName,
              args: event.args,
              argsPreview: event.argsPreview,
            },
          };
          break;
        }

        case 'ask_user_request': {
          state = {
            ...state,
            pendingAskUser: {
              requestId: event.requestId,
              questions: event.questions,
            },
          };
          break;
        }

        case 'permission_resolved': {
          if (state.pendingPermission?.requestId === (event as any).requestId) {
            state = { ...state, pendingPermission: null };
          }
          break;
        }

        case 'ask_user_resolved': {
          if (state.pendingAskUser?.requestId === (event as any).requestId) {
            state = { ...state, pendingAskUser: null };
          }
          break;
        }

        case 'subagent_spawned': {
          const existing = state.subagents.find(s => s.taskId === (event as any).taskId);
          if (!existing) {
            state = {
              ...state,
              subagents: [...state.subagents, {
                taskId: (event as any).taskId,
                prompt: (event as any).prompt,
                status: 'running',
                verb: 'Starting...',
                spawnedAt: Date.now(),
              }],
            };
          }
          break;
        }

        case 'subagent_status': {
          const ev = event as any;
          state = {
            ...state,
            subagents: state.subagents.map(s =>
              s.taskId === ev.taskId
                ? {
                    ...s,
                    verb: ev.verb ?? s.verb,
                    toolName: ev.toolName,
                    tokenUsage: ev.tokenUsage ?? s.tokenUsage,
                  }
                : s,
            ),
          };
          break;
        }

        case 'subagent_complete': {
          const ev = event as any;
          const isError = !!ev.error;
          const completeTime = Date.now();
          state = {
            ...state,
            subagents: state.subagents.map(s =>
              s.taskId === ev.taskId
                ? {
                    ...s,
                    status: isError ? 'failed' as const : 'completed' as const,
                    verb: isError ? 'Failed' : 'Completed',
                    toolName: undefined,
                    completedAt: completeTime,
                    error: ev.error,
                    ...(ev.tokenUsage ? { tokenUsage: ev.tokenUsage } : {}),
                  }
                : s,
            ),
          };
          const existingTimer = subagentCleanupTimers.get(ev.taskId);
          if (existingTimer) clearTimeout(existingTimer);
          const timer = setTimeout(() => {
            state = { ...state, subagents: state.subagents.filter(s => s.taskId !== ev.taskId) };
            subagentCleanupTimers.delete(ev.taskId);
            notify();
          }, SUBAGENT_CLEANUP_DELAY_MS);
          subagentCleanupTimers.set(ev.taskId, timer);
          break;
        }

        case 'subagent_consumed': {
          const ev = event as any;
          const tmr = subagentCleanupTimers.get(ev.taskId);
          if (tmr) {
            clearTimeout(tmr);
            subagentCleanupTimers.delete(ev.taskId);
          }
          state = {
            ...state,
            subagents: state.subagents.filter(s => s.taskId !== ev.taskId),
          };
          break;
        }

        case 'provider_usage': {
          const prev = state.cumulativeUsage;
          state = {
            ...state,
            lastProviderUsage: {
              promptTokens: event.promptTokens,
              completionTokens: event.completionTokens,
              cachedTokens: event.cachedTokens,
              cost: event.cost,
            },
            cumulativeUsage: {
              promptTokens: prev.promptTokens + (event.promptTokens ?? 0),
              completionTokens: prev.completionTokens + (event.completionTokens ?? 0),
              cachedTokens: prev.cachedTokens + (event.cachedTokens ?? 0),
              cost: prev.cost + (event.cost ?? 0),
            },
          };
          break;
        }

        case 'task_snapshot': {
          state = { ...state, tasks: event.tasks };
          break;
        }

        case 'toolset_skill_state': {
          const ev = event as any;
          state = {
            ...state,
            currentToolset: ev.toolsetName,
            currentPersona: ev.personaName ?? null,
            availableToolsets: ev.availableToolsets,
            loadedSkills: ev.loadedSkills,
            availableSkills: ev.availableSkills,
            availablePersonas: ev.availablePersonas ?? state.availablePersonas,
          };
          break;
        }

        case 'provider_request_start':
        case 'provider_request_update': {
          const req = (event as any).request;
          if (req?.requestId) {
            const existing = state.providerRequests;
            const ridx = existing.findIndex((r) => r.requestId === req.requestId);
            const updated = ridx >= 0
              ? [...existing.slice(0, ridx), req, ...existing.slice(ridx + 1)]
              : [...existing, req];
            state = { ...state, providerRequests: updated };
          }
          break;
        }

        case 'provider_request_end': {
          state = {
            ...state,
            providerRequests: state.providerRequests.filter((r) => r.requestId !== (event as any).requestId),
          };
          break;
        }

        case 'provider_request_snapshot': {
          state = { ...state, providerRequests: (event as any).requests ?? [] };
          break;
        }

        case 'supervisor_state': {
          const ev = event as any;
          state = {
            ...state,
            supervisorMode: !!ev.active,
            supervisorRules: ev.rules ?? '',
          };
          break;
        }

        case 'provider_switched': {
          const ev = event as any;
          state = {
            ...state,
            currentProvider: {
              model: ev.model,
              baseURL: ev.baseURL,
              providerType: ev.providerType,
              profile: ev.profile,
            },
            modelName: ev.model,
          };
          break;
        }

        case 'provider_state': {
          const ev = event as any;
          state = {
            ...state,
            currentProvider: {
              model: ev.model,
              baseURL: ev.baseURL,
              providerType: ev.providerType,
              profile: ev.currentProfile,
            },
            availableProfiles: ev.availableProfiles ?? [],
            modelName: ev.model,
          };
          break;
        }

        default:
          return;
      }

      notify();
    } finally {
      batchDepth--;
      if (batchDirty) {
        batchDirty = false;
        for (const fn of listeners) fn();
      }
    }
  }

  function toggleToolCollapse(id: string): void {
    reducer.toggleToolCollapse(id);
    pullFromReducer();
    notify();
  }

  function toggleThinkingCollapse(id: string): void {
    reducer.toggleThinkingCollapse(id);
    pullFromReducer();
    notify();
  }

  function startNewTurn(userPrompt: string): void {
    if (textTimer) { clearTimeout(textTimer); textTimer = null; }
    if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
    reducer.startNewTurn(userPrompt);
    pullFromReducer();
    notify();
  }

  function markIdle(): void {
    if (textTimer) { clearTimeout(textTimer); textTimer = null; }
    if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
    reducer.markIdle();
    pullFromReducer();
    notify();
  }

  function setModelName(name: string): void {
    state = { ...state, modelName: name };
    notify();
  }

  function pushInputHistory(input: string): void {
    const history = [...state.inputHistory, input];
    if (history.length > 100) history.shift();
    state = { ...state, inputHistory: history };
    notify();
  }

  // Permission responder callback — set by TUI client
  let permissionResponder: ((requestId: string, decision: import('@vesper/shared').PermissionDecision, denyReason?: string) => void) | null = null;

  function setPermissionResponder(fn: (requestId: string, decision: import('@vesper/shared').PermissionDecision, denyReason?: string) => void): void {
    permissionResponder = fn;
  }

  function respondPermission(decision: import('@vesper/shared').PermissionDecision, denyReason?: string): void {
    const pending = state.pendingPermission;
    if (!pending) return;
    state = { ...state, pendingPermission: null };
    notify();
    if (permissionResponder) {
      permissionResponder(pending.requestId, decision, denyReason);
    }
  }

  // Ask user responder callback — set by TUI client
  let askUserResponder: ((requestId: string, answers: AskUserAnswers) => void) | null = null;

  function setAskUserResponder(fn: (requestId: string, answers: AskUserAnswers) => void): void {
    askUserResponder = fn;
  }

  function respondAskUser(answers: AskUserAnswers): void {
    const pending = state.pendingAskUser;
    if (!pending) return;
    state = { ...state, pendingAskUser: null };
    notify();
    if (askUserResponder) {
      askUserResponder(pending.requestId, answers);
    }
  }

  function addPending(message: string): void {
    state = { ...state, pendingSidebands: [...state.pendingSidebands, message] };
    notify();
  }

  function removePending(message: string): void {
    const idx = state.pendingSidebands.indexOf(message);
    if (idx !== -1) {
      const updated = [...state.pendingSidebands];
      updated.splice(idx, 1);
      state = { ...state, pendingSidebands: updated };
      notify();
    }
  }

  function addSystemMessage(text: string): void {
    reducer.addSystemMessage(text);
    pullFromReducer();
    notify();
  }

  function setTasks(tasks: TaskItem[]): void {
    state = { ...state, tasks };
    notify();
  }

  // --- Canvas Browser methods ---

  function openCanvasBrowser(snapshot: CanvasBrowserSnapshot): void {
    state = {
      ...state,
      canvasBrowser: {
        snapshot,
        selectedIndex: 0,
        mode: 'list',
        scrollOffset: 0,
      },
    };
    notify();
  }

  function closeCanvasBrowser(): void {
    state = { ...state, canvasBrowser: null };
    notify();
  }

  function updateCanvasBrowser(snapshot: CanvasBrowserSnapshot): void {
    if (!state.canvasBrowser) return;
    const maxIdx = Math.max(0, snapshot.blocks.length - 1);
    state = {
      ...state,
      canvasBrowser: {
        ...state.canvasBrowser,
        snapshot,
        selectedIndex: Math.min(state.canvasBrowser.selectedIndex, maxIdx),
      },
    };
    notify();
  }

  function canvasBrowserNavigate(delta: number): void {
    if (!state.canvasBrowser || state.canvasBrowser.mode !== 'list') return;
    const count = state.canvasBrowser.snapshot.blocks.length;
    if (count === 0) return;
    const newIdx = Math.max(0, Math.min(count - 1, state.canvasBrowser.selectedIndex + delta));
    state = {
      ...state,
      canvasBrowser: { ...state.canvasBrowser, selectedIndex: newIdx },
    };
    notify();
  }

  function canvasBrowserSetInspect(blockId: string, content: string): void {
    if (!state.canvasBrowser) return;
    state = {
      ...state,
      canvasBrowser: {
        ...state.canvasBrowser,
        mode: 'inspect',
        inspectBlockId: blockId,
        inspectContent: content,
      },
    };
    notify();
  }

  function canvasBrowserStartEdit(blockId: string, content: string): void {
    if (!state.canvasBrowser) return;
    state = {
      ...state,
      canvasBrowser: { ...state.canvasBrowser, mode: 'edit', editBlockId: blockId, editContent: content },
    };
    notify();
  }

  function canvasBrowserBackToList(): void {
    if (!state.canvasBrowser) return;
    state = {
      ...state,
      canvasBrowser: {
        ...state.canvasBrowser,
        mode: 'list',
        inspectBlockId: undefined,
        inspectContent: undefined,
        editBlockId: undefined,
        editContent: undefined,
      },
    };
    notify();
  }

  function canvasBrowserSetEditContent(content: string): void {
    if (!state.canvasBrowser || state.canvasBrowser.mode !== 'edit') return;
    state = {
      ...state,
      canvasBrowser: { ...state.canvasBrowser, editContent: content },
    };
    notify();
  }

  // --- Session Browser methods ---

  function openSessionBrowser(sessions: SavedSessionSummary[]): void {
    state = {
      ...state,
      sessionBrowser: { sessions, selectedIndex: 0, scrollOffset: 0 },
    };
    notify();
  }

  function closeSessionBrowser(): void {
    state = { ...state, sessionBrowser: null };
    notify();
  }

  function sessionBrowserNavigate(delta: number): void {
    if (!state.sessionBrowser) return;
    const count = state.sessionBrowser.sessions.length;
    if (count === 0) return;
    const newIdx = Math.max(0, Math.min(count - 1, state.sessionBrowser.selectedIndex + delta));
    state = {
      ...state,
      sessionBrowser: { ...state.sessionBrowser, selectedIndex: newIdx },
    };
    notify();
  }

  function sessionBrowserNavigateTop(): void {
    if (!state.sessionBrowser) return;
    state = {
      ...state,
      sessionBrowser: { ...state.sessionBrowser, selectedIndex: 0, scrollOffset: 0 },
    };
    notify();
  }

  function sessionBrowserNavigateBottom(): void {
    if (!state.sessionBrowser) return;
    const count = state.sessionBrowser.sessions.length;
    if (count === 0) return;
    state = {
      ...state,
      sessionBrowser: { ...state.sessionBrowser, selectedIndex: count - 1 },
    };
    notify();
  }

  function reset(): void {
    if (textTimer) { clearTimeout(textTimer); textTimer = null; }
    if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
    reducer.reset();
    state = createInitialState();
    pullFromReducer();
    notify();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function getSnapshot(): TuiStoreState {
    return state;
  }

  return {
    handleEvent,
    toggleToolCollapse,
    toggleThinkingCollapse,
    startNewTurn,
    markIdle,
    reset,
    subscribe,
    getSnapshot,
    setModelName,
    addPending,
    removePending,
    pushInputHistory,
    respondPermission,
    setPermissionResponder,
    respondAskUser,
    setAskUserResponder,
    addSystemMessage,
    setTasks,
    openCanvasBrowser,
    closeCanvasBrowser,
    updateCanvasBrowser,
    canvasBrowserNavigate,
    canvasBrowserSetInspect,
    canvasBrowserStartEdit,
    canvasBrowserBackToList,
    canvasBrowserSetEditContent,
    openSessionBrowser,
    closeSessionBrowser,
    sessionBrowserNavigate,
    sessionBrowserNavigateTop,
    sessionBrowserNavigateBottom,
  };
}
