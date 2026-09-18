// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — AgentSpinner (TUI-aligned: deterministic verb, elapsed time,
// hue cycling, frozen frame on idle)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import { theme } from '../theme.js';
import { formatElapsed } from '../lib/format-utils.js';
import type { TimelineItem } from '../store.js';
export type RequestAction =
  | { type: 'pause'; requestId: string }
  | { type: 'resume'; requestId: string }
  | { type: 'retry'; requestId: string }
  | { type: 'abort'; requestId: string };

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ---------------------------------------------------------------------------
// Retry reason labels (human-readable)
// ---------------------------------------------------------------------------

const RETRY_REASON_LABELS: Record<string, string> = {
  rate_limit: 'Rate limited',
  server_error: 'Server error',
  network_error: 'Network error',
  context_overflow: 'Context overflow',
  timeout: 'Timeout',
  unknown: 'Error',
};

function retryReasonLabel(reason?: string): string {
  return (reason && RETRY_REASON_LABELS[reason]) || 'Error';
}

// ---------------------------------------------------------------------------
// Deterministic verb derivation (matches TUI exactly)
// ---------------------------------------------------------------------------

function deriveVerb(status: string, timeline: TimelineItem[]): string {
  if (status === 'idle') return 'Idle';
  if (status === 'done') return 'Done';
  if (status === 'error') return 'Error';

  // streaming — derive from last timeline item kind (no tool names)
  if (timeline.length === 0) return 'Thinking...';
  const last = timeline[timeline.length - 1]!;
  if (last.kind === 'thinking') return 'Thinking...';
  if (last.kind === 'tool' && !last.entry.result) return 'Running...';
  return 'Generating...';
}

// ---------------------------------------------------------------------------
// Get start time of the currently active item for elapsed display
// ---------------------------------------------------------------------------

function getActiveStartTime(status: string, timeline: TimelineItem[]): number | null {
  if (status !== 'streaming' || timeline.length === 0) return null;
  const last = timeline[timeline.length - 1]!;
  if (last.kind === 'thinking') return last.entry.startTime;
  if (last.kind === 'tool' && !last.entry.result) return last.entry.timestamp;
  return null;
}

// ---------------------------------------------------------------------------
// HSL → hex (for hue cycling without CSS animation)
// ---------------------------------------------------------------------------

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------------------------------------------------------------------------
// Token usage formatting helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProviderRequestSummary {
  requestId: string;
  status: string;
  model: string;
  startedAt: number;
  elapsedMs: number;
  attempt: number;
  error?: string;
  retryReason?: string;
  retryDelayMs?: number;
  retryStartedAt?: number;
  maxRetries?: number;
  extendedRetry?: boolean;
  extendedRetryCount?: number;
}

interface AgentSpinnerProps {
  status: string;
  timeline: TimelineItem[];
  /** Active provider requests (shown inline). */
  providerRequests?: ProviderRequestSummary[];
  onRequestAction?: (action: RequestAction) => void;
}

