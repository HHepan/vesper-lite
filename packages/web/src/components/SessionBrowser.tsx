// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Session Browser Component
//
// Interactive panel for browsing/managing saved sessions.
// Triggered by /sessions command. Mirrors CanvasBrowser UX patterns.
// Keyboard: ↑↓ navigate, Enter load, d delete, Esc close.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useEffect, useCallback, useRef } from 'react';
import type { SessionBrowserState, SavedSessionSummary } from '../store.js';
import { theme } from '../theme.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionBrowserAction =
  | { type: 'close' }
  | { type: 'navigate'; delta: number }
  | { type: 'navigate_top' }
  | { type: 'navigate_bottom' }
  | { type: 'load'; sessionName: string }
  | { type: 'delete'; sessionName: string };

interface SessionBrowserProps {
  state: SessionBrowserState;
  onAction: (action: SessionBrowserAction) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEWPORT_SIZE = 15;
const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 100;

// ---------------------------------------------------------------------------
// useRepeatPress
// ---------------------------------------------------------------------------

function useRepeatPress(action: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;

  const stop = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    actionRef.current();
    stop();
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => actionRef.current(), REPEAT_INTERVAL);
    }, REPEAT_DELAY);
  }, [stop]);

  return { onPointerDown, onPointerUp: stop, onPointerLeave: stop };
}

// ---------------------------------------------------------------------------
// Session Row
// ---------------------------------------------------------------------------

interface SessionRowProps {
  session: SavedSessionSummary;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}

function SessionRow({ session, index, isSelected, onClick }: SessionRowProps) {
  const num = String(index + 1).padStart(2, '0');
  const date = new Date(session.updatedAt).toLocaleDateString();
  const shortId = session.id.slice(0, 8);

  const rowStyle: React.CSSProperties = {
    whiteSpace: 'pre',
    fontFamily: 'inherit',
    color: isSelected ? (theme.canvasBrowserSelected ?? theme.promptText) : undefined,
    fontWeight: isSelected ? 'bold' : undefined,
    backgroundColor: isSelected ? 'rgba(255,255,255,0.05)' : undefined,
    padding: '0.3em 1ch',
    cursor: 'pointer',
    touchAction: 'manipulation',
    minHeight: '2em',
    display: 'flex',
    alignItems: 'center',
  };

  return (
    <div style={rowStyle} onClick={onClick}>
      <span style={styles.marker}>{isSelected ? '>' : '\u00A0'}</span>
      [{num}] 📁 {session.name}  ({session.checkpointCount} cp, {date})  [{shortId}]
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const SessionBrowser = memo(function SessionBrowser({
  state,
  onAction,
}: SessionBrowserProps) {
  const { sessions, selectedIndex } = state;

  const navigateUp = useRepeatPress(() => onAction({ type: 'navigate', delta: -1 }));
  const navigateDown = useRepeatPress(() => onAction({ type: 'navigate', delta: 1 }));

  // Keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.stopPropagation();

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onAction({ type: 'close' });
          return;
        case 'ArrowUp':
          e.preventDefault();
          onAction({ type: 'navigate', delta: -1 });
          return;
        case 'ArrowDown':
          e.preventDefault();
          onAction({ type: 'navigate', delta: 1 });
          return;
        case 'Home':
          e.preventDefault();
          onAction({ type: 'navigate_top' });
          return;
        case 'End':
          e.preventDefault();
          onAction({ type: 'navigate_bottom' });
          return;
        case 'Enter':
          if (sessions.length > 0) {
            e.preventDefault();
            onAction({ type: 'load', sessionName: sessions[selectedIndex].name });
          }
          return;
        case 'd':
          if (sessions.length > 0) {
            e.preventDefault();
            onAction({ type: 'delete', sessionName: sessions[selectedIndex].name });
          }
          return;
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [sessions, selectedIndex, onAction]);

  // Viewport
  let viewStart = state.scrollOffset;
  if (selectedIndex < viewStart) viewStart = selectedIndex;
  if (selectedIndex >= viewStart + VIEWPORT_SIZE) viewStart = selectedIndex - VIEWPORT_SIZE + 1;
  const viewEnd = Math.min(sessions.length, viewStart + VIEWPORT_SIZE);
  const visible = sessions.slice(viewStart, viewEnd);

  return (
    <div style={styles.container}>
      <div style={{ ...styles.header, color: theme.canvasBrowserHeader }}>
        Session Browser ({sessions.length} saved sessions)
      </div>

      {sessions.length === 0 ? (
        <div style={{ padding: '0.5em 1ch', color: theme.dimText }}>
          No saved sessions.
        </div>
      ) : (
        <div style={styles.list}>
          {visible.map((s, viewIdx) => {
            const realIdx = viewStart + viewIdx;
            const isSelected = realIdx === selectedIndex;
            return (
              <SessionRow
                key={s.id}
                session={s}
                index={realIdx}
                isSelected={isSelected}
                onClick={() => {
                  if (isSelected) {
                    onAction({ type: 'load', sessionName: s.name });
                  } else {
                    onAction({ type: 'navigate', delta: realIdx - selectedIndex });
                  }
                }}
              />
            );
          })}
        </div>
      )}

      {/* Action bar */}
      <div style={styles.actionBar}>
        <div style={styles.actionGroup}>
          {sessions.length > 1 && (
            <>
              <button style={{ ...styles.actionBtn, ...styles.navBtn }} disabled={selectedIndex <= 0} {...navigateUp}>▲</button>
              <button style={{ ...styles.actionBtn, ...styles.navBtn }} disabled={selectedIndex >= sessions.length - 1} {...navigateDown}>▼</button>
            </>
          )}
        </div>
        <div style={styles.actionGroup}>
          {sessions.length > 0 && (
            <>
              <button
                style={{ ...styles.actionBtn, color: theme.toolSuccess }}
                onClick={() => onAction({ type: 'load', sessionName: sessions[selectedIndex].name })}
              >
                [Enter] Load
              </button>
              <button
                style={{ ...styles.actionBtn, color: theme.toolError }}
                onClick={() => onAction({ type: 'delete', sessionName: sessions[selectedIndex].name })}
              >
                [d] Delete
              </button>
            </>
          )}
          <button style={styles.actionBtn} onClick={() => onAction({ type: 'close' })}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Styles (reuses CanvasBrowser visual language)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: `1px solid ${theme.canvasBrowserBorder}`,
    borderRadius: '4px',
    margin: '0.5em 1ch',
    padding: '0.5em 0',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  header: {
    fontWeight: 'bold',
    padding: '0 1ch 0.5em 1ch',
    borderBottom: `1px solid ${theme.canvasBrowserBorder}`,
    marginBottom: '0.25em',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
  },
  actionBar: {
    padding: '0.5em 1ch 0 1ch',
    borderTop: `1px solid ${theme.canvasBrowserBorder}`,
    marginTop: '0.25em',
    display: 'flex',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '0.5em',
  },
  actionGroup: {
    display: 'flex',
    gap: '0.5em',
    flexWrap: 'wrap',
  },
  actionBtn: {
    background: 'transparent',
    border: '1px solid var(--text-muted)',
    borderRadius: '3px',
    padding: '0.4em 1.2ch',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    minHeight: '2.2em',
    touchAction: 'manipulation',
  },
  navBtn: {
    padding: '0.4em 1.6ch',
    fontWeight: 'bold',
  },
  marker: {
    display: 'inline-block',
    width: '2ch',
    textAlign: 'center',
    flexShrink: 0,
  },
};
