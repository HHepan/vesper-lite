// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Current Turn View (dynamic zone, CC-style ● dot + └─ tree)
//
// Only renders the active tail of the current turn (last item in timeline).
// All completed items are in the Static zone via frozenTimeline.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { TimelineItem } from '../store.js';
import { ThinkingBlock } from './ThinkingPanel.js';
import { ToolCard } from './ToolPanel.js';
import { TreeContent } from './TreeContent.js';
import { renderMarkdown } from '../render-markdown.js';
import { theme } from '../theme.js';

/** Big dot for top-level items (U+25CF BLACK CIRCLE). */
const DOT = '● ';

interface Props {
  timeline: TimelineItem[];
  lastError: string | null;
  status: 'idle' | 'streaming' | 'done' | 'error';
  hasFrozenContent: boolean;
  onToggleTool: (id: string) => void;
  onToggleThinking: (id: string) => void;
  /** When true, hide pending ask_user tool cards (the AskUserDialog provides the UI instead). */
  hideAskUserPending?: boolean;
}

export const CurrentTurnView = React.memo(function CurrentTurnView({
  timeline,
  lastError,
  status,
  hasFrozenContent,
  onToggleTool,
  onToggleThinking,
  hideAskUserPending,
}: Props): React.JSX.Element | null {
  const { stdout } = useStdout();
  const maxVisibleLines = (stdout?.rows ?? 40) - 8; // Reserve space for input, status, separators

  const hasContent = timeline.length > 0 || lastError !== null;

  if (!hasContent) return null;

  const isStreaming = status === 'streaming';
  const lastItem = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const trailingTextId = isStreaming && lastItem?.kind === 'text' ? lastItem.entry.id : null;

  return (
    <Box flexDirection="column">
      {/* Active timeline items (typically just the last one) */}
      {timeline.map((item) => {
        if (item.kind === 'prompt') {
          return (
            <Box key={item.entry.id} marginBottom={1}>
              <Text backgroundColor={theme.promptBg}>
                {'  '}<Text color={theme.promptMarker} dimColor>{'>'}</Text>{' '}<Text color={theme.promptText}>{item.entry.content}</Text>{'  '}
              </Text>
            </Box>
          );
        }
        if (item.kind === 'thinking') {
          return (
            <ThinkingBlock
              key={item.entry.id}
              entry={item.entry}
              onToggle={onToggleThinking}
            />
          );
        }
        if (item.kind === 'tool') {
          // Hide pending ask_user card when AskUserDialog is active (it provides the UI)
          if (hideAskUserPending && !item.entry.result && item.entry.call.name === 'ask_user') {
            return null;
          }
          return (
            <ToolCard
              key={item.entry.id}
              entry={item.entry}
              onToggle={onToggleTool}
            />
          );
        }
        // System message
        if (item.kind === 'system') {
          return (
            <Box key={item.entry.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={theme.systemDot}>{DOT}</Text>
                <Text color={theme.systemLabel} dimColor>{'System'}</Text>
              </Box>
              <TreeContent>
                <Text color={theme.systemText}>{item.entry.content}</Text>
              </TreeContent>
            </Box>
          );
        }
        // Text block — truncate to last N lines if too long
        const showCursor = isStreaming && item.entry.id === trailingTextId;
        let displayContent = item.entry.content;
        if (maxVisibleLines > 0) {
          const lines = displayContent.split('\n');
          if (lines.length > maxVisibleLines) {
            displayContent = lines.slice(-maxVisibleLines).join('\n');
          }
        }
        return (
          <Box key={item.entry.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={theme.assistantDot}>{DOT}</Text>
            </Box>
            <TreeContent>
              <Text>
                {displayContent}
                {showCursor ? <Text color={theme.streamingCursor}>{'\u2588'}</Text> : null}
              </Text>
            </TreeContent>
          </Box>
        );
      })}

      {/* Error */}
      {lastError && (
        <Box marginBottom={1}>
          <Text color={theme.errorDot}>{DOT}</Text>
          <Text color={theme.errorText}>{lastError}</Text>
        </Box>
      )}
    </Box>
  );
});
