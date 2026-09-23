// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Root App Component (TUI Style)
//
// Desktop: Toolbar + DockLayout (rc-dock) with split panes, drag-drop tabs
// Mobile:  TabBar + single-panel rendering (unchanged)
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createBridge, type Bridge, type BridgeState, type WireLogEntry } from './bridge.js';
import { createWebStore, type WebStore } from './store.js';
import { TabBar, type TabInfo } from './components/TabBar.js';
import { SessionSidebar } from './components/SessionSidebar.js';
import { SessionPanel } from './components/SessionPanel.js';
import { ConfigPanel } from './components/ConfigPanel.js';
import { SessionCreateDialog, bumpSessionCounter } from './components/SessionCreateDialog.js';
import { DebugPanel } from './components/DebugPanel.js';

import { Toolbar } from './components/Toolbar.js';
import { DockLayoutWrapper } from './components/dock/DockLayoutWrapper.js';
import { SessionTabContent } from './components/dock/SessionTabContent.js';
import { ThemeProvider, useTheme } from './contexts/ThemeContext.js';
import { useIsMobile } from './hooks/useIsMobile.js';
import { useNotification } from './hooks/useNotification.js';
import { useNotificationSound } from './hooks/useNotificationSound.js';
import type { CanvasBrowserAction } from './components/CanvasBrowser.js';
import type { SessionBrowserAction } from './components/SessionBrowser.js';
import type { RequestAction } from './components/AgentSpinner.js';
import { captureSessionToClipboard } from './components/ScreenshotRenderer.js';

// ---------------------------------------------------------------------------
// Tab types — sessions only (terminal support is not part of Vesper Lite)
// ---------------------------------------------------------------------------

interface SessionTab {
  kind: 'session';
  id: string;
  name: string;
  store: WebStore;
}

type Tab = SessionTab;

let tabCounter = 0;
function nextTabId(prefix: string): string {
  // Append a random suffix so ids are unique across page reloads. Without this,
  // ids restart at "s1"/"t1" after every reload and collide with stale
  // localStorage entries (pinned tabs / session order / tags) from a previous
  // session — making freshly-created sessions appear pinned for no reason.
  return `${prefix}${++tabCounter}-${Math.random().toString(36).slice(2, 6)}`;
}
/** Ensure tabCounter stays above any restored session/terminal ID. */
function bumpTabCounter(id: string): void {
  const m = id.match(/^[st](\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= tabCounter) tabCounter = n;
  }
}

/**
 * 返回固定标签页中"最新 pin 且当前已存在"的 tab id（pinnedIds 按 pin 顺序追加，
 * 数组末尾即最新打开的）。没有任何可用的固定标签页时返回 null。
 * 刷新后用于决定自动激活哪个标签：优先最新 pinned 的 session/terminal。
 */
function latestPinnedTabId(pinnedIds: string[], tabList: { id: string }[]): string | null {
  const existing = new Set(tabList.map(t => t.id));
  for (let i = pinnedIds.length - 1; i >= 0; i--) {
    if (existing.has(pinnedIds[i])) return pinnedIds[i];
  }
  return null;
}

/** Wire permission + ask-user responders to a WebStore for a given session. */
function wireStoreResponders(bridge: Bridge, store: WebStore, sessionId: string): void {
  store.setPermissionResponder((requestId, decision, denyReason) => {
    bridge.sendCommand(sessionId, {
      cmd: 'permission_respond',
      id: `perm-${Date.now()}`,
      requestId,
      decision,
      ...(denyReason ? { denyReason } : {}),
    });
  });
  store.setAskUserResponder((requestId, answers) => {
    bridge.sendCommand(sessionId, {
      cmd: 'ask_user_respond',
      id: `ask-${Date.now()}`,
      requestId,
      answers,
    });
  });
}

// ---------------------------------------------------------------------------
// Inner App (needs access to TerminalWriteContext)
// ---------------------------------------------------------------------------

