// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — SessionSidebar (desktop: left panel, QQ/WeChat style)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext.js';
import type { TabInfo } from './TabBar.js';
import type { BridgeState } from '../bridge.js';

// Unicode superscript and subscript digits for ⏰ⁿₘ indicator
const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const SUBSCRIPTS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

function superscriptNum(n: number): string {
  if (n <= 0) return '';
  if (n > 9) return '⁹⁺';
  return String(n).split('').map(d => SUPERSCRIPTS[parseInt(d)]).join('');
}

function subscriptNum(n: number): string {
  if (n <= 0) return '';
  if (n > 9) return '₉₊';
  return String(n).split('').map(d => SUBSCRIPTS[parseInt(d)]).join('');
}

interface SessionSidebarProps {
  tabs: TabInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Pin a tab to the top bar (double-click on a row, VS Code-style). */
  onPinTab?: (id: string) => void;
  onNewSession: () => void;
  onNewTerminal: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
  bridgeState: BridgeState;
  /** Per-session status info for sidebar indicators. */
  sessionStates?: Record<string, {
    status?: 'idle' | 'streaming' | 'done' | 'error';
    cronCreated?: number;
    cronTargeted?: number;
    hasPending?: boolean;
    hasNotification?: boolean;
    hasContent?: boolean;
  }>;
  /** Session tags — sessionId → tag content. */
  sessionTags?: Record<string, string>;
  /** Callback when a tag is saved. */
  onSaveTag?: (sessionId: string, tag: string) => void;
  /** Callback to close the sidebar. */
  onCloseSidebar?: () => void;
  /** Callback when sessions are reordered via drag and drop. */
  onReorderSessions?: (fromIndex: number, toIndex: number) => void;
  /** Callback when terminals are reordered via drag and drop. */
  onReorderTerminals?: (fromIndex: number, toIndex: number) => void;
}

