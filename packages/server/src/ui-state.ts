import {
  type Persona,
  type Role,
  type RoleAssignment,
  TimelineReducer,
  deriveAssistantText,
  isLinkMessage,
  type TimelineItem,
  type TimelineTurn,
  type TimelineToolCallEntry,
  type TimelineThinkingEntry,
  type TimelineTextEntry,
  type TimelineInlineImage,
} from '@vesper/shared';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Vesper Server — Session UI State Accumulator
//
// Maintains a server-side mirror of UI-relevant state for each session.
// On page refresh, the client requests a snapshot to restore full UI state.
//
// Timeline reduction is delegated to the shared TimelineReducer from
// @vesper/shared (no debounce — server flushes every event immediately; no
// truncation — the snapshot must carry complete content for loadSnapshot).
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Types — server-side aliases for the shared timeline entry shapes.
// Kept under the UI* names because session-manager / qq-bot-manager / the
// wire snapshot protocol all reference them.
// ---------------------------------------------------------------------------

export interface UIToolResultMeta {
  filePath?: string;
  lineCount?: number;
  action?: string;
  [key: string]: any;
}

/** Server-side tool entry: shared entry without the collapsed view flag. */
export type UIToolCallEntry = Omit<TimelineToolCallEntry, 'collapsed' | 'result'> & {
  result?: { content: string; isError?: boolean; meta?: UIToolResultMeta; hasAttachments?: boolean; attachmentCount?: number };
};

export type UIThinkingEntry = Omit<TimelineThinkingEntry, 'collapsed'>;

export type UIInlineImage = TimelineInlineImage;

export type UITextEntry = Omit<TimelineTextEntry, 'personaName'>;

export type UITimelineItem =
  | { kind: 'prompt';   entry: UITextEntry }
  | { kind: 'thinking'; entry: UIThinkingEntry }
  | { kind: 'tool';     entry: UIToolCallEntry }
  | { kind: 'text';     entry: UITextEntry }
  | { kind: 'system';   entry: UITextEntry }
  | { kind: 'link_message'; entry: UITextEntry };

export interface UITurnEntry {
  id: string;
  userPrompt: string;
  timeline: UITimelineItem[];
  assistantText: string;
  error: string | null;
}

export interface UITaskItem {
  id: string;
  subject: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
  blockedBy?: string[];
  blocks?: string[];
  owner?: string;
}

export interface SessionUIState {
  turns: UITurnEntry[];
  currentTurnTimeline: UITimelineItem[];
  currentTurnPrompt: string;
  tasks: UITaskItem[];
  inputHistory: string[];
  modelName: string;
  tokenBudget: any | null;
  status: 'idle' | 'streaming' | 'done' | 'error';
  lastError: string | null;
  pendingPermission: { requestId: string; toolName: string; args: Record<string, any>; argsPreview: string } | null;
  pendingAskUser: { requestId: string; questions: any[] } | null;
  lastProviderUsage: { promptTokens: number; completionTokens: number; cachedTokens?: number; cost?: number } | null;
  cumulativeUsage: { promptTokens: number; completionTokens: number; cachedTokens: number; cost: number };
  currentToolset?: string | null;
  currentPersona?: string | null;
  activeRoleName?: string | null;
  availableToolsets?: Array<{ name: string; description: string }>;
  loadedSkills?: string[];
  availableSkills?: Array<{ name: string; description: string }>;
  availablePersonas?: Persona[];
  /** Team roles definition. */
  roles?: Record<string, Role>;
  /** Team role assignments. */
  assignments?: RoleAssignment[];
  /** Active provider requests (for request control panel). */
  providerRequests: Array<{ requestId: string; status: string; model: string; startedAt: number; elapsedMs: number; attempt: number; error?: string; promptTokens?: number; completionTokens?: number }>;
  /** Supervisor mode state. */
  supervisorMode?: boolean;
  supervisorRules?: string;
  /** Dynamic provider switch state. */
  currentProvider?: { model: string; baseURL: string; providerType: string; profile?: string } | null;
  availableProfiles?: string[];
  /** Whether this session has an unread notification from another session (yellow dot). */
  hasSessionNotification?: boolean;
}

