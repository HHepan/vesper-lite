// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Canvas Browser Component
//
// Interactive modal for browsing/managing canvas blocks.
// Three modes: list (browse), inspect (view full), edit (modify content).
// Keyboard-driven: ↑↓ navigate, f fold, u unfold, d delete, Enter inspect,
//                  e edit, Esc close/back.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { CanvasBrowserState } from '../store.js';
import type { CanvasBlockSummary } from '@vesper/shared';
import { theme } from '../theme.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CanvasBrowserAction =
  | { type: 'close' }
  | { type: 'fold'; blockId: string }
  | { type: 'unfold'; blockId: string }
  | { type: 'delete'; blockId: string }
  | { type: 'inspect'; blockId: string }
  | { type: 'navigate'; delta: number }
  | { type: 'back' }
  | { type: 'start_edit'; blockId: string; content: string }
  | { type: 'edit_submit'; blockId: string; content: string }
  | { type: 'edit_change'; content: string };

interface CanvasBrowserProps {
  state: CanvasBrowserState;
  onAction: (action: CanvasBrowserAction) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEWPORT_SIZE = 15;

const TYPE_ICONS: Record<string, string> = {
  pin: '\u{1F4CC}',         // 📌
  text: '\u{1F4AC}',        // 💬
  tool_call: '\u{1F527}',   // 🔧
  tool_result: '\u{1F4CB}', // 📋
  think: '\u{1F4AD}',       // 💭
  user_message: '\u{1F464}', // 👤
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}

function getTypeIcon(type: string): string {
  return TYPE_ICONS[type] ?? '\u{2753}'; // ❓
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'pin': return 'pin      ';
    case 'text': return 'text     ';
    case 'tool_call': return 'tool_call';
    case 'tool_result': return 'tool_res ';
    case 'think': return 'think    ';
    case 'user_message': return 'user_msg ';
    default: return type.padEnd(9);
  }
}

// ---------------------------------------------------------------------------
// List Mode
// ---------------------------------------------------------------------------

function ListView({ state, onAction }: CanvasBrowserProps): React.JSX.Element {
  const { snapshot, selectedIndex } = state;
  const blocks = snapshot.blocks;

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
    if (key.return && blocks.length > 0) {
      onAction({ type: 'inspect', blockId: blocks[selectedIndex].id });
      return;
    }
    if (blocks.length === 0) return;
    const selected = blocks[selectedIndex];
    switch (input) {
      case 'f':
        if (selected.foldable && !selected.folded && !selected.pinned) {
          onAction({ type: 'fold', blockId: selected.id });
        }
        break;
      case 'u':
        if (selected.folded && selected.hasOriginal) {
          onAction({ type: 'unfold', blockId: selected.id });
        }
        break;
      case 'd':
        onAction({ type: 'delete', blockId: selected.id });
        break;
      case 'e':
        onAction({ type: 'inspect', blockId: selected.id });
        // We go through inspect first — edit is triggered from there
        break;
    }
  });

  // Compute viewport window
  let viewStart = state.scrollOffset;
  if (selectedIndex < viewStart) viewStart = selectedIndex;
  if (selectedIndex >= viewStart + VIEWPORT_SIZE) viewStart = selectedIndex - VIEWPORT_SIZE + 1;

  const viewEnd = Math.min(blocks.length, viewStart + VIEWPORT_SIZE);
  const visibleBlocks = blocks.slice(viewStart, viewEnd);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.canvasBrowserBorder ?? theme.border}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Header */}
      <Text color={theme.canvasBrowserHeader ?? theme.permissionHeader} bold>
        {` Canvas Browser (${snapshot.blockCount} blocks, ${formatTokens(snapshot.totalTokens)} tokens) `}
      </Text>

      {/* Block list */}
      {blocks.length === 0 ? (
        <Box marginTop={1}>
          <Text color={theme.dimText}>No blocks in canvas.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={0}>
          {visibleBlocks.map((block, viewIdx) => {
            const realIdx = viewStart + viewIdx;
            const isSelected = realIdx === selectedIndex;
            return (
              <BlockRow
                key={block.id}
                block={block}
                index={realIdx}
                isSelected={isSelected}
              />
            );
          })}
          {/* Scroll indicators */}
          {viewStart > 0 && (
            <Text color={theme.dimText}>  ... {viewStart} more above</Text>
          )}
          {viewEnd < blocks.length && (
            <Text color={theme.dimText}>  ... {blocks.length - viewEnd} more below</Text>
          )}
        </Box>
      )}

      {/* Keybindings help */}
      <Box marginTop={1}>
        <Text color={theme.dimText}>
          {'↑↓ Navigate  '}
        </Text>
        <Text color={theme.toolSuccess}>f</Text>
        <Text color={theme.dimText}>{' Fold  '}</Text>
        <Text color={theme.toolName}>u</Text>
        <Text color={theme.dimText}>{' Unfold  '}</Text>
        <Text color={theme.toolError}>d</Text>
        <Text color={theme.dimText}>{' Delete  '}</Text>
        <Text color={theme.promptText}>Enter</Text>
        <Text color={theme.dimText}>{' Inspect  '}</Text>
        <Text color={theme.dimText}>Esc Close</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Block Row