export const AgentSpinner = memo(function AgentSpinner({
  status, timeline, providerRequests, onRequestAction,
}: AgentSpinnerProps) {
  const isActive = status === 'streaming';
  const verb = deriveVerb(status, timeline);

  const [tick, setTick] = useState(0);
  const lastFrameRef = useRef(SPINNER_FRAMES[0]!);

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setTick(prev => prev + 1);
    }, 80);
    return () => clearInterval(timer);
  }, [isActive]);

  const currentFrame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!;
  if (isActive) {
    lastFrameRef.current = currentFrame;
  }

  const spinnerIcon = isActive ? currentFrame : lastFrameRef.current;

  const verbColor = isActive
    ? (theme.spinnerHueCycling ? hslToHex((tick * 6) % 360, 70, 72) : theme.spinnerActive)
    : theme.spinnerIdle;

  const iconColor = isActive
    ? (theme.spinnerHueCycling ? hslToHex((tick * 6) % 360, 70, 72) : theme.spinnerActive)
    : theme.spinnerIdle;

  const activeStart = getActiveStartTime(status, timeline);
  const elapsedSuffix = isActive && activeStart !== null
    ? ` ${formatElapsed(Date.now() - activeStart)}`
    : '';

  // Pick the first active request for inline controls (usually only one at a time)
  const activeReq = providerRequests?.length ? providerRequests[0] : null;
  const isRetrying = activeReq && (activeReq.status === 'waiting_retry' || activeReq.status === 'retrying');
  const isExtendedRetry = activeReq && activeReq.status === 'waiting_extended_retry';

  return (
    <div>
      <div style={styles.row}>
        <span style={{ color: iconColor }}>{spinnerIcon}</span>
        <span style={{ color: verbColor, marginLeft: '1ch' }}>{verb}</span>
        {elapsedSuffix && (
          <span style={{ color: theme.spinnerIdle, marginLeft: '0.5ch' }}>{elapsedSuffix}</span>
        )}
        {/* Right-aligned provider request controls */}
        {activeReq && onRequestAction && (
          <RequestControls req={activeReq} onAction={onRequestAction} />
        )}
      </div>
      {isRetrying && activeReq && (
        <RetryBanner req={activeReq} />
      )}
      {isExtendedRetry && activeReq && (
        <ExtendedRetryBanner req={activeReq} onAction={onRequestAction} />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Inline request controls (right-aligned in spinner row)
// ---------------------------------------------------------------------------

const RequestControls = memo(function RequestControls({
  req, onAction,
}: { req: ProviderRequestSummary; onAction: (a: RequestAction) => void }) {
  const isPaused = req.status === 'paused';
  const isTerminal = req.status === 'completed' || req.status === 'failed';

  const pause = useCallback(() => onAction({ type: 'pause', requestId: req.requestId }), [onAction, req.requestId]);
  const resume = useCallback(() => onAction({ type: 'resume', requestId: req.requestId }), [onAction, req.requestId]);
  const retry = useCallback(() => onAction({ type: 'retry', requestId: req.requestId }), [onAction, req.requestId]);
  const abort = useCallback(() => onAction({ type: 'abort', requestId: req.requestId }), [onAction, req.requestId]);

  if (isTerminal) return null;

  return (
    <span style={styles.controls}>
      {isPaused
        ? <CtrlBtn label="▶" title="Resume" onClick={resume} />
        : <CtrlBtn label="⏸" title="Pause" onClick={pause} />
      }
      <CtrlBtn label="↻" title="Retry" onClick={retry} />
      <CtrlBtn label="✕" title="Stop" onClick={abort} color={theme.errorText} />
      {req.attempt > 1 && (
        <span style={{ color: theme.statusBudgetWarn, fontSize: '0.9em' }}>×{req.attempt}</span>
      )}
    </span>
  );
});

function CtrlBtn({ label, title, onClick, color }: {
  label: string; title: string; onClick: () => void; color?: string;
}) {
  return (
    <button onClick={onClick} title={title} style={{ ...styles.btn, color: color ?? 'var(--text-secondary)' }}>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Retry banner (shown when auto-retry is in progress)
// ---------------------------------------------------------------------------

const RetryBanner = memo(function RetryBanner({ req }: { req: ProviderRequestSummary }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (req.status !== 'waiting_retry' || !req.retryDelayMs) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [req.status, req.retryDelayMs]);

  const reason = retryReasonLabel(req.retryReason);
  const attempt = req.attempt ?? 1;
  const maxRetries = req.maxRetries ?? 3;

  if (req.status === 'retrying') {
    return (
      <div style={styles.retryBanner}>
        <span style={{ color: theme.statusBudgetWarn }}>↻</span>
        <span style={{ color: theme.statusBudgetWarn, marginLeft: '0.5ch' }}>
          Retrying ({attempt}/{maxRetries})
        </span>
        <span style={{ color: theme.dimText, marginLeft: '1ch', fontSize: '0.9em' }}>
          {reason}
        </span>
      </div>
    );
  }

  // waiting_retry — show countdown
  const elapsed = req.retryStartedAt ? now - req.retryStartedAt : 0;
  const remaining = Math.max(0, (req.retryDelayMs ?? 0) - elapsed);
  const remainingSec = (remaining / 1000).toFixed(1);

  return (
    <div style={styles.retryBanner}>
      <span style={{ color: theme.statusBudgetWarn }}>⏳</span>
      <span style={{ color: theme.statusBudgetWarn, marginLeft: '0.5ch' }}>
        {reason} — retry {attempt}/{maxRetries} in {remainingSec}s
      </span>
      {req.error && (
        <span style={{ color: theme.dimText, marginLeft: '1ch', fontSize: '0.85em' }}
              title={req.error}>
          {req.error.length > 60 ? req.error.slice(0, 60) + '…' : req.error}
        </span>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Extended retry banner (long-interval infinite retry — prominent, user-cancellable)
// ---------------------------------------------------------------------------

/** Format a large ms duration into human-readable "Xm Ys" or "Xh Ym". */
function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

const ExtendedRetryBanner = memo(function ExtendedRetryBanner({
  req, onAction,
}: { req: ProviderRequestSummary; onAction?: (a: RequestAction) => void }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const reason = retryReasonLabel(req.retryReason);
  const extCount = req.extendedRetryCount ?? 1;
  const elapsed = req.retryStartedAt ? now - req.retryStartedAt : 0;
  const remaining = Math.max(0, (req.retryDelayMs ?? 0) - elapsed);
  const totalElapsed = req.startedAt ? now - req.startedAt : 0;

  return (
    <div style={extRetryStyles.container}>
      <div style={extRetryStyles.headerRow}>
        <span style={extRetryStyles.icon}>⚠</span>
        <span style={extRetryStyles.title}>
          Provider unavailable — extended retry mode
        </span>
      </div>
      <div style={extRetryStyles.detailRow}>
        <span style={{ color: theme.dimText }}>
          {reason} · attempt #{extCount} · elapsed: {formatDuration(totalElapsed)}
        </span>
      </div>
      <div style={extRetryStyles.detailRow}>
        <span style={{ color: 'var(--status-warning)' }}>
          ⏳ Next retry in {formatDuration(remaining)}
        </span>
      </div>
      {req.error && (
        <div style={extRetryStyles.detailRow}>
          <span style={{ color: theme.dimText, fontSize: '0.85em' }} title={req.error}>
            {req.error.length > 80 ? req.error.slice(0, 80) + '…' : req.error}
          </span>
        </div>
      )}
      <div style={extRetryStyles.actionRow}>
        <span style={{ color: theme.dimText, fontSize: '0.85em' }}>
          Will keep retrying until provider recovers.
        </span>
        <span style={extRetryStyles.actionBtns}>
          {onAction && (
            <button
              onClick={() => onAction({ type: 'retry', requestId: req.requestId })}
              style={extRetryStyles.retryNowBtn}
              title="Skip the delay and retry immediately"
            >
              ↻ Retry Now
            </button>
          )}
          {onAction && (
            <button
              onClick={() => onAction({ type: 'abort', requestId: req.requestId })}
              style={extRetryStyles.cancelBtn}
              title="Stop retrying and cancel the request"
            >
              ✕ Cancel
            </button>
          )}
        </span>
      </div>
    </div>
  );
});

const extRetryStyles: Record<string, React.CSSProperties> = {
  container: {
    margin: '0.25em 1ch 0.5em 2.5ch',
    padding: '0.5em 1ch',
    border: '1px solid var(--status-warning-dark)',
    borderRadius: '4px',
    background: 'var(--status-warning-bg)',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '0.3em',
  },
  icon: {
    color: 'var(--status-warning)',
    fontSize: '1.1em',
    marginRight: '0.5ch',
  },
  title: {
    color: 'var(--status-warning)',
    fontWeight: 'bold',
    fontSize: '0.95em',
  },
  detailRow: {
    padding: '0.1em 0 0.1em 2ch',
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.3em 0 0 2ch',
    borderTop: '1px solid var(--border-color)',
    marginTop: '0.3em',
  },
  actionBtns: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
  },
  retryNowBtn: {
    background: 'transparent',
    border: '1px solid var(--status-success-dark)',
    borderRadius: '3px',
    padding: '0.1em 1ch',
    color: 'var(--status-success-light)',
    fontFamily: 'inherit',
    fontSize: '0.9em',
    cursor: 'pointer',
    lineHeight: 1.6,
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid var(--status-error-dark)',
    borderRadius: '3px',
    padding: '0.1em 1ch',
    color: 'var(--status-error-light)',
    fontFamily: 'inherit',
    fontSize: '0.9em',
    cursor: 'pointer',
    lineHeight: 1.6,
  },
};

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 1ch',
    minHeight: '1.5em',
    marginBottom: '0.5em',
  },
  retryBanner: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 1ch 0 2.5ch',
    minHeight: '1.4em',
    marginBottom: '0.25em',
  },
  controls: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5ch',
  },
  btn: {
    background: 'transparent',
    border: '1px solid var(--text-muted)',
    borderRadius: '3px',
    padding: '0 0.8ch',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    lineHeight: 1.4,
  },
};
