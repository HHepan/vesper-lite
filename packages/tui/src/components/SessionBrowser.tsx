// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Session Browser Component
//
// Interactive modal for browsing/managing saved sessions.
// Triggered by /sessions command. Mirrors CanvasBrowser UX patterns.
// Keyboard: ↑↓ navigate, Enter load, d delete, Esc close, Home/End.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SessionBrowserState, SavedSessionSummary } from '../store.js';
import { theme } from '../theme.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionBrowserAction =
  | { type: 'close' }
  | { type: 'navigate'; delta: number }
  | { type: 'navigate_top' }
  | { type: 'navigate_bottom' }
  | { type: 'load'; sessionName: string }
  | { type: 'delete'; sessionName: string };

interface SessionBrowserProps {
  state: SessionBrowserState;
  onAction: (action: SessionBrowserAction) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEWPORT_SIZE = 15;

// ---------------------------------------------------------------------------
// Session Row
// ---------------------------------------------------------------------------

function SessionRow({ session, index, isSelected }: {
  session: SavedSessionSummary;
  index: number;
  isSelected: boolean;
}): React.JSX.Element {
  const num = String(index + 1).padStart(2, '0');
  const date = new Date(session.updatedAt).toLocaleDateString();
  const shortId = session.id.slice(0, 8);

  return (
    <Box>
      <Text color={isSelected ? theme.canvasBrowserSelected : theme.dimText}>
        {isSelected ? '> ' : '  '}
      </Text>
      <Text color={isSelected ? theme.canvasBrowserSelected : undefined} bold={isSelected}>
        [{num}] 📁 {session.name}
      </Text>
      <Text color={theme.dimText}>
        {`  (${session.checkpointCount} cp, ${date})  [${shortId}]`}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const SessionBrowser = memo(function SessionBrowser({
  state,
  onAction,
}: SessionBrowserProps): React.JSX.Element {
  const { sessions, selectedIndex } = state;

  // Keyboard handler
  useInput((input, key) => {
    if (key.escape) {
      onAction({ type: 'close' });
      return;
    }
    if (key.upArrow) {
      onAction({ type: 'navigate', delta: -1 });
      return;
    }
    if (key.downArrow) {
      onAction({ type: 'navigate', delta: 1 });
      return;
    }
    if (key.return && sessions.length > 0) {
      onAction({ type: 'load', sessionName: sessions[selectedIndex]!.name });
      return;
    }
    if (input === 'd' && sessions.length > 0) {
      onAction({ type: 'delete', sessionName: sessions[selectedIndex]!.name });
      return;
    }
    // Home/End (Ink doesn't have dedicated keys, but pageUp/pageDown work)
    if (key.pageUp) {
      onAction({ type: 'navigate_top' });
      return;
    }
    if (key.pageDown) {
      onAction({ type: 'navigate_bottom' });
      return;
    }
  });

  // Viewport windowing
  let viewStart = state.scrollOffset;
  if (selectedIndex < viewStart) viewStart = selectedIndex;
  if (selectedIndex >= viewStart + VIEWPORT_SIZE) viewStart = selectedIndex - VIEWPORT_SIZE + 1;
  const viewEnd = Math.min(sessions.length, viewStart + VIEWPORT_SIZE);
  const visible = sessions.slice(viewStart, viewEnd);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.canvasBrowserBorder} paddingX={1}>
      {/* Header */}
      <Box>
        <Text color={theme.canvasBrowserHeader} bold>
          Session Browser ({sessions.length} saved sessions)
        </Text>
      </Box>

      {/* Empty state */}
      {sessions.length === 0 ? (
        <Box paddingY={1}>
          <Text color={theme.dimText}>No saved sessions.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {visible.map((s, viewIdx) => {
            const realIdx = viewStart + viewIdx;
            return (
              <SessionRow
                key={s.id}
                session={s}
                index={realIdx}
                isSelected={realIdx === selectedIndex}
              />
            );
          })}
        </Box>
      )}

      {/* Footer with keyboard hints */}
      <Box marginTop={1}>
        <Text color={theme.dimText}>
          {'↑↓ navigate  ⏎ load  d delete  Esc close'}
        </Text>
      </Box>
    </Box>
  );
});
