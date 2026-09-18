// ═══════════════════════════════════════════════════════════════════════════
// Vesper Shared — Timeline Reducer
//
// Single source of truth for reducing wire stream events into a chronological
// timeline of UI entries (thinking → tool → text). Consumed by three frontends:
//   - @vesper/tui    (Ink terminal UI — frozen items pushed to <Static>)
//   - @vesper/web    (React WebUI — vanilla store + useSyncExternalStore)
//   - @vesper/server (SessionUIStateAccumulator — snapshot mirror for page refresh)
//
// The reducer owns ONLY the timeline projection (frozen/active split, stream
// buffering, tool_call↔tool_result matching). Session-level fields (tasks,
// permission requests, provider state, canvas browser, ...) remain the
// responsibility of each frontend's store.
//
// Stream-event field convention: reducers accept BOTH the in-process field
// `_subflow` (StreamEvent, used by the TUI path via deserializeEvent) and the
// wire field `subflow` (WireEvent, consumed verbatim by web/server). Callers
// don't need to normalize.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  SubflowTag,
  ToolResultMeta,
} from './types.js';
import type { WireToolCall, WireToolResult } from './protocol.js';

// ---------------------------------------------------------------------------
// Timeline entry types — the shared "reduced" data shape
// ---------------------------------------------------------------------------

export interface TimelineInlineImage {
  mimeType: string;
  data: string;
  filename?: string;
  width?: number;
  height?: number;
}

export interface TimelineToolResult {
  content: string;
  /** Full untruncated content when `content` was clamped for inline display. */
  fullContent?: string;
  /** True when `content` was truncated (see `maxInlineContent` option). */
  truncated?: boolean;
  isError?: boolean;
  meta?: ToolResultMeta;
  hasAttachments?: boolean;
  attachmentCount?: number;
}

export interface TimelineToolCallEntry {
  id: string;
  call: { name: string; arguments: Record<string, any> };
  result?: TimelineToolResult;
  collapsed: boolean;
  timestamp: number;
  /** Final elapsed time in ms (set when tool_result arrives). */
  elapsedMs?: number;
  /** Present when this tool call belongs to a sub-flow (supervisor/curator). */
  subflow?: SubflowTag;
  /** Persona that generated this block (multi-chat display). */
  personaName?: string;
}

export interface TimelineThinkingEntry {
  id: string;
  content: string;
  collapsed: boolean;
  /** Timestamp (Date.now()) when this thinking block started. */
  startTime: number;
  /** Final elapsed time in ms (set when the block is frozen/completed). */
  elapsedMs?: number;
  subflow?: SubflowTag;
}

export interface TimelineTextEntry {
  id: string;
  content: string;
  images?: TimelineInlineImage[];
  subflow?: SubflowTag;
  /** Persona that generated this block (multi-chat display). */
  personaName?: string;
}

/** A single item in the chronological timeline. */
export type TimelineItem =
  | { kind: 'prompt';       entry: TimelineTextEntry }
  | { kind: 'thinking';     entry: TimelineThinkingEntry }
  | { kind: 'tool';         entry: TimelineToolCallEntry }
  | { kind: 'text';         entry: TimelineTextEntry }
  | { kind: 'system';       entry: TimelineTextEntry }
  | { kind: 'link_message'; entry: TimelineTextEntry };