// ---------------------------------------------------------------------------
// Type adapters — shared TimelineItem ↔ server UITimelineItem
// (strip the view-only `collapsed`/`personaName`/`fullContent` fields)
// ---------------------------------------------------------------------------

function toUITimeline(items: TimelineItem[]): UITimelineItem[] {
  return items.map((item): UITimelineItem => {
    switch (item.kind) {
      case 'tool': {
        const { collapsed: _c, result, ...entry } = item.entry as TimelineToolCallEntry;
        return {
          kind: 'tool',
          entry: {
            ...entry,
            result: result
              ? {
                  content: result.content,
                  isError: result.isError,
                  ...(result.meta ? { meta: result.meta as UIToolResultMeta } : {}),
                  ...(result.hasAttachments ? { hasAttachments: true, attachmentCount: result.attachmentCount } : {}),
                }
              : undefined,
          },
        };
      }
      case 'thinking': {
        const { collapsed: _c, ...entry } = item.entry as TimelineThinkingEntry;
        return { kind: 'thinking', entry };
      }
      case 'prompt':
      case 'text':
      case 'system':
      case 'link_message': {
        const { personaName: _p, ...entry } = item.entry as TimelineTextEntry;
        return { kind: item.kind, entry };
      }
      default:
        return item as unknown as UITimelineItem;
    }
  });
}

function toUITurns(turns: TimelineTurn[]): UITurnEntry[] {
  return turns.map((t) => ({ ...t, timeline: toUITimeline(t.timeline) }));
}

// ---------------------------------------------------------------------------
// Accumulator
// ---------------------------------------------------------------------------

let idCounter = 0;
function nextId(): string {
  return `srv-${++idCounter}`;
}

export class SessionUIStateAccumulator {
  private reducer = new TimelineReducer({
    defaultCollapsed: false,
    // No truncation — snapshots must carry full content for the client's
    // Detail modal; the client's own reducer will clamp for display.
    maxInlineContent: undefined,
    doneStatus: 'idle',
    linkMessageKind: true,
  });

  private tasks: UITaskItem[] = [];
  private inputHistory: string[] = [];
  private modelName = '';
  private tokenBudget: any | null = null;
  private pendingPermission: SessionUIState['pendingPermission'] = null;
  private pendingAskUser: SessionUIState['pendingAskUser'] = null;
  private lastProviderUsage: SessionUIState['lastProviderUsage'] = null;
  private currentToolset: string | null | undefined = undefined;
  private currentPersona: string | null | undefined = undefined;
  private activeRoleName: string | null | undefined = undefined;
  private availableToolsets: Array<{ name: string; description: string }> = [];
  private loadedSkills: string[] = [];
  private availableSkills: Array<{ name: string; description: string }> = [];
  private availablePersonas: Persona[] = [];
  private roles: Record<string, Role> = {};
  private assignments: RoleAssignment[] = [];
  private cumulativeUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  private providerRequests = new Map<string, SessionUIState['providerRequests'][number]>();
  private supervisorMode = false;
  private supervisorRules = '';
  private currentProvider: SessionUIState['currentProvider'] = null;
  private availableProfiles: string[] = [];
  /** Whether this session has an unread notification from another session (yellow dot). */
  private hasSessionNotification = false;

  // ── Turn archival (for rebuildFromCanvasBlocks, which bypasses the reducer) ──

  private archiveCurrentTurn(): void {
    // The reducer's frozen+active timeline already holds the current turn;
    // archiveCurrentTurn is only needed by rebuildFromCanvasBlocks which
    // resets and re-populates turns directly — kept for symmetry.
  }

