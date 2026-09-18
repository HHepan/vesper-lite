// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — DockLayoutWrapper (rc-dock integration)
//
// Controlled DockLayout that manages the split-pane layout tree.
// Maps Vesper Tab[] to rc-dock's LayoutData, handling add/remove/drag/split.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useRef, useEffect, useCallback, useMemo, useState, type ReactElement } from 'react';
import DockLayout, {
  type LayoutData,
  type TabData,
  type PanelData,
  type BoxData,
  type TabGroup,
} from 'rc-dock';

// Type assertion to fix React 19 compatibility issue with rc-dock
const DockLayoutComponent = DockLayout as any;

// Import rc-dock base styles + our dark theme
import 'rc-dock/dist/rc-dock.css';
import './dockTheme.css';



// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionTab {
  kind: 'session';
  id: string;
  name: string;
}

export interface TerminalTab {
  kind: 'terminal';
  id: string;
  name: string;
  ready?: boolean;  // True after server confirms term_created
}

export type Tab = SessionTab | TerminalTab;

/** Per-session status info for dock tab indicators (mirrors the sidebar). */
export interface DockSessionState {
  status?: 'idle' | 'streaming' | 'done' | 'error';
  hasPending?: boolean;
  hasNotification?: boolean;
}

const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Status indicator inside a session dock tab — mirrors SessionSidebar:
 * amber dot for pending asks, animated spinner while streaming, green ●
 * when idle/done, red ● on error. Runs its own animation interval so the
 * title element only needs rebuilding when the state itself changes.
 */
function DockTabStatus({ state }: { state: DockSessionState | undefined }) {
  const isStreaming = state?.status === 'streaming';
  const hasPending = !!(state?.hasPending || state?.hasNotification);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!isStreaming) return undefined;
    const t = setInterval(() => setFrame(f => (f + 1) % SPINNER_CHARS.length), 80);
    return () => clearInterval(t);
  }, [isStreaming]);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2ch', flexShrink: 0 }}>
      {hasPending && (
        <span
          style={{ width: '0.5em', height: '0.5em', borderRadius: '50%', background: 'var(--status-warning)', flexShrink: 0 }}
          title="Has pending message, permission request, or notification"
        />
      )}
      {isStreaming && (
        <span style={{ fontSize: '0.7em', color: 'var(--streaming-cursor)', flexShrink: 0 }} title="Processing...">
          {SPINNER_CHARS[frame]}
        </span>
      )}
      {!isStreaming && !hasPending && (
        <span
          style={{ fontSize: '0.6em', flexShrink: 0, color: state?.status === 'error' ? 'var(--status-error)' : 'var(--tool-success)' }}
          title={state?.status === 'error' ? 'Error' : 'Idle'}
        >
          ●
        </span>
      )}
    </span>
  );
}