export const SessionSidebar = memo(function SessionSidebar({
  tabs,
  activeId,
  onSelect,
  onPinTab,
  onNewSession,
  onNewTerminal,
  onClose,
  onRename,
  onReorderSessions,
  onReorderTerminals,
  bridgeState,
  sessionStates,
  sessionTags,
  onSaveTag,
  onCloseSidebar,
}: SessionSidebarProps) {
  const { theme } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editTagValue, setEditTagValue] = useState('');
  const [dotFrame, setDotFrame] = useState(0);
  const dotChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  
  // Display options state
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [showPersonaName, setShowPersonaName] = useState(true);
  const [showSessionId, setShowSessionId] = useState(true);
  const [showSessionTag, setShowSessionTag] = useState(true);

  // Drag-and-drop state
  const [dragState, setDragState] = useState<{
    kind: 'session';
    dragIndex: number;
    overIndex: number | null;
    /** 'above' or 'below' the overIndex item */
    position: 'above' | 'below';
  } | null>(null);

  // Animate streaming dots
  useEffect(() => {
    const hasStreaming = tabs.some(t => t.kind === 'session' && sessionStates?.[t.id]?.status === 'streaming');
    if (!hasStreaming) return;
    const timer = setInterval(() => setDotFrame(f => (f + 1) % dotChars.length), 80);
    return () => clearInterval(timer);
  }, [tabs, sessionStates]);

  // Close display menu when clicking outside
  useEffect(() => {
    if (!showDisplayMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.display-menu-container')) {
        setShowDisplayMenu(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showDisplayMenu]);

  const handleDoubleClick = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const dotColor = bridgeState === 'connected' ? theme.toolSuccess
    : bridgeState === 'connecting' ? theme.thinkingDot
    : theme.toolError;

  // Sessions (all tabs are sessions in Vesper Lite)
  const sessions = tabs.filter(t => t.kind === 'session');

  const renderEntry = (t: TabInfo, index: number, kind: 'session') => {
    const isActive = t.id === activeId;
    const sState = sessionStates?.[t.id];
    const isStreaming = sState?.status === 'streaming';
    const cronCreated = sState?.cronCreated ?? 0;
    const cronTargeted = sState?.cronTargeted ?? 0;
    const hasCron = cronCreated > 0 || cronTargeted > 0;
    const hasPending = sState?.hasPending || sState?.hasNotification;
    const hasContent = sState?.hasContent ?? false;
    const tag = sessionTags?.[t.id] ?? '';
    const isEditingTag = editingTagId === t.id;
    const canEditTag = hasContent;

    // Drag state
    const isDragging = dragState?.kind === kind && dragState?.dragIndex === index;
    const showDropIndicatorAbove = dragState?.kind === kind && dragState?.overIndex === index && dragState?.position === 'above';
    const showDropIndicatorBelow = dragState?.kind === kind && dragState?.overIndex === index && dragState?.position === 'below';
    const onReorder = onReorderSessions;

    return (
      <div
        key={t.id}
        className="sidebar-entry"
        draggable={!!onReorder}
        style={{
          ...styles.entry,
          ...(isActive ? styles.entryActive : {}),
          ...(isDragging ? { opacity: 0.4 } : {}),
          position: 'relative',
        }}
        onClick={() => onSelect(t.id)}
        onDoubleClick={() => onPinTab?.(t.id)}
        onDragStart={(e) => {
          if (!onReorder) return;
          e.dataTransfer.effectAllowed = 'move';
          setDragState({ kind, dragIndex: index, overIndex: null, position: 'below' });
        }}
        onDragOver={(e) => {
          if (!onReorder || !dragState || dragState.kind !== kind) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const newPos: 'above' | 'below' = e.clientY < midY ? 'above' : 'below';
          if (dragState.overIndex !== index || dragState.position !== newPos) {
            setDragState(prev => prev ? { ...prev, overIndex: index, position: newPos } : null);
          }
        }}
        onDragLeave={(e) => {
          // Only clear if we actually leave this element (not entering a child)
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          if (dragState?.overIndex === index) {
            setDragState(prev => prev ? { ...prev, overIndex: null } : null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!onReorder || !dragState || dragState.kind !== kind) return;
          const fromIdx = dragState.dragIndex;
          let toIdx = index;
          if (dragState.position === 'below') toIdx = index + 1;
          // Adjust target index if dragging from above to below
          if (fromIdx < toIdx) toIdx -= 1;
          if (fromIdx !== toIdx) {
            onReorder(fromIdx, toIdx);
          }
          setDragState(null);
        }}
        onDragEnd={() => {
          setDragState(null);
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            const el = e.currentTarget as HTMLDivElement;
            el.style.background = 'var(--bg-hover)';
            el.style.color = 'var(--text-primary)';
          }
          const btn = e.currentTarget.querySelector('.sidebar-close-btn') as HTMLButtonElement;
          if (btn) btn.style.display = 'flex';
          const rbtn = e.currentTarget.querySelector('.sidebar-action-btn') as HTMLButtonElement;
          if (rbtn) rbtn.style.display = 'flex';
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            const el = e.currentTarget as HTMLDivElement;
            el.style.background = '';
            el.style.color = '';
          }
          const btn = e.currentTarget.querySelector('.sidebar-close-btn') as HTMLButtonElement;
          if (btn) btn.style.display = 'none';
          const rbtn = e.currentTarget.querySelector('.sidebar-action-btn') as HTMLButtonElement;
          if (rbtn) rbtn.style.display = 'none';
        }}
      >
        {/* Drop indicator — blue line above */}
        {showDropIndicatorAbove && (
          <div style={styles.dropIndicator} />
        )}
        {/* ── Row 1: Status + Name + Actions ── */}
        <div style={styles.entryRow}>
          {/* Status indicators (left of name) */}
          {t.kind === 'session' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2ch', flexShrink: 0 }}>
              {/* Pending indicator (yellow dot) */}
              {hasPending && (
                <span style={{ width: '0.5em', height: '0.5em', borderRadius: '50%', background: 'var(--status-warning)', flexShrink: 0 }} title="Has pending message, permission request, or notification" />
              )}
              {/* Streaming indicator (animated dots) */}
              {isStreaming && (
                <span className="streaming-dots" style={{ fontSize: '0.7em', color: theme.streamingCursor, flexShrink: 0 }} title="Processing...">{dotChars[dotFrame]}</span>
              )}
              {/* Session icon when idle */}
              {!isStreaming && !hasPending && (
                <span style={styles.sessionIcon}>●</span>
              )}
            </span>
          )}
          {t.kind === 'terminal' && (
            <span style={styles.termIcon}>&gt;_</span>
          )}
          {editingId === t.id ? (
            <input
              style={styles.editInput}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitRename();
                if (e.key === 'Escape') setEditingId(null);
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span style={styles.entryLabel}>
                {t.name}
                {t.pinned && (
                  <span style={{ marginLeft: '0.3ch', fontSize: '0.85em' }} title="已固定在顶部标签栏">📌</span>
                )}
                {t.kind === 'session' && t.personaName && showPersonaName && (
                  <span style={styles.personaTag}>（{t.personaName}）</span>
                )}
                {t.kind === 'session' && showSessionId && (
                  <span style={styles.sessionIdTag}>#{t.id}</span>
                )}
                {hasCron && (
                  <span style={{ fontSize: '0.8em', marginLeft: '0.3ch' }} title={`${cronCreated} created, ${cronTargeted} targeted`}>
                    ⏰{cronCreated > 0 ? superscriptNum(cronCreated) : ''}{cronTargeted > 0 ? subscriptNum(cronTargeted) : ''}
                  </span>
                )}
              </span>
              <button
                className="sidebar-action-btn"
                style={styles.renameBtn}
                onClick={(e) => { e.stopPropagation(); handleDoubleClick(t.id, t.name); }}
                title="Rename"
              >
                ✏
              </button>
            </>
          )}
          <button
            className="sidebar-close-btn"
            style={styles.closeBtn}
            onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
            title="Close session"
          >
            ×
          </button>
        </div>

        {/* ── Row 2: Tag (session only) ── */}
        {t.kind === 'session' && showSessionTag && (
          !hasContent ? (
            // Empty session: show placeholder, not editable
            <div
              className="sidebar-tag-row sidebar-tag-row-empty"
              style={{
                ...styles.tagRow,
                ...styles.tagRowEmpty,
                cursor: 'default',
              }}
            >
              <span style={styles.tagIcon}>🏷</span>
              <span style={styles.tagText}>
                该对话还未开始
              </span>
            </div>
          ) : isEditingTag ? (
            // Editing mode
            <input
              style={styles.tagEditInput}
              value={editTagValue}
              onChange={(e) => setEditTagValue(e.target.value)}
              onBlur={() => {
                if (onSaveTag) onSaveTag(t.id, editTagValue);
                setEditingTagId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  if (onSaveTag) onSaveTag(t.id, editTagValue);
                  setEditingTagId(null);
                }
                if (e.key === 'Escape') setEditingTagId(null);
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              placeholder="输入标签…"
            />
          ) : (
            // Display mode (editable)
            <div
              className={`sidebar-tag-row${tag ? '' : ' sidebar-tag-row-empty'}`}
              style={{
                ...styles.tagRow,
                ...(tag ? {} : styles.tagRowEmpty),
              }}
              title={tag || '双击编辑标签'}
              onDoubleClick={(e) => {
                if (!canEditTag) return;
                e.stopPropagation();
                setEditingTagId(t.id);
                setEditTagValue(tag);
              }}
            >
              <span style={styles.tagIcon}>🏷</span>
              <span style={styles.tagText}>
                {tag || '双击添加标签…'}
              </span>
            </div>
          )
        )}
        {/* Drop indicator — blue line below */}
        {showDropIndicatorBelow && (
          <div style={styles.dropIndicator} />
        )}
      </div>
    );
  };

  return (
    <div style={styles.sidebar}>
      {/* ── Header: Title + New buttons ── */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3ch' }}>
          <span style={styles.title}>Vesper</span>
          <div style={{ position: 'relative' }} className="display-menu-container">
            <button
              style={{ ...styles.headerBtn, fontSize: '0.85em' }}
              onClick={(e) => { e.stopPropagation(); setShowDisplayMenu(!showDisplayMenu); }}
              title="显示选项"
            >
              👁
            </button>
            {showDisplayMenu && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 100,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '0.5em',
                fontSize: '0.85em',
                color: 'var(--text-primary)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                whiteSpace: 'nowrap',
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5ch', padding: '0.3em 0', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={showPersonaName} 
                    onChange={() => setShowPersonaName(!showPersonaName)} 
                  />
                  人格名称
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5ch', padding: '0.3em 0', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={showSessionId} 
                    onChange={() => setShowSessionId(!showSessionId)} 
                  />
                  会话标识
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5ch', padding: '0.3em 0', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={showSessionTag} 
                    onChange={() => setShowSessionTag(!showSessionTag)} 
                  />
                  会话标签
                </label>
              </div>
            )}
          </div>
        </div>
        <div style={styles.headerActions}>
          <button style={styles.headerBtn} onClick={onNewSession} disabled={bridgeState !== 'connected'} title="New session">+</button>
        </div>
      </div>

      {/* ── Sessions list ── */}
      <div style={styles.list}>
        {sessions.length > 0 && (
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>Sessions</span>
            <span style={styles.sectionCount}>{sessions.length}</span>
          </div>
        )}
        {sessions.map((t, i) => renderEntry(t, i, 'session'))}
      </div>

      {/* ── Footer: Connection status + Close button ── */}
      <div style={styles.footer}>
        <div style={{
          ...styles.dot,
          backgroundColor: dotColor,
        }} />
        <span style={styles.footerLabel}>
          {bridgeState === 'connected' ? 'Connected' : bridgeState === 'connecting' ? 'Connecting...' : 'Disconnected'}
        </span>
        {onCloseSidebar && (
          <button
            style={styles.closeSidebarBtn}
            onClick={onCloseSidebar}
            title="隐藏侧边栏"
          >
            ◀
          </button>
        )}
      </div>
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-secondary)',
    borderRight: '1px solid var(--border-color)',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    overflow: 'hidden',
    transition: 'width 0.3s ease, min-width 0.3s ease, max-width 0.3s ease, opacity 0.3s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.8em 1.2ch',
    borderBottom: '1px solid var(--border-color)',
    minHeight: '2.5em',
  },
  title: {
    color: 'var(--text-primary)',
    fontWeight: 600,
    fontSize: '0.95em',
    letterSpacing: '-0.01em',
  },
  headerActions: {
    display: 'flex',
    gap: '0.4ch',
  },
  headerBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '24px',
    padding: '0 8px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: '12px',
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: 'pointer',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-sm)',
    transition: 'all 0.15s ease',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '0.5em 0.6ch',
    scrollbarWidth: 'thin',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.6em 0.8ch 0.3em',
    borderBottom: 'none',
  },
  sectionLabel: {
    color: 'var(--text-muted)',
    fontSize: '0.75em',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  sectionCount: {
    color: 'var(--text-muted)',
    fontSize: '0.75em',
    padding: '1px 6px',
    borderRadius: '10px',
    background: 'var(--bg-tertiary)',
  },
  entry: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '0.55em 0.8ch',
    margin: '2px 0',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    position: 'relative' as const,
    borderRadius: 'var(--radius-sm)',
    transition: 'background 0.15s ease, color 0.15s ease',
  },
  entryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6ch',
    width: '100%',
  },
  entryActive: {
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    boxShadow: 'var(--shadow-sm)',
    fontWeight: 500,
  },
  entryLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontSize: '0.88em',
    fontWeight: 500,
  },
  personaTag: {
    color: 'var(--text-muted)',
    fontWeight: 'normal',
    fontSize: '0.85em',
    marginLeft: '0.3ch',
  },
  sessionIdTag: {
    color: 'var(--text-muted)',
    fontWeight: 'normal',
    fontSize: '0.75em',
    marginLeft: '0.2ch',
    opacity: 0.7,
  },
  sessionIcon: {
    color: 'var(--tool-success)',
    fontSize: '0.6em',
    flexShrink: 0,
  },
  termIcon: {
    color: 'var(--streaming-cursor)',
    fontSize: '0.8em',
    flexShrink: 0,
  },
  renameBtn: {
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2ch',
    height: '1.5em',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '0.8em',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    borderRadius: 'var(--radius-sm)',
  },
  closeBtn: {
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2ch',
    height: '1.5em',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    borderRadius: 'var(--radius-sm)',
  },
  editInput: {
    flex: 1,
    background: 'transparent',
    border: '1px solid var(--streaming-cursor)',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: '0.9em',
    padding: '0 0.5ch',
    outline: 'none',
    minWidth: 0,
    borderRadius: '2px',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    padding: '0.5em 1ch',
    borderTop: '1px solid var(--border-color)',
  },
  dot: {
    width: '0.6em',
    height: '0.6em',
    borderRadius: '50%',
    flexShrink: 0,
  },
  footerLabel: {
    color: 'var(--text-muted)',
    fontSize: '0.8em',
    flex: 1,
  },
  closeSidebarBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2ch',
    height: '1.5em',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '0.9em',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    borderRadius: 'var(--radius-sm)',
    marginLeft: 'auto',
  },
  tagRow: {
    fontSize: '0.8em',
    padding: '0.15em 0.5em 0.15em 1.5em',
    cursor: 'pointer',
    opacity: 0.7,
    transition: 'opacity 0.15s',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3ch',
    marginTop: '0.1em',
  },
  tagRowEmpty: {
    opacity: 0.4,
    fontStyle: 'italic' as const,
  },
  tagIcon: {
    fontSize: '0.9em',
    flexShrink: 0,
  },
  tagText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  tagEditInput: {
    width: '100%',
    fontSize: '0.8em',
    padding: '0.15em 0.5em 0.15em 1.5em',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    borderRadius: '2px',
    outline: 'none',
    marginTop: '0.1em',
  },
  dropIndicator: {
    position: 'absolute',
    left: '2px',
    right: '2px',
    height: '2px',
    background: 'var(--streaming-cursor)',
    borderRadius: '1px',
    zIndex: 5,
    pointerEvents: 'none' as const,
  },
};