/** A completed conversation turn (user prompt + assistant response). */
export interface TimelineTurn {
  id: string;
  userPrompt: string;
  timeline: TimelineItem[];
  assistantText: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Ego-prefix stripping (mirrors canvas.ts stripEgoPrefixes)
// ---------------------------------------------------------------------------

const egoPrefixReCache = new Map<string, RegExp>();

/**
 * Strip leading "Name：" / "Name:" prefixes the model sometimes emits on its
 * own (e.g. "绮梦：你好" → "你好"). The runtime no longer injects prefixes —
 * the persona name is shown in the message header.
 */
export function stripEgoPrefixes(text: string, egoName: string): string {
  if (!egoName || !text) return text;
  let re = egoPrefixReCache.get(egoName);
  if (!re) {
    const escaped = egoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp('^(' + escaped + '[\uFF1A:]\\s*)+');
    egoPrefixReCache.set(egoName, re);
  }
  const match = text.match(re);
  if (!match) return text;
  return text.slice(match[0].length);
}

/** True when the text looks like a cross-session link/link-inject message. */
export function isLinkMessage(content: string): boolean {
  return /^\[来自其他session/i.test(content) || /^\[LINK ALERT\]/i.test(content);
}

// ---------------------------------------------------------------------------
// Options — per-frontend behavioral switches
// ---------------------------------------------------------------------------

export interface TimelineReducerOptions {
  /** Default collapsed state for thinking blocks and tool cards. */
  defaultCollapsed?: boolean;
  /**
   * Tool names that always render expanded regardless of `defaultCollapsed`
   * (e.g. `['script']` — users want to see executed code).
   */
  expandedToolNames?: string[];
  /**
   * Max characters kept inline in a tool result. Longer results are clamped
   * into `content` with the original preserved in `fullContent` and
   * `truncated: true`. Set to `Infinity`/undefined to disable truncation.
   */
  maxInlineContent?: number;
  /**
   * Persona name used to (a) strip ego prefixes from streamed text and
   * (b) stamp `personaName` on new text/tool entries. Pass `undefined`
   * to disable (TUI doesn't display persona headers).
   */
  personaName?: string | null;
  /**
   * Status written to `state.status` when a `done`/`run_complete` event
   * arrives. Frontends that keep a separate `markIdle()` should use `'done'`;
   * the server accumulator uses `'idle'` because there is no live "done" UI.
   */
  doneStatus?: 'done' | 'idle';
  /**
   * When true, `sideband_consumed` messages that look like cross-session
   * link messages are emitted as `link_message` items; otherwise they are
   * always `prompt` items with a 💬 prefix (TUI behavior).
   */
  linkMessageKind?: boolean;
}

// ---------------------------------------------------------------------------
// Reducer state
// ---------------------------------------------------------------------------

export interface TimelineState {
  /** Completed past turns (read-only history). */
  turns: TimelineTurn[];
  /** Frozen (settled) items of the current turn. */
  frozenTimeline: TimelineItem[];
  /** Active tail of the current turn. */
  timeline: TimelineItem[];
  status: 'idle' | 'streaming' | 'done' | 'error';
  lastError: string | null;
  /** The user prompt for the current in-progress turn. */
  currentUserPrompt: string;
}

// Mutable streaming internals kept alongside the public state.
interface StreamInternals {
  /** Buffered text deltas not yet flushed into a timeline entry. */
  pendingText: string;
  /** Buffered thinking deltas not yet flushed. */
  pendingThinking: string;
  /** ID of the in-progress text entry (null = next flush creates one). */
  currentTextId: string | null;
  /** ID of the in-progress thinking entry. */
  currentThinkingId: string | null;
  pendingTextSubflow: SubflowTag | undefined;
  pendingThinkingSubflow: SubflowTag | undefined;
}

let timelineIdCounter = 0;
function nextId(): string {
  return `tl-${++timelineIdCounter}`;
}

export function createTimelineState(): TimelineState {
  return {
    turns: [],
    frozenTimeline: [],
    timeline: [],
    status: 'idle',
    lastError: null,
    currentUserPrompt: '',
  };
}

// ---------------------------------------------------------------------------
// TimelineReducer — the single implementation of stream→timeline reduction
// ---------------------------------------------------------------------------

/**
 * Reduces stream events into a two-zone timeline (frozen + active).
 *
 * The class is stateful but side-effect-free: callers get a new immutable
 * `state` snapshot after every event. Debouncing of text/thinking deltas is
 * the caller's concern — `handleEvent` accumulates into buffers and the
 * caller decides when to flush (TUI/WebUI use ~50ms timers for ~20fps;
 * the server flushes immediately via `flushAll()` after each event).
 */
export class TimelineReducer {
  state: TimelineState;
  private opts: Required<Omit<TimelineReducerOptions, 'personaName' | 'maxInlineContent'>> & Pick<TimelineReducerOptions, 'personaName' | 'maxInlineContent'>;
  private s: StreamInternals = {
    pendingText: '',
    pendingThinking: '',
    currentTextId: null,
    currentThinkingId: null,
    pendingTextSubflow: undefined,
    pendingThinkingSubflow: undefined,
  };

  constructor(options?: TimelineReducerOptions) {
    this.opts = {
      defaultCollapsed: options?.defaultCollapsed ?? false,
      expandedToolNames: options?.expandedToolNames ?? [],
      maxInlineContent: options?.maxInlineContent,
      personaName: options?.personaName,
      doneStatus: options?.doneStatus ?? 'done',
      linkMessageKind: options?.linkMessageKind ?? true,
    };
    this.state = createTimelineState();
  }

  /** Update persona name at runtime (persona switches mid-session). */
  setPersonaName(name: string | null | undefined): void {
    this.opts.personaName = name ?? undefined;
  }

  // ── Buffer flush helpers ──────────────────────────────────────────

  /** Append pending text deltas into the timeline (creates or extends the active text entry). */
  private flushText(): void {
    if (!this.s.pendingText) return;
    const st = this.state;
    if (this.s.currentTextId) {
      const id = this.s.currentTextId;
      const persona = this.opts.personaName;
      const timeline = st.timeline.map((item) => {
        if (item.kind === 'text' && item.entry.id === id) {
          let content = item.entry.content + this.s.pendingText;
          if (persona) content = stripEgoPrefixes(content, persona);
          return { ...item, entry: { ...item.entry, content } };
        }
        return item;
      });
      this.state = { ...st, timeline };
    } else {
      const id = nextId();
      this.s.currentTextId = id;
      const persona = this.opts.personaName;
      let content = this.s.pendingText;
      if (persona) content = stripEgoPrefixes(content, persona);
      const entry: TimelineTextEntry = {
        id,
        content,
        ...(this.s.pendingTextSubflow ? { subflow: this.s.pendingTextSubflow } : {}),
        ...(persona ? { personaName: persona } : {}),
      };
      this.state = { ...st, timeline: [...st.timeline, { kind: 'text', entry }] };
    }
    this.s.pendingText = '';
    this.s.pendingTextSubflow = undefined;
  }

  /** Append pending thinking deltas into the timeline. */
  private flushThinking(): void {
    if (!this.s.pendingThinking) return;
    const st = this.state;
    if (this.s.currentThinkingId) {
      const id = this.s.currentThinkingId;
      const timeline = st.timeline.map((item) =>
        item.kind === 'thinking' && item.entry.id === id
          ? { ...item, entry: { ...item.entry, content: item.entry.content + this.s.pendingThinking } }
          : item,
      );
      this.state = { ...st, timeline };
    } else {
      const id = nextId();
      this.s.currentThinkingId = id;
      const entry: TimelineThinkingEntry = {
        id,
        content: this.s.pendingThinking,
        collapsed: this.opts.defaultCollapsed,
        startTime: Date.now(),
        ...(this.s.pendingThinkingSubflow ? { subflow: this.s.pendingThinkingSubflow } : {}),
      };
      this.state = { ...st, timeline: [...st.timeline, { kind: 'thinking', entry }] };
    }
    this.s.pendingThinking = '';
    this.s.pendingThinkingSubflow = undefined;
  }

  /** Stamp elapsedMs on the current thinking block before clearing its ID. */
  private finalizeThinkingElapsed(): void {
    if (!this.s.currentThinkingId) return;
    const id = this.s.currentThinkingId;
    const now = Date.now();
    const stamp = (items: TimelineItem[]): TimelineItem[] =>
      items.map((item) =>
        item.kind === 'thinking' && item.entry.id === id && !item.entry.elapsedMs
          ? { ...item, entry: { ...item.entry, elapsedMs: now - item.entry.startTime } }
          : item,
      );
    this.state = {
      ...this.state,
      timeline: stamp(this.state.timeline),
      frozenTimeline: stamp(this.state.frozenTimeline),
    };
  }

  /** Extract the subflow tag from either field convention (`_subflow` or `subflow`). */
  private subflowOf(event: any): SubflowTag | undefined {
    return event?._subflow ?? event?.subflow;
  }

  // ── Turn boundary / freeze helpers ────────────────────────────────

  /**
   * Freeze the longest prefix of "settled" items in the active timeline.
   * Non-tool items (text/thinking/system) are always settled; tool items
   * are settled only when they have a result. Stops at the first pending
   * tool — never freeze a pending tool, otherwise its incoming tool_result
   * can't find a match.
   */
  private freezeSettledPrefix(): void {
    const st = this.state;
    let freezeEnd = 0;
    for (let i = 0; i < st.timeline.length; i++) {
      const item = st.timeline[i];
      if (item.kind === 'tool' && !item.entry.result) break;
      freezeEnd = i + 1;
    }
    if (freezeEnd === 0) return;
    this.state = {
      ...st,
      frozenTimeline: [...st.frozenTimeline, ...st.timeline.slice(0, freezeEnd)],
      timeline: st.timeline.slice(freezeEnd),
    };
  }

  /**
   * Flush pending text and thinking deltas into their active entries
   * WITHOUT clearing currentTextId / currentThinkingId. Used during
   * active streaming (e.g. debounced 50ms ticks, server per-event sync)
   * to keep incremental output accumulating into a single continuous block.
   */
  flushBuffers(): void {
    this.flushText();
    this.flushThinking();
  }

  /** Flush all buffers and stamp elapsed — used at turn boundaries (done/error/idle). */
  flushAll(): void {
    this.flushBuffers();
    this.finalizeThinkingElapsed();
    this.s.currentTextId = null;
    this.s.currentThinkingId = null;
    this.s.pendingTextSubflow = undefined;
    this.s.pendingThinkingSubflow = undefined;
  }

  /** Flush pending buffers and freeze the entire active timeline (turn complete). */
  finalizeTurn(status: 'done' | 'idle' | 'error', lastError?: string | null): void {
    this.flushAll();
    this.state = {
      ...this.state,
      frozenTimeline: [...this.state.frozenTimeline, ...this.state.timeline],
      timeline: [],
      status,
      ...(lastError !== undefined ? { lastError } : {}),
    };
  }

  // ── Turn archival ─────────────────────────────────────────────────

  /**
   * Archive the current turn into `turns` and reset streaming state for a
   * new prompt. Mirrors startNewTurn() in the web/tui stores: the prompt is
   * immediately frozen (it's already "done"), prior content is archived only
   * when non-empty.
   *
   * @param userPrompt  The new turn's prompt text.
   * @param opts.regenerate  When true, drop the in-progress turn instead of
   *        archiving it (same question, replacing the answer) and reuse any
   *        existing prompt entry to avoid duplicate prompts on the canvas.
   * @param opts.promptKind  'prompt' (default) or 'link_message'.
   * @param opts.images  Optional inline images for the prompt entry.
   */
  startNewTurn(
    userPrompt: string,
    opts?: { regenerate?: boolean; promptKind?: 'prompt' | 'link_message'; images?: TimelineInlineImage[] },
  ): void {
    this.flushAll();
    const st = this.state;
    const fullTimeline = [...st.frozenTimeline, ...st.timeline];
    const assistantText = deriveAssistantText(fullTimeline);
    const hasContent = assistantText.length > 0 || fullTimeline.length > 0 || st.lastError;

    let newTurns: TimelineTurn[];
    if (opts?.regenerate) {
      newTurns = st.turns; // keep previous turns, drop current incomplete one
    } else {
      newTurns = hasContent
        ? [...st.turns, {
            id: nextId(),
            userPrompt: st.currentUserPrompt,
            timeline: fullTimeline,
            assistantText,
            error: st.lastError,
          }]
        : st.turns;
    }

    let frozenBase: TimelineItem[];
    const kind = opts?.promptKind ?? 'prompt';
    if (opts?.regenerate) {
      const existingPrompt = fullTimeline.find((it) => it.kind === 'prompt' || it.kind === 'link_message');
      frozenBase = existingPrompt
        ? [existingPrompt]
        : [{ kind, entry: { id: nextId(), content: userPrompt, ...(opts?.images ? { images: opts.images } : {}) } }];
    } else {
      frozenBase = [{ kind, entry: { id: nextId(), content: userPrompt, ...(opts?.images ? { images: opts.images } : {}) } }];
    }

    this.state = {
      ...st,
      turns: newTurns,
      frozenTimeline: frozenBase,
      timeline: [],
      status: 'streaming',
      lastError: null,
      currentUserPrompt: userPrompt,
    };
  }

  // ── Event reduction ───────────────────────────────────────────────

  /**
   * Reduce one stream event into the timeline.
   *
   * Handles the ~15 event types that produce timeline content or mutate
   * streaming state. Returns `true` when the event was consumed (the caller
   * may still need to react to sideband/notification semantics), `false`
   * when the event type isn't timeline-related and should be handled by the
   * caller's own store.
   *
   * Accepted event types: text, thinking, tool_call, tool_call_progress,
   * tool_result, done, run_complete, error, init_error, run_started,
   * sideband_injected, sideband_consumed, supervisor_decision.
   */
  handleEvent(event: { type: string; [key: string]: any }): boolean {
    switch (event.type) {
      case 'text': {
        // Text starts → finalize any pending thinking block and freeze
        // everything before it (chronological order must survive in frozen).
        if (this.s.pendingThinking || this.s.currentThinkingId) {
          this.flushThinking();
          this.finalizeThinkingElapsed();
          this.s.currentThinkingId = null;
          if (this.state.timeline.length > 0) {
            this.state = {
              ...this.state,
              frozenTimeline: [...this.state.frozenTimeline, ...this.state.timeline],
              timeline: [],
            };
          }
        }
        if (this.state.status !== 'streaming') {
          this.state = { ...this.state, status: 'streaming' };
        }
        this.s.pendingText += event.value;
        const sf = this.subflowOf(event);
        if (!this.s.currentTextId && sf) {
          this.s.pendingTextSubflow = sf;
        }
        return true;
      }

      case 'thinking': {
        // Thinking starts → flush pending text and freeze (text→thinking boundary).
        if (this.s.pendingText || this.s.currentTextId) {
          this.flushText();
          this.s.currentTextId = null;
          if (this.state.timeline.length > 0) {
            this.state = {
              ...this.state,
              frozenTimeline: [...this.state.frozenTimeline, ...this.state.timeline],
              timeline: [],
            };
          }
        }
        if (this.state.status !== 'streaming') {
          this.state = { ...this.state, status: 'streaming' };
        }
        this.s.pendingThinking += event.value;
        const sf = this.subflowOf(event);
        if (!this.s.currentThinkingId && sf) {
          this.s.pendingThinkingSubflow = sf;
        }
        return true;
      }

      case 'tool_call': {
        this.flushText();
        this.s.currentTextId = null;
        this.flushThinking();
        this.finalizeThinkingElapsed();
        this.s.currentThinkingId = null;
        // Force-freeze everything in the timeline before adding the new tool
        // call — but NEVER pending tools (they must stay in the dynamic zone
        // so their tool_result can still find a match; a frozen pending tool
        // renders as a blinking card that never resolves).
        if (this.state.timeline.length > 0) {
          const toFreeze: TimelineItem[] = [];
          const toKeep: TimelineItem[] = [];
          for (const item of this.state.timeline) {
            if (item.kind === 'tool' && !item.entry.result) {
              toKeep.push(item);
            } else {
              toFreeze.push(item);
            }
          }
          this.state = {
            ...this.state,
            frozenTimeline: [...this.state.frozenTimeline, ...toFreeze],
            timeline: toKeep,
          };
        }

        const alwaysExpanded = this.opts.expandedToolNames.includes(event.call.name);
        const sf = this.subflowOf(event);
        const entry: TimelineToolCallEntry = {
          id: nextId(),
          call: { name: event.call.name, arguments: event.call.arguments },
          collapsed: alwaysExpanded ? false : this.opts.defaultCollapsed,
          timestamp: Date.now(),
          ...(sf ? { subflow: sf } : {}),
          ...(this.opts.personaName ? { personaName: this.opts.personaName } : {}),
        };
        this.state = {
          ...this.state,
          status: 'streaming',
          timeline: [...this.state.timeline, { kind: 'tool', entry }],
        };
        return true;
      }

      case 'tool_call_progress': {
        if (this.state.status !== 'streaming') {
          this.state = { ...this.state, status: 'streaming' };
        }
        return true;
      }

      case 'tool_result': {
        this.flushText();
        this.s.currentTextId = null;
        this.flushThinking();
        this.s.currentThinkingId = null;

        const rawContent: string = event.result?.content ?? '';
        const max = this.opts.maxInlineContent;
        const needsTruncation = typeof max === 'number' && rawContent.length > max;
        const resultPayload: TimelineToolResult = {
          content: needsTruncation ? rawContent.slice(0, max) : rawContent,
          fullContent: needsTruncation ? rawContent : undefined,
          truncated: needsTruncation || undefined,
          isError: event.result?.isError,
          ...(event.result?.meta ? { meta: event.result.meta } : {}),
          ...(event.result?.hasAttachments ? { hasAttachments: true, attachmentCount: event.result.attachmentCount } : {}),
          ...(event.result?.meta?.type === 'file_attachment' ? { hasAttachments: true, attachmentCount: 1 } : {}),
        };

        // Find matching tool_call entry: match in timeline first (from oldest to newest
        // so that multiple calls of the same tool resolve in emission order),
        // then fall back to frozenTimeline for late-arriving results.
        const now = Date.now();
        const timeline = [...this.state.timeline];
        let matched = false;
        for (let i = 0; i < timeline.length; i++) {
          const item = timeline[i];
          if (item.kind === 'tool' && item.entry.call.name === event.call?.name && !item.entry.result) {
            const elapsedMs = now - item.entry.timestamp;
            const alwaysExpanded = this.opts.expandedToolNames.includes(item.entry.call.name);
            timeline[i] = {
              ...item,
              entry: {
                ...item.entry,
                result: resultPayload,
                collapsed: alwaysExpanded ? false : this.opts.defaultCollapsed,
                elapsedMs,
              },
            };
            matched = true;
            break;
          }
        }
        if (!matched) {
          // Check frozenTimeline as fallback
          const frozen = [...this.state.frozenTimeline];
          for (let i = 0; i < frozen.length; i++) {
            const item = frozen[i];
            if (item.kind === 'tool' && item.entry.call.name === event.call?.name && !item.entry.result) {
              const elapsedMs = now - item.entry.timestamp;
              const alwaysExpanded = this.opts.expandedToolNames.includes(item.entry.call.name);
              frozen[i] = {
                ...item,
                entry: {
                  ...item.entry,
                  result: resultPayload,
                  collapsed: alwaysExpanded ? false : this.opts.defaultCollapsed,
                  elapsedMs,
                },
              };
              matched = true;
              this.state = { ...this.state, frozenTimeline: frozen };
              break;
            }
          }
        }
        this.state = { ...this.state, timeline };
        if (matched) this.freezeSettledPrefix();
        return true;
      }

      case 'run_started': {
        // A new run began (from run/sideband/link_inject). Archive any prior
        // turn, then seed the timeline with the prompt entry — deduplicated
        // against an identical trailing prompt (e.g. created optimistically
        // by startNewTurn).
        const prompt: string = event.prompt ?? '';
        const images: TimelineInlineImage[] | undefined = event.images?.length ? event.images : undefined;
        if (!prompt) {
          this.state = {
            ...this.state,
            status: 'streaming',
            lastError: null,
          };
          return true;
        }

        const lastFrozen = this.state.frozenTimeline[this.state.frozenTimeline.length - 1];
        const lastPromptContent = (lastFrozen?.kind === 'prompt' || lastFrozen?.kind === 'link_message')
          ? lastFrozen.entry.content
          : null;

        if (lastPromptContent === prompt) {
          // Prompt already exists — merge images if the existing entry lacks them.
          if (images && lastFrozen && (lastFrozen.kind === 'prompt' || lastFrozen.kind === 'link_message') && !lastFrozen.entry.images) {
            const patched: TimelineItem = {
              ...lastFrozen,
              entry: { ...lastFrozen.entry, images },
            } as TimelineItem;
            this.state = {
              ...this.state,
              frozenTimeline: [...this.state.frozenTimeline.slice(0, -1), patched],
              status: 'streaming',
              lastError: null,
              currentUserPrompt: prompt,
            };
            return true;
          }
          this.state = {
            ...this.state,
            status: 'streaming',
            lastError: null,
            currentUserPrompt: prompt,
          };
          return true;
        }

        // Archive the previous turn, then start the new one.
        const kind: 'prompt' | 'link_message' = isLinkMessage(prompt) ? 'link_message' : 'prompt';
        this.startNewTurn(prompt, { promptKind: kind, images });
        return true;
      }

      case 'sideband_injected': {
        // Sideband queue membership is session state, not timeline — but the
        // event marks the stream alive. Frontends track pendingSidebands in
        // their own store; nothing to do for the timeline itself.
        return true;
      }

      case 'sideband_consumed': {
        // A queued sideband was picked up — surface it in the timeline as a
        // prompt (or link_message for cross-session injections).
        const message: string = event.message ?? '';
        const isLink = this.opts.linkMessageKind && isLinkMessage(message);
        const entry: TimelineTextEntry = { id: nextId(), content: isLink ? message : `💬 ${message}` };
        const item: TimelineItem = { kind: isLink ? 'link_message' : 'prompt', entry };
        this.state = { ...this.state, timeline: [...this.state.timeline, item] };
        return true;
      }

      case 'supervisor_decision': {
        const action = event.decision === 'approve' ? '✓ approved'
          : event.decision === 'deny' ? '✗ denied'
          : '↑ escalated to user';
        const reason = event.reason ? ` — ${event.reason}` : '';
        const entry: TimelineTextEntry = {
          id: nextId(),
          content: `⚑ Supervisor ${action} (${event.requestType})${reason}`,
        };
        this.state = { ...this.state, timeline: [...this.state.timeline, { kind: 'system', entry }] };
        return true;
      }

      case 'done':
      case 'run_complete': {
        this.finalizeTurn(this.opts.doneStatus, null);
        return true;
      }

      case 'run_aborted': {
        // Flow was interrupted (user abort / stop). Return to idle so the UI
        // exits the stale "streaming" state and re-enables input.
        this.finalizeTurn('idle', null);
        return true;
      }

      case 'error':
      case 'init_error': {
        const message = event.message || event.error?.message || 'Unknown error';
        this.finalizeTurn('error', message);
        return true;
      }

      default:
        return false;
    }
  }

  /** Force status back to idle (call after flow completes to re-enable input). */
  markIdle(): void {
    this.finalizeTurn('idle');
  }

  /** Append a system message to the frozen timeline (session/canvas feedback). */
  addSystemMessage(text: string): void {
    const entry: TimelineTextEntry = { id: nextId(), content: text };
    this.state = {
      ...this.state,
      frozenTimeline: [...this.state.frozenTimeline, { kind: 'system', entry }],
    };
  }

  /** Toggle the collapsed flag of a tool entry (active or frozen). */
  toggleToolCollapse(id: string): void {
    const map = (items: TimelineItem[]): TimelineItem[] =>
      items.map((item) =>
        item.kind === 'tool' && item.entry.id === id
          ? { ...item, entry: { ...item.entry, collapsed: !item.entry.collapsed } }
          : item,
      );
    this.state = { ...this.state, timeline: map(this.state.timeline), frozenTimeline: map(this.state.frozenTimeline) };
  }

  /** Toggle the collapsed flag of a thinking entry (active or frozen). */
  toggleThinkingCollapse(id: string): void {
    const map = (items: TimelineItem[]): TimelineItem[] =>
      items.map((item) =>
        item.kind === 'thinking' && item.entry.id === id
          ? { ...item, entry: { ...item.entry, collapsed: !item.entry.collapsed } }
          : item,
      );
    this.state = { ...this.state, timeline: map(this.state.timeline), frozenTimeline: map(this.state.frozenTimeline) };
  }

  /**
   * True when the reducer still has buffered (un-flushed) stream deltas.
   * Callers that debounce text/thinking use this to decide whether a
   * timer-triggered flush is needed.
   */
  hasPendingBuffers(): boolean {
    return this.s.pendingText.length > 0 || this.s.pendingThinking.length > 0;
  }

  /** Reset all timeline state to a fresh initial state (turns, timelines, buffers). */
  reset(): void {
    this.state = createTimelineState();
    this.s = {
      pendingText: '',
      pendingThinking: '',
      currentTextId: null,
      currentThinkingId: null,
      pendingTextSubflow: undefined,
      pendingThinkingSubflow: undefined,
    };
  }

  /**
   * Restore the reducer's timeline state from a snapshot (e.g. server's
   * SessionUIState mirror after /load). Replaces turns + frozen timeline
   * + status; streaming buffers are cleared.
   */
  loadTimelineSnapshot(snapshot: {
    turns: TimelineTurn[];
    frozenTimeline: TimelineItem[];
    status?: TimelineState['status'];
    lastError?: string | null;
    currentUserPrompt?: string;
  }): void {
    this.reset();
    this.state = {
      ...this.state,
      turns: snapshot.turns,
      frozenTimeline: snapshot.frozenTimeline,
      timeline: [],
      status: snapshot.status ?? 'idle',
      lastError: snapshot.lastError ?? null,
      currentUserPrompt: snapshot.currentUserPrompt ?? '',
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute assistant text by concatenating all `text` items in a timeline. */
export function deriveAssistantText(timeline: TimelineItem[]): string {
  let text = '';
  for (const item of timeline) {
    if (item.kind === 'text') text += item.entry.content;
  }
  return text;
}

/** Extract typed sublists from a timeline (thinking / tool / text). */
export function deriveFromTimeline(timeline: TimelineItem[]): {
  thinkingEntries: TimelineThinkingEntry[];
  toolEntries: TimelineToolCallEntry[];
  assistantText: string;
} {
  const thinkingEntries: TimelineThinkingEntry[] = [];
  const toolEntries: TimelineToolCallEntry[] = [];
  let assistantText = '';
  for (const item of timeline) {
    if (item.kind === 'thinking') thinkingEntries.push(item.entry);
    else if (item.kind === 'tool') toolEntries.push(item.entry);
    else if (item.kind === 'text') assistantText += item.entry.content;
  }
  return { thinkingEntries, toolEntries, assistantText };
}
