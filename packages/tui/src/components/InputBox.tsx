// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Input Box Component (CC-style)
//
// Uses ink-text-input for cursor editing (left/right, insert, delete).
// Handles history navigation (up/down), Ctrl+C via useInput, and
// slash-command autocomplete menu when input starts with '/'.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '../theme.js';
import { filterCommands } from '../slash-commands.js';
import { SlashCommandMenu } from './SlashCommandMenu.js';

interface Props {
  onSubmit: (input: string) => void;
  onEscape?: () => void;
  disabled: boolean;
  inputHistory?: string[];
}

export const InputBox = React.memo(function InputBox({ onSubmit, onEscape, disabled, inputHistory = [] }: Props): React.JSX.Element {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const savedBufferRef = useRef('');

  // Menu is open when typing a slash command prefix (no space yet, not browsing history)
  const menuOpen = !disabled && value.startsWith('/') && !value.includes(' ') && historyIndex === -1;

  // Filter commands based on current prefix (without leading '/')
  const filteredCommands = useMemo(() => {
    if (!menuOpen) return [];
    return filterCommands(value.slice(1));
  }, [menuOpen, value]);

  const hasMenuItems = menuOpen && filteredCommands.length > 0;

  const handleChange = useCallback((newValue: string) => {
    setValue(newValue);
    setHistoryIndex(-1);
    setHighlightIndex(0);
  }, []);

  // Ref to let handleSubmit know whether menu is active (avoids stale closure)
  const menuRef = useRef<{ hasItems: boolean; commands: typeof filteredCommands; highlight: number }>({
    hasItems: false, commands: [], highlight: 0,
  });
  menuRef.current = { hasItems: hasMenuItems, commands: filteredCommands, highlight: highlightIndex };

  const handleSubmit = useCallback((submitted: string) => {
    const menu = menuRef.current;

    // Menu open + Enter → accept highlighted command
    if (menu.hasItems) {
      const cmd = menu.commands[Math.min(menu.highlight, menu.commands.length - 1)];
      if (cmd) {
        if (cmd.argHint) {
          // Command needs args → fill input + trailing space, don't submit
          setValue('/' + cmd.name + ' ');
          setHighlightIndex(0);
        } else {
          // No args → submit immediately
          onSubmit('/' + cmd.name);
          setValue('');
          setHistoryIndex(-1);
          setHighlightIndex(0);
          savedBufferRef.current = '';
        }
        return;
      }
    }

    const trimmed = submitted.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setValue('');
      setHistoryIndex(-1);
      setHighlightIndex(0);
      savedBufferRef.current = '';
    }
  }, [onSubmit]);

  // Handle Escape (interrupt) + history/menu navigation (not handled by TextInput)
  // Note: Ctrl+C is handled at the App level (top-level useInput) so it works
  // regardless of InputBox disabled state. See ink-app.tsx.
  useInput(useCallback((input: string, key: import('ink').Key) => {
    // Escape = interrupt flow, but only when not disabled (permission dialog owns Escape)
    if (key.escape && !disabled) {
      onEscape?.();
      return;
    }

    if (disabled) return;

    // Tab = accept highlighted command when menu is open
    if (key.tab && hasMenuItems) {
      const cmd = filteredCommands[highlightIndex];
      if (cmd) {
        // Fill input with command; add trailing space if command accepts args
        const filled = '/' + cmd.name + (cmd.argHint ? ' ' : '');
        setValue(filled);
        setHighlightIndex(0);
      }
      return;
    }

    if (key.upArrow) {
      if (hasMenuItems) {
        // Navigate menu (wrap around)
        setHighlightIndex((prev) =>
          prev <= 0 ? filteredCommands.length - 1 : prev - 1
        );
        return;
      }
      // History navigation
      if (inputHistory.length === 0) return;
      if (historyIndex === -1) {
        savedBufferRef.current = value;
        const newIdx = inputHistory.length - 1;
        setHistoryIndex(newIdx);
        setValue(inputHistory[newIdx]!);
      } else if (historyIndex > 0) {
        const newIdx = historyIndex - 1;
        setHistoryIndex(newIdx);
        setValue(inputHistory[newIdx]!);
      }
      return;
    }

    if (key.downArrow) {
      if (hasMenuItems) {
        // Navigate menu (wrap around)
        setHighlightIndex((prev) =>
          prev >= filteredCommands.length - 1 ? 0 : prev + 1
        );
        return;
      }
      // History navigation
      if (historyIndex === -1) return;
      if (historyIndex < inputHistory.length - 1) {
        const newIdx = historyIndex + 1;
        setHistoryIndex(newIdx);
        setValue(inputHistory[newIdx]!);
      } else {
        setHistoryIndex(-1);
        setValue(savedBufferRef.current);
        savedBufferRef.current = '';
      }
      return;
    }
  }, [onEscape, disabled, inputHistory, historyIndex, value, hasMenuItems, filteredCommands, highlightIndex]));

  // Clamp highlight index when filtered list shrinks
  const clampedHighlight = hasMenuItems
    ? Math.min(highlightIndex, filteredCommands.length - 1)
    : 0;

  if (disabled) {
    return (
      <Box>
        <Text color={theme.dimText} dimColor>{'> ...'}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.promptMarker}>{'> '}</Text>
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          showCursor
        />
      </Box>
      {hasMenuItems && (
        <SlashCommandMenu commands={filteredCommands} highlightIndex={clampedHighlight} />
      )}
    </Box>
  );
});
