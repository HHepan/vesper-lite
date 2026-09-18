// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Event Store (bridges NDJSON wire events → React state)
//
// Timeline reduction (text/thinking/tool_call/tool_result/done/error/
// run_started/sideband/supervisor_decision) is delegated to the shared
// TimelineReducer from @vesper/shared — this file only owns session-level state
// (tasks, permission dialogs, provider/scene/cron state, canvas/session
// browsers) and the debounce timers that batch stream deltas to ~20fps.
//
// Uses vanilla subscribe()/getSnapshot() for React useSyncExternalStore.
// Each session gets its own store instance via createWebStore().
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Types — shared wire types imported from @vesper/shared.
// WebUI-specific extensions (e.g. TaskItem.activeForm) extend the shared base.
// ---------------------------------------------------------------------------

import {
  TimelineReducer,
  deriveFromTimeline,
  isLinkMessage,
  stripEgoPrefixes,
  type TimelineItem,
  type TimelineTextEntry,
  type TimelineThinkingEntry,
  type TimelineToolCallEntry,
  type TimelineToolResult,
  type TimelineTurn,
  type TimelineInlineImage,
} from '@vesper/shared';
import type {
  SubflowTag, Persona, Role, RoleAssignment, Scene,
  ToolResultMeta, TokenBudgetSnapshot, TaskItem as SharedTaskItem,
  AskUserQuestion, AskUserAnswers, PermissionDecision,
  CanvasBlockSummary, CanvasBrowserSnapshot, CronEntryWire,
} from '@vesper/shared';
export type {
  SubflowTag, Persona, Role, RoleAssignment, Scene,
  ToolResultMeta, TokenBudgetSnapshot,
  AskUserQuestion, AskUserAnswers, PermissionDecision,
  CanvasBlockSummary, CanvasBrowserSnapshot, CronEntryWire,
};

/** Re-export shared timeline types under their legacy local names. */
export type {
  TimelineItem,
  TimelineTextEntry as TextEntry,
  TimelineThinkingEntry as ThinkingEntry,
  TimelineToolCallEntry as ToolCallEntry,
  TimelineToolResult,
  TimelineTurn as TurnEntry,
  TimelineInlineImage as InlineImage,
};

/** WebUI TaskItem extends shared wire type with the activeForm display field. */
export interface TaskItem extends SharedTaskItem {
  /** Short human-readable description of in-progress work (WebUI display). */
  activeForm?: string;
}

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

