// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — SubagentPanel (real-time subagent status display)
//
// Shows spawned subagents with live status, verb, token usage, elapsed time.
// Visual style matches TaskPanel (TUI-aligned tree content).
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useState, useEffect } from 'react';
import { theme } from '../theme.js';
import { TreeContent } from './TreeContent.js';
import { formatTokens, formatElapsed } from '../lib/format-utils.js';
import type { SubagentEntry } from '../store.js';

// ---------------------------------------------------------------------------
// Spinner frames (braille pattern, same as AgentSpinner)
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ---------------------------------------------------------------------------
// SubagentHeader — ◆ Subagents  2 running
// ---------------------------------------------------------------------------

const SubagentHeader = memo(function SubagentHeader({ subagents }: { subagents: SubagentEntry[] }) {
  const running = subagents.filter(s => s.status === 'running').length;
  const total = subagents.length;

  return (
    <div style={{ color: theme.taskHeader, display: 'flex', gap: '1ch', alignItems: 'baseline' }}>
      <span style={{ color: theme.taskTitleStar }}>◆ </span>
      <span>Subagents</span>
      <span style={{ color: running > 0 ? theme.taskInProgress : theme.taskDone }}>
        {running > 0 ? `${running} running` : `${total} done`}
      </span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// SubagentRow — single subagent status row
// ---------------------------------------------------------------------------

const SubagentRow = memo(function SubagentRow({ entry, tick }: { entry: SubagentEntry; tick: number }) {
  const isRunning = entry.status === 'running';
  const isFailed = entry.status === 'failed' || entry.status === 'aborted';
  const isDone = entry.status === 'completed';

  // Icon
  let icon: string;
  let iconColor: string;
  if (isRunning) {
    icon = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!;
    iconColor = theme.taskInProgress;
  } else if (isDone) {
    icon = '✓';
    iconColor = theme.taskDone;
  } else {
    icon = '✗';
    iconColor = theme.errorText;
  }

  // Verb + tool name
  let verbText = entry.verb;
  if (isRunning && entry.toolName && entry.verb === 'Running...') {
    verbText = `Running ${entry.toolName}...`;
  }

  // Token usage (total tokens only, no cost)
  let tokenText = '';
  if (entry.tokenUsage) {
    const total = entry.tokenUsage.promptTokens + entry.tokenUsage.completionTokens;
    if (total > 0) {
      tokenText = formatTokens(total) + ' tokens';
    }
  }

  // Elapsed time
  const baseTime = isRunning || isDone || isFailed
    ? (entry.completedAt ?? Date.now()) - entry.spawnedAt
    : 0;
  const elapsedText = baseTime > 0 ? formatElapsed(baseTime) : '';

  const rowOpacity = isDone || isFailed ? 0.6 : 1;

  return (
    <div style={{ display: 'flex', gap: '1ch', opacity: rowOpacity, alignItems: 'baseline' }}>
      <span style={{ color: iconColor, minWidth: '1ch' }}>{icon}</span>
      <span style={{
        color: isRunning ? theme.taskInProgress : isDone ? theme.taskDone : theme.errorText,
        minWidth: '0',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: '22ch',
      }}>
        {entry.taskId}
      </span>
      <span style={{ color: theme.dimText, minWidth: '0', whiteSpace: 'nowrap' }}>
        {verbText}
      </span>
      {tokenText && (
        <span style={{ color: 'var(--status-success-light)', whiteSpace: 'nowrap' }}>
          {tokenText}
        </span>
      )}
      {elapsedText && (
        <span style={{ color: theme.spinnerIdle, whiteSpace: 'nowrap' }}>
          {elapsedText}
        </span>
      )}
      {isFailed && entry.error && (
        <span style={{ color: theme.errorText, fontSize: '0.9em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '30ch' }}
              title={entry.error}>
          {entry.error.length > 40 ? entry.error.slice(0, 40) + '…' : entry.error}
        </span>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// SubagentPanel
// ---------------------------------------------------------------------------

interface SubagentPanelProps {
  subagents: SubagentEntry[];
}

export const SubagentPanel = memo(function SubagentPanel({ subagents }: SubagentPanelProps) {
  if (subagents.length === 0) return null;

  const hasRunning = subagents.some(s => s.status === 'running');

  // Tick for spinner animation + elapsed time updates
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => setTick(prev => prev + 1), 80);
    return () => clearInterval(timer);
  }, [hasRunning]);

  return (
    <div style={styles.container}>
      <SubagentHeader subagents={subagents} />
      <TreeContent color={theme.taskPanelTree}>
        {subagents.map((entry) => (
          <SubagentRow key={entry.taskId} entry={entry} tick={tick} />
        ))}
      </TreeContent>
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '0 1ch',
  },
};
