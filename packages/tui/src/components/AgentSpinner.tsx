// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Agent Spinner (CC-style status line above input)
//
// Always visible. Animated spinner + hue-cycling verb when active,
// static gray icon + dim verb when idle.
// Now includes provider request retry status display.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { TimelineItem, ProviderRequestEntry } from '../store.js';
import { formatElapsed } from '../store.js';
import { theme } from '../theme.js';

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

interface Props {
  status: 'idle' | 'streaming' | 'done' | 'error';
  timeline: TimelineItem[];
  providerRequests?: ProviderRequestEntry[];
}

function deriveVerb(status: Props['status'], timeline: TimelineItem[]): string {
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

/** Get the start timestamp of the currently active (in-progress) item, or null if idle. */
function getActiveStartTime(status: Props['status'], timeline: TimelineItem[]): number | null {
  if (status !== 'streaming' || timeline.length === 0) return null;
  const last = timeline[timeline.length - 1]!;
  if (last.kind === 'thinking') return last.entry.startTime;
  if (last.kind === 'tool' && !last.entry.result) return last.entry.timestamp;
  return null;
}

/** Convert HSL (h: 0-360, s: 0-100, l: 0-100) to hex color string. */
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

export const AgentSpinner = React.memo(function AgentSpinner({ status, timeline, providerRequests }: Props): React.JSX.Element {
  const isActive = status === 'streaming';
  const verb = deriveVerb(status, timeline);

  const [tick, setTick] = useState(0);
  // Remember the last spinner frame so idle shows the frozen symbol instead of ●
  const lastFrameRef = React.useRef(SPINNER_FRAMES[0]!);
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 80);
    return () => clearInterval(timer);
  }, [isActive]);

  const currentFrame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!;
  if (isActive) {
    lastFrameRef.current = currentFrame;
  }

  const spinnerIcon = isActive ? currentFrame : lastFrameRef.current;
  const iconColor = isActive ? theme.spinnerActive : theme.spinnerIdle;

  // Hue-cycling color for verb text when active (soft pastel gradient)
  const verbColor = isActive
    ? (theme.spinnerHueCycling ? hslToHex((tick * 6) % 360, 70, 72) : theme.spinnerActive)
    : undefined;

  // Dynamic elapsed time for active items (tick drives re-render so Date.now() stays fresh)
  const activeStart = getActiveStartTime(status, timeline);
  const elapsedSuffix = isActive && activeStart !== null
    ? ` ${formatElapsed(Date.now() - activeStart)}`
    : '';

  // Pick the first active request for retry status display
  const activeReq = providerRequests?.length ? providerRequests[0] : null;
  const isRetrying = activeReq && (activeReq.status === 'waiting_retry' || activeReq.status === 'retrying');
  const isExtendedRetry = activeReq && activeReq.status === 'waiting_extended_retry';

  return (
    <Box flexDirection="column">
      {/* Main spinner row */}
      <Box>
        <Text color={iconColor}>{spinnerIcon}</Text>
        {isActive
          ? <>
              <Text color={verbColor}>{` ${verb}`}</Text>
              {elapsedSuffix && <Text color={theme.spinnerIdle} dimColor>{elapsedSuffix}</Text>}
              {activeReq && activeReq.attempt > 1 && (
                <Text color={theme.statusBudgetWarn}>{` ×${activeReq.attempt}`}</Text>
              )}
            </>
          : <Text color={theme.spinnerIdle} dimColor>{` ${verb}`}</Text>
        }
      </Box>

      {/* Retry banner */}
      {isRetrying && activeReq && (
        <Box paddingLeft={2}>
          {activeReq.status === 'retrying' ? (
            <>
              <Text color={theme.statusBudgetWarn}>{'↻ '}</Text>
              <Text color={theme.statusBudgetWarn}>
                {`Retrying (${activeReq.attempt}/${activeReq.maxRetries ?? 3})`}
              </Text>
              <Text color={theme.dimText}>{` ${retryReasonLabel(activeReq.retryReason)}`}</Text>
            </>
          ) : (
            <>
              <Text color={theme.statusBudgetWarn}>{'⏳ '}</Text>
              <Text color={theme.statusBudgetWarn}>
                {`${retryReasonLabel(activeReq.retryReason)} — retry ${activeReq.attempt}/${activeReq.maxRetries ?? 3}`}
              </Text>
              {activeReq.error && (
                <Text color={theme.dimText} dimColor>
                  {` ${activeReq.error.length > 50 ? activeReq.error.slice(0, 50) + '…' : activeReq.error}`}
                </Text>
              )}
            </>
          )}
        </Box>
      )}

      {/* Extended retry banner */}
      {isExtendedRetry && activeReq && (
        <Box paddingLeft={2}>
          <Text color={theme.statusBudgetWarn}>{'⏳ '}</Text>
          <Text color={theme.statusBudgetWarn} bold>
            {`Extended retry ${activeReq.extendedRetryCount ?? 0} — ${retryReasonLabel(activeReq.retryReason)}`}
          </Text>
          {activeReq.error && (
            <Text color={theme.dimText} dimColor>
              {` ${activeReq.error.length > 50 ? activeReq.error.slice(0, 50) + '…' : activeReq.error}`}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
});
