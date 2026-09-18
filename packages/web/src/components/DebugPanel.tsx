// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — DebugPanel (full-screen wire protocol inspector)
//
// Port of Android DebugActivity: shows raw NDJSON send/recv/stderr log.
// Opened via "D" button in TabBar, displayed as full-screen overlay.
//
// Colors match Android version:
//   >>> send  = blue  (var(--ansi-blue))
//   <<< recv  = green (var(--ansi-green))
//   [E] stderr = yellow (var(--ansi-yellow))
//   [sys] system = gray (var(--text-muted))
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useRef, useEffect, useCallback } from 'react';
import type { WireLogEntry } from '../bridge.js';
import { useModalAnimation } from '../hooks/useModalAnimation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DebugPanelProps {
  wireLog: WireLogEntry[];
  sessionIds: string[];
  activeSessionId: string | null;
  onSelectSession?: (sessionId: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Colors (matching Android DebugActivity)
// ---------------------------------------------------------------------------

const COLOR_SEND   = 'var(--ansi-blue)';  // Blue — outgoing
const COLOR_RECV   = 'var(--ansi-green)';  // Green — incoming
const COLOR_STDERR = 'var(--ansi-yellow)';  // Yellow — stderr
const COLOR_SYSTEM = 'var(--text-muted)';  // Gray — system

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

// ---------------------------------------------------------------------------
// Truncate long JSON for display
// ---------------------------------------------------------------------------

function truncateText(text: string, maxLen: number = 2000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `... [truncated ${text.length}B]`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DebugPanel = memo(function DebugPanel({
  wireLog,
  sessionIds,
  activeSessionId,
  onSelectSession,
  onClose,
}: DebugPanelProps) {
  const { isClosing, handleClose, handleOverlayClick, overlayAnimation, panelAnimation } = useModalAnimation(onClose);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  // Auto-scroll on new log entries
  useEffect(() => {
    if (autoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [wireLog.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScroll.current = distFromBottom < 40;
  }, []);

  // Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  return (
    <div style={{ ...styles.overlay, animation: overlayAnimation }} onClick={handleOverlayClick}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <span style={styles.title}>Debug</span>

        {/* Session selector */}
        {sessionIds.length > 0 && (
          <select
            style={styles.select}
            value={activeSessionId ?? ''}
            onChange={(e) => onSelectSession?.(e.target.value)}
          >
            {sessionIds.map(id => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        )}

        <span style={{ flex: 1 }} />

        {/* Legend */}
        <span style={{ color: COLOR_SEND, marginRight: '1ch', fontSize: '0.85em' }}>{'>>> send'}</span>
        <span style={{ color: COLOR_RECV, marginRight: '1ch', fontSize: '0.85em' }}>{'<<< recv'}</span>

        {/* Close button */}
        <button
          style={styles.closeBtn}
          onClick={handleClose}
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Status line */}
      <div style={styles.statusLine}>
        Sessions: {sessionIds.length} | Log entries: {wireLog.length}
        {activeSessionId && ` | Viewing: ${activeSessionId}`}
      </div>

      {/* Scrollable log area */}
      <div
        ref={scrollRef}
        style={styles.logArea}
        onScroll={handleScroll}
      >
        {wireLog.length === 0 ? (
          <div style={{ color: COLOR_SYSTEM, padding: '1em' }}>
            No wire log entries yet. Send a message to see protocol traffic.
          </div>
        ) : (
          wireLog.map((entry, i) => (
            <LogLine key={i} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Single log line
// ---------------------------------------------------------------------------

function LogLine({ entry }: { entry: WireLogEntry }): React.JSX.Element {
  const time = formatTime(entry.timestamp);
  const prefix = entry.direction === 'send' ? '>>> ' : '<<< ';
  const color = entry.direction === 'send' ? COLOR_SEND : COLOR_RECV;
  const text = truncateText(entry.text);

  // Try to pretty-print compact JSON for readability
  let displayText: string;
  try {
    const parsed = JSON.parse(text);
    // Show type/cmd on first line, rest compact
    const type = parsed.type ?? parsed.cmd ?? '';
    const brief = type ? `[${type}] ` : '';
    displayText = brief + JSON.stringify(parsed);
  } catch {
    displayText = text;
  }

  return (
    <div style={{ ...styles.logLine, color }}>
      <span style={{ color: COLOR_SYSTEM }}>{time} </span>
      {prefix}
      {displayText}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--bg-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    animation: 'fade-in 0.2s ease-out',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.5em 1ch',
    backgroundColor: 'var(--bg-tertiary)',
    gap: '1ch',
    flexShrink: 0,
  },
  title: {
    color: 'var(--ansi-blue)',
    fontWeight: 'bold',
    fontSize: '1em',
  },
  select: {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--text-muted)',
    borderRadius: '2px',
    padding: '0.1em 0.5ch',
    fontFamily: 'inherit',
    fontSize: '0.9em',
    outline: 'none',
  },
  closeBtn: {
    background: 'none',
    border: '1px solid var(--text-muted)',
    borderRadius: '2px',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    padding: '0.1em 0.6ch',
    fontFamily: 'inherit',
    fontSize: '0.9em',
    lineHeight: 1,
  },
  statusLine: {
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    padding: '0.2em 1ch',
    backgroundColor: 'var(--bg-primary)',
    flexShrink: 0,
  },
  logArea: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '0.5em 1ch',
    minHeight: 0,
  },
  logLine: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    lineHeight: 1.3,
    fontSize: '0.9em',
    padding: '1px 0',
  },
};