export interface DockLayoutWrapperProps {
  tabs: Tab[];
  activeTabId: string | null;
  onCloseTab: (tabId: string) => void;
  onFocusTab: (tabId: string) => void;
  /** Id of the tab currently shown as an italic preview (not pinned yet). */
  previewTabId?: string | null;
  /** Pin a preview tab (double-click on it, VS Code-style). */
  onPinTab?: (tabId: string) => void;
  renderSessionContent: (tab: SessionTab) => ReactElement;
  renderTerminalContent: (tab: TerminalTab) => ReactElement;
  /** Called when user requests a screenshot of a session tab. */
  onScreenshotSession?: (tabId: string) => Promise<void>;
  /** Per-session status info for tab indicators (same shape as sidebar). */
  sessionStates?: Record<string, DockSessionState>;
  /**
   * True while sessions are still being restored after a reload/reconnect.
   * While restoring, the stored layout skeleton is NOT applied — doing so
   * would bake a mid-restore activeTabId (or the skeleton's stale one) into
   * rc-dock's internal focus, overriding the "latest pinned tab" decision
   * made later by the App. The skeleton restore is deferred until the
   * restore phase ends (this prop flips to false).
   */
  isRestoring?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an rc-dock TabData from a Vesper Tab */
function createTabData(
  tab: Tab,
  renderSession: DockLayoutWrapperProps['renderSessionContent'],
  renderTerminal: DockLayoutWrapperProps['renderTerminalContent'],
  onTabContextMenu?: (e: React.MouseEvent, tabId: string, tabKind: Tab['kind']) => void,
  previewTabId?: string | null,
  onPinTab?: (tabId: string) => void,
  sessionStates?: Record<string, DockSessionState>,
): TabData {
  const icon = tab.kind === 'terminal' ? '>_ ' : '';
  const isPreview = tab.id === previewTabId;
  return {
    id: tab.id,
    title: (
      <span
        data-tab-id={tab.id}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5ch',
          whiteSpace: 'nowrap',
          fontStyle: isPreview ? 'italic' : undefined,
          color: isPreview ? 'var(--text-muted)' : undefined,
        }}
        onContextMenu={onTabContextMenu ? (e) => onTabContextMenu(e, tab.id, tab.kind) : undefined}
        onDoubleClick={onPinTab && isPreview ? (e) => { e.stopPropagation(); onPinTab(tab.id); } : undefined}
        title={tab.name}
      >
        {icon && <span style={{ color: 'var(--accent-blue)' }}>{icon}</span>}
        {tab.kind === 'session' && <DockTabStatus state={sessionStates?.[tab.id]} />}
        <span style={{ maxWidth: '15ch', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.name}</span>
      </span>
    ),
    // Cast needed: rc-dock uses React 18 types, we use React 19
    content: (tab.kind === 'session'
      ? renderSession(tab as SessionTab)
      : renderTerminal(tab as TerminalTab)) as any,
    closable: true,
    group: 'lux',
  };
}

/**
 * Stable signature of everything that affects a dock tab's *title*: its id,
 * name, kind, whether it is the italic preview tab, and its status indicator.
 *
 * Why this exists: `rebuildTitles` replaces every `TabData` object, and rc-dock
 * treats a new `props.layout` object as "reload the whole layout"
 * (`getDerivedStateFromProps`). That reload rebuilds the internal tree with
 * fresh `TabData` identities — and rc-dock removes a dragged tab from its source
 * panel by *object identity* (`removeFromLayout` -> `panel.tabs.indexOf(tab)`).
 * If a reload lands mid-drag, the tab is never removed from the old panel and
 * ends up duplicated (the "zombie" tab). So the rebuild effect is gated on this
 * signature and only runs when a title actually needs to change.
 */
export function computeDockTitleSignature(
  tabs: Tab[],
  previewTabId: string | null | undefined,
  sessionStates: Record<string, DockSessionState> | undefined,
): string {
  return JSON.stringify({
    tabs: tabs.map(t => [t.id, t.name, t.kind]),
    preview: previewTabId ?? null,
    states: sessionStates ?? {},
  });
}

