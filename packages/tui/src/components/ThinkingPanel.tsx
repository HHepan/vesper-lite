// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Thinking Block Component (CC-style ● dot + borderLeft tree)
//
// ● Thinking (yellow dot) — collapsed summary or expanded with tree border
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Box, Text } from 'ink';
import type { ThinkingEntry } from '../store.js';
import { formatElapsed } from '../store.js';
import { TreeContent } from './TreeContent.js';
import { theme } from '../theme.js';

/** Big dot for top-level items (U+25CF BLACK CIRCLE). */
const DOT = '● ';

interface BlockProps {
  entry: ThinkingEntry;
  onToggle: (id: string) => void;
}

export const ThinkingBlock = React.memo(function ThinkingBlock({ entry, onToggle }: BlockProps): React.JSX.Element {
  const elapsed = entry.elapsedMs != null ? ` (${formatElapsed(entry.elapsedMs)})` : '';

  // ── Collapsed ──────────────────────────────────────────────────────────
  if (entry.collapsed) {
    return (
      <Box marginBottom={1}>
        <Text color={theme.thinkingDot} dimColor>{DOT}</Text>
        <Text color={theme.thinkingLabel} dimColor>
          {`Thinking${elapsed}`}
        </Text>
      </Box>
    );
  }

  // ── Expanded: ● header + borderLeft tree for content ───────────────────
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.thinkingDot}>{DOT}</Text>
        <Text color={theme.thinkingLabel} dimColor>{`Thinking${elapsed}`}</Text>
      </Box>
      <TreeContent>
        <Text color={theme.thinkingContent} dimColor>{entry.content}</Text>
      </TreeContent>
    </Box>
  );
});

// Re-export for backwards compatibility
export { ThinkingBlock as ThinkingPanel };
