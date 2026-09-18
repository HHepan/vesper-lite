// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — TreeContent (borderLeft wrapper for tree-line hierarchy)
//
// Uses Ink Box borderLeft to render a continuous │ line that auto-extends
// with text wrap. Ends with a └─ terminator on an empty line.
//
// Layout:
//   │ content line 1 that may wrap and the │
//   │ border extends automatically
//   │ content line 2
//   └─
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

interface TreeContentProps {
  children: React.ReactNode;
  color?: string;
}

/**
 * Wraps children in a left-border box with a └─ terminator.
 * The border automatically extends when text wraps — no manual
 * line-counting needed.
 */
export function TreeContent({ children, color = theme.treeBorder }: TreeContentProps): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={1} width="100%">
      {/* Content area with left border — auto-extends on wrap */}
      <Box
        borderStyle="single"
        borderLeft={true}
        borderTop={false}
        borderBottom={false}
        borderRight={false}
        borderColor={color}
        borderDimColor={true}
        paddingLeft={1}
        width="100%"
      >
        <Box flexDirection="column" width="100%">
          {children}
        </Box>
      </Box>
      {/* └─ terminator */}
      <Text color={color} dimColor>{'└─'}</Text>
    </Box>
  );
}