export interface PendingPermission {
  requestId: string;
  toolName: string;
  args: Record<string, any>;
  argsPreview: string;
  /** Preview metadata for file write/edit operations (diff preview before approval) */
  previewMeta?: ToolResultMeta;
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
// Session Browser Types
// ---------------------------------------------------------------------------

export interface SavedSessionSummary {
  id: string;
  name: string;
  checkpointCount: number;
  /** Wire format sends number (ms epoch); older callers may pass ISO string. */
  updatedAt: string | number;
}

export interface SessionBrowserState {
  sessions: SavedSessionSummary[];
  selectedIndex: number;
  scrollOffset: number;
}

// ---------------------------------------------------------------------------
// Scene Types
// ---------------------------------------------------------------------------

export interface SceneInfo {
  name: string;
  description?: string;
  isActive: boolean;
}

export interface SceneDetail {
  name: string;
  description?: string;
  defaultProfile: string;
  profiles: Array<{ name: string; model: string; baseURL: string }>;
  personas: Array<{ name: string; displayName: string; description: string; profile?: string; ego?: string; source?: string }>;
  roles: Record<string, any>;
  assignments: Array<{ roleName: string; personaName: string; isActive: boolean; customDescription?: string }>;
  subagentAssignments?: Array<{ subagentName: string; personaName?: string }>;
  defaultSupervisorRules?: string;
  cronEntries?: Array<{ tag?: string; description?: string; message: string; repeatMs?: number; frozen?: boolean }>;
  createdAt: number;
  updatedAt: number;
}

export interface WebStoreState {
  sessionId: string;
  /** Completed past turns (read-only history). */
  turns: TimelineTurn[];
  /** Current in-progress turn's assistant text (derived from timeline). */
  assistantText: string;
  /** Frozen (completed) items from the current turn. */
  frozenTimeline: TimelineItem[];
  /** Active tail of the current turn. */
  timeline: TimelineItem[];
  /** Current in-progress turn's thinking entries (derived). */
  thinkingEntries: TimelineThinkingEntry[];
  /** Current in-progress turn's tool entries (derived). */
  toolEntries: TimelineToolCallEntry[];
  tokenBudget: TokenBudgetSnapshot | null;
  ready: boolean;
  status: 'idle' | 'streaming' | 'done' | 'error';
  lastError: string | null;
  pendingSidebands: string[];
  modelName: string;
  inputHistory: string[];
  currentUserPrompt: string;
  pendingPermission: PendingPermission | null;
  pendingAskUser: PendingAskUser | null;
  lastProviderUsage: { promptTokens: number; completionTokens: number; cachedTokens?: number; cost?: number } | null;
  /** Accumulated provider usage across all LLM calls in the session. */
  cumulativeUsage: { promptTokens: number; completionTokens: number; cachedTokens: number; cost: number };
  tasks: TaskItem[];
  /** Active/completed subagents for status panel display. */
  subagents: SubagentEntry[];
  canvasBrowser: CanvasBrowserState | null;
  /** Session browser panel state (opened by /sessions). */
  sessionBrowser: SessionBrowserState | null;
  /** Web-specific: stderr lines from the core process. */
  stderrLines: string[];
  /** Current tool profile name (null = default/none, undefined = not yet received). */
  currentToolset: string | null | undefined;
  /** Current persona name (null = none, undefined = not yet received). */
  currentPersona: string | null | undefined;
  /** Current active role name (undefined = pure ego mode, no role). */
  activeRoleName: string | null | undefined;
  /** Available tool profiles. */
  availableToolsets: Array<{ name: string; description: string }>;
  /** Currently loaded skill names. */
  loadedSkills: string[];
  /** Available skills discovered from skill paths. */
  availableSkills: Array<{ name: string; description: string }>;
  /** Available personas for persona switcher. */
  availablePersonas: Persona[];
  /** Team roles definition. */
  roles: Record<string, Role>;
  /** Team role assignments. */
  assignments: RoleAssignment[];
  /** Available scenes from backend. */
  scenes: SceneInfo[];
  /** Currently active scene name. */
  activeScene: string | null;
  /** Detailed info for currently loaded scene. */
  sceneDetail: SceneDetail | null;

