import React, { memo, useState, useMemo, useEffect, useRef } from 'react';
import { theme } from '../theme.js';
import { formatElapsed } from '../lib/format-utils.js';
import type { ToolCallEntry } from '../store.js';
import { ToolCard } from './ToolCard.js';

interface ToolGroupProps {
  entries: ToolCallEntry[];
  onToggleTool?: (id: string) => void;
}

export const ToolGroup = memo(function ToolGroup({
  entries,
  onToggleTool,
}: ToolGroupProps) {
  // Group stats
  const totalCount = entries.length;
  const completedCount = entries.filter((e) => !!e.result).length;
  const pendingCount = totalCount - completedCount;
  const errorCount = entries.filter((e) => e.result?.isError).length;
  const isRunning = pendingCount > 0;

  // Track if user manually toggled expansion
  const [userToggled, setUserToggled] = useState(false);

  // Track whether this group has collapsed at least once (auto or manual).
  // Once collapsed, subsequent tool additions stay compact (single-line header)
  // instead of popping open and closed repeatedly.
  const hasCollapsedRef = useRef(!isRunning);

  const [expanded, setExpanded] = useState(isRunning);

  // Lazy render child cards:
  // When collapsed and idle, do NOT render heavy ToolCard DOM nodes (markdown, diff, etc.).
  // Only mount children when expanded or while closing/opening animation is playing.
  const [renderChildren, setRenderChildren] = useState(isRunning);

  // When transition from running -> completed
  useEffect(() => {
    if (userToggled) return;
    if (isRunning) {
      // Only auto-expand if this group has NEVER collapsed before (first execution batch)
      if (!hasCollapsedRef.current) {
        setRenderChildren(true);
        setExpanded(true);
      }
    } else if (!hasCollapsedRef.current) {
      // First batch completed: 400ms pause, then trigger smooth collapse
      const timer = setTimeout(() => {
        setExpanded(false);
        hasCollapsedRef.current = true;
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isRunning, userToggled]);

  // Handle unmounting children after collapse animation finishes
  useEffect(() => {
    if (expanded) {
      setRenderChildren(true);
    } else {
      // Wait for CSS Grid collapse animation (350ms) to complete before unmounting children
      const timer = setTimeout(() => {
        setRenderChildren(false);
      }, 360);
      return () => clearTimeout(timer);
    }
  }, [expanded]);

  // Handle manual click
  const handleToggle = () => {
    setUserToggled(true);
    if (!expanded) {
      setRenderChildren(true);
      requestAnimationFrame(() => {
        setExpanded(true);
      });
    } else {
      setExpanded(false);
      hasCollapsedRef.current = true;
    }
  };

  // Currently running tool(s)
  const runningEntries = useMemo(() => {
    return entries.filter((e) => !e.result);
  }, [entries]);

  const runningToolsText = useMemo(() => {
    if (runningEntries.length === 0) return '';
    const names = Array.from(new Set(runningEntries.map((e) => e.call.name)));
    return names.join(', ');
  }, [runningEntries]);

  const currentRunningEntry = isRunning
    ? entries.find((e) => !e.result) ?? entries[entries.length - 1]
    : null;

  const toolSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      const name = e.call.name;
      counts[name] = (counts[name] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
      .join(', ');
  }, [entries]);

  const totalElapsedMs = useMemo(() => {
    let sum = 0;
    for (const e of entries) {
      if (e.elapsedMs) sum += e.elapsedMs;
    }
    return sum;
  }, [entries]);

  const elapsedText = totalElapsedMs > 0 ? formatElapsed(totalElapsedMs) : '';

  let statusColor = theme.toolSuccess;
  let statusIcon = '✓';
  if (isRunning) {
    statusColor = theme.toolPending;
    statusIcon = '⚡';
  } else if (errorCount > 0) {
    statusColor = theme.toolError;
    statusIcon = '⚠';
  }

  return (
    <div style={styles.container}>
      {/* Header bar */}
      <div
        style={{
          ...styles.header,
          borderColor: isRunning ? 'var(--border-color)' : 'transparent',
        }}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
      >
        <div style={styles.headerLeft}>
          <span
            className={isRunning ? 'tui-dot-pulse' : ''}
            style={{
              ...styles.badge,
              backgroundColor: isRunning
                ? 'rgba(209, 154, 102, 0.15)'
                : errorCount > 0
                ? 'rgba(224, 108, 117, 0.15)'
                : 'rgba(94, 183, 107, 0.15)',
              color: statusColor,
            }}
          >
            {statusIcon}
          </span>

          <span style={styles.title}>
            {isRunning ? (
              <>
                <span style={{ color: theme.toolPending, fontWeight: 'bold' }}>
                  执行工具中 ({completedCount}/{totalCount})
                </span>
                {runningToolsText && (
                  <span style={styles.runningToolTag}>
                    {runningToolsText}
                  </span>
                )}
              </>
            ) : (
              <>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  执行了 {totalCount} 个工具操作
                </span>
                {errorCount > 0 && (
                  <span style={{ color: theme.toolError, marginLeft: '0.5em', fontSize: '0.9em' }}>
                    ({errorCount} 个失败)
                  </span>
                )}
              </>
            )}
          </span>

          {!isRunning && (
            <span style={styles.summary} title={toolSummary}>
              ({toolSummary})
            </span>
          )}
        </div>

        <div style={styles.headerRight}>
          {elapsedText && <span style={styles.elapsed}>{elapsedText}</span>}
          <span style={styles.chevron}>
            {expanded ? '收起 ▴' : '展开 ▸'}
          </span>
        </div>
      </div>

      {/* Grid-based smooth height transition */}
      <div
        style={{
          ...styles.collapsibleGrid,
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
        }}
      >
        <div style={styles.collapsibleInner}>
          {renderChildren && (
            <div style={styles.expandedList}>
              {entries.map((entry) => (
                <div key={entry.id} style={styles.childCardWrapper}>
                  <ToolCard entry={entry as ToolCallEntry} onToggle={onToggleTool} />
                </div>
              ))}
              {/* Bottom bar with collapse button and status indicator */}
              <div style={styles.bottomBar}>
                <button
                  style={styles.bottomCollapseBtn}
                  onClick={handleToggle}
                  title="收起工具组"
                >
                  收起 ▴
                </button>
                <div style={styles.bottomStatus}>
                  {isRunning ? (
                    <>
                      <span
                        className="tui-dot-pulse"
                        style={{
                          ...styles.badge,
                          backgroundColor: 'rgba(209, 154, 102, 0.15)',
                          color: statusColor,
                        }}
                      >
                        {statusIcon}
                      </span>
                      <span style={{ color: theme.toolPending, fontWeight: 'bold' }}>
                        执行工具中 ({completedCount}/{totalCount})
                      </span>
                      {runningToolsText && (
                        <span style={styles.runningToolTag}>
                          {runningToolsText}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span
                        style={{
                          ...styles.badge,
                          backgroundColor: errorCount > 0
                            ? 'rgba(224, 108, 117, 0.15)'
                            : 'rgba(94, 183, 107, 0.15)',
                          color: statusColor,
                        }}
                      >
                        {statusIcon}
                      </span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                        执行了 {totalCount} 个工具操作
                      </span>
                      {errorCount > 0 && (
                        <span style={{ color: theme.toolError, marginLeft: '0.4em', fontSize: '0.9em' }}>
                          ({errorCount} 个失败)
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: '0.75em',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    overflow: 'hidden',
    transition: 'all 0.2s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.6em 0.8ch',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background-color 0.15s ease',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6ch',
    minWidth: 0,
    flex: 1,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '1ch',
    flexShrink: 0,
    marginLeft: '1ch',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    fontSize: '0.75em',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  title: {
    fontSize: '0.92em',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
  },
  runningToolTag: {
    color: theme.toolName,
    backgroundColor: 'rgba(184, 192, 232, 0.12)',
    padding: '0.1em 0.55em',
    borderRadius: 'var(--radius-sm, 3px)',
    fontSize: '0.88em',
    fontWeight: 600,
    letterSpacing: '0.02em',
    fontFamily: 'var(--font-mono, monospace)',
  },
  summary: {
    fontSize: '0.85em',
    color: 'var(--text-secondary, #5C6370)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '45vw',
  },
  elapsed: {
    fontSize: '0.85em',
    color: theme.dimText,
  },
  chevron: {
    fontSize: '0.85em',
    color: theme.dimText,
    cursor: 'pointer',
  },
  // Modern CSS Grid Transition: 0fr <-> 1fr
  collapsibleGrid: {
    display: 'grid',
    transition: 'grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
  },
  collapsibleInner: {
    overflow: 'hidden',
  },
  expandedList: {
    padding: '0.5em 0.8ch 0.2em 0.8ch',
    borderTop: '1px dashed var(--border-color)',
    background: 'rgba(0, 0, 0, 0.08)',
  },
  childCardWrapper: {
    marginBottom: '0.5em',
  },
  bottomBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '1.2ch',
    paddingTop: '0.4em',
    paddingBottom: '0.2em',
  },
  bottomStatus: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5ch',
    fontSize: '0.88em',
  },
  bottomCollapseBtn: {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm, 4px)',
    color: theme.dimText,
    cursor: 'pointer',
    fontSize: '0.82em',
    padding: '0.2em 0.8em',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3em',
    transition: 'all 0.15s ease',
    userSelect: 'none',
  },
};