  // ── Public API ────────────────────────────────────────────────────

  /** Reset all state — preserves inputHistory, modelName, and provider state (session-lifetime). */
  reset(): void {
    this.reducer.reset();
    this.tasks = [];
    // inputHistory, modelName, currentProvider, and availableProfiles are preserved
    this.tokenBudget = null;
    this.pendingPermission = null;
    this.pendingAskUser = null;
    this.lastProviderUsage = null;
    this.cumulativeUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
    this.roles = {};
    this.assignments = [];
    this.providerRequests.clear();
    this.supervisorMode = false;
    this.supervisorRules = '';
  }

  /**
   * Rebuild UI state from canvas blocks (after /load).
   * Groups blocks into turns by `user_message` boundaries.
   */
  rebuildFromCanvasBlocks(blocks: any[], tasks?: any[]): void {
    this.reset();

    const loadImages = (refs?: string[]): UIInlineImage[] | undefined => {
      if (!refs?.length) return undefined;
      const images = refs.flatMap((ref: string) => {
        try {
          const data = readFileSync(ref).toString('base64');
          const ext = extname(ref).toLowerCase();
          const mimeType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as Record<string, string>)[ext] ?? 'image/png';
          return [{ mimeType, data, filename: ref.split('/').pop() }];
        } catch {
          return [];
        }
      });
      return images.length ? images : undefined;
    };
    if (tasks) this.tasks = tasks;

    // Group blocks into turns by user_message boundaries
    const turnGroups: { prompt: string; items: any[]; isLinkMessage?: boolean; images?: UIInlineImage[] }[] = [];
    let currentGroup: { prompt: string; items: any[]; isLinkMessage?: boolean; images?: UIInlineImage[] } | null = null;

    for (const block of blocks) {
      if (block.type === 'pin') continue; // Skip pins — context, not conversation
      if (block.evicted) continue; // Skip evicted blocks — beyond the sliding window

      if (block.type === 'user_message') {
        if (currentGroup) {
          turnGroups.push(currentGroup);
        }
        const content = block.content ?? '';
        const isLink = isLinkMessage(content);
        currentGroup = { prompt: content, items: [], isLinkMessage: isLink, images: loadImages(block.imageRefs) };
        continue;
      }

      if (!currentGroup) {
        currentGroup = { prompt: '', items: [] };
      }

      currentGroup.items.push(block);
    }

    if (currentGroup) {
      turnGroups.push(currentGroup);
    }

    // Convert all groups except the last into completed turns,
    // the last group becomes the current timeline
    const turns: TimelineTurn[] = [];
    let currentPrompt = '';
    let currentTimeline: TimelineItem[] = [];

    for (let i = 0; i < turnGroups.length; i++) {
      const group = turnGroups[i];
      const timeline = this.convertBlocksToTimeline(group.items);
      const promptKind = group.isLinkMessage ? 'link_message' as const : 'prompt' as const;

      if (i < turnGroups.length - 1) {
        const fullTimeline: TimelineItem[] = [];
        if (group.prompt) {
          fullTimeline.push({
            kind: promptKind,
            entry: { id: nextId(), content: group.prompt, ...(group.images?.length ? { images: group.images } : {}) },
          });
        }
        fullTimeline.push(...timeline);
        turns.push({
          id: nextId(),
          userPrompt: group.prompt,
          timeline: fullTimeline,
          assistantText: deriveAssistantText(timeline),
          error: null,
        });
      } else {
        currentPrompt = group.prompt;
        if (group.prompt) {
          currentTimeline.push({
            kind: promptKind,
            entry: { id: nextId(), content: group.prompt, ...(group.images?.length ? { images: group.images } : {}) },
          });
        }
        currentTimeline.push(...timeline);
      }
    }