  /** Active provider requests for request control panel. */
  providerRequests: Array<{
    requestId: string; status: string; model: string; startedAt: number;
    elapsedMs: number; attempt: number; error?: string;
    retryReason?: string; retryDelayMs?: number; retryStartedAt?: number; maxRetries?: number;
    extendedRetry?: boolean; extendedRetryCount?: number;
  }>;
  /** Supervisor mode: true when active, with the rules string. */
  supervisorMode: boolean;
  supervisorRules: string;
  /** Dynamic provider: current provider info. */
  currentProvider: { model: string; baseURL: string; providerType: string; profile?: string } | null;
  /** Dynamic provider: available profile names from config. */
  availableProfiles: Array<{ name: string; model?: string }>;
  /** Public mode: when true, chat blocks are marked as non-foldable. */
  publicMode: boolean;
  /** Permission mode: how to handle 'ask'-level tool requests. */
  permissionMode: 'manual' | 'auto' | 'supervisor';
  /** Multi-chat mode: when multiple members are selected, AI members auto-rotate. */
  multiChatMode: boolean;
  /** Selected members for multi-chat (persona-role identifiers, e.g. "Liuli-architect"). */
  selectedMembers: string[];
  /** Cron entries from the scheduler. */
  cronEntries: CronEntryWire[];
  /** Cron counts: created by this session (superscript). */
  cronCreated: number;
  /** Cron counts: targeting this session (subscript). */
  cronTargeted: number;
  /** Whether a cron-triggered run is currently active. false | string (description) | true */
  cronRunning: false | string | true;
  /** Cron data collection settings. */
  cronDataCollection: { enabled: boolean; path: string } | null;
  /** Pending dataset overwrite confirmation dialog. */
  datasetOverwriteDialog: { requestId: string; name: string; path: string } | null;
  /** Whether this session has an unread notification from another session (yellow dot). */
  hasSessionNotification: boolean;
  /** Monotonically increasing counter incremented every time this session is activated/switched to. */
  activationCount: number;
}

export interface WebStore {
  handleEvent(event: any): void;
  toggleToolCollapse(id: string): void;
  toggleThinkingCollapse(id: string): void;
  startNewTurn(userPrompt: string, regenerate?: boolean): void;
  markReady(): void;
  markIdle(): void;
  reset(): void;
  loadSnapshot(snapshot: any): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): WebStoreState;
  setModelName(name: string): void;
  pushInputHistory(input: string): void;
  addPending(message: string): void;
  removePending(message: string): void;
  respondPermission(decision: PermissionDecision, denyReason?: string): void;
  setPermissionResponder(fn: (requestId: string, decision: PermissionDecision, denyReason?: string) => void): void;
  respondAskUser(answers: AskUserAnswers): void;
  setAskUserResponder(fn: (requestId: string, answers: AskUserAnswers) => void): void;
  addSystemMessage(text: string): void;
  setTasks(tasks: TaskItem[]): void;
  openCanvasBrowser(snapshot: CanvasBrowserSnapshot): void;
  closeCanvasBrowser(): void;
  updateCanvasBrowser(snapshot: CanvasBrowserSnapshot): void;
  canvasBrowserNavigate(delta: number): void;
  canvasBrowserNavigateTop(): void;
  canvasBrowserNavigateBottom(): void;
  canvasBrowserSetInspect(blockId: string, content: string): void;
  canvasBrowserStartEdit(blockId: string, content: string): void;
  canvasBrowserBackToList(): void;
  canvasBrowserSetEditContent(content: string): void;
  openSessionBrowser(sessions: SavedSessionSummary[]): void;
  closeSessionBrowser(): void;
  sessionBrowserNavigate(delta: number): void;
  sessionBrowserNavigateTop(): void;
  sessionBrowserNavigateBottom(): void;
  togglePublicMode(): void;
  setPermissionMode(mode: 'manual' | 'auto' | 'supervisor'): void;
  setMultiChatMode(enabled: boolean, members: string[]): void;
  showDatasetOverwriteDialog(requestId: string, name: string, path: string): void;
  dismissDatasetOverwriteDialog(): void;
  setDatasetOverwriteResponder(fn: (requestId: string, decision: 'overwrite' | 'cancel') => void): void;
  respondDatasetOverwrite(decision: 'overwrite' | 'cancel'): void;
  setSessionNotification(): void;
  clearSessionNotification(): void;
  notifyActivated(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let idCounter = 0;
function nextId(): string {
  return `entry-${++idCounter}`;
}

function createInitialState(sessionId: string): WebStoreState {
  return {
    sessionId,
    turns: [],
    assistantText: '',
    frozenTimeline: [],
    timeline: [],
    thinkingEntries: [],
    toolEntries: [],
    tokenBudget: null,
    ready: false,
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
    stderrLines: [],
    currentToolset: undefined,
    currentPersona: undefined,
    activeRoleName: undefined,
    availableToolsets: [],
    loadedSkills: [],
    availableSkills: [],
    availablePersonas: [],
    roles: {},
    assignments: [],
    scenes: [],
    activeScene: null,
    sceneDetail: null,
    providerRequests: [],
    supervisorMode: false,
    supervisorRules: '',
    currentProvider: null,
    availableProfiles: [],
    publicMode: false,
    permissionMode: 'manual',
    multiChatMode: false,
    selectedMembers: [],
    cronEntries: [],
    cronCreated: 0,
    cronTargeted: 0,
    cronRunning: false,
    cronDataCollection: null,
    datasetOverwriteDialog: null,
    hasSessionNotification: false,
    activationCount: 0,
  };
}

/** Fields on WebStoreState that are owned/mirrored by the TimelineReducer. */
const REDUCER_FIELDS = [
  'turns', 'frozenTimeline', 'timeline', 'status', 'lastError', 'currentUserPrompt',
] as const;

export function createWebStore(sessionId: string, options?: { defaultCollapsed?: boolean }): WebStore {
  const defaultCollapsed = options?.defaultCollapsed ?? false;

  const reducer = new TimelineReducer({
    defaultCollapsed,
    expandedToolNames: ['script'],
    maxInlineContent: 2000,
    doneStatus: 'done',
    linkMessageKind: true,
  });

  let state = createInitialState(sessionId);
  // Mirror reducer-owned fields into state (same immutable references).
  pullFromReducer();

  const listeners = new Set<() => void>();

  // Subagent auto-cleanup: completed subagents are removed after 30s
  const SUBAGENT_CLEANUP_DELAY_MS = 30000;
  const subagentCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Text debounce: batch ~50ms for ~20fps (reduces repaint frequency)
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

  /** Copy reducer-owned fields into the WebStore state and refresh derived lists. */
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

  function handleEvent(event: any): void {
    batchDepth++;
    batchDirty = false;
    try {
      // Keep the reducer's persona-aware ego-prefix stripping in sync.
      reducer.setPersonaName(state.currentPersona ?? null);

      // Delegate timeline-owning events to the shared reducer.
      const consumed = reducer.handleEvent(event);
      pullFromReducer();

      if (consumed) {
        // Schedule debounced flush for text/thinking so ~50ms of deltas
        // batch into a single render pass. Other events flush via pull.
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
          // Non-debounced event: if a debounce timer was pending, force-flush
          // now so ordering (e.g. tool_result) sees the buffered content.
          if (textTimer) { clearTimeout(textTimer); textTimer = null; }
          if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
        }

        // Additional session-state updates the reducer doesn't own.
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
          case 'run_started':
            // Clear notification + purge errored provider requests on new run.
            state = {
              ...state,
              hasSessionNotification: false,
              providerRequests: state.providerRequests.filter(r => r.status !== 'error' && r.status !== 'aborted'),
            };
            break;
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

        case 'permission_request': {
          state = {
            ...state,
            pendingPermission: {
              requestId: event.requestId,
              toolName: event.toolName,
              args: event.args,
              argsPreview: event.argsPreview,
              previewMeta: event.previewMeta,
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
          if (state.pendingPermission?.requestId === event.requestId) {
            state = { ...state, pendingPermission: null };
          }
          break;
        }

        case 'ask_user_resolved': {
          if (state.pendingAskUser?.requestId === event.requestId) {
            state = { ...state, pendingAskUser: null };
          }
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
          state = {
            ...state,
            currentToolset: event.toolsetName,
            currentPersona: event.personaName ?? null,
            activeRoleName: event.activeRoleName ?? null,
            availableToolsets: event.availableToolsets,
            loadedSkills: event.loadedSkills,
            availableSkills: event.availableSkills,
            availablePersonas: event.availablePersonas ?? state.availablePersonas,
            roles: event.roles ?? state.roles,
            assignments: event.assignments ?? state.assignments,
          };
          break;
        }

        case 'provider_request_start':
        case 'provider_request_update': {
          const req = event.request;
          if (req?.requestId) {
            const existing = state.providerRequests;
            const idx = existing.findIndex((r: any) => r.requestId === req.requestId);
            const updated = idx >= 0
              ? [...existing.slice(0, idx), req, ...existing.slice(idx + 1)]
              : [...existing, req];
            state = { ...state, providerRequests: updated };
          }
          break;
        }

        case 'provider_request_end': {
          state = {
            ...state,
            providerRequests: state.providerRequests.filter((r: any) => r.requestId !== event.requestId),
          };
          break;
        }

        case 'provider_request_snapshot': {
          state = { ...state, providerRequests: event.requests ?? [] };
          break;
        }

        case 'remote_user_prompt': {
          // Cross-session messages (link_post / session_post) start a new turn.
          const isLink = isLinkMessage(event.input);
          if (isLink) {
            reducer.startNewTurn(event.input, { promptKind: 'link_message' });
            pullFromReducer();
          } else {
            startNewTurn(event.input);
          }
          break;
        }

        case 'session_notification': {
          state = { ...state, hasSessionNotification: true };
          break;
        }

        case 'supervisor_state': {
          state = {
            ...state,
            supervisorMode: !!event.active,
            supervisorRules: event.rules ?? '',
          };
          break;
        }

        case 'permission_mode_changed': {
          state = {
            ...state,
            permissionMode: event.mode ?? 'manual',
            supervisorMode: event.mode === 'supervisor' ? true : event.mode !== 'supervisor' ? false : state.supervisorMode,
          };
          break;
        }

        case 'cron_snapshot': {
          state = { ...state, cronEntries: event.entries ?? [] };
          break;
        }

        case 'cron_counts': {
          state = {
            ...state,
            cronCreated: event.created ?? 0,
            cronTargeted: event.targeted ?? 0,
          };
          break;
        }

        case 'cron_run_status': {
          state = {
            ...state,
            cronRunning: event.active ? (event.description || true) : false,
          };
          break;
        }

        case 'cron_data_collection_status': {
          state = {
            ...state,
            cronDataCollection: event.settings ?? null,
          };
          break;
        }

        case 'provider_switched': {
          state = {
            ...state,
            currentProvider: {
              model: event.model,
              baseURL: event.baseURL,
              providerType: event.providerType,
              profile: event.profile,
            },
            modelName: event.model,
          };
          break;
        }

        case 'provider_state': {
          state = {
            ...state,
            currentProvider: {
              model: event.model,
              baseURL: event.baseURL,
              providerType: event.providerType,
              profile: event.currentProfile,
            },
            availableProfiles: (event.availableProfiles ?? []).map((p: any) => typeof p === 'string' ? { name: p } : p),
            modelName: event.model,
          };
          break;
        }

        case 'scene_state': {
          state = {
            ...state,
            scenes: event.scenes ?? [],
            activeScene: event.activeScene ?? null,
          };
          break;
        }

        case 'scene_loaded': {
          const sc = event.scene;
          state = {
            ...state,
            activeScene: sc?.name ?? null,
            sceneDetail: sc ? {
              name: sc.name,
              description: sc.description,
              defaultProfile: sc.defaultProfile ?? '',
              profiles: Array.isArray(sc.profiles) ? sc.profiles.map((p: any) => ({ name: p.name, model: p.model, baseURL: p.baseURL })) : [],
              personas: Array.isArray(sc.personas) ? sc.personas.map((p: any) => ({ name: p.name, displayName: p.displayName, description: p.description, profile: p.profile, ego: p.ego, source: p.source })) : [],
              roles: sc.roles ?? {},
              assignments: Array.isArray(sc.assignments) ? sc.assignments.map((a: any) => ({ roleName: a.roleName, personaName: a.personaName, isActive: a.isActive, customDescription: a.customDescription })) : [],
              subagentAssignments: sc.subagentAssignments ?? undefined,
              defaultSupervisorRules: sc.defaultSupervisorRules ?? undefined,
              cronEntries: sc.cronEntries ?? undefined,
              createdAt: sc.createdAt ?? Date.now(),
              updatedAt: sc.updatedAt ?? Date.now(),
            } : null,
          };
          break;
        }

        case 'scene_saved': {
          const existing = state.scenes.find(s => s.name === event.name);
          const updatedScenes = existing
            ? state.scenes.map(s => s.name === event.name ? { ...s, isActive: true } : { ...s, isActive: false })
            : [...state.scenes.map(s => ({ ...s, isActive: false })), { name: event.name, isActive: true }];
          state = {
            ...state,
            activeScene: event.name ?? state.activeScene,
            scenes: updatedScenes,
          };
          break;
        }

        case 'scene_deleted': {
          state = {
            ...state,
            scenes: state.scenes.filter(s => s.name !== event.name),
            activeScene: state.activeScene === event.name ? null : state.activeScene,
            sceneDetail: state.sceneDetail?.name === event.name ? null : state.sceneDetail,
          };
          break;
        }

        // --- Web-specific events ---

        case 'ready': {
          const updates: Partial<WebStoreState> = { status: 'idle' };
          if (event.effectiveConfig?.model) {
            updates.modelName = event.effectiveConfig.model;
          }
          state = { ...state, ...updates };
          break;
        }

        case 'stderr': {
          const lines = [...state.stderrLines.slice(-99), event.line];
          state = { ...state, stderrLines: lines };
          break;
        }

        case 'process_exited': {
          state = {
            ...state,
            status: 'error',
            lastError: `Process exited with code ${event.exitCode}`,
          };
          break;
        }

        case 'subagent_spawned': {
          const existing = state.subagents.find(s => s.taskId === event.taskId);
          if (!existing) {
            state = {
              ...state,
              subagents: [...state.subagents, {
                taskId: event.taskId,
                prompt: event.prompt,
                status: 'running',
                verb: 'Starting...',
                spawnedAt: Date.now(),
              }],
            };
          }
          break;
        }

        case 'subagent_status': {
          state = {
            ...state,
            subagents: state.subagents.map(s =>
              s.taskId === event.taskId
                ? {
                    ...s,
                    verb: event.verb ?? s.verb,
                    toolName: event.toolName,
                    tokenUsage: event.tokenUsage ?? s.tokenUsage,
                  }
                : s,
            ),
          };
          break;
        }

        case 'subagent_complete': {
          const isError = !!event.error;
          const completeTime = Date.now();
          state = {
            ...state,
            subagents: state.subagents.map(s =>
              s.taskId === event.taskId
                ? {
                    ...s,
                    status: isError ? 'failed' as const : 'completed' as const,
                    verb: isError ? 'Failed' : 'Completed',
                    toolName: undefined,
                    completedAt: completeTime,
                    error: event.error,
                    ...(event.tokenUsage ? { tokenUsage: event.tokenUsage } : {}),
                  }
                : s,
            ),
          };
          const existingTimer = subagentCleanupTimers.get(event.taskId);
          if (existingTimer) clearTimeout(existingTimer);
          const timer = setTimeout(() => {
            state = { ...state, subagents: state.subagents.filter(s => s.taskId !== event.taskId) };
            subagentCleanupTimers.delete(event.taskId);
            notify();
          }, SUBAGENT_CLEANUP_DELAY_MS);
          subagentCleanupTimers.set(event.taskId, timer);
          break;
        }

        case 'subagent_consumed': {
          const timer = subagentCleanupTimers.get(event.taskId);
          if (timer) {
            clearTimeout(timer);
            subagentCleanupTimers.delete(event.taskId);
          }
          state = {
            ...state,
            subagents: state.subagents.filter(s => s.taskId !== event.taskId),
          };
          break;
        }

        case 'diagnostics_update':
          return;

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

  function startNewTurn(userPrompt: string, regenerate?: boolean): void {
    if (textTimer) { clearTimeout(textTimer); textTimer = null; }
    if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
    reducer.startNewTurn(userPrompt, { regenerate });
    pullFromReducer();
    notify();
  }

  function markReady(): void {
    state = { ...state, ready: true };
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

  // Permission responder
  let permissionResponder: ((requestId: string, decision: PermissionDecision, denyReason?: string) => void) | null = null;

  function setPermissionResponder(fn: (requestId: string, decision: PermissionDecision, denyReason?: string) => void): void {
    permissionResponder = fn;
  }

  function respondPermission(decision: PermissionDecision, denyReason?: string): void {
    const pending = state.pendingPermission;
    if (!pending) return;
    state = { ...state, pendingPermission: null };
    notify();
    if (permissionResponder) {
      permissionResponder(pending.requestId, decision, denyReason);
    }
  }

  // Ask user responder
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
      canvasBrowser: { snapshot, selectedIndex: 0, mode: 'list', scrollOffset: 0 },
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

  function canvasBrowserNavigateTop(): void {
    if (!state.canvasBrowser || state.canvasBrowser.mode !== 'list') return;
    const count = state.canvasBrowser.snapshot.blocks.length;
    if (count === 0) return;
    state = {
      ...state,
      canvasBrowser: { ...state.canvasBrowser, selectedIndex: 0, scrollOffset: 0 },
    };
    notify();
  }

  function canvasBrowserNavigateBottom(): void {
    if (!state.canvasBrowser || state.canvasBrowser.mode !== 'list') return;
    const count = state.canvasBrowser.snapshot.blocks.length;
    if (count === 0) return;
    const lastIdx = count - 1;
    const scrollOffset = Math.max(0, lastIdx - 14);
    state = {
      ...state,
      canvasBrowser: { ...state.canvasBrowser, selectedIndex: lastIdx, scrollOffset },
    };
    notify();
  }

  function canvasBrowserSetInspect(blockId: string, content: string): void {
    if (!state.canvasBrowser) return;
    state = {
      ...state,
      canvasBrowser: { ...state.canvasBrowser, mode: 'inspect', inspectBlockId: blockId, inspectContent: content },
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
    // Rebuild the reducer (timeline state is reset wholesale).
    reducerReset();
    // Reset conversation-level fields, preserve session-lifetime fields.
    const fresh = createInitialState(sessionId);
    state = {
      ...state,
      turns: fresh.turns,
      assistantText: fresh.assistantText,
      frozenTimeline: fresh.frozenTimeline,
      timeline: fresh.timeline,
      thinkingEntries: fresh.thinkingEntries,
      toolEntries: fresh.toolEntries,
      status: fresh.status,
      lastError: fresh.lastError,
      pendingSidebands: fresh.pendingSidebands,
      currentUserPrompt: fresh.currentUserPrompt,
      pendingPermission: fresh.pendingPermission,
      pendingAskUser: fresh.pendingAskUser,
      tasks: fresh.tasks,
      canvasBrowser: fresh.canvasBrowser,
      sessionBrowser: fresh.sessionBrowser,
      stderrLines: fresh.stderrLines,
      providerRequests: fresh.providerRequests,
    };
    notify();
  }

  /** Reset the reducer's internal timeline state (fresh turns/timelines/status). */
  function reducerReset(): void {
    // Swap the reducer for a fresh instance; pullFromReducer re-syncs mirrors.
    const fresh = new TimelineReducer({
      defaultCollapsed,
      expandedToolNames: ['script'],
      maxInlineContent: 2000,
      doneStatus: 'done',
      linkMessageKind: true,
    });
    // Copy the fresh reducer's state into ours by mutating the existing
    // reducer reference is simpler: just replace the internal state object.
    (reducer as any).state = fresh.state;
    (reducer as any).s = (fresh as any).s;
  }

  function loadSnapshot(snapshot: any): void {
    if (textTimer) { clearTimeout(textTimer); textTimer = null; }
    if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }

    // Convert server UITurnEntry[] → client TurnEntry[]
    const turns: TimelineTurn[] = (snapshot.turns ?? []).map((t: any) => ({
      id: nextId(),
      userPrompt: t.userPrompt ?? '',
      timeline: convertTimeline(t.timeline ?? []),
      assistantText: t.assistantText ?? '',
      error: t.error ?? null,
    }));

    const currentTimeline = convertTimeline(snapshot.currentTurnTimeline ?? []);
    const currentUserPrompt = snapshot.currentTurnPrompt ?? '';

    // Seed the reducer with the snapshot's turn history + current timeline.
    reducer.loadTimelineSnapshot({
      turns,
      frozenTimeline: currentTimeline,
      status: snapshot.status ?? 'idle',
      lastError: snapshot.lastError ?? null,
      currentUserPrompt,
    });

    state = {
      ...createInitialState(sessionId),
      turns,
      frozenTimeline: currentTimeline,
      timeline: [],
      tasks: snapshot.tasks ?? [],
      inputHistory: snapshot.inputHistory ?? [],
      modelName: snapshot.modelName ?? '',
      tokenBudget: snapshot.tokenBudget ?? null,
      status: snapshot.status ?? 'idle',
      lastError: snapshot.lastError ?? null,
      pendingPermission: snapshot.pendingPermission ?? null,
      pendingAskUser: snapshot.pendingAskUser ?? null,
      lastProviderUsage: snapshot.lastProviderUsage ?? null,
      cumulativeUsage: snapshot.cumulativeUsage ?? { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 },
      currentUserPrompt,
      ready: true,
      currentToolset: snapshot.currentToolset,
      currentPersona: snapshot.currentPersona ?? undefined,
      activeRoleName: snapshot.activeRoleName ?? undefined,
      availableToolsets: snapshot.availableToolsets ?? [],
      loadedSkills: snapshot.loadedSkills ?? [],
      availableSkills: snapshot.availableSkills ?? [],
      availablePersonas: snapshot.availablePersonas ?? [],
      roles: snapshot.roles ?? state.roles,
      assignments: Array.isArray(snapshot.assignments) ? snapshot.assignments.map((a: any) => ({ roleName: a.roleName, personaName: a.personaName, isActive: a.isActive, customDescription: a.customDescription })) : state.assignments,
      providerRequests: snapshot.providerRequests ?? [],
      supervisorMode: snapshot.supervisorMode ?? false,
      supervisorRules: snapshot.supervisorRules ?? '',
      currentProvider: snapshot.currentProvider ?? null,
      availableProfiles: (snapshot.availableProfiles ?? []).map((p: any) => typeof p === 'string' ? { name: p } : p),
      hasSessionNotification: snapshot.hasSessionNotification ?? false,
    };
    pullFromReducer();
    notify();
  }

  function togglePublicMode(): void {
    state = { ...state, publicMode: !state.publicMode };
    notify();
  }

  function setPermissionMode(mode: 'manual' | 'auto' | 'supervisor'): void {
    state = { ...state, permissionMode: mode };
    notify();
  }

  function setMultiChatMode(enabled: boolean, members: string[]): void {
    state = {
      ...state,
      multiChatMode: enabled,
      selectedMembers: members,
      publicMode: enabled ? true : state.publicMode,
    };
    notify();
  }

  function showDatasetOverwriteDialog(requestId: string, name: string, path: string): void {
    state = {
      ...state,
      datasetOverwriteDialog: { requestId, name, path },
    };
    notify();
  }

  function dismissDatasetOverwriteDialog(): void {
    state = {
      ...state,
      datasetOverwriteDialog: null,
    };
    notify();
  }

  // Dataset overwrite responder
  let datasetOverwriteResponder: ((requestId: string, decision: 'overwrite' | 'cancel') => void) | null = null;

  function setDatasetOverwriteResponder(fn: (requestId: string, decision: 'overwrite' | 'cancel') => void): void {
    datasetOverwriteResponder = fn;
  }

  function respondDatasetOverwrite(decision: 'overwrite' | 'cancel'): void {
    const dialog = state.datasetOverwriteDialog;
    if (!dialog) return;
    state = { ...state, datasetOverwriteDialog: null };
    notify();
    if (datasetOverwriteResponder) {
      datasetOverwriteResponder(dialog.requestId, decision);
    }
  }

  function setSessionNotification(): void {
    if (!state.hasSessionNotification) {
      state = { ...state, hasSessionNotification: true };
      notify();
    }
  }

  function clearSessionNotification(): void {
    if (state.hasSessionNotification) {
      state = { ...state, hasSessionNotification: false };
      notify();
    }
  }

  function notifyActivated(): void {
    state = { ...state, activationCount: state.activationCount + 1 };
    notify();
  }

  /** Convert server UITimelineItem[] → client TimelineItem[] with fresh IDs. */
  function convertTimeline(items: any[]): TimelineItem[] {
    return items.map((item: any): TimelineItem => {
      switch (item.kind) {
        case 'prompt':
          return {
            kind: 'prompt',
            entry: {
              id: nextId(),
              content: item.entry?.content ?? '',
              ...(item.entry?.images?.length ? { images: item.entry.images } : {}),
            },
          };
        case 'thinking':
          return {
            kind: 'thinking',
            entry: {
              id: nextId(),
              content: item.entry?.content ?? '',
              collapsed: defaultCollapsed,
              startTime: item.entry?.startTime ?? Date.now(),
              elapsedMs: item.entry?.elapsedMs,
            },
          };
        case 'tool': {
          const toolName = item.entry?.call?.name ?? '';
          return {
            kind: 'tool',
            entry: {
              id: nextId(),
              call: item.entry?.call ?? { name: '', arguments: {} },
              result: item.entry?.result,
              collapsed: toolName === 'script' ? false : defaultCollapsed,
              timestamp: item.entry?.timestamp ?? Date.now(),
              elapsedMs: item.entry?.elapsedMs,
            },
          };
        }
        case 'system':
          return { kind: 'system', entry: { id: nextId(), content: item.entry?.content ?? '' } };
        case 'link_message':
          return { kind: 'link_message', entry: { id: nextId(), content: item.entry?.content ?? '' } };
        case 'text':
        default:
          return { kind: 'text', entry: { id: nextId(), content: item.entry?.content ?? '' } };
      }
    });
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function getSnapshot(): WebStoreState {
    return state;
  }

  return {
    handleEvent,
    toggleToolCollapse,
    toggleThinkingCollapse,
    startNewTurn,
    markReady,
    markIdle,
    reset,
    loadSnapshot,
    subscribe,
    getSnapshot,
    setModelName,
    pushInputHistory,
    addPending,
    removePending,
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
    canvasBrowserNavigateTop,
    canvasBrowserNavigateBottom,
    canvasBrowserSetInspect,
    canvasBrowserStartEdit,
    canvasBrowserBackToList,
    canvasBrowserSetEditContent,
    openSessionBrowser,
    closeSessionBrowser,
    sessionBrowserNavigate,
    sessionBrowserNavigateTop,
    sessionBrowserNavigateBottom,
    togglePublicMode,
    setPermissionMode,
    setMultiChatMode,
    showDatasetOverwriteDialog,
    dismissDatasetOverwriteDialog,
    setDatasetOverwriteResponder,
    respondDatasetOverwrite,
    setSessionNotification,
    clearSessionNotification,
    notifyActivated,
  };
}