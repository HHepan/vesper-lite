// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Completed Turn View (for <Static>, CC-style)
//
// Renders a finished turn once with full content (not collapsed).
// Uses unified timeline to preserve chronological event ordering.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { TurnEntry } from '../store.js';
import { theme } from '../theme.js';

interface Props {
  turn: TurnEntry;
}

function formatArgsPreview(args: Record<string, any>): string {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const val = typeof v === 'string'
      ? (v.length > 40 ? `"${v.slice(0, 40)}..."` : `"${v}"`)
      : JSON.stringify(v);
    pairs.push(`${k}=${val}`);
  }
  const joined = pairs.join(', ');
  return joined.length > 100 ? joined.slice(0, 100) + '...' : joined;
}

export const CompletedTurnView = React.memo(function CompletedTurnView({ turn }: Props): React.JSX.Element {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  return (
    <Box flexDirection="column">
      {/* Timeline: prompt, thinking, tools, and text in chronological order */}
      {turn.timeline.map((item) => {
        if (item.kind === 'prompt') {
          return (
            <Box key={item.entry.id}>
              <Text color={theme.promptText} bold>{'> '}</Text>
              <Text color={theme.promptText} bold>{item.entry.content}</Text>
            </Box>
          );
        }
        if (item.kind === 'thinking') {
          // Show thinking content in full (collapsed to summary in gray)
          const lineCount = item.entry.content.split('\n').length;
          return (
            <Box key={item.entry.id} flexDirection="column" paddingLeft={2}>
              <Text color={theme.thinkingLabel} dimColor>
                {`⏵ Thinking (${lineCount} line${lineCount !== 1 ? 's' : ''})`}
              </Text>
            </Box>
          );
        }
        if (item.kind === 'tool') {
          const entry = item.entry;
          const isError = entry.result?.isError;
          const icon = isError ? '✗' : '✓';
          const color = isError ? theme.toolError : theme.toolSuccess;
          const argsPreview = formatArgsPreview(entry.call.arguments);

          return (
            <Box key={entry.id} paddingLeft={2}>
              <Text color={color}>{`${icon} `}</Text>
              <Text color={theme.toolName} bold>{entry.call.name}</Text>
              <Text color={theme.toolArgs} dimColor>{` ${argsPreview}`}</Text>
            </Box>
          );
        }
        // Text block — full content
        return (
          <Box key={item.entry.id} paddingLeft={2}>
            <Text>{item.entry.content}</Text>
          </Box>
        );
      })}

      {/* Error */}
      {turn.error && (
        <Box paddingLeft={2}>
          <Text color={theme.errorDot}>{'✖ '}</Text>
          <Text color={theme.errorText}>{turn.error}</Text>
        </Box>
      )}

      {/* Separator */}
      <Box>
        <Text color={theme.separator} dimColor>{'─'.repeat(Math.min(termWidth, 120))}</Text>
      </Box>
    </Box>
  );
});