/** Collect all tab IDs from a layout tree */
export function collectTabIds(layoutData: LayoutData): Set<string> {
  const ids = new Set<string>();
  const traverse = (children: (BoxData | PanelData)[]) => {
    for (const child of children) {
      if ('tabs' in child) {
        for (const tab of child.tabs || []) {
          if (tab.id) ids.add(tab.id as string);
        }
      } else if ('children' in child && child.children) {
        traverse(child.children);
      }
    }
  };
  if (layoutData.dockbox?.children) {
    traverse(layoutData.dockbox.children);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Layout persistence (localStorage)
// ---------------------------------------------------------------------------

const LAYOUT_STORAGE_KEY = 'vesper-dock-layout';

/** Serializable layout skeleton — no React elements */
export interface LayoutSkeleton {
  dockbox: SkeletonBox;
}
export interface SkeletonBox {
  mode?: string;
  size?: number;
  children: (SkeletonBox | SkeletonPanel)[];
}
export interface SkeletonPanel {
  id?: string;
  size?: number;
  tabs: string[]; // tab IDs only
  activeId?: string;
  group?: string;
}

function isPanel(node: SkeletonBox | SkeletonPanel): node is SkeletonPanel {
  return 'tabs' in node;
}

/** Extract a JSON-safe skeleton from rc-dock LayoutData */
export function serializeLayout(layoutData: LayoutData): LayoutSkeleton | null {
  try {
    const serializeChildren = (children: (BoxData | PanelData)[]): (SkeletonBox | SkeletonPanel)[] => {
      const out: (SkeletonBox | SkeletonPanel)[] = [];
      for (const child of children) {
        if ('tabs' in child) {
          out.push({
            id: child.id as string | undefined,
            size: child.size,
            tabs: (child.tabs || []).map(t => t.id as string).filter(Boolean),
            activeId: child.activeId as string | undefined,
            group: child.group as string | undefined,
          });
        } else if ('children' in child && child.children) {
          out.push({
            mode: child.mode,
            size: child.size,
            children: serializeChildren(child.children),
          });
        }
      }
      return out;
    };
    if (!layoutData.dockbox?.children) return null;
    return {
      dockbox: {
        mode: layoutData.dockbox.mode,
        children: serializeChildren(layoutData.dockbox.children),
      },
    };
  } catch {
    return null;
  }
}

/** Rebuild a full LayoutData from a skeleton + current tabs */
export function deserializeLayout(
  skeleton: LayoutSkeleton,
  tabs: Tab[],
  renderSession: DockLayoutWrapperProps['renderSessionContent'],
  renderTerminal: DockLayoutWrapperProps['renderTerminalContent'],
  onTabContextMenu?: (e: React.MouseEvent, tabId: string, tabKind: Tab['kind']) => void,
  previewTabId?: string | null,
  onPinTab?: (tabId: string) => void,
  sessionStates?: Record<string, DockSessionState>,
): LayoutData | null {
  try {
    const tabMap = new Map(tabs.map(t => [t.id, t]));
    const makeTabData = (t: Tab) => createTabData(t, renderSession, renderTerminal, onTabContextMenu, previewTabId, onPinTab, sessionStates);

    const rebuildChildren = (nodes: (SkeletonBox | SkeletonPanel)[]): (BoxData | PanelData)[] => {
      const out: (BoxData | PanelData)[] = [];
      for (const node of nodes) {
        if (isPanel(node)) {
          const resolvedTabs = node.tabs
            .filter(id => tabMap.has(id))
            .map(id => makeTabData(tabMap.get(id)!));
          if (resolvedTabs.length === 0) continue; // prune empty panels
          out.push({
            id: node.id,
            size: node.size,
            tabs: resolvedTabs,
            activeId: node.activeId,
            group: node.group ?? 'lux',
          } as PanelData);
        } else {
          const children = rebuildChildren(node.children);
          if (children.length === 0) continue; // prune empty boxes
          out.push({
            mode: node.mode as any,
            size: node.size,
            children,
          } as BoxData);
        }
      }
      return out;
    };

    const children = rebuildChildren(skeleton.dockbox.children);
    if (children.length === 0) return null;

    // Find tabs not in the skeleton (newly added) and append to first panel
    const skeletonTabIds = new Set<string>();
    const collectIds = (nodes: (SkeletonBox | SkeletonPanel)[]) => {
      for (const n of nodes) {
        if (isPanel(n)) n.tabs.forEach(id => skeletonTabIds.add(id));
        else collectIds(n.children);
      }
    };
    collectIds(skeleton.dockbox.children);

    const orphanTabs = tabs.filter(t => !skeletonTabIds.has(t.id));
    if (orphanTabs.length > 0) {
      const orphanTabDatas = orphanTabs.map(makeTabData);
      const addToFirst = (ch: (BoxData | PanelData)[]): boolean => {
        for (let i = 0; i < ch.length; i++) {
          const c = ch[i];
          if ('tabs' in c) {
            ch[i] = { ...c, tabs: [...c.tabs, ...orphanTabDatas] };
            return true;
          } else if ('children' in c && c.children) {
            if (addToFirst(c.children)) return true;
          }
        }
        return false;
      };
      addToFirst(children);
    }

    return {
      dockbox: {
        mode: skeleton.dockbox.mode as any ?? 'horizontal',
        children,
      },
    };
  } catch {
    return null;
  }
}

function saveLayoutToStorage(layoutData: LayoutData): void {
  try {
    const skeleton = serializeLayout(layoutData);
    if (skeleton) {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(skeleton));
    }
  } catch { /* ignore */ }
}

function loadLayoutFromStorage(): LayoutSkeleton | null {
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return null;
}

/**
 * Build (or reconcile) a LayoutData from the current Tab[].
 * - If existingLayout is provided, preserves the user's split/panel structure
 *   while adding/removing tabs to match the current tab list.
 * - Otherwise creates a fresh single-panel layout.
 */
export function buildLayoutFromTabs(
  tabs: Tab[],
  renderSession: DockLayoutWrapperProps['renderSessionContent'],
  renderTerminal: DockLayoutWrapperProps['renderTerminalContent'],
  existingLayout?: LayoutData,
  activeTabId?: string | null,
  onTabContextMenu?: (e: React.MouseEvent, tabId: string, tabKind: Tab['kind']) => void,
  previewTabId?: string | null,
  onPinTab?: (tabId: string) => void,
  sessionStates?: Record<string, DockSessionState>,
): LayoutData {
  const tabIds = new Set(tabs.map(t => t.id));
  const makeTabData = (t: Tab) => createTabData(t, renderSession, renderTerminal, onTabContextMenu, previewTabId, onPinTab, sessionStates);

  // --- Reconcile existing layout ---
  if (existingLayout?.dockbox?.children && existingLayout.dockbox.children.length > 0) {
    // Filter tabs in a panel: keep only those still in the tab list, refresh content
    const filterPanel = (panel: PanelData): PanelData | null => {
      const kept = (panel.tabs || [])
        .filter(td => tabIds.has(td.id as string))
        .map(td => {
          const tab = tabs.find(t => t.id === td.id);
          return tab ? makeTabData(tab) : td;
        });
      if (kept.length === 0) return null;
      return { ...panel, tabs: kept };
    };

    // Recursively process box children
    const processChildren = (children: (BoxData | PanelData)[]): (BoxData | PanelData)[] => {
      const result: (BoxData | PanelData)[] = [];
      for (const child of children) {
        if ('tabs' in child) {
          const filtered = filterPanel(child);
          if (filtered) result.push(filtered);
        } else if ('children' in child) {
          const processed = processChildren(child.children || []);
          if (processed.length > 0) {
            result.push({ ...child, children: processed });
          }
        }
      }
      return result;
    };

    // Find which tabs are already in the layout
    const existingTabIds = collectTabIds(existingLayout);
    const newTabs = tabs.filter(t => !existingTabIds.has(t.id));

    let newChildren = processChildren(existingLayout.dockbox.children);

    // Add new tabs to the first panel found, and activate the target tab
    if (newTabs.length > 0) {
      const newTabDatas = newTabs.map(makeTabData);
      // Determine which tab should be active — prefer the explicitly requested one
      const activateId = activeTabId && newTabs.some(t => t.id === activeTabId) ? activeTabId : undefined;

      if (newChildren.length > 0) {
        const addToFirstPanel = (children: (BoxData | PanelData)[]): boolean => {
          for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if ('tabs' in child) {
              children[i] = { ...child, tabs: [...child.tabs, ...newTabDatas], ...(activateId ? { activeId: activateId } : {}) };
              return true;
            } else if ('children' in child && child.children) {
              if (addToFirstPanel(child.children)) return true;
            }
          }
          return false;
        };
        addToFirstPanel(newChildren);
      } else {
        newChildren = [{
          id: 'main-panel',
          tabs: newTabDatas,
          ...(activateId ? { activeId: activateId } : {}),
          group: 'lux',
        } as PanelData];
      }
    }

    // Fallback: all panels removed but we still have tabs
    if (newChildren.length === 0 && tabs.length > 0) {
      return {
        dockbox: {
          mode: 'horizontal',
          children: [{
            id: 'main-panel',
            tabs: tabs.map(makeTabData),
            group: 'lux',
          } as PanelData],
        },
      };
    }

    return {
      ...existingLayout,
      dockbox: {
        ...existingLayout.dockbox,
        children: newChildren,
      },
    };
  }

  // --- Fresh layout ---
  if (tabs.length === 0) {
    return {
      dockbox: {
        mode: 'horizontal',
        children: [{
          id: 'main-panel',
          tabs: [],
          panelLock: {},
          group: 'lux',
        } as PanelData],
      },
    };
  }

  return {
    dockbox: {
      mode: 'horizontal',
      children: [{
        id: 'main-panel',
        tabs: tabs.map(makeTabData),
        group: 'lux',
      } as PanelData],
    },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Context Menu state
// ---------------------------------------------------------------------------

interface ContextMenuState {
  x: number;
  y: number;
  tabId: string;
  tabKind: Tab['kind'];
}

export function DockLayoutWrapper({
  tabs,
  activeTabId,
  previewTabId,
  onPinTab,
  onCloseTab,
  onFocusTab,
  renderSessionContent,
  renderTerminalContent,
  onScreenshotSession,
  sessionStates,
  isRestoring = false,
}: DockLayoutWrapperProps) {
  const dockRef = useRef<DockLayout>(null);

  // ── Context menu for tab right-click ──────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [screenshotStatus, setScreenshotStatus] = useState<'idle' | 'capturing' | 'success' | 'error'>('idle');

  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string, tabKind: Tab['kind']) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, tabId, tabKind });
    setScreenshotStatus('idle');
  }, []);

  const closeContextMenu = useCallback(() => {
    setCtxMenu(null);
  }, []);

  const handleScreenshot = useCallback(async () => {
    if (!ctxMenu || !onScreenshotSession) return;
    setScreenshotStatus('capturing');

    try {
      await onScreenshotSession(ctxMenu.tabId);
      setScreenshotStatus('success');
      setTimeout(() => {
        setCtxMenu(null);
        setScreenshotStatus('idle');
      }, 800);
    } catch (err) {
      console.error('Screenshot failed:', err);
      setScreenshotStatus('error');
      setTimeout(() => setScreenshotStatus('idle'), 2000);
    }
  }, [ctxMenu]);

  // Controlled layout state — restore from localStorage if available
  const [layout, setLayout] = useState<LayoutData>(() => {
    const skeleton = loadLayoutFromStorage();
    if (skeleton && tabs.length > 0) {
      const restored = deserializeLayout(skeleton, tabs, renderSessionContent, renderTerminalContent, handleTabContextMenu, undefined, undefined, sessionStates);
      if (restored) return restored;
    }
    return buildLayoutFromTabs(tabs, renderSessionContent, renderTerminalContent, undefined, undefined, handleTabContextMenu, undefined, undefined, sessionStates);
  });

  // Tab group config — shared by all tabs
  const groups: Record<string, TabGroup> = useMemo(() => ({
    lux: {
      floatable: false,
      maximizable: false,
      tabLocked: false,
    },
  }), []);

  // Track previous tab IDs for change detection
  const prevTabIdsRef = useRef<Set<string>>(new Set(tabs.map(t => t.id)));
  const prevTabsRef = useRef<Tab[]>(tabs);  // Track previous tabs for ready state detection
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const previewTabIdRef = useRef(previewTabId);
  previewTabIdRef.current = previewTabId;
  const onPinTabRef = useRef(onPinTab);
  onPinTabRef.current = onPinTab;
  const renderSessionRef = useRef(renderSessionContent);
  renderSessionRef.current = renderSessionContent;
  const renderTerminalRef = useRef(renderTerminalContent);
  renderTerminalRef.current = renderTerminalContent;
  const sessionStatesRef = useRef(sessionStates);
  sessionStatesRef.current = sessionStates;

  // Track whether we've consumed the stored layout skeleton
  const restoredFromStorageRef = useRef(false);
  const pendingSkeleton = useRef<LayoutSkeleton | null | undefined>(undefined);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRestoringRef = useRef(isRestoring);

  // On mount, load the skeleton once for later use
  if (pendingSkeleton.current === undefined) {
    pendingSkeleton.current = loadLayoutFromStorage();
  }

  // Sync tabs → layout when tabs are added or removed externally.
  // During restore, we debounce 200ms so all async session_state arrivals
  // settle before we attempt skeleton-based layout rebuild.
  useEffect(() => {
    const currentIds = new Set(tabs.map(t => t.id));
    const prevIds = prevTabIdsRef.current;

    const hasAdded = tabs.some(t => !prevIds.has(t.id));
    const hasRemoved = Array.from(prevIds).some(id => !currentIds.has(id));
    
    // Detect terminal ready state changes (need to re-render terminal content)
    const prevTabs = prevTabsRef.current;
    const hasReadyChange = tabs.some(t => 
      t.kind === 'terminal' && 
      prevTabs.find(pt => pt.id === t.id && pt.kind === 'terminal' && pt.ready !== t.ready)
    );
    
    // Detect the restore phase ending — the skeleton restore must run at that
    // moment (even with no tab diff), with the *final* activeTabId in hand.
    const wasRestoring = prevRestoringRef.current;
    prevRestoringRef.current = isRestoring;
    const restoreJustEnded = wasRestoring && !isRestoring;
    
    // Update refs for next comparison
    prevTabIdsRef.current = currentIds;
    prevTabsRef.current = tabs;

    if (!hasAdded && !hasRemoved && !hasReadyChange && !restoreJustEnded) return;

    // While restoring: keep the UI usable with a basic reconcile, but do NOT
    // apply the stored skeleton — it would bake a mid-restore (or stale)
    // activeTabId into rc-dock's internal focus, overriding the App's final
    // "latest pinned tab" decision. Defer until the restore phase ends.
    if (isRestoring) {
      setLayout(prev => buildLayoutFromTabs(tabs, renderSessionContent, renderTerminalContent, prev, activeTabId, handleTabContextMenu, previewTabId, onPinTab, sessionStates));
      return;
    }

    // If we still have a pending skeleton, debounce to wait for all tabs
    if (!restoredFromStorageRef.current && pendingSkeleton.current && tabs.length > 0) {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      // Immediately do a basic reconcile so the UI isn't empty
      setLayout(prev => buildLayoutFromTabs(tabs, renderSessionContent, renderTerminalContent, prev, activeTabId, handleTabContextMenu, previewTabId, onPinTab));
      // Schedule the skeleton-based restore (uses ref for latest tabs)
      restoreTimerRef.current = setTimeout(() => {
        restoreTimerRef.current = null;
        restoredFromStorageRef.current = true;
        const skel = pendingSkeleton.current;
        pendingSkeleton.current = null;
        if (skel) {
          const latestTabs = tabsRef.current;
          setLayout(_prev => {
            let result = deserializeLayout(skel, latestTabs, renderSessionRef.current, renderTerminalRef.current, handleTabContextMenu, previewTabIdRef.current, onPinTabRef.current);
            if (!result) return _prev;
            // Re-apply activeTabId after skeleton restore so focus isn't lost
            const aid = activeTabIdRef.current;
            if (aid) {
              const activate = (children: (BoxData | PanelData)[]): (BoxData | PanelData)[] =>
                children.map(child => {
                  if ('tabs' in child) {
                    if ((child.tabs || []).some(t => t.id === aid)) return { ...child, activeId: aid };
                    return child;
                  } else if ('children' in child && child.children) {
                    return { ...child, children: activate(child.children) };
                  }
                  return child;
                });
              if (result.dockbox?.children) {
                result = { ...result, dockbox: { ...result.dockbox, children: activate(result.dockbox.children) } };
              }
            }
            saveLayoutToStorage(result);
            // rc-dock 初始化时用的是 skeleton 的 activeId（可能已过时），受控
            // activeId 更新不保证驱动内部焦点——通过 API 强制激活最终 tab。
            const dock = dockRef.current;
            if (dock) {
              setTimeout(() => {
                const aid = activeTabIdRef.current;
                if (aid) dock.updateTab(aid, null, true);
              }, 0);
            }
            return result;
          });
        }
      }, 300);
      return;
    }

    restoredFromStorageRef.current = true;
    setLayout(prev => {
      const next = buildLayoutFromTabs(tabs, renderSessionContent, renderTerminalContent, prev, activeTabId, handleTabContextMenu, previewTabIdRef.current, onPinTabRef.current, sessionStatesRef.current);
      saveLayoutToStorage(next);
      return next;
    });
  }, [tabs, activeTabId, renderSessionContent, renderTerminalContent, isRestoring]);

  // Activate the requested tab in the layout when activeTabId changes
  // (handles the case where no tabs are added/removed but focus should shift)
  const prevActiveRef = useRef(activeTabId);
  useEffect(() => {
    if (activeTabId && activeTabId !== prevActiveRef.current) {
      prevActiveRef.current = activeTabId;
      setLayout(prev => {
        // Walk layout tree and set activeId on the panel containing the target tab
        const activate = (children: (BoxData | PanelData)[]): (BoxData | PanelData)[] => {
          return children.map(child => {
            if ('tabs' in child) {
              const hasTab = (child.tabs || []).some(t => t.id === activeTabId);
              if (hasTab && child.activeId !== activeTabId) {
                return { ...child, activeId: activeTabId };
              }
              return child;
            } else if ('children' in child && child.children) {
              return { ...child, children: activate(child.children) };
            }
            return child;
          });
        };
        if (!prev.dockbox?.children) return prev;
        const newChildren = activate(prev.dockbox.children);
        if (newChildren === prev.dockbox.children) return prev;
        return { ...prev, dockbox: { ...prev.dockbox, children: newChildren } };
      });
      // rc-dock 受控 layout 的 activeId 更新并不总是驱动其内部焦点（尤其刷新后
      // 骨架恢复的场景），通过其 API 强制激活，确保程序化切换真正生效。
      const dock = dockRef.current;
      if (dock) {
        setTimeout(() => { dock.updateTab(activeTabId, null, true); }, 0);
      }
    } else {
      prevActiveRef.current = activeTabId;
    }
  }, [activeTabId]);

  // Rebuild tab titles — italic preview styling is baked into the title
  // element at layout-build time, so it must be refreshed whenever the
  // preview tab changes.
  const rebuildTitles = useCallback((prev: LayoutData, latestTabs: Tab[], pid: string | null | undefined) => {
    const updateTitles = (children: (BoxData | PanelData)[]): (BoxData | PanelData)[] => {
      return children.map(child => {
        if ('tabs' in child) {
          return {
            ...child,
            tabs: (child.tabs || []).map(td => {
              const tab = latestTabs.find(t => t.id === td.id);
              if (!tab) return td;
              return createTabData(tab, renderSessionRef.current, renderTerminalRef.current, handleTabContextMenu, pid, onPinTabRef.current, sessionStatesRef.current);
            }),
          };
        } else if ('children' in child && child.children) {
          return { ...child, children: updateTitles(child.children) };
        }
        return child;
      });
    };
    if (!prev.dockbox?.children) return prev;
    return { ...prev, dockbox: { ...prev.dockbox, children: updateTitles(prev.dockbox.children) } };
  }, []);

  // Signature of everything that affects a dock tab's title (name, preview
  // styling, status dot). Rebuilding titles replaces every TabData object,
  // which makes rc-dock reload the layout — and, crucially, breaks the object
  // identity rc-dock relies on to remove a tab from its *source* panel while
  // splitting. When that happens mid-drag the tab is never removed from the old
  // panel, so it ends up duplicated ("zombie" tab). So only rebuild when the
  // signature actually changes, and never while a drag is in progress.
  const titleSig = useMemo(
    () => computeDockTitleSignature(tabs, previewTabId, sessionStates),
    [tabs, previewTabId, sessionStates]
  );
  const lastTitleSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastTitleSigRef.current === titleSig) return;
    if (typeof document !== 'undefined' && document.body.classList.contains('dock-dragging')) return;
    lastTitleSigRef.current = titleSig;
    setLayout(prev => rebuildTitles(prev, tabsRef.current, previewTabIdRef.current));
  }, [titleSig, rebuildTitles]);

  // rc-dock renders the title element inside its draggable tab wrapper. Set the
  // tooltip on the wrapper as well, so hovering the tab padding (rather than
  // only the text) still reveals the complete session name.
  useEffect(() => {
    const applyTabTooltips = () => {
      const labelsById = new Map(
        Array.from(document.querySelectorAll<HTMLElement>('[data-tab-id]'))
          .map(label => [label.dataset.tabId, label] as const),
      );
      for (const tab of tabsRef.current) {
        const label = labelsById.get(tab.id);
        if (!label) continue;
        label.setAttribute('title', tab.name);
        const tabElement = label.closest<HTMLElement>('.dock-tab, [role="tab"]');
        tabElement?.setAttribute('title', tab.name);
      }
    };

    applyTabTooltips();
    const timer = setTimeout(applyTabTooltips, 0);
    return () => clearTimeout(timer);
  }, [tabs, previewTabId, layout]);

  // Fallback: refresh preview styling once after mount, covering async
  // session-restore timing where the preview tab id may not be set yet.
  // Skipped entirely while dragging (same identity reason as the effect above).
  useEffect(() => {
    const t = setTimeout(() => {
      if (document.body.classList.contains('dock-dragging')) return;
      setLayout(prev => rebuildTitles(prev, tabsRef.current, previewTabIdRef.current));
    }, 600);
    return () => clearTimeout(t);
  }, [rebuildTitles]);

  // Handle layout changes from user interaction (drag, close, split)
  const handleLayoutChange = useCallback(
    (newLayout: LayoutData, currentTabId?: string) => {
      // Detect closed tabs
      const oldIds = collectTabIds(layout);
      const newIds = collectTabIds(newLayout);
      const closedIds = [...oldIds].filter(id => !newIds.has(id));

      for (const id of closedIds) {
        onCloseTab(id);
      }

      setLayout(newLayout);
      saveLayoutToStorage(newLayout);

      // Track focus (VS Code semantics):
      //  - If the closed tab was the active one, activate its right neighbor
      //    (or left neighbor if it was rightmost) from the pre-close order.
      //  - Otherwise accept rc-dock's currentTabId, if it still exists.
      // rc-dock's own choice is NOT used for the active-close case — it tends
      // to pick the last tab rather than the adjacent one.
      const activeId = activeTabIdRef.current;
      if (activeId && closedIds.includes(activeId)) {
        const order = [...oldIds]; // pre-close tab order
        const idx = order.indexOf(activeId);
        const right = order.slice(idx + 1).find(id => newIds.has(id));
        const left = order.slice(0, idx).reverse().find(id => newIds.has(id));
        const next = right ?? left;
        if (next) onFocusTab(next);
      } else if (currentTabId && newIds.has(currentTabId)) {
        // Only accept a tab that actually exists in the layout rc-dock just
        // produced — under fast closes currentTabId can point at a tab that
        // was itself just closed, which would resurrect a ghost tab.
        onFocusTab(currentTabId);
      }
    },
    [layout, onCloseTab, onFocusTab]
  );

  // Restore tab content when rc-dock needs to re-render a cached tab
  const loadTab = useCallback(
    (tabData: TabData): TabData => {
      if (!tabData.content) {
        const tab = tabs.find(t => t.id === tabData.id);
        if (tab) {
          return createTabData(tab, renderSessionContent, renderTerminalContent, handleTabContextMenu, previewTabId, onPinTab, sessionStates);
        }
      }
      return tabData;
    },
    [tabs, renderSessionContent, renderTerminalContent, handleTabContextMenu, previewTabId, onPinTab, sessionStates]
  );

  return (
    <>
      <DockLayoutComponent
        ref={dockRef}
        layout={layout}
        groups={groups}
        onLayoutChange={handleLayoutChange}
        loadTab={loadTab}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
        }}
      />

      {/* ── Tab right-click context menu ── */}
      {ctxMenu && (
        <>
          <div style={ctxMenuStyles.backdrop} onClick={closeContextMenu} />
          <div style={{ ...ctxMenuStyles.menu, left: ctxMenu.x, top: ctxMenu.y }}>
            {ctxMenu.tabKind === 'session' && onScreenshotSession && (
              <button
                className="lux-ctx-menu-item"
                style={ctxMenuStyles.item}
                onClick={handleScreenshot}
                disabled={screenshotStatus === 'capturing'}
              >
                <span style={ctxMenuStyles.icon}>
                  {screenshotStatus === 'success' ? '✓' : screenshotStatus === 'error' ? '✗' : '📷'}
                </span>
                {screenshotStatus === 'capturing' ? 'Capturing...'
                  : screenshotStatus === 'success' ? 'Copied!'
                  : screenshotStatus === 'error' ? 'Failed'
                  : 'Copy as PNG'}
              </button>
            )}
            <button
              className="lux-ctx-menu-item"
              style={ctxMenuStyles.item}
              onClick={() => { onCloseTab(ctxMenu.tabId); closeContextMenu(); }}
            >
              <span style={ctxMenuStyles.icon}>×</span>
              Close tab
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Context menu inline styles
// ---------------------------------------------------------------------------

const ctxMenuStyles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 9998,
  },
  menu: {
    position: 'fixed',
    zIndex: 9999,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--text-muted)',
    borderRadius: '3px',
    minWidth: '16ch',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '1ch',
    padding: '0.6em 1.2ch',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2ch',
    color: 'var(--text-secondary)',
  },
};