// ---------------------------------------------------------------------------

function BlockRow({
  block,
  index,
  isSelected,
}: {
  block: CanvasBlockSummary;
  index: number;
  isSelected: boolean;
}): React.JSX.Element {
  const marker = isSelected ? '> ' : '  ';
  const num = String(index + 1).padStart(2, '0');
  const icon = getTypeIcon(block.type);
  const label = getTypeLabel(block.type);
  const tokens = formatTokens(block.tokens).padStart(5);
  let preview = block.preview.replace(/[\n\r]+/g, ' ').slice(0, 50);

  // Visual indicators
  const indicators: string[] = [];
  if (block.pinned) indicators.push('\u{1F4CC}'); // 📌
  if (block.folded) indicators.push('\u{1F512}'); // 🔒

  const indicatorStr = indicators.length > 0 ? indicators.join('') + ' ' : '';

  const dimColor = block.folded ? theme.dimText : undefined;

  return (
    <Box>
      <Text
        color={isSelected ? (theme.canvasBrowserSelected ?? theme.promptText) : undefined}
        bold={isSelected}
        dimColor={block.folded && !isSelected}
      >
        {marker}[{num}] {icon} {label} {tokens}  {indicatorStr}{preview}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Inspect Mode
// ---------------------------------------------------------------------------

function InspectView({ state, onAction }: CanvasBrowserProps): React.JSX.Element {
  const { inspectBlockId, inspectContent, snapshot, selectedIndex } = state;
  const block = snapshot.blocks.find(b => b.id === inspectBlockId);
  const blockType = block?.type ?? 'unknown';
  const tokens = block ? formatTokens(block.tokens) : '?';

  useInput((input, key) => {
    if (key.escape) {
      onAction({ type: 'back' });
      return;
    }
    if (input === 'e' && inspectBlockId && inspectContent !== undefined) {
      onAction({ type: 'start_edit', blockId: inspectBlockId, content: inspectContent });
      return;
    }
  });

  // Truncate long content for display (max ~30 lines)
  const lines = (inspectContent ?? '').split('\n');
  const maxLines = 30;
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;
  const displayContent = displayLines.join('\n') + (truncated ? `\n... (${lines.length - maxLines} more lines)` : '');

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.canvasBrowserBorder ?? theme.border}
      paddingLeft={1}
      paddingRight={1}
    >
      <Text color={theme.canvasBrowserHeader ?? theme.permissionHeader} bold>
        {` Inspect: [${String(selectedIndex + 1).padStart(2, '0')}] ${blockType} (${tokens} tokens) `}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text wrap="wrap">{displayContent}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.dimText}>Esc Back  </Text>
        <Text color={theme.toolName}>e</Text>
        <Text color={theme.dimText}> Edit</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Edit Mode
// ---------------------------------------------------------------------------

function EditView({ state, onAction }: CanvasBrowserProps): React.JSX.Element {
  const { editBlockId, editContent, selectedIndex } = state;
  const block = state.snapshot.blocks.find(b => b.id === editBlockId);
  const blockType = block?.type ?? 'unknown';

  useInput((input, key) => {
    if (key.escape) {
      onAction({ type: 'back' });
      return;
    }
  }, { isActive: false }); // Disabled because TextInput handles keys

  const handleSubmit = (value: string): void => {
    if (editBlockId) {
      onAction({ type: 'edit_submit', blockId: editBlockId, content: value });
    }
  };

  const handleChange = (value: string): void => {
    onAction({ type: 'edit_change', content: value });
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.canvasBrowserBorder ?? theme.border}
      paddingLeft={1}
      paddingRight={1}
    >
      <Text color={theme.canvasBrowserHeader ?? theme.permissionHeader} bold>
        {` Edit: [${String(selectedIndex + 1).padStart(2, '0')}] ${blockType} `}
      </Text>

      <Box marginTop={1}>
        <Text color={theme.promptMarker}>{'>  '}</Text>
        <TextInput
          value={editContent ?? ''}
          onChange={handleChange}
          onSubmit={handleSubmit}
        />
      </Box>

      <Box marginTop={1}>
        <Text color={theme.dimText}>Enter Save  Esc Cancel</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const CanvasBrowser = memo(function CanvasBrowser({
  state,
  onAction,
}: CanvasBrowserProps): React.JSX.Element {
  switch (state.mode) {
    case 'inspect':
      return <InspectView state={state} onAction={onAction} />;
    case 'edit':
      return <EditView state={state} onAction={onAction} />;
    case 'list':
    default:
      return <ListView state={state} onAction={onAction} />;
  }
});
