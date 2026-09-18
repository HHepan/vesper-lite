// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Welcome Banner (CC-style with internal dividers)
//
// Layout inside round border:
//   ╭──────────────────────────────────────╮
//   │  /|___|\ │  Vesper                      │
//   │ ( (O,O) )│  ────────────────────     │
//   │    " "   │  Type a message to start  │
//   ╰──────────────────────────────────────╯
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { theme } from '../theme.js';

// Mascot for Vesper
const MASCOT = [
  '  /|___|\\  ',
  ' ( (O,O) ) ',
  '    " "    ',
];

export function WelcomeBanner(): React.JSX.Element {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const bannerWidth = Math.max(termWidth - 2, 40);

  // Width available for the right text area (rough estimate for the horizontal rule)
  const rightAreaWidth = Math.max(bannerWidth - 20, 20);

  return (
    <Box flexDirection="column" width={bannerWidth}>
      <Box borderStyle="round" borderColor={theme.bannerBorder} paddingX={1} paddingY={0} flexDirection="row">
        {/* Left: mascot */}
        <Box flexDirection="column" justifyContent="center">
          {MASCOT.map((line, i) => (
            <Text key={i} color={theme.bannerMascot}>{line}</Text>
          ))}
        </Box>

        {/* Vertical separator */}
        <Box flexDirection="column" justifyContent="center" marginX={1}>
          <Text color={theme.separator} dimColor>{'│'}</Text>
          <Text color={theme.separator} dimColor>{'│'}</Text>
          <Text color={theme.separator} dimColor>{'│'}</Text>
        </Box>

        {/* Right: text info with horizontal divider */}
        <Box flexDirection="column" justifyContent="center">
          <Text bold color={theme.bannerTitle}>{'Vesper'}</Text>
          <Text color={theme.separator} dimColor>{'─'.repeat(Math.min(rightAreaWidth, 40))}</Text>
          <Text color={theme.bannerSubtext}>{'Type a message to start. Ctrl+C to interrupt.'}</Text>
        </Box>
      </Box>
    </Box>
  );
}