function AppInner() {
  const bridgeRef = useRef<Bridge | null>(null);
  const [bridgeState, setBridgeState] = useState<BridgeState>('disconnected');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabIdRaw] = useState<string | null>(null);

  // Wrapper that also clears session notification when switching to a session tab.
  // Supports both direct value and function updater forms.
  const setActiveTabId = useCallback((idOrUpdater: string | null | ((prev: string | null) => string | null)) => {
    if (typeof idOrUpdater === 'function') {
      setActiveTabIdRaw((prev) => {
        const newId = idOrUpdater(prev);
        if (newId) {
          const tab = tabsRef.current.find(t => t.id === newId);
          if (tab?.kind === 'session') {
            tab.store.clearSessionNotification();
            tab.store.notifyActivated();
          }
        }
        return newId;
      });
    } else {
      setActiveTabIdRaw(idOrUpdater);
      if (idOrUpdater) {
        const tab = tabsRef.current.find(t => t.id === idOrUpdater);
        if (tab?.kind === 'session') {
          tab.store.clearSessionNotification();
          tab.store.notifyActivated();
        }
      }
    }
  }, []);
  const [focusedTabId, setFocusedTabId] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showSessionCreate, setShowSessionCreate] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showTodo, setShowTodo] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try { const s = localStorage.getItem('lux-sidebar-width'); return s ? Math.max(230, Math.min(600, parseInt(s, 10))) : 230; } catch { return 230; }
  });
  const [sidebarResizing, setSidebarResizing] = useState(false);
 
  const [wireLog, setWireLog] = useState<WireLogEntry[]>([]);
  const wireLogRef = useRef<WireLogEntry[]>([]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Session tags state (persisted to localStorage)
  const [sessionTags, setSessionTags] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('lux-session-tags');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // ── Session order persistence ────────────────────────────────────
  const [sessionOrder, setSessionOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('lux-session-order');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Persist order whenever it changes
  useEffect(() => {
    try { localStorage.setItem('lux-session-order', JSON.stringify(sessionOrder)); } catch {}
  }, [sessionOrder]);

  // ── Pinned tabs (VS Code-style) ──────────────────────────────────
  // Only pinned tabs stay on the top tab bar. Non-pinned tabs appear
  // as a single italic "preview" tab that gets replaced on next click.
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('lux-pinned-tabs');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Persist pinned tabs
  useEffect(() => {
    try { localStorage.setItem('lux-pinned-tabs', JSON.stringify(pinnedIds)); } catch {}
  }, [pinnedIds]);
  const pinnedIdsRef = useRef(pinnedIds);
  pinnedIdsRef.current = pinnedIds;
  /**
   * Recently closed dock-tab ids (with timestamps), for re-settling the active
   * tab after fast consecutive closes. Keyed by id → close time.
   */
  const recentlyClosedRef = useRef<Map<string, number>>(new Map());

  const isMobile = useIsMobile();
  const notify = useNotification();
  const playSound = useNotificationSound();
  const { themeName } = useTheme();

  // ── Generate col-resize cursor from canvas (theme-aware) ──────────
  const resizeCursor = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 14;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'col-resize';
    const isLight = themeName === 'light';
    // Shadow layer — horizontal double arrow
    ctx.fillStyle = isLight ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.moveTo(0, 7); ctx.lineTo(5, 3); ctx.lineTo(5, 5); ctx.lineTo(15, 5);
    ctx.lineTo(15, 3); ctx.lineTo(20, 7); ctx.lineTo(15, 11); ctx.lineTo(15, 9);
    ctx.lineTo(5, 9); ctx.lineTo(5, 11); ctx.closePath(); ctx.fill();
    // Body layer
    ctx.fillStyle = isLight ? '#333' : '#fff';
    ctx.beginPath();
    ctx.moveTo(1, 7); ctx.lineTo(5.5, 3.5); ctx.lineTo(5.5, 5.5); ctx.lineTo(14.5, 5.5);
    ctx.lineTo(14.5, 3.5); ctx.lineTo(19, 7); ctx.lineTo(14.5, 10.5); ctx.lineTo(14.5, 8.5);
    ctx.lineTo(5.5, 8.5); ctx.lineTo(5.5, 10.5); ctx.closePath(); ctx.fill();
    return `url(${canvas.toDataURL('image/png')}) 10 7, col-resize`;
  })();

  // ── Sidebar resize (drag right edge) ───────────────────────────────
  const handleSidebarResizeRef = useRef<((e: MouseEvent) => void) | null>(null);
  const handleSidebarResizeEndRef = useRef<(() => void) | null>(null);

  const startSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setSidebarResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(230, Math.min(600, startWidth + (ev.clientX - startX)));
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      setSidebarResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Persist final width
      try { localStorage.setItem('lux-sidebar-width', String(sidebarWidth)); } catch {}
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    handleSidebarResizeRef.current = onMouseMove;
    handleSidebarResizeEndRef.current = onMouseUp;
  }, [sidebarWidth]);

  // Persist sidebar width on change (debounced via effect)
  useEffect(() => {
    if (!sidebarResizing) {
      try { localStorage.setItem('lux-sidebar-width', String(sidebarWidth)); } catch {}
    }
  }, [sidebarWidth, sidebarResizing]);

  // Reconnect tracking
  const initializedRef = useRef(false);
  const isRestoringRef = useRef(false);
  // Reactive mirror of isRestoringRef — drives DockLayoutWrapper's skeleton
  // restore deferral (layout must not be restored mid-restore with a stale
  // activeTabId; it is applied only after the restore phase ends).
  const [restoring, setRestoring] = useState(false);

  // Sessions declared by session_list but not yet restored (session_state not
  // yet received). Keeps the restore-settle window open until the *very last*
  // declared session arrives — otherwise a slowly-restoring session would
  // arrive after the settle timer fired and either hijack the active tab
  // (no pinned → "No pinned tabs" screen gets taken over) or fail to become
  // the active tab even though it is the latest pinned one (race).
  const pendingRestoreRef = useRef<Set<string> | null>(null);

  // Fallback timer that force-ends the restore phase even if some declared
  // session never delivers a session_state (server hiccup), so the restoring
  // flag can't hang forever and break normal interaction afterwards.
  const forceSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce timer for settling the active tab after session restore completes.
  // Every session_state arrival during restore resets it; once the restore
  // event stream settles, the active tab is re-decided (latest pinned tab,
  // or none → "No pinned tabs" screen).
  const settleRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest isMobile — needed inside async restore-settle callback.
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;

  // ── Session tags persistence ───────────────────────────────────────

  // Persist tags to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('lux-session-tags', JSON.stringify(sessionTags));
    } catch {
      // Ignore storage errors (quota exceeded, etc.)
    }
  }, [sessionTags]);

  // Clean up orphaned tags on mount (tags for sessions that no longer exist)
  useEffect(() => {
    // This runs once on mount to clean up any stale tags from localStorage
    // that belong to sessions that were closed in a previous page load
    setSessionTags(prev => {
      const cleaned = { ...prev };
      // Remove tags that are empty or whitespace-only
      for (const [id, tag] of Object.entries(cleaned)) {
        if (!tag || !tag.trim()) {
          delete cleaned[id];
        }
      }
      // Only update if we actually removed something
      if (Object.keys(cleaned).length !== Object.keys(prev).length) {
        return cleaned;
      }
      return prev;
    });
  }, []); // Empty deps = run once on mount

  // Handle tag save
  const handleSaveTag = useCallback((sessionId: string, tag: string) => {
    setSessionTags(prev => {
      const next = { ...prev };
      if (tag.trim()) {
        next[sessionId] = tag.trim();
      } else {
        delete next[sessionId];
      }
      return next;
    });
  }, []);

  // ── Bridge setup ─────────────────────────────────────────────────

  /**
   * 决定恢复/重建完成后应激活的 tab：
   * 1. 最新 pin 且已恢复存在的 tab（刷新后自动选中固定标签页中最新的一个）；
   * 2. 没有任何可用 pinned tab 时：桌面端返回 null（显示 "No pinned tabs" 空界面），
   *    移动端保持原行为——激活第一个 tab，避免整页空白。
   */
  const resolveInitialActiveId = useCallback((): string | null => {
    const target = latestPinnedTabId(pinnedIdsRef.current, tabsRef.current);
    if (target) return target;
    if (isMobileRef.current) {
      return tabsRef.current.length > 0 ? tabsRef.current[0].id : null;
    }
    return null;
  }, []);

  useEffect(() => {
    const bridge = createBridge();
    bridgeRef.current = bridge;

    const unsub1 = bridge.onStateChange((state) => {
      setBridgeState(state);
    });

    const unsub2 = bridge.onSessionEvent((sessionId, event) => {
      // Handle sub_session_created before tab lookup (child tab doesn't exist yet)
      if (event.type === 'sub_session_created') {
        const childId = event.childId;
        if (childId && !tabsRef.current.find(t => t.id === childId)) {
          // Auto-restore the new sub-session so it appears in sidebar
          bridge.restoreSession(childId);
        }
        return;
      }

      // Handle session_state before tab lookup (tab doesn't exist yet during restore)
      if (event.type === 'session_state') {
        const { state: snapshot, name: sessionName } = event;
        if (!snapshot) return;
        // Don't create duplicate tabs for same session
        if (tabsRef.current.find(t => t.id === sessionId)) return;
        bumpTabCounter(sessionId);
        // Keep session name counter in sync (e.g. "Session 3" → bump to 3)
        if (sessionName) {
          const m = sessionName.match(/^Session\s+(\d+)$/);
          if (m) bumpSessionCounter(parseInt(m[1], 10));
        }

        const store = createWebStore(sessionId, { defaultCollapsed: isMobile });
        wireStoreResponders(bridge, store, sessionId);
        store.loadSnapshot(snapshot);

        const tab: SessionTab = { kind: 'session', id: sessionId, name: sessionName ?? sessionId, store };
        tabsRef.current = [...tabsRef.current, tab];
        setTabs(tabsRef.current);
        pendingRestoreRef.current?.delete(sessionId);
        setActiveTabId(prev => {
          // 正常交互（恢复已定案）中 active 仍有效则保持；恢复过程中忽略保持逻辑，
          // 始终按最新 pinned 且已恢复的 tab 计算——否则较早的 settle 定案结果会
          // 卡住慢恢复的"最新固定标签"，刷新后选不中（时序竞态）。
          if (!isRestoringRef.current && prev && tabsRef.current.some(t => t.id === prev)) return prev;
          return latestPinnedTabId(pinnedIdsRef.current, tabsRef.current) ?? sessionId;
        });
        // Ordering: during bulk restore (page refresh) append so the persisted
        // order is preserved; at runtime (new sub-session, remote-created
        // session) prepend so the newest session surfaces at the top.
        setSessionOrder(prev => prev.includes(sessionId)
          ? prev
          : isRestoringRef.current ? [...prev, sessionId] : [sessionId, ...prev]);
        // 恢复过程中：每次恢复事件到达都重置 settle 定时器（与 DockLayoutWrapper 的
        // 布局恢复 debounce 节奏一致）；事件流停滞后统一决定激活标签——最新 pinned 的
        // tab，没有任何 pinned tab 则桌面端显示 "No pinned tabs" 空界面。
        // 仅当所有已声明的 session 都恢复完毕才结束恢复态；否则保持，等待迟到的
        // session_state 重新启动 settle，并用兜底定时器防止恢复态永久悬挂。
        if (isRestoringRef.current) {
          if (settleRestoreTimerRef.current) clearTimeout(settleRestoreTimerRef.current);
          settleRestoreTimerRef.current = setTimeout(() => {
            settleRestoreTimerRef.current = null;
            setActiveTabId(resolveInitialActiveId());
            if ((pendingRestoreRef.current?.size ?? 0) === 0) {
              isRestoringRef.current = false;
              setRestoring(false);
              if (forceSettleTimerRef.current) {
                clearTimeout(forceSettleTimerRef.current);
                forceSettleTimerRef.current = null;
              }
            } else if (!forceSettleTimerRef.current) {
              forceSettleTimerRef.current = setTimeout(() => {
                forceSettleTimerRef.current = null;
                isRestoringRef.current = false;
                setRestoring(false);
                setActiveTabId(resolveInitialActiveId());
              }, 5000);
            }
          }, 300);
        }
        return;
      }

      const tab = tabsRef.current.find(t => t.id === sessionId);
      if (!tab || tab.kind !== 'session') return;
      const session = tab;

      switch (event.type) {
        case 'ready':
          session.store.markReady();
          break;

        case 'canvas_browse_result':
          session.store.openCanvasBrowser(event.snapshot);
          return;
        case 'canvas_op_result':
          if (event.success) session.store.updateCanvasBrowser(event.snapshot);
          return;
        case 'canvas_inspect_result':
          session.store.canvasBrowserSetInspect(event.blockId, event.content);
          return;
        case 'canvas_edit_result':
          if (event.success) {
            session.store.updateCanvasBrowser(event.snapshot);
            session.store.canvasBrowserBackToList();
          }
          return;

        case 'session_saved':
          session.store.addSystemMessage(`Session saved: "${event.name}" (${event.sessionId})`);
          return;
        case 'session_loaded':
          if (event.uiState) {
            session.store.reset();
            session.store.loadSnapshot(event.uiState);
          }
          session.store.addSystemMessage(`Session loaded: ${event.sessionId}`);
          return;
        case 'session_list_result': {
          // Only open the TUI-style session browser if it's already visible
          // (i.e., triggered by /sessions command). The Settings panel SessionsTab
          // consumes this event independently — we don't want both to react.
          const sessions = event.sessions ?? [];
          if (session.store.getSnapshot().sessionBrowser) {
            // Browser already open — update data
            session.store.openSessionBrowser(sessions);
          } else if (sessions.length > 0) {
            // Browser not open — this is from /sessions command, open it
            session.store.openSessionBrowser(sessions);
          } else {
            session.store.addSystemMessage('No saved sessions.');
          }
          return;
        }
        case 'session_rollback_result':
          session.store.addSystemMessage(`Rolled back to checkpoint ${event.checkpointId} (step ${event.step})`);
          return;
        case 'session_deleted':
          session.store.addSystemMessage(`Session deleted: "${event.name ?? event.sessionId}" (${event.sessionId})`);
          // Clear session tag from localStorage
          setSessionTags(prev => {
            const next = { ...prev };
            delete next[event.sessionId];
            return next;
          });
          // Refresh session browser if open
          if (session.store.getSnapshot().sessionBrowser) {
            bridge.sendCommand(sessionId, { cmd: 'session_list', id: `sl-refresh-${Date.now()}` });
          }
          return;
        case 'session_renamed': {
          // The server broadcasts the authoritative rename as a session event.
          // Update the tab model immediately as well as the session store; the
          // tab label is independent from the store and otherwise only gets
          // refreshed incidentally on a later tab switch.
          const renamedSessionId = event.sessionId || sessionId;
          if (event.name) {
            setTabs(prev => prev.map(t =>
              t.id === renamedSessionId ? { ...t, name: event.name } : t,
            ));
          }
          session.store.addSystemMessage(`Session renamed to: "${event.name}" (${renamedSessionId})`);
          // Refresh session browser if open
          if (session.store.getSnapshot().sessionBrowser) {
            bridge.sendCommand(sessionId, { cmd: 'session_list', id: `sl-refresh-${Date.now()}` });
          }
          return;
        }
        case 'session_rename_failed':
          session.store.addSystemMessage('Failed to rename session: ' + event.error);
          return;
        case 'session_exported':
          session.store.addSystemMessage(`Session "${event.name}" exported to: ${event.filePath}`);
          return;
        case 'session_imported':
          session.store.addSystemMessage(`Session "${event.name}" imported. Use /load ${event.name} to load it.`);
          return;

        case 'canvas_cleared':
          session.store.reset();
          session.store.addSystemMessage('Canvas cleared — reset to initial state.');
          // Clear session tag when canvas is cleared
          setSessionTags(prev => {
            const next = { ...prev };
            delete next[sessionId];
            return next;
          });
          return;

        case 'compact_complete':
          session.store.addSystemMessage(`Canvas compacted: ${event.foldCount} folded, ${event.unfoldCount} unfolded`);
          return;
        case 'curator_run':
          return;

        case 'dump_complete':
          session.store.addSystemMessage(`Prompt dumped to: ${event.filePath}`);
          return;

        case 'task_snapshot':
          session.store.setTasks(event.tasks ?? []);
          return;

        case 'status':
          session.store.addSystemMessage(event.message);
          return;

        case 'dataset_saved':
          if (event.path) {
            session.store.addSystemMessage(`✅ 数据集已保存: "${event.name}" (${event.egoCount} 个 ego) → ${event.path}`);
          } else if (event.egoCount === 0) {
            session.store.addSystemMessage(`⚠️ 数据集保存取消: "${event.name}"`);
          }
          return;


        case 'permission_request':
          notify('Vesper Lite — Approval Needed', `"${event.toolName}" requires permission.`);
          playSound('attention');
          break; // fall through to handleEvent()
        case 'ask_user_request':
          notify('Vesper Lite — Question', event.questions?.[0]?.question ?? 'Agent is asking a question.');
          playSound('attention');
          break; // fall through to handleEvent()

        case 'session_notification':
          // Yellow dot notification from another session — only notify if tab is not active
          if (activeTabIdRef.current !== sessionId) {
            notify('Vesper Lite — Session Message', `Message from ${event.fromLabel ?? 'another session'}`);
            playSound('attention');
          }
          break; // fall through to handleEvent()

        case 'toolset_skill_state':
          // Let it fall through to handleEvent() for store state update
          break;

        case 'run_started':
          session.store.removePending(event.prompt);
          // Yellow dot: non-active session received a new message/run
          if (activeTabIdRef.current !== sessionId) {
            session.store.setSessionNotification();
          }
          break; // fall through to handleEvent() to clear error & set streaming
        case 'run_complete':
          session.store.markIdle();
          // Yellow dot: non-active session finished a run
          if (activeTabIdRef.current !== sessionId) {
            session.store.setSessionNotification();
          }
          notify('Vesper Lite — Task Complete', `Session "${tab.name}" is now idle.`);
          playSound('complete');
          return;
      }

      session.store.handleEvent(event);
    });

    const unsub3 = bridge.onMetaEvent((event) => {
      switch (event.type) {
        case 'cron_snapshot': {
          // Server-level cron snapshots are broadcast without a sessionId.
          // Apply the authoritative snapshot to every session store so rename
          // updates (including legacy name-based targets) reach the UI.
          for (const tab of tabsRef.current) {
            if (tab.kind === 'session') tab.store.handleEvent(event);
          }
          break;
        }

        case 'session_created':
          if (event.success) {
            // Auto-restore the newly created session so it appears in sidebar
            bridge.restoreSession(event.sessionId);
          } else {
            console.error('Failed to create session:', event.sessionId, event.error);
          }
          break;

        case 'session_list': {
          // Reconnect flow: restore existing sessions or create fresh
          if (!initializedRef.current) {
            initializedRef.current = true;
            const sessions = event.sessions ?? [];
            if (sessions.length > 0) {
              isRestoringRef.current = true;
              setRestoring(true);
              const pending = new Set<string>();
              for (const s of sessions) pending.add(s.id ?? s);
              pendingRestoreRef.current = pending;
              for (const s of sessions) {
                bridge.restoreSession(s.id ?? s);
              }
            } else {
              // No existing sessions — create a fresh one
              const id = nextTabId('s');
              const name = 'Default Session';
              const store = createWebStore(id, { defaultCollapsed: isMobile });
              wireStoreResponders(bridge, store, id);
              const tab: SessionTab = { kind: 'session', id, name, store };
              tabsRef.current = [...tabsRef.current, tab];
              setTabs(tabsRef.current);
              setActiveTabId(id);
              bridge.createSession(id, { name });
            }
          }
          break;
        }

        case 'file_search_result': {
          if (event.requestId) {
            const cb = fileSearchCallbacksRef.current.get(event.requestId);
            if (cb) {
              fileSearchCallbacksRef.current.delete(event.requestId);
              // Enrich each result with absolutePath (cwd + relative path)
              const cwdBase: string = (event.cwd ?? '').replace(/\/$/, '');
              const enriched = (event.results ?? []).map((r: any) => ({
                ...r,
                absolutePath: cwdBase ? `${cwdBase}/${r.path}` : r.path,
              }));
              cb(enriched);
            }
          }
          break;
        }

      }
    });

    const unsub4 = bridge.onWireLog((entry) => {
      wireLogRef.current = [...wireLogRef.current.slice(-499), entry];
      setWireLog(wireLogRef.current);
    });

    const currentPort = window.location.port ? parseInt(window.location.port) : 18767;
    bridge.connect(currentPort);

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      if (settleRestoreTimerRef.current) {
        clearTimeout(settleRestoreTimerRef.current);
        settleRestoreTimerRef.current = null;
      }
      if (forceSettleTimerRef.current) {
        clearTimeout(forceSettleTimerRef.current);
        forceSettleTimerRef.current = null;
      }
      bridge.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session management ───────────────────────────────────────────

  const openNewSessionDialog = useCallback(() => {
    if (bridgeState !== 'connected') return;
    setShowSessionCreate(true);
  }, [bridgeState]);

  const doCreateSession = useCallback((profile?: string, customName?: string) => {
    const bridge = bridgeRef.current;
    if (!bridge || bridgeState !== 'connected') return;
    setShowSessionCreate(false);

    const id = nextTabId('s');
    const name = customName || `Session ${tabCounter}`;
    const store = createWebStore(id, { defaultCollapsed: isMobile });

    wireStoreResponders(bridge, store, id);

    const config: Record<string, any> = { name };
    if (profile) config.profile = profile;

    const tab: SessionTab = { kind: 'session', id, name, store };
    tabsRef.current = [...tabsRef.current, tab];
    setTabs(tabsRef.current);
    setActiveTabId(id);
    // New sessions go to the TOP of the sidebar — they're the most likely
    // to be used next, and shouldn't require scrolling to the bottom.
    setSessionOrder(prev => [id, ...prev]);

    bridge.createSession(id, config);
  }, [bridgeState]);

  // ── Close tab (either kind) ──────────────────────────────────────

  const closeTab = useCallback((id: string) => {
    const bridge = bridgeRef.current;
    const tab = tabsRef.current.find(t => t.id === id);
    if (!tab) return;

    // For sessions, show confirmation dialog
    if (tab.kind === 'session') {
      if (!window.confirm('Close this session? Unsaved conversation history may be lost.')) {
        return;
      }
    }

    if (tab.kind === 'session' && bridge) {
      bridge.destroySession(id);
      // Clear session tag from localStorage
      handleSaveTag(id, '');
      setSessionOrder(prev => prev.filter(oid => oid !== id));
    }
    // Remove from pinned set
    setPinnedIds(prev => prev.filter(pid => pid !== id));

    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== id);
      setActiveTabId(prevActive => {
        if (prevActive !== id) return prevActive;
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
      return remaining;
    });
  }, [handleSaveTag]);

  // ── Pin tab (VS Code-style: single-click preview, double-click pin) ──

  /** Pin a tab so it stays on the top tab bar (idempotent). */
  const pinTab = useCallback((id: string) => {
    setPinnedIds(prev => prev.includes(id) ? prev : [...prev, id]);
  }, []);

  /**
   * Close a tab on the top bar (× button / context menu).
   *
   * - Session: removes it from the bar only — the session stays alive and
   *   remains in the left sidebar, ready to be re-opened.
   *
   * Active-tab adjacency is normally delegated to rc-dock: its onLayoutChange
   * delivers the newly-active tab via currentTabId → onFocusTab. But under
   * fast consecutive closes both rc-dock's currentTabId and our refs are
   * unreliable, so every closed session id is recorded here (with a
   * timestamp) and a useEffect re-settles the active id against the *final*
   * pinnedIds.
   */
  const closeDockTab = useCallback((id: string) => {
    // Session: just remove from the bar, keep alive in the sidebar.
    setPinnedIds(prev => prev.filter(pid => pid !== id));
    recentlyClosedRef.current.set(id, Date.now());
  }, []);

  // Re-settle after a dock-tab close: if the active tab is one of the just
  // closed ones (rc-dock's currentTabId is unreliable under fast consecutive
  // closes), activate the last remaining pinned tab — or clear if none left.
  // Runs against final pinnedIds (functional updates win), so it is immune
  // to stale-ref races during fast consecutive closes.
  useEffect(() => {
    const now = Date.now();
    // Expire stale markers so a session re-opened later isn't re-closed.
    for (const [k, ts] of recentlyClosedRef.current) {
      if (now - ts > 3000) recentlyClosedRef.current.delete(k);
    }
    const activeId = activeTabIdRef.current;
    if (activeId && recentlyClosedRef.current.has(activeId)) {
      recentlyClosedRef.current.delete(activeId);
      // 激活剩余"最新 pinned 且真实存在"的 tab。pinnedIds 可能残留已丢失/已销毁
      // 的 id（如刷新后未恢复的 terminal），直接取数组末尾会激活不存在的标签，
      // 导致标签栏空白、误显示 "No pinned tabs" 空界面。
      setActiveTabId(latestPinnedTabId(pinnedIds, tabsRef.current));
    }
  }, [pinnedIds, activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const renameTab = useCallback((id: string, name: string) => {
    // Check for duplicate session name
    const isDuplicate = tabsRef.current.some(t => t.kind === 'session' && t.id !== id && t.name === name);
    if (isDuplicate) {
      // Show error message in the session being renamed
      const session = tabsRef.current.find(t => t.id === id);
      if (session && session.kind === 'session') {
        session.store.addSystemMessage('Failed to rename: session "' + name + '" already exists');
      }
      return;
    }
    
    setTabs(prev => prev.map(t =>
      t.id === id ? { ...t, name } : t
    ));
    // Persist name on server for restore after refresh
    const bridge = bridgeRef.current;
    if (bridge) bridge.renameSession(id, name);
  }, []);

  // ── Reorder sessions (drag & drop) ───────────────────────────────

  const handleReorderSessions = useCallback((fromIndex: number, toIndex: number) => {
    setTabs(prev => {
      const sessions = prev.filter(t => t.kind === 'session');
      const [moved] = sessions.splice(fromIndex, 1);
      sessions.splice(toIndex, 0, moved);
      const newOrder = sessions.map(s => s.id);
      setSessionOrder(newOrder);
      return sessions;
    });
  }, []);

  // ── Send prompt (tab-targeted) ────────────────────────────────────

  const sendPromptTo = useCallback((tabId: string, text: string, images?: import('./components/InputBox.js').PendingImage[], regenerate?: boolean) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;

    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab || tab.kind !== 'session') return;

    tab.store.pushInputHistory(text);

    if (text.startsWith('/')) {
      bridge.sendCommand(tabId, {
        cmd: 'slash',
        id: `slash-${Date.now()}`,
        input: text,
      });
      return;
    }

    // If the agent is currently streaming (inner loop running), route as
    // sideband interrupt instead of queuing a new run. The runtime will
    // flush accumulated interactions to canvas, inject this message into
    // the conversation, and the LLM will see it on its next round.
    // Note: sideband does not support images — images are ignored here.
    const isStreaming = tab.store.getSnapshot().status === 'streaming';
    if (isStreaming) {
      tab.store.addPending(text);
      bridge.sendCommand(tabId, {
        cmd: 'sideband',
        id: `sb-${Date.now()}`,
        message: text,
      });
      return;
    }

    tab.store.startNewTurn(text, regenerate);

    // Convert PendingImage[] to wire format (ImageAttachment-compatible, without thumbnailUrl)
    const wireImages = images?.map(img => ({
      type: 'image' as const,
      mimeType: img.mimeType,
      data: img.data,
      filename: img.filename,
      ...(img.width != null ? { width: img.width, height: img.height } : {}),
      sizeBytes: img.sizeBytes,
    }));

    bridge.sendCommand(tabId, {
      cmd: 'run',
      id: `run-${Date.now()}`,
      input: text,
      ...(wireImages?.length ? { images: wireImages } : {}),
      ...(regenerate ? { regenerate: true } : {}),
    });
  }, []);

  // Mobile convenience: send to activeTabId
  const sendPrompt = useCallback((text: string, images?: import('./components/InputBox.js').PendingImage[], regenerate?: boolean) => {
    if (activeTabId) sendPromptTo(activeTabId, text, images, regenerate);
  }, [activeTabId, sendPromptTo]);

  // ── @-mention file search ──────────────────────────────────────────

  const fileSearchCallbacksRef = useRef(new Map<string, (results: import('./components/AtMentionMenu.js').FileSearchResultItem[]) => void>());

  // file_search_result is handled inside the bridge setup useEffect's onMetaEvent handler.

  const handleFileSearch = useCallback((query: string, callback: (results: import('./components/AtMentionMenu.js').FileSearchResultItem[]) => void) => {
    const bridge = bridgeRef.current;
    if (!bridge) { callback([]); return; }
    const requestId = `fs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    fileSearchCallbacksRef.current.set(requestId, callback);
    bridge.fileSearch(query, requestId);
    // Timeout: clean up if server doesn't respond within 3s
    setTimeout(() => {
      if (fileSearchCallbacksRef.current.has(requestId)) {
        fileSearchCallbacksRef.current.delete(requestId);
        callback([]);
      }
    }, 3000);
  }, []);

  // ── Abort (tab-targeted) ──────────────────────────────────────────

  const handleAbortFor = useCallback((tabId: string) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.sendCommand(tabId, {
      cmd: 'abort',
      id: `abort-${Date.now()}`,
    });
  }, []);

  const handleAbort = useCallback(() => {
    if (activeTabId) handleAbortFor(activeTabId);
  }, [activeTabId, handleAbortFor]);

  // ── Canvas browser actions (tab-targeted) ─────────────────────────

  const handleCanvasBrowserActionFor = useCallback((tabId: string, action: CanvasBrowserAction) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab || tab.kind !== 'session') return;

    switch (action.type) {
      case 'fold':
      case 'unfold':
      case 'delete':
        bridge.sendCommand(tabId, {
          cmd: 'canvas_op',
          id: `cv-${Date.now()}`,
          op: action.type,
          blockId: action.blockId,
        });
        break;
      case 'inspect':
        bridge.sendCommand(tabId, {
          cmd: 'canvas_inspect',
          id: `cv-${Date.now()}`,
          blockId: action.blockId,
        });
        break;
      case 'edit_submit':
        bridge.sendCommand(tabId, {
          cmd: 'canvas_edit',
          id: `cv-${Date.now()}`,
          blockId: action.blockId,
          content: action.content,
        });
        break;

      case 'close':
        tab.store.closeCanvasBrowser();
        break;
      case 'navigate':
        tab.store.canvasBrowserNavigate(action.delta);
        break;
      case 'navigate_top':
        tab.store.canvasBrowserNavigateTop();
        break;
      case 'navigate_bottom':
        tab.store.canvasBrowserNavigateBottom();
        break;
      case 'fold_all_tool_calls': {
        // Find all tool_call blocks that can be folded
        const snapshot = tab.store.getSnapshot().canvasBrowser?.snapshot;
        if (snapshot) {
          const toolCallBlocks = snapshot.blocks.filter(
            b => b.type === 'tool_call' && b.foldable && !b.folded && !b.pinned
          );
          for (const block of toolCallBlocks) {
            bridge.sendCommand(tabId, {
              cmd: 'canvas_op',
              id: `cv-fold-${Date.now()}-${block.id}`,
              op: 'fold',
              blockId: block.id,
            });
          }
        }
        break;
      }
      case 'back':
        tab.store.canvasBrowserBackToList();
        break;
      case 'start_edit':
        tab.store.canvasBrowserStartEdit(action.blockId, action.content);
        break;
      case 'edit_change':
        tab.store.canvasBrowserSetEditContent(action.content);
        break;
    }
  }, []);

  const handleCanvasBrowserAction = useCallback((action: CanvasBrowserAction) => {
    if (activeTabId) handleCanvasBrowserActionFor(activeTabId, action);
  }, [activeTabId, handleCanvasBrowserActionFor]);

  // ── Session browser actions (tab-targeted) ─────────────────────

  const handleSessionBrowserActionFor = useCallback((tabId: string, action: SessionBrowserAction) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab || tab.kind !== 'session') return;

    switch (action.type) {
      case 'load':
        tab.store.closeSessionBrowser();
        bridge.sendCommand(tabId, {
          cmd: 'slash',
          id: `slash-${Date.now()}`,
          input: `/load ${action.sessionName}`,
        });
        break;
      case 'delete':
        bridge.sendCommand(tabId, {
          cmd: 'slash',
          id: `slash-${Date.now()}`,
          input: `/delete ${action.sessionName}`,
        });
        // Re-request session list to refresh the panel
        bridge.sendCommand(tabId, {
          cmd: 'session_list',
          id: `sl-${Date.now()}`,
        });
        break;
      case 'close':
        tab.store.closeSessionBrowser();
        break;
      case 'navigate':
        tab.store.sessionBrowserNavigate(action.delta);
        break;
      case 'navigate_top':
        tab.store.sessionBrowserNavigateTop();
        break;
      case 'navigate_bottom':
        tab.store.sessionBrowserNavigateBottom();
        break;
    }
  }, []);

  const handleSessionBrowserAction = useCallback((action: SessionBrowserAction) => {
    if (activeTabId) handleSessionBrowserActionFor(activeTabId, action);
  }, [activeTabId, handleSessionBrowserActionFor]);

  // ── Provider request control (tab-targeted) ──────────────────────

  const handleRequestActionFor = useCallback((tabId: string, action: RequestAction) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    const cmdMap = {
      pause: 'provider_request_pause',
      resume: 'provider_request_resume',
      retry: 'provider_request_retry',
      abort: 'provider_request_abort',
    } as const;
    bridge.sendCommand(tabId, {
      cmd: cmdMap[action.type as keyof typeof cmdMap],
      id: `req-${Date.now()}`,
      requestId: action.requestId,
    });
  }, []);

  // ── Persona switching (tab-targeted) ──────────────────────────────

  const handleSwitchPersonaFor = useCallback((tabId: string, name: string) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.sendCommand(tabId, {
      cmd: 'slash',
      id: `persona-${Date.now()}`,
      input: `/persona ${name}`,
    });
  }, []);


  // ── Provider switching (tab-targeted) ──────────────────────────

  const handleSwitchProviderFor = useCallback((tabId: string, profile: string) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.sendCommand(tabId, {
      cmd: 'switch_provider',
      id: `provider-${Date.now()}`,
      profile,
    });
  }, []);

  // ── Supervisor mode disable (tab-targeted) ──────────────────────

  const handleDisableSupervisorFor = useCallback((tabId: string) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.sendCommand(tabId, {
      cmd: 'slash',
      id: `unsupervise-${Date.now()}`,
      input: '/unsupervise',
    });
  }, []);

  // ── Supervisor rules update (tab-targeted) ────────────────────

  const handleUpdateSupervisorRulesFor = useCallback((tabId: string, rules: string) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.sendCommand(tabId, {
      cmd: 'slash',
      id: `supervise-${Date.now()}`,
      input: `/supervise ${rules}`,
    });
  }, []);

  // ── Public mode toggle (tab-targeted) ───────────────────────────

  const handleTogglePublicModeFor = useCallback((tabId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (tab?.kind === 'session') {
      // Toggle publicMode in local store
      tab.store.togglePublicMode();
      // Notify core to toggle publicMode on AgentState
      const bridge = bridgeRef.current;
      if (bridge) {
        bridge.sendCommand(tabId, {
          cmd: 'toggle_public_mode',
          id: `tpm-${Date.now()}`,
        });
      }
    }
  }, []);


  const handleSetPermissionModeFor = useCallback((tabId: string, mode: 'manual' | 'auto' | 'supervisor') => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (tab?.kind === 'session') {
      // Update local store
      tab.store.setPermissionMode(mode);
      // Notify core to change permissionMode on AgentState
      const bridge = bridgeRef.current;
      if (bridge) {
        bridge.sendCommand(tabId, {
          cmd: 'set_permission_mode',
          id: `spm-${Date.now()}`,
          mode,
        });
      }
    }
  }, []);

  // ── Global Escape key → abort active session ───────────────────
  // Works regardless of focus (textarea, scrolling area, etc.)

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const targetTabId = activeTabId;
      if (!targetTabId) return;
      const tab = tabsRef.current.find(t => t.id === targetTabId);
      if (!tab || tab.kind !== 'session') return;
      handleAbortFor(targetTabId);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeTabId, handleAbortFor]);

  // ── On connect: request session list to trigger restore/create ────

  useEffect(() => {
    if (bridgeState === 'connected') {
      const bridge = bridgeRef.current;
      if (bridge && !initializedRef.current) {
        bridge.listActiveSessions();
      }
    } else if (bridgeState === 'disconnected') {
      // Reset init flag on disconnect so reconnect triggers restore
      initializedRef.current = false;
      isRestoringRef.current = false;
    }
  }, [bridgeState]);

  // ── Desktop dock callbacks ────────────────────────────────────────

  const renderSessionContent = useCallback((tab: { kind: 'session'; id: string; name: string }) => {
    const fullTab = tabsRef.current.find(t => t.id === tab.id);
    if (!fullTab || fullTab.kind !== 'session') {
      return <div style={styles.empty}>Session not found</div>;
    }
    return (
      <SessionTabContent
        store={fullTab.store}
        onSendPrompt={(text, images, regenerate) => sendPromptTo(tab.id, text, images, regenerate)}
        onAbort={() => handleAbortFor(tab.id)}
        onCanvasBrowserAction={(action) => handleCanvasBrowserActionFor(tab.id, action)}
        onSessionBrowserAction={(action) => handleSessionBrowserActionFor(tab.id, action)}
        onRequestAction={(action) => handleRequestActionFor(tab.id, action)}
        onSwitchPersona={(name) => handleSwitchPersonaFor(tab.id, name)}
        onSwitchProvider={(profile) => handleSwitchProviderFor(tab.id, profile)}
        onDisableSupervisor={() => handleDisableSupervisorFor(tab.id)}
        onUpdateSupervisorRules={(rules) => handleUpdateSupervisorRulesFor(tab.id, rules)}
        onTogglePublicMode={() => handleTogglePublicModeFor(tab.id)}
        onSetPermissionMode={(mode) => handleSetPermissionModeFor(tab.id, mode)}
        onFileSearch={handleFileSearch}
      />
    );
  }, [sendPromptTo, handleAbortFor, handleCanvasBrowserActionFor, handleSessionBrowserActionFor, handleRequestActionFor, handleSwitchPersonaFor, handleSwitchProviderFor, handleDisableSupervisorFor, handleUpdateSupervisorRulesFor, handleTogglePublicModeFor, handleSetPermissionModeFor, handleFileSearch]);

  const handleDockFocusTab = useCallback((tabId: string) => {
    setFocusedTabId(tabId);
    setActiveTabId(tabId);
  }, []);

  // ── Screenshot session (desktop context menu) ─────────────────────

  const handleScreenshotSession = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab || tab.kind !== 'session') {
      throw new Error('Tab not found or not a session');
    }
    await captureSessionToClipboard(tab.store);
  }, []);

  // ── Render ───────────────────────────────────────────────────────

  const activeTab = tabs.find(t => t.id === activeTabId);

  // ── Dock tabs (pinned + active preview, VS Code-style) ─────────────
  // The top tab bar only shows pinned tabs plus (if the active tab is not
  // pinned) the active tab as a single italic preview.
  const dockTabs: Tab[] = useMemo(() => {
    const pinned = tabs.filter(t => pinnedIds.includes(t.id));
    const active = tabs.find(t => t.id === activeTabId);
    if (active && !pinnedIds.includes(active.id)) return [...pinned, active];
    return pinned;
  }, [tabs, activeTabId, pinnedIds]);

  const tabInfos: TabInfo[] = (() => {
    const sessions = tabs.filter(t => t.kind === 'session');
    // Sort by persisted order, falling back to reverse-chronological (newest first) for unindexed items
    const orderedSessions = [...sessions].sort((a, b) => {
      const ai = sessionOrder.indexOf(a.id);
      const bi = sessionOrder.indexOf(b.id);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1; // a is in sessionOrder, prioritize
      if (bi !== -1) return 1;  // b is in sessionOrder, prioritize
      // Neither is in sessionOrder: newest sessions (larger tab id suffix or index in array) first
      return sessions.indexOf(b) - sessions.indexOf(a);
    });
    return orderedSessions.map(t => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      pinned: pinnedIds.includes(t.id),
      personaName: t.kind === 'session' ? t.store.getSnapshot().currentPersona : undefined,
    }));
  })();

  // Build session state map for sidebar indicators
  const sessionStates: Record<string, { status?: 'idle' | 'streaming' | 'done' | 'error'; cronCreated?: number; cronTargeted?: number; hasPending?: boolean; hasNotification?: boolean; hasContent?: boolean }> = {};
  for (const tab of tabs) {
    if (tab.kind === 'session') {
      const snap = tab.store.getSnapshot();
      sessionStates[tab.id] = {
        status: snap.status,
        cronCreated: snap.cronCreated,
        cronTargeted: snap.cronTargeted,
        hasPending: !!(snap.pendingPermission || snap.pendingAskUser),
        hasNotification: snap.hasSessionNotification,
        hasContent: snap.turns.length > 0 || snap.currentUserPrompt.trim().length > 0,
      };
    }
  }

  // Track store updates for tag auto-generation
  const [storeUpdateCounter, setStoreUpdateCounter] = useState(0);
  
  // Subscribe to all session stores for tag auto-generation
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];
    
    for (const tab of tabs) {
      if (tab.kind === 'session') {
        const unsubscribe = tab.store.subscribe(() => {
          // Trigger re-render when any store changes
          setStoreUpdateCounter(c => c + 1);
        });
        unsubscribers.push(unsubscribe);
      }
    }
    
    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [tabs]);

  // Auto-generate session tags based on first user message
  // Only generate if tag doesn't exist and session has content
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.kind === 'session') {
        const snap = tab.store.getSnapshot();
        const sessionId = tab.id;
        
        // Check if session has any content
        const hasContent = snap.turns.length > 0 || snap.currentUserPrompt.trim().length > 0;
        
        // If no content and no tag, skip (will show "该对话还未开始")
        if (!hasContent && !sessionTags[sessionId]) {
          continue;
        }
        
        // If has content but no tag, auto-generate from first user message
        if (hasContent && !sessionTags[sessionId]) {
          const firstPrompt = snap.turns.length > 0 
            ? snap.turns[0].userPrompt 
            : snap.currentUserPrompt;
          
          if (firstPrompt.trim()) {
            // Generate tag: first 30 characters, remove newlines
            const autoTag = firstPrompt.trim().replace(/\n/g, ' ').slice(0, 30);
            
            setSessionTags(prev => ({
              ...prev,
              [sessionId]: autoTag + (firstPrompt.length > 30 ? '...' : ''),
            }));
          }
        }
      }
    }
  }, [tabs, sessionTags, storeUpdateCounter]);

  return (
    <div style={styles.container}>
      {isMobile ? (
        <>
          {/* ── Mobile: TabBar + single panel (unchanged) ── */}
          <TabBar
            tabs={tabInfos}
            activeId={activeTabId}
            sessionStates={sessionStates}
            sessionTags={sessionTags}
            onSaveTag={handleSaveTag}
            onSelect={setActiveTabId}
            onNewSession={openNewSessionDialog}
            onClose={closeTab}
            onRename={renameTab}
            onConfig={() => setShowConfig(true)}
            onDebug={() => setShowDebug(true)}
            onTodo={() => setShowTodo(true)}
            bridgeState={bridgeState}
          />

          <div style={styles.main}>
            {activeTab?.kind === 'session' ? (
              <SessionPanel
                key={activeTab.id}
                store={activeTab.store}
                onSendPrompt={sendPrompt}
                onAbort={handleAbort}
                onCanvasBrowserAction={handleCanvasBrowserAction}
                onSessionBrowserAction={handleSessionBrowserAction}
                onRequestAction={activeTabId ? (action) => handleRequestActionFor(activeTabId, action) : undefined}
                onSwitchPersona={activeTabId ? (name) => handleSwitchPersonaFor(activeTabId, name) : undefined}
                onSwitchProvider={activeTabId ? (profile) => handleSwitchProviderFor(activeTabId, profile) : undefined}
                onDisableSupervisor={activeTabId ? () => handleDisableSupervisorFor(activeTabId) : undefined}
                onUpdateSupervisorRules={activeTabId ? (rules) => handleUpdateSupervisorRulesFor(activeTabId, rules) : undefined}
                onTogglePublicMode={activeTabId ? () => handleTogglePublicModeFor(activeTabId) : undefined}
                onSetPermissionMode={activeTabId ? (mode) => handleSetPermissionModeFor(activeTabId, mode) : undefined}
                onFileSearch={handleFileSearch}
              />
            ) : (
              <div style={styles.empty}>
                {bridgeState === 'connected'
                  ? 'No active tabs. Click + to create a session.'
                  : bridgeState === 'connecting'
                  ? 'Connecting to Vesper Lite service...'
                  : 'Disconnected from Vesper Lite service.'}
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={styles.desktopRow}>
          {/* ── Desktop: SessionSidebar + Toolbar + DockLayout ── */}
          <div style={{
            ...styles.sidebarWrapper,
            width: sidebarVisible ? `${sidebarWidth}px` : '0px',
            minWidth: sidebarVisible ? `${sidebarWidth}px` : '0px',
            maxWidth: sidebarVisible ? `${sidebarWidth}px` : '0px',
            opacity: sidebarVisible ? 1 : 0,
            transition: sidebarResizing ? 'none' : styles.sidebarWrapper.transition,
          }}>
            <SessionSidebar
              tabs={tabInfos}
              activeId={activeTabId}
              onSelect={setActiveTabId}
              onPinTab={pinTab}
              onNewSession={openNewSessionDialog}
              onClose={closeTab}
              onRename={renameTab}
              onReorderSessions={handleReorderSessions}
              bridgeState={bridgeState}
              sessionStates={sessionStates}
              sessionTags={sessionTags}
              onSaveTag={handleSaveTag}
              onCloseSidebar={() => setSidebarVisible(false)}
            />
            {/* Resize handle */}
            {sidebarVisible && (
              <div
                className="sidebar-resize-handle"
                onMouseDown={startSidebarResize}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: -12,
                  width: 24,
                  height: '100%',
                  zIndex: 10,
                  userSelect: 'none',
                  cursor: resizeCursor,
                }}
              />
            )}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Toolbar
              onConfig={() => setShowConfig(true)}
              onDebug={() => setShowDebug(true)}
              onTodo={() => setShowTodo(true)}
              onToggleSidebar={() => setSidebarVisible(!sidebarVisible)}
              sidebarVisible={sidebarVisible}
              bridgeState={bridgeState}
              activeTabKind={activeTabId ? tabs.find(t => t.id === activeTabId)?.kind : undefined}
            />
            <div style={styles.dockMain}>
            {dockTabs.length > 0 ? (
              <DockLayoutWrapper
                tabs={dockTabs}
                activeTabId={activeTabId}
                previewTabId={activeTabId && !pinnedIds.includes(activeTabId) ? activeTabId : null}
                onCloseTab={closeDockTab}
                onFocusTab={handleDockFocusTab}
                onPinTab={pinTab}
                renderSessionContent={renderSessionContent}
                renderTerminalContent={() => <div />}
                onScreenshotSession={handleScreenshotSession}
                sessionStates={sessionStates}
                isRestoring={restoring}
              />
            ) : (
              <div style={styles.empty}>
                {bridgeState === 'connected'
                  ? tabs.length > 0
                    ? 'No pinned tabs. Click a session to preview, double-click to pin.'
                    : 'No active tabs. Click + to create a session.'
                  : bridgeState === 'connecting'
                  ? 'Connecting to Vesper Lite service...'
                  : 'Disconnected from Vesper Lite service.'}
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* ── Overlays (shared) ── */}
      {showSessionCreate && bridgeRef.current && (
        <SessionCreateDialog
          bridge={bridgeRef.current}
          onClose={() => setShowSessionCreate(false)}
          onCreate={doCreateSession}
          existingNames={tabs.filter(t => t.kind === 'session').map(t => t.name)}
        />
      )}

      {showConfig && bridgeRef.current && (
        <ConfigPanel
          onClose={() => setShowConfig(false)}
          bridge={bridgeRef.current}
          storeRef={activeTab?.kind === 'session' ? { current: activeTab.store } : { current: null }}
        />
      )}

      {showDebug && (
        <DebugPanel
          wireLog={wireLog}
          sessionIds={tabs.filter(t => t.kind === 'session').map(t => t.id)}
          activeSessionId={activeTabId}
          onSelectSession={setActiveTabId}
          onClose={() => setShowDebug(false)}
        />
      )}



      
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 0,
  },
  desktopRow: {
    flex: 1,
    display: 'flex',
    flexDirection: 'row',
    overflow: 'hidden',
    minHeight: 0,
  },
  sidebarWrapper: {
    position: 'relative',
    height: '100%',
    overflow: 'hidden',
    transition: 'width 0.3s ease, min-width 0.3s ease, max-width 0.3s ease, opacity 0.3s ease',
  },
  dockMain: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 0,
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666666',
    fontSize: 'inherit',
  },
};

