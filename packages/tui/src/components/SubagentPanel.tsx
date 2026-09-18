// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — SubagentPanel (real-time subagent status display)
//
// Shows spawned subagents with live status, verb, token usage, elapsed time.
// Visual style matches TaskPanel (Ink tree content).
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { SubagentEntry } from '../store.js';
import { formatElapsed } from '../store.js';
import { TreeContent } from './TreeContent.js';
import { theme } from '../theme.js';

// ---------------------------------------------------------------------------
// Spinner frames (braille pattern, same as AgentSpinner)
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ---------------------------------------------------------------------------
// Token formatting
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// SubagentPanel
// ---------------------------------------------------------------------------

interface SubagentPanelProps {
  subagents: SubagentEntry[];
}

export const SubagentPanel = React.memo(function SubagentPanel({ subagents }: SubagentPanelProps): React.JSX.Element | null {
  if (subagents.length === 0) return null;

  const hasRunning = subagents.some(s => s.status === 'running');
  const runningCount = subagents.filter(s => s.status === 'running').length;

  // Tick for spinner animation + elapsed time updates
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => setTick(prev => prev + 1), 80);
    return () => clearInterval(timer);
  }, [hasRunning]);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {/* Header */}
      <Box>
        <Text color={theme.taskTitleStar}>{'◆ '}</Text>
        <Text color={theme.taskHeader}>Subagents </Text>
        <Text color={hasRunning ? theme.taskInProgress : theme.taskDone}>
          {hasRunning ? `${runningCount} running` : `${subagents.length} done`}
        </Text>
      </Box>

      {/* Rows */}
      <TreeContent color={theme.taskPanelTree}>
        {subagents.map((entry) => {
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

          // Token usage
          let tokenText = '';
          if (entry.tokenUsage) {
            const total = entry.tokenUsage.promptTokens + entry.tokenUsage.completionTokens;
            if (total > 0) {
              tokenText = ` ${formatTokens(total)} tokens`;
            }
          }

          // Elapsed time
          const baseTime = isRunning || isDone || isFailed
            ? (entry.completedAt ?? Date.now()) - entry.spawnedAt
            : 0;
          const elapsedText = baseTime > 0 ? ` ${formatElapsed(baseTime)}` : '';

          return (
            <Box key={entry.taskId}>
              <Text color={iconColor}>{icon} </Text>
              <Text color={isRunning ? theme.taskInProgress : isDone ? theme.taskDone : theme.errorText} dimColor={isDone || isFailed}>
                {entry.taskId}
              </Text>
              <Text color={theme.dimText} dimColor={isDone || isFailed}>{` ${verbText}`}</Text>
              {tokenText && <Text color={theme.taskDone}>{tokenText}</Text>}
              {elapsedText && <Text color={theme.spinnerIdle} dimColor>{elapsedText}</Text>}
              {isFailed && entry.error && (
                <Text color={theme.errorText} dimColor>
                  {` ${entry.error.length > 40 ? entry.error.slice(0, 40) + '…' : entry.error}`}
                </Text>
              )}
            </Box>
          );
        })}
      </TreeContent>
    </Box>
  );
});
