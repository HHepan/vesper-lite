// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — SessionPanel (virtual-scroll layout for long sessions)
//
// Uses @tanstack/react-virtual for dynamic-height virtualised scrolling.
// Only items in/near the viewport are mounted — 1000+ tool calls stay fast.
//
// Layout:
//   ┌─────────────────────────────────────────┐
//   │ [virtualised scrollable area]           │
//   │   WelcomeBanner (item 0)                │
//   │   FrozenItem × N  (past turns)          │
//   │   FrozenItem × M  (current frozen)      │
//   │   CurrentTurn (streaming tail)          │
//   │   Dialogs / TaskPanel / Spinner         │
//   ├─────────────────────────────────────────┤
//   │ > InputBox                              │  ← fixed bottom
//   │ StatusBar                               │
//   └─────────────────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════════════

import React, { useSyncExternalStore, useCallback, useRef, useEffect, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { WebStore } from '../store.js';
import type { TimelineItem } from '../store.js';
import { theme } from '../theme.js';
import { WelcomeBanner } from './WelcomeBanner.js';
import { TimelineItemView } from './TimelineItem.js';
import { ToolGroup } from './ToolGroup.js';
import { groupTimelineItems, type GroupedTimelineItem } from '../lib/group-tools.js';
import { CurrentTurn } from './CurrentTurn.js';
import { AgentSpinner } from './AgentSpinner.js';
import { TaskPanel } from './TaskPanel.js';
import { InputBox } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { PermissionDialog } from './PermissionDialog.js';
import { AskUserDialog } from './AskUserDialog.js';
import { DatasetOverwriteDialog } from './DatasetOverwriteDialog.js';
import { CanvasBrowser, type CanvasBrowserAction } from './CanvasBrowser.js';
import { SessionBrowser, type SessionBrowserAction } from './SessionBrowser.js';
import type { RequestAction } from './AgentSpinner.js';
import { MessageTimeline } from './MessageTimeline.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

// ---------------------------------------------------------------------------
// Flat item model: every visible row is one of these
// ---------------------------------------------------------------------------

type FlatItem =
  | { kind: 'welcome' }
  | { kind: 'timeline'; item: GroupedTimelineItem }
  | { kind: 'tail' }; // CurrentTurn + dialogs + spinner + tasks

interface SessionPanelProps {
  store: WebStore;
  onSendPrompt: (text: string, images?: import('./InputBox.js').PendingImage[], regenerate?: boolean) => void;
  onAbort: () => void;
  onCanvasBrowserAction?: (action: CanvasBrowserAction) => void;
  onSessionBrowserAction?: (action: SessionBrowserAction) => void;
  onRequestAction?: (action: RequestAction) => void;
  onSwitchPersona?: (name: string) => void;
  onSwitchMember?: (personaName: string, roleName: string) => void;
  onSwitchProvider?: (profile: string) => void;
  onDisableSupervisor?: () => void;
  onUpdateSupervisorRules?: (rules: string) => void;
  onTogglePublicMode?: () => void;
  onSetPermissionMode?: (mode: 'manual' | 'auto' | 'supervisor') => void;
  onSetMultiChatMode?: (enabled: boolean, members: string[]) => void;
  onFileSearch?: import('./InputBox.js').FileSearchFn;
}

export function SessionPanel({ store, onSendPrompt, onAbort, onCanvasBrowserAction, onSessionBrowserAction, onRequestAction, onSwitchPersona, onSwitchMember, onSwitchProvider, onDisableSupervisor, onUpdateSupervisorRules, onTogglePublicMode, onSetPermissionMode, onSetMultiChatMode, onFileSearch }: SessionPanelProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollLoopRef = useRef<number | null>(null);
  const isAutoScrollingRef = useRef(false);
  const isMobile = useIsMobile();
  const [mobileTimelineOpen, setMobileTimelineOpen] = useState(false);

  // ── Flatten all items into a single virtual list ──────────────────────
  // Memoize grouped items from completed past turns so they aren't re-computed on every stream event.
  const pastTurnsItems: FlatItem[] = useMemo(() => {
    const items: FlatItem[] = [];
    for (const turn of state.turns) {
      const grouped = groupTimelineItems(turn.timeline);
      for (const gi of grouped) {
        items.push({ kind: 'timeline', item: gi });
      }
    }
    return items;
  }, [state.turns]);

  const flatItems: FlatItem[] = useMemo(() => {
    const items: FlatItem[] = [{ kind: 'welcome' }, ...pastTurnsItems];

    // Current turn: combine frozen (settled) and in-flight (active) timeline items into one unified sequence,
    // then group contiguous tools. This ensures running tools stay INSIDE their ToolGroup with isRunning=true,
    // and multiple tool bursts separated by text naturally become separate ToolGroups.
    const currentTurnAll = [...state.frozenTimeline, ...state.timeline];
    const groupedCurrent = groupTimelineItems(currentTurnAll);
    for (const gi of groupedCurrent) {
      items.push({ kind: 'timeline', item: gi });
    }

    // Tail: dialogs + spinner + task panel (always last, always rendered)
    items.push({ kind: 'tail' });

    return items;
  }, [pastTurnsItems, state.frozenTimeline, state.timeline]);

  // ── Virtualizer ───────────────────────────────────────────────────────
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index: number) => {
      const item = flatItems[index];
      if (item.kind === 'welcome') return 'welcome';
      if (item.kind === 'tail') return 'tail';
      if (item.item.kind === 'tool_group') return item.item.id;
      return item.item.entry.id;
    },
    estimateSize: (index: number) => {
      const item = flatItems[index];
      if (item.kind === 'welcome') return 60;
      if (item.kind === 'tail') return 150;
      // Timeline items: rough estimates by kind
      switch (item.item.kind) {
        case 'prompt': return 32;
        case 'thinking': return 24;
        case 'tool': return 28;
        case 'tool_group': return 36;
        case 'text': return 80;
        default: return 40;
      }
    },
    overscan: 10,
  });

  // ── Auto-scroll to bottom ─────────────────────────────────────────────
  // The `tail` virtual item contains several sub-components whose content
  // can grow without changing flatItems.length or state.timeline (e.g.
  // extended retry banners, task list, permission/ask-user dialogs).
  // We include those state slices as dependencies so the virtualizer
  // re-scrolls when the tail's DOM height changes.
  const prevItemCount = useRef(flatItems.length);
  useEffect(() => {
    if (userScrolledUp.current) {
      prevItemCount.current = flatItems.length;
      return;
    }
    if (flatItems.length === 0) {
      prevItemCount.current = flatItems.length;
      return;
    }

    // Immediate scroll for new items
    virtualizer.scrollToIndex(flatItems.length - 1, { align: 'end' });

    // Deferred scroll: the tail node may have grown (e.g. retry banner,
    // task list, dialog appeared) but the virtualizer's ResizeObserver
    // hasn't re-measured yet.  Wait one frame for the DOM to settle, then
    // scroll again so the new height is accounted for.
    const raf = requestAnimationFrame(() => {
      if (!userScrolledUp.current) {
        virtualizer.scrollToIndex(flatItems.length - 1, { align: 'end' });
      }
    });

    prevItemCount.current = flatItems.length;
    return () => cancelAnimationFrame(raf);
  }, [flatItems.length, state.timeline, state.status, state.providerRequests, state.tasks, state.pendingPermission, state.pendingAskUser, state.lastError, virtualizer]);

  // Also re-scroll when streaming text updates (tail content grows)
  const lastTimelineLen = useRef(0);
  useEffect(() => {
    const newLen = state.timeline.length;
    if (newLen !== lastTimelineLen.current && !userScrolledUp.current) {
      virtualizer.scrollToIndex(flatItems.length - 1, { align: 'end' });
    }
    lastTimelineLen.current = newLen;
  }, [state.timeline, flatItems.length, virtualizer]);

  // ── Scroll to bottom ──────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    userScrolledUp.current = false;
    setShowScrollDown(false);
    const el = scrollRef.current;
    if (!el) return;

    if (scrollLoopRef.current !== null) {
      cancelAnimationFrame(scrollLoopRef.current);
      scrollLoopRef.current = null;
    }

    isAutoScrollingRef.current = true;
    let attempts = 0;
    const maxAttempts = 20;
    let lastScrollTop = -1;
    let stableCount = 0;

    const step = () => {
      if (!el.isConnected) {
        isAutoScrollingRef.current = false;
        scrollLoopRef.current = null;
        return;
      }

      const targetIndex = flatItems.length - 1;
      if (targetIndex >= 0) {
        virtualizer.scrollToIndex(targetIndex, { align: 'end' });
      }
      el.scrollTop = el.scrollHeight;

      const currentScrollTop = el.scrollTop;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const items = virtualizer.getVirtualItems();
      const hasTail = items.length > 0 && items[items.length - 1].index === targetIndex;

      if (hasTail && distFromBottom <= 5 && currentScrollTop === lastScrollTop) {
        stableCount++;
        if (stableCount >= 2) {
          isAutoScrollingRef.current = false;
          scrollLoopRef.current = null;
          return;
        }
      } else {
        stableCount = 0;
      }

      lastScrollTop = currentScrollTop;
      attempts++;
      if (attempts < maxAttempts) {
        scrollLoopRef.current = requestAnimationFrame(step);
      } else {
        isAutoScrollingRef.current = false;
        scrollLoopRef.current = null;
      }
    };

    scrollLoopRef.current = requestAnimationFrame(step);
  }, [virtualizer, flatItems.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isAutoScrollingRef.current) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = distFromBottom > 100;
    userScrolledUp.current = scrolledUp;
    setShowScrollDown(scrolledUp);
  }, []);

  // ── Scroll to bottom when tab becomes visible (tab switch) ────────────
  // When the panel is hidden (rc-dock tab inactive), scrollRef has zero
  // dimensions.  On re-show the ResizeObserver fires — scroll to bottom.
  //
  // IMPORTANT: We do NOT call virtualizer.measure() here.  measure()
  // clears all cached item heights and falls back to estimateSize values.
  // Since estimateSize for tool blocks is ~28px but real expanded tools
  // can be 200-400px, this causes severe layout overlap (mixed/stacked
  // rows) until the user scrolls and measureElement re-fires.
  //
  // Instead we just scroll.  The virtualizer's existing measurement cache
  // is still valid (the DOM elements didn't change, they were just hidden).
  const wasHiddenRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Force the virtualizer to re-sync its internal scrollOffset/range with
    // the element's real scrollTop.
    const resyncVirtualizer = () => {
      el.dispatchEvent(new Event('scroll', { bubbles: false }));
    };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { height } = entry.contentRect;
      if (height === 0) {
        wasHiddenRef.current = true;
      } else if (wasHiddenRef.current) {
        wasHiddenRef.current = false;
        // Tab just became visible again — this fires on tab switch AND when an
        // rc-dock split re-parents this panel's cached DOM node.
        // Resync virtualizer and scroll to bottom.
        requestAnimationFrame(() => {
          if (!el.isConnected) return;
          resyncVirtualizer();
          if (virtualizer.getVirtualItems().length === 0 && flatItems.length > 0) {
            virtualizer.scrollToOffset(el.scrollTop, { align: 'start' });
            resyncVirtualizer();
          }
          scrollToBottom();
        });
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [virtualizer, flatItems.length, scrollToBottom]);

  // ── Initial mount: scroll to bottom if content exists ───────────────
  useEffect(() => {
    if (flatItems.length > 0) {
      scrollToBottom();
    }
  }, []); // Run once on mount

  // ── Scroll to bottom when session is activated / switched to ──────────
  const prevActivationRef = useRef(state.activationCount);
  useEffect(() => {
    if (state.activationCount !== prevActivationRef.current) {
      prevActivationRef.current = state.activationCount;
      scrollToBottom();
    }
  }, [state.activationCount, scrollToBottom]);

  // ── Cancel auto-scroll if user manually wheels / touches ─────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onUserInteract = () => {
      if (isAutoScrollingRef.current) {
        if (scrollLoopRef.current !== null) {
          cancelAnimationFrame(scrollLoopRef.current);
          scrollLoopRef.current = null;
        }
        isAutoScrollingRef.current = false;
      }
    };
    el.addEventListener('wheel', onUserInteract, { passive: true });
    el.addEventListener('touchmove', onUserInteract, { passive: true });
    return () => {
      el.removeEventListener('wheel', onUserInteract);
      el.removeEventListener('touchmove', onUserInteract);
    };
  }, []);

  // ── Blank-canvas self-heal ──────────────────────────────────────────
  // rc-dock split/move can leave the virtualizer with a stale range that never
  // re-notifies (scrollOffset synced only via scroll events). If we ever render
  // with zero virtual items while there IS content and the container has real
  // height, nudge a scroll event to force a resync.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (flatItems.length > 0 && virtualizer.getVirtualItems().length === 0 && el.clientHeight > 0) {
      el.dispatchEvent(new Event('scroll', { bubbles: false }));
    }
  }, [flatItems.length, virtualizer]);

  // ── Callbacks ─────────────────────────────────────────────────────────
  const handleToggleTool = useCallback((id: string) => {
    store.toggleToolCollapse(id);
  }, [store]);

  const handleToggleThinking = useCallback((id: string) => {
    store.toggleThinkingCollapse(id);
  }, [store]);

  const handlePermissionRespond = useCallback((decision: import('../store.js').PermissionDecision, denyReason?: string) => {
    store.respondPermission(decision, denyReason);
  }, [store]);

  const handleAskUserRespond = useCallback((answers: import('../store.js').AskUserAnswers) => {
    store.respondAskUser(answers);
  }, [store]);

  const handleDatasetOverwriteRespond = useCallback((decision: 'overwrite' | 'cancel') => {
    store.respondDatasetOverwrite(decision);
  }, [store]);

  const inputDisabled = !state.ready || state.pendingPermission !== null || state.pendingAskUser !== null || state.canvasBrowser !== null || state.sessionBrowser !== null || state.datasetOverwriteDialog !== null;

  // ── Flow-control actions for InputBox row ──────────────────────────────────
  const flowActions: import('./InputBox.js').FlowAction[] | undefined = useMemo(() => {
    if (state.status === 'streaming') {
      return [{ label: '⏹ 暂停', title: '暂停生成 (Escape)', onClick: onAbort }];
    }
    if ((state.status === 'done' || state.status === 'idle') && state.currentUserPrompt) {
      return [{ label: '🔁 重新生成', title: '用相同的输入重新生成回答', onClick: () => onSendPrompt(state.currentUserPrompt!, undefined, true) }];
    }
    if (state.status === 'error' && state.currentUserPrompt) {
      return [
        { label: '▶ 继续尝试', title: '重试上一轮请求', onClick: () => onSendPrompt(state.currentUserPrompt!) },
        { label: '🔁 重新生成', title: '用相同的输入重新生成回答', onClick: () => onSendPrompt(state.currentUserPrompt!, undefined, true), dimmed: true },
      ];
    }
    return undefined;
  }, [state.status, state.currentUserPrompt, onAbort, onSendPrompt]);

  // Trailing text ID for streaming cursor
  const trailingTextId = state.status === 'streaming' && state.timeline.length > 0 && state.timeline[state.timeline.length - 1].kind === 'text'
    ? state.timeline[state.timeline.length - 1].entry.id
    : null;

  // ── Render ────────────────────────────────────────────────────────────
  const virtualItems = virtualizer.getVirtualItems();

  // Calculate visible range for MessageTimeline
  const visibleRange = {
    start: virtualItems.length > 0 ? virtualItems[0].index : 0,
    end: virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : 0,
  };

  return (
    <div style={styles.panel}>
      {/* Virtualised scrollable area */}
      <div style={styles.scrollWrapper}>
      <div ref={scrollRef} style={styles.scroll} onScroll={handleScroll}>
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualItems.map((vItem) => {
            const flatItem = flatItems[vItem.index];

            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vItem.start}px)`,
                }}
              >
                {flatItem.kind === 'welcome' && <WelcomeBanner />}

                {flatItem.kind === 'timeline' && flatItem.item.kind === 'tool_group' && (
                  <ToolGroup
                    entries={flatItem.item.entries}
                    onToggleTool={handleToggleTool}
                  />
                )}

                {flatItem.kind === 'timeline' && flatItem.item.kind !== 'tool_group' && (
                  <TimelineItemView
                    item={flatItem.item}
                    isStreaming={flatItem.item.kind === 'text' && flatItem.item.entry.id === trailingTextId}
                    onToggleTool={handleToggleTool}
                    onToggleThinking={handleToggleThinking}
                  />
                )}

                {flatItem.kind === 'tail' && (
                  <>
                    {/* Error display */}
                    {state.lastError && (
                      <div style={styles.error}>
                        <span style={{ color: theme.errorDot }}>● </span>
                        <span style={{ color: theme.errorText }}>{state.lastError}</span>
                      </div>
                    )}

                    {/* Permission dialog */}
                    {state.pendingPermission && (
                      <PermissionDialog
                        permission={state.pendingPermission}
                        onRespond={handlePermissionRespond}
                      />
                    )}

                    {/* Ask user dialog */}
                    {state.pendingAskUser && (
                      <AskUserDialog
                        pending={state.pendingAskUser}
                        onRespond={handleAskUserRespond}
                      />
                    )}

                    {/* Dataset overwrite confirmation dialog */}
                    {state.datasetOverwriteDialog && (
                      <DatasetOverwriteDialog
                        name={state.datasetOverwriteDialog.name}
                        path={state.datasetOverwriteDialog.path}
                        onRespond={handleDatasetOverwriteRespond}
                      />
                    )}

                    {/* Canvas browser modal */}
                    {state.canvasBrowser && onCanvasBrowserAction && (
                      <CanvasBrowser
                        state={state.canvasBrowser}
                        onAction={onCanvasBrowserAction}
                      />
                    )}

                    {/* Session browser modal */}
                    {state.sessionBrowser && onSessionBrowserAction && (
                      <SessionBrowser
                        state={state.sessionBrowser}
                        onAction={onSessionBrowserAction}
                      />
                    )}

                    {/* Task panel */}
                    <TaskPanel tasks={state.tasks} />

                    {/* Agent spinner + inline request controls */}
                    <AgentSpinner
                      status={state.status}
                      timeline={state.timeline}
                      providerRequests={state.providerRequests}
                      onRequestAction={onRequestAction}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scroll-to-bottom FAB */}
      {showScrollDown && (
        <button
          className="scroll-down-btn"
          onClick={scrollToBottom}
          style={styles.scrollDownBtn}
          title="回到最新消息"
          aria-label="Scroll to latest message"
        >
          ↓
        </button>
      )}

      {/* Message timeline navigation */}
      <MessageTimeline
        flatItems={flatItems}
        virtualizer={virtualizer}
        visibleRange={visibleRange}
        renderSheetOnly={isMobile}
        mobileOpen={mobileTimelineOpen}
        onMobileOpenChange={setMobileTimelineOpen}
      />
      </div>

      {/* Fixed bottom area */}
      <div style={styles.bottom}>
        <Separator />

        <InputBox
          onSubmit={onSendPrompt}
          onEscape={onAbort}
          disabled={inputDisabled}
          inputHistory={state.inputHistory}
          onFileSearch={onFileSearch}
          flowActions={flowActions}
          floatingActionsPrefix={
            isMobile ? (
              <button
                type="button"
                onClick={() => setMobileTimelineOpen(true)}
                style={styles.mobileTimelineTrigger}
                title="消息列表导航"
              >
                📋 消息
              </button>
            ) : null
          }
        />

        <Separator />

        <StatusBar
          modelName={state.modelName}
          tokenBudget={state.tokenBudget}
          status={state.status}
          providerUsage={state.lastProviderUsage}
          cumulativeUsage={state.cumulativeUsage}
          currentToolset={state.currentToolset}
          currentPersona={state.currentPersona}
          activeRoleName={state.activeRoleName}
          loadedSkills={state.loadedSkills}
          availablePersonas={state.availablePersonas}
          onSwitchPersona={onSwitchPersona}
          onSwitchMember={onSwitchMember}
          availableProfiles={state.availableProfiles}
          currentProvider={state.currentProvider}
          onSwitchProvider={onSwitchProvider}
          supervisorMode={state.supervisorMode}
          supervisorRules={state.supervisorRules}
          onDisableSupervisor={onDisableSupervisor}
          onUpdateSupervisorRules={onUpdateSupervisorRules}
          assignments={state.assignments}
          publicMode={state.publicMode}
          onTogglePublicMode={onTogglePublicMode}
          multiChatMode={state.multiChatMode}
          selectedMembers={state.selectedMembers}
          onMultiChatChange={(enabled, members) => {
            store.setMultiChatMode(enabled, members);
            onSetMultiChatMode?.(enabled, members);
          }}
          permissionMode={state.permissionMode}
          onSetPermissionMode={onSetPermissionMode}
        />
      </div>
    </div>
  );
}

function Separator() {
  return <hr className="tui-separator" />;
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 0,
  },
 
  scrollWrapper: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 0,
  },
  scroll: {
    height: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
    // No padding — virtualizer controls all positioning
  },
  scrollDownBtn: {
    position: 'absolute',
    bottom: 46,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'var(--shadow-md)',
    transition: 'all 0.15s ease',
    zIndex: 20,
  },
  mobileTimelineTrigger: {
    background: 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 8px',
    color: 'var(--text-secondary)',
    fontFamily: 'inherit',
    fontSize: '11px',
    fontWeight: 500,
    cursor: 'pointer',
    touchAction: 'manipulation',
    whiteSpace: 'nowrap' as const,
    lineHeight: '1.4em',
    transition: 'all 0.15s ease',
  },
  bottom: {
    flexShrink: 0,
  },
};
