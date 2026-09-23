// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — TabBar (TUI style: monospace, minimal)
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { BridgeState } from '../bridge.js';
import { theme } from '../theme.js';
import { useTheme } from '../contexts/ThemeContext.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useModalAnimation } from '../hooks/useModalAnimation.js';

// Inject keyframes for mobile streaming spinner
const SPIN_KEYFRAMES_ID = 'lux-mobile-spin-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(SPIN_KEYFRAMES_ID)) {
  const style = document.createElement('style');
  style.id = SPIN_KEYFRAMES_ID;
  style.textContent = `@keyframes lux-mobile-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}

export interface TabInfo {
  id: string;
  name: string;
  kind: 'session' | 'terminal';
  /** True if this tab is pinned to the top tab bar (VS Code-style). */
  pinned?: boolean;
  /** Current persona name for session tabs (undefined = not yet received, null = none). */
  personaName?: string | null;
}

interface TabBarProps {
  tabs: TabInfo[];
  activeId: string | null;
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
  onSelect: (id: string) => void;
  onNewSession: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onConfig: () => void;
  onDebug: () => void;
  onTodo: () => void;
  bridgeState: BridgeState;
}

export function TabBar({ tabs, activeId, sessionStates, sessionTags, onSaveTag, onSelect, onNewSession, onClose, onRename, onConfig, onDebug, onTodo, bridgeState }: TabBarProps) {
  const { themeName, toggleTheme } = useTheme();
  const isMobile = useIsMobile();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [sessionListClosing, setSessionListClosing] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editTagValue, setEditTagValue] = useState('');
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [showPersonaName, setShowPersonaName] = useState(true);
  const [showSessionId, setShowSessionId] = useState(true);
  const [showSessionTag, setShowSessionTag] = useState(true);

  const openSessionList = useCallback(() => {
    setSessionListOpen(true);
    setSessionListClosing(false);
  }, []);

  const closeSessionList = useCallback(() => {
    setSessionListClosing(true);
    setTimeout(() => {
      setSessionListOpen(false);
      setSessionListClosing(false);
    }, 200);
  }, []);

  const sessionListRef = useRef<HTMLDivElement>(null);

  // Close session list on outside click
  useEffect(() => {
    if (!sessionListOpen) return;
    const handler = (e: MouseEvent) => {
      if (sessionListRef.current && !sessionListRef.current.contains(e.target as Node)) {
        closeSessionList();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sessionListOpen]);

  // Close display menu on outside click
  useEffect(() => {
    if (!showDisplayMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.mobile-display-menu-container')) {
        setShowDisplayMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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

  const currentTab = tabs.find(t => t.id === activeId);
  const currentLabel = currentTab ? currentTab.name : 'No session';

  if (isMobile) {
    return (
      <div style={styles.bar}>
        {/* Left: list button + current session name */}
        <div style={mobileStyles.currentRow}>
          <button
            style={mobileStyles.listBtn}
            onClick={() => sessionListOpen ? closeSessionList() : openSessionList()}
            title="切换会话"
          >
            📋
          </button>
          <span
            style={mobileStyles.currentName}
            onClick={() => sessionListOpen ? closeSessionList() : openSessionList()}
          >
            {currentLabel}
          </span>
        </div>

        {/* Right: actions */}
        <div style={styles.actions}>
          <div style={{ ...styles.dot, backgroundColor: dotColor }} />
          <button
            style={styles.hamburgerBtn}
            onClick={() => setMenuOpen(prev => !prev)}
            title="更多"
          >
            ☰
          </button>
          {menuOpen && (
            <>
              <div style={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
              <div style={styles.menu}>
                <button
                  style={styles.menuItem}
                  onClick={() => { setMenuOpen(false); onDebug(); }}
                >
                  <span style={styles.menuIcon}>D</span> 调试日志
                </button>
                <button
                  style={styles.menuItem}
                  onClick={() => { setMenuOpen(false); onConfig(); }}
                >
                  <span style={styles.menuIcon}>⚙</span> 设置
                </button>
                <button
                  style={styles.menuItem}
                  onClick={() => { setMenuOpen(false); onTodo(); }}
                >
                  <span style={styles.menuIcon}>📝</span> 待办
                </button>
                <button
                  style={styles.menuItem}
                  onClick={() => { setMenuOpen(false); toggleTheme(); }}
                >
                  <span style={styles.menuIcon}>{themeName === 'dark' ? '☀️' : '🌙'}</span> 切换主题
                </button>
              </div>
            </>
          )}
        </div>

        {/* Session list overlay */}
        {sessionListOpen && (
          <>
            <div
              style={{
                ...mobileStyles.overlayBackdrop,
                animation: sessionListClosing ? 'fade-out 0.2s ease-out forwards' : 'fade-in 0.2s ease-out',
              }}
              onClick={() => closeSessionList()}
            />
            <div
              ref={sessionListRef}
              style={{
                ...mobileStyles.overlayPanel,
                animation: sessionListClosing ? 'scale-out 0.2s ease-out forwards' : 'scale-in 0.2s ease-out',
              }}
            >
              <div style={mobileStyles.overlayHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5ch' }}>
                  <span>会话列表</span>
                  <div style={{ position: 'relative' }} className="mobile-display-menu-container">
                    <button
                      style={mobileStyles.displayMenuBtn}
                      onClick={(e) => { e.stopPropagation(); setShowDisplayMenu(!showDisplayMenu); }}
                      title="显示选项"
                    >
                      👁
                    </button>
                    {showDisplayMenu && (
                      <div style={mobileStyles.displayMenu}>
                        <label style={mobileStyles.displayMenuItem}>
                          <input
                            type="checkbox"
                            checked={showPersonaName}
                            onChange={() => setShowPersonaName(!showPersonaName)}
                          />
                          人格名称
                        </label>
                        <label style={mobileStyles.displayMenuItem}>
                          <input
                            type="checkbox"
                            checked={showSessionId}
                            onChange={() => setShowSessionId(!showSessionId)}
                          />
                          会话标识
                        </label>
                        <label style={mobileStyles.displayMenuItem}>
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
                <button
                  style={mobileStyles.overlayCloseBtn}
                  onClick={() => closeSessionList()}
                >
                  ✕
                </button>
              </div>
              <div style={mobileStyles.sessionList}>
                {(() => {
                  const sessions = tabs.filter(t => t.kind === 'session');
                  return sessions.map(t => {
                    const isActive = t.id === activeId;
                    const sState = sessionStates?.[t.id];
                    const isStreaming = sState?.status === 'streaming';
                    const hasPending = sState?.hasPending || sState?.hasNotification;
                    const hasContent = sState?.hasContent ?? false;
                    const tag = sessionTags?.[t.id] ?? '';
                    const isEditingTag = editingTagId === t.id;
                    const canEditTag = hasContent;
                    return (
                      <div
                        key={t.id}
                        style={{
                          ...mobileStyles.sessionItem,
                          ...(isActive ? mobileStyles.sessionItemActive : {}),
                        }}
                        onClick={() => { closeSessionList(); onSelect(t.id); }}
                      >
                        <div style={mobileStyles.sessionRow}>
                          <span style={mobileStyles.sessionIcon}>
                            {isStreaming ? (
                              <span className="mobile-streaming-dots" style={mobileStyles.streamingDot} />
                            ) : hasPending ? (
                              <span style={{ ...mobileStyles.statusDot, backgroundColor: 'var(--status-warning)' }} />
                            ) : (
                              <span style={{ ...mobileStyles.statusDot, backgroundColor: 'var(--status-success, #4CAF50)' }} />
                            )}
                          </span>
                          <span style={mobileStyles.sessionName}>
                            {t.name}
                            {showSessionId && (
                              <span style={mobileStyles.sessionIdTag}>#{t.id}</span>
                            )}
                            {t.personaName && showPersonaName && (
                              <span style={mobileStyles.sessionPersonaTag}>（{t.personaName}）</span>
                            )}
                          </span>
                          {isActive && <span style={mobileStyles.sessionCheck}>✓</span>}
                          <button
                            style={mobileStyles.sessionCloseBtn}
                            onClick={(e) => { e.stopPropagation(); closeSessionList(); onClose(t.id); }}
                            title="关闭"
                          >
                            ×
                          </button>
                        </div>
                        {/* Tag row */}
                        {showSessionTag && (
                          <div style={mobileStyles.sessionTagRow}>
                            {isEditingTag ? (
                              <input
                                style={mobileStyles.tagEditInput}
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
                              <span
                                style={mobileStyles.tagText}
                                title={tag || '双击编辑标签'}
                                onDoubleClick={(e) => {
                                  if (!canEditTag) return;
                                  e.stopPropagation();
                                  setEditingTagId(t.id);
                                  setEditTagValue(tag);
                                }}
                              >
                                {tag || (canEditTag ? '🏷 双击添加标签…' : '🏷 该对话还未开始')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
              <div style={mobileStyles.overlayActions}>
                <button
                  style={mobileStyles.overlayActionBtn}
                  disabled={bridgeState !== 'connected'}
                  onClick={() => { closeSessionList(); onNewSession(); }}
                >
                  + 新建会话
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={styles.bar}>
      <div style={styles.tabs}>
        {tabs.map((t) => (
          <div
            key={t.id}
            style={{
              ...styles.tab,
              ...(t.id === activeId ? styles.tabActive : {}),
            }}
            title={t.name}
            onClick={() => onSelect(t.id)}
            onDoubleClick={() => handleDoubleClick(t.id, t.name)}
          >
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
              <span style={styles.tabLabel}>
                {t.name}
                {t.kind === 'session' && t.personaName && (
                  <span style={styles.personaTag}>（{t.personaName}）</span>
                )}
              </span>
            )}
            <button
              style={styles.closeBtn}
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              title="Close session"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div style={styles.actions}>
        <div style={{
          ...styles.dot,
          backgroundColor: dotColor,
        }} />
        <button
          style={styles.hamburgerBtn}
          onClick={() => setMenuOpen(prev => !prev)}
          title="Menu"
        >
          ☰
        </button>
        {menuOpen && (
          <>
            <div style={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
            <div style={styles.menu}>
              <button
                style={styles.menuItem}
                disabled={bridgeState !== 'connected'}
                onClick={() => { setMenuOpen(false); onNewSession(); }}
              >
                <span style={styles.menuIcon}>+</span> New Session
              </button>
              <button
                style={styles.menuItem}
                onClick={() => { setMenuOpen(false); onDebug(); }}
              >
                <span style={styles.menuIcon}>D</span> Debug
              </button>
              <button
                style={styles.menuItem}
                onClick={() => { setMenuOpen(false); onConfig(); }}
              >
                <span style={styles.menuIcon}>⚙</span> Settings
              </button>
              <button
                style={styles.menuItem}
                onClick={() => { setMenuOpen(false); onTodo(); }}
              >
                <span style={styles.menuIcon}>📝</span> TODO
              </button>
              <button
                style={styles.menuItem}
                onClick={() => { setMenuOpen(false); toggleTheme(); }}
              >
                <span style={styles.menuIcon}>{themeName === 'dark' ? '☀️' : '🌙'}</span> {themeName === 'dark' ? 'Light' : 'Dark'} Theme
              </button>
              </div>
          </>
        )}
      </div>
    </div>
  );
}

const mobileStyles: Record<string, React.CSSProperties> = {
  currentRow: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    paddingLeft: '0.5ch',
    overflow: 'hidden',
  },
  listBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2.5em',
    height: '2em',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  currentName: {
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    flex: 1,
  },
  overlayBackdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 399,
  },
  overlayPanel: {
    position: 'fixed' as const,
    top: '10%',
    left: '5%',
    right: '5%',
    bottom: '10%',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    zIndex: 400,
    display: 'flex',
    flexDirection: 'column' as const,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  },
  overlayHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.8em 1ch',
    borderBottom: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    fontWeight: 'bold',
    fontSize: '1em',
  },
  overlayCloseBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2em',
    height: '2em',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: 0,
  },
  displayMenuBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2em',
    height: '2em',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: 0,
    borderRadius: '3px',
  },
  displayMenu: {
    position: 'absolute' as const,
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
    whiteSpace: 'nowrap' as const,
  },
  displayMenuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    padding: '0.3em 0',
    cursor: 'pointer',
  },
  sessionList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0.3em 0',
  },
  sessionItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    cursor: 'pointer',
    borderBottom: '1px solid var(--border-color)',
    transition: 'background 0.1s',
  },
  sessionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.8ch',
    padding: '0.7em 1ch 0.3em 1ch',
  },
  sessionItemActive: {
    background: 'var(--bg-secondary)',
    borderLeft: '3px solid var(--accent-blue)',
  },
  sessionIcon: {
    flexShrink: 0,
    width: '2ch',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-secondary)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  streamingDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    border: '2px solid var(--status-success, #4CAF50)',
    borderTopColor: 'transparent',
    animation: 'lux-mobile-spin 0.8s linear infinite',
    flexShrink: 0,
    display: 'inline-block',
  },
  sessionName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-primary)',
  },
  sessionIdTag: {
    color: 'var(--text-muted)',
    fontSize: '0.75em',
    marginLeft: '0.3ch',
    opacity: 0.7,
  },
  sessionPersonaTag: {
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    marginLeft: '0.2ch',
  },
  sessionCheck: {
    color: 'var(--status-success)',
    fontWeight: 'bold',
    marginRight: '0.5ch',
    flexShrink: 0,
  },
  sessionCloseBtn: {
    display: 'flex',
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
  },
  sessionTagRow: {
    padding: '0.1em 1ch 0.5em calc(2ch + 1.6ch)',
    fontSize: '0.8em',
    color: 'var(--text-muted)',
  },
  tagEditInput: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--accent-blue)',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    padding: '0.2em 0.3ch',
    outline: 'none',
  },
  tagText: {
    cursor: 'pointer',
    opacity: 0.8,
  },
  overlayActions: {
    display: 'flex',
    gap: '0.5ch',
    padding: '0.6em 1ch',
    borderTop: '1px solid var(--border-color)',
  },
  overlayActionBtn: {
    flex: 1,
    padding: '0.7em 1ch',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    textAlign: 'center' as const,
  },
};

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    height: '2em',
    minHeight: '2em',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  tabs: {
    flex: 1,
    display: 'flex',
    overflowX: 'auto',
    overflowY: 'hidden',
    gap: 0,
    scrollbarWidth: 'none',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    padding: '0 1ch',
    height: '2em',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    borderRight: '1px solid var(--border-color)',
  },
  tabActive: {
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
  },
  tabLabel: {
    maxWidth: '15ch',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  personaTag: {
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    marginLeft: '0.2ch',
  },
  termIcon: {
    color: theme.streamingCursor,
    fontSize: 'inherit',
  },
  closeBtn: {
    display: 'flex',
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
  },
  editInput: {
    width: '12ch',
    background: 'transparent',
    border: `1px solid ${theme.streamingCursor}`,
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    padding: '0 0.5ch',
    outline: 'none',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
    paddingRight: '0.5ch',
    flexShrink: 0,
    position: 'relative' as const,
  },
  hamburgerBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2.5em',
    height: '2em',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: 0,
  },
  menuBackdrop: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 299,
  },
  menu: {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    zIndex: 300,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '3px',
    minWidth: '18ch',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '1ch',
    padding: '0.8em 1.2ch',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  menuIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2ch',
    color: 'var(--text-secondary)',
  },
  dot: {
    width: '0.7em',
    height: '0.7em',
    borderRadius: '50%',
  },
};