    this.reducer.loadTimelineSnapshot({
      turns,
      frozenTimeline: currentTimeline,
      status: 'idle',
      currentUserPrompt: currentPrompt,
    });
  }

  /** Convert raw canvas blocks to shared TimelineItems. */
  private convertBlocksToTimeline(blocks: any[]): TimelineItem[] {
    const result: TimelineItem[] = [];
    const toolCallMap = new Map<string, TimelineToolCallEntry>();

    for (const block of blocks) {
      switch (block.type) {
        case 'text': {
          result.push({
            kind: 'text',
            entry: { id: nextId(), content: block.content ?? '' },
          });
          break;
        }
        case 'think': {
          result.push({
            kind: 'thinking',
            entry: {
              id: nextId(),
              content: block.content ?? '',
              collapsed: false,
              startTime: block.timestamp ?? Date.now(),
            },
          });
          break;
        }
        case 'tool_call': {
          let call: { name: string; arguments: Record<string, any> };
          try {
            const parsed = JSON.parse(block.content ?? '{}');
            call = { name: parsed.name ?? '', arguments: parsed.arguments ?? {} };
          } catch {
            call = { name: '', arguments: {} };
          }
          const entry: TimelineToolCallEntry = {
            id: nextId(),
            call,
            collapsed: false,
            timestamp: block.timestamp ?? Date.now(),
          };
          toolCallMap.set(block.id, entry);
          result.push({ kind: 'tool', entry });
          break;
        }
        case 'tool_result': {
          const parentEntry = block.parentId ? toolCallMap.get(block.parentId) : undefined;
          if (parentEntry) {
            parentEntry.result = {
              content: block.content ?? '',
              isError: false,
              ...(block.meta ? { meta: block.meta } : {}),
            };
            if (block.timestamp && parentEntry.timestamp) {
              parentEntry.elapsedMs = block.timestamp - parentEntry.timestamp;
            }
          }
          break;
        }
        case 'conversation_summary': {
          result.push({
            kind: 'text',
            entry: { id: nextId(), content: block.content ?? '' },
          });
          break;
        }
        default:
          break;
      }
    }

    return result;
  }

  processEvent(event: any): void {
    // Events that map onto the shared timeline reducer. Server flushes
    // immediately (no debounce) so the snapshot is always consistent.
    switch (event.type) {
      case 'text':
      case 'thinking':
        if (this.reducer.handleEvent(event)) {
          this.reducer.flushBuffers(); // server: no debounce, flush buffers incrementally into active entry
        }
        return;

      case 'tool_call':
      case 'tool_call_progress':
      case 'tool_result':
      case 'done':
      case 'run_complete':
      case 'error':
      case 'init_error':
      case 'sideband_consumed':
      case 'supervisor_decision':
        if (this.reducer.handleEvent(event)) {
          this.reducer.flushAll(); // boundary event: full flush & reset
        }
        return;

      case 'run_started': {
        // run_started on the server also tracks the prompt for snapshot restore.
        this.reducer.handleEvent(event);
        this.reducer.flushAll();
        return;
      }

      case 'ready': {
        this.reducer.state = { ...this.reducer.state, status: 'idle' };
        if (event.effectiveConfig?.model) {
          this.modelName = event.effectiveConfig.model;
        }
        break;
      }

      case 'task_snapshot': {
        this.tasks = event.tasks ?? [];
        break;
      }

      case 'token_budget': {
        this.tokenBudget = event.snapshot ?? null;
        break;
      }

      case 'permission_request': {
        this.pendingPermission = {
          requestId: event.requestId,
          toolName: event.toolName,
          args: event.args,
          argsPreview: event.argsPreview,
        };
        break;
      }

      case 'permission_resolved': {
        this.pendingPermission = null;
        break;
      }

      case 'ask_user_request': {
        this.pendingAskUser = {
          requestId: event.requestId,
          questions: event.questions,
        };
        break;
      }

      case 'ask_user_resolved': {
        this.pendingAskUser = null;
        break;
      }

      case 'provider_usage': {
        this.lastProviderUsage = {
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          cachedTokens: event.cachedTokens,
          cost: event.cost,
        };
        break;
      }

      case 'canvas_cleared': {
        this.reset();
        break;
      }

      case 'session_loaded': {
        if (event.canvasBlocks) {
          this.rebuildFromCanvasBlocks(event.canvasBlocks, event.tasks);
        }
        break;
      }

      case 'toolset_skill_state': {
        this.currentToolset = event.toolsetName ?? null;
        this.currentPersona = event.personaName ?? null;
        this.activeRoleName = event.activeRoleName ?? null;
        this.availableToolsets = event.availableToolsets ?? [];
        this.loadedSkills = event.loadedSkills ?? [];
        this.availableSkills = event.availableSkills ?? [];
        this.availablePersonas = event.availablePersonas ?? this.availablePersonas;
        this.roles = event.roles ?? this.roles;
        this.assignments = event.assignments ?? this.assignments;
        break;
      }

      case 'provider_request_start':
      case 'provider_request_update': {
        const req = event.request;
        if (req?.requestId) {
          this.providerRequests.set(req.requestId, req);
        }
        break;
      }

      case 'provider_request_end': {
        this.providerRequests.delete(event.requestId);
        break;
      }

      case 'supervisor_state': {
        this.supervisorMode = !!event.active;
        this.supervisorRules = event.rules ?? '';
        break;
      }

      case 'provider_state': {
        this.currentProvider = {
          model: event.model,
          baseURL: event.baseURL,
          providerType: event.providerType,
          profile: event.currentProfile,
        };
        this.availableProfiles = event.availableProfiles ?? [];
        if (event.model) this.modelName = event.model;
        break;
      }

      case 'provider_switched': {
        this.currentProvider = {
          model: event.model,
          baseURL: event.baseURL,
          providerType: event.providerType,
          profile: event.profile,
        };
        if (event.model) this.modelName = event.model;
        break;
      }

      case 'session_notification': {
        this.hasSessionNotification = true;
        break;
      }

      default:
        break;
    }
  }

  pushInputHistory(prompt: string): void {
    this.inputHistory.push(prompt);
    if (this.inputHistory.length > 100) {
      this.inputHistory.shift();
    }
  }

  getSnapshot(): SessionUIState {
    // Flush any pending buffers before snapshot
    this.reducer.flushAll();

    const rs = this.reducer.state;
    const uiTurns = toUITurns(rs.turns);
    const uiTimeline = toUITimeline([...rs.frozenTimeline, ...rs.timeline]);

    // Deep clone via JSON to avoid shared references
    return JSON.parse(JSON.stringify({
      turns: uiTurns,
      currentTurnTimeline: uiTimeline,
      currentTurnPrompt: rs.currentUserPrompt,
      tasks: this.tasks,
      inputHistory: this.inputHistory,
      modelName: this.modelName,
      tokenBudget: this.tokenBudget,
      status: rs.status,
      lastError: rs.lastError,
      pendingPermission: this.pendingPermission,
      pendingAskUser: this.pendingAskUser,
      lastProviderUsage: this.lastProviderUsage,
      cumulativeUsage: this.cumulativeUsage,
      currentToolset: this.currentToolset,
      currentPersona: this.currentPersona,
      activeRoleName: this.activeRoleName,
      availableToolsets: this.availableToolsets,
      loadedSkills: this.loadedSkills,
      availableSkills: this.availableSkills,
      availablePersonas: this.availablePersonas,
      roles: this.roles,
      assignments: this.assignments,
      providerRequests: [...this.providerRequests.values()],
      supervisorMode: this.supervisorMode,
      supervisorRules: this.supervisorRules,
      currentProvider: this.currentProvider,
      availableProfiles: this.availableProfiles,
      hasSessionNotification: this.hasSessionNotification,
    }));
  }
}
