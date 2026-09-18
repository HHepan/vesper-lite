// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Canvas Browser Component
//
// Interactive modal for browsing/managing canvas blocks (DOM port of TUI).
// Three modes: list (browse), inspect (view full), edit (modify content).
// Keyboard-driven: ↑↓ navigate, f fold, u unfold, d delete, Enter inspect,
//                  e edit, Esc close/back.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useEffect, useCallback, useRef } from 'react';
import type { CanvasBrowserState, CanvasBlockSummary } from '../store.js';
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
  | { type: 'navigate_top' }
  | { type: 'navigate_bottom' }
  | { type: 'fold_all_tool_calls' }
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

/** Delay before repeat starts (ms) */
const REPEAT_DELAY = 400;
/** Interval between repeats (ms) */
const REPEAT_INTERVAL = 100;

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
// useRepeatPress — fires action on press, then repeats while held down
// ---------------------------------------------------------------------------

function useRepeatPress(action: () => void): {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;

  const stop = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    actionRef.current();
    stop();
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => actionRef.current(), REPEAT_INTERVAL);
    }, REPEAT_DELAY);
  }, [stop]);

  return { onPointerDown, onPointerUp: stop, onPointerLeave: stop };
}

// ---------------------------------------------------------------------------
// List Mode
// ---------------------------------------------------------------------------

function ListView({ state, onAction }: CanvasBrowserProps): React.JSX.Element {
  const { snapshot, selectedIndex } = state;
  const blocks = snapshot.blocks;

  const navigateUp = useRepeatPress(() => onAction({ type: 'navigate', delta: -1 }));
  const navigateDown = useRepeatPress(() => onAction({ type: 'navigate', delta: 1 }));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Stop propagation so canvas browser captures all keys exclusively
      e.stopPropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        onAction({ type: 'close' });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onAction({ type: 'navigate', delta: -1 });
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onAction({ type: 'navigate', delta: 1 });
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        onAction({ type: 'navigate_top' });
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        onAction({ type: 'navigate_bottom' });
        return;
      }
      if (e.key === 'Enter' && blocks.length > 0) {
        e.preventDefault();
        onAction({ type: 'inspect', blockId: blocks[selectedIndex].id });
        return;
      }
      if (blocks.length === 0) return;
      const selected = blocks[selectedIndex];
      switch (e.key) {
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
          break;
      }
    };

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [blocks, selectedIndex, onAction]);

  // Compute viewport window
  let viewStart = state.scrollOffset;
  if (selectedIndex < viewStart) viewStart = selectedIndex;
  if (selectedIndex >= viewStart + VIEWPORT_SIZE) viewStart = selectedIndex - VIEWPORT_SIZE + 1;

  const viewEnd = Math.min(blocks.length, viewStart + VIEWPORT_SIZE);
  const visibleBlocks = blocks.slice(viewStart, viewEnd);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={{ ...styles.header, color: theme.canvasBrowserHeader }}>
        Canvas Browser ({snapshot.blockCount} blocks, {formatTokens(snapshot.totalTokens)} tokens)
      </div>

      {/* Block list */}
      {blocks.length === 0 ? (
        <div style={{ padding: '0.5em 1ch', color: theme.dimText }}>
          No blocks in canvas.
        </div>
      ) : (
        <div style={styles.blockList}>
          {visibleBlocks.map((block, viewIdx) => {
            const realIdx = viewStart + viewIdx;
            const isSelected = realIdx === selectedIndex;
            return (
              <BlockRow
                key={block.id}
                block={block}
                index={realIdx}
                isSelected={isSelected}
                onClick={() => {
                  // First tap selects, second tap (when already selected) inspects
                  if (isSelected) {
                    onAction({ type: 'inspect', blockId: block.id });
                  } else {
                    onAction({ type: 'navigate', delta: realIdx - selectedIndex });
                  }
                }}
              />
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div style={styles.actionBar}>
        {/* Left: navigation */}
        <div style={styles.actionGroup}>
          {blocks.length > 1 && (
            <>
              <button
                style={{ ...styles.actionBtn, ...styles.navBtn }}
                disabled={selectedIndex <= 0}
                {...navigateUp}
                title="Previous block (Home: jump to top)"
              >
                ▲
              </button>
              <button
                style={{ ...styles.actionBtn, ...styles.navBtn }}
                disabled={selectedIndex >= blocks.length - 1}
                {...navigateDown}
                title="Next block (End: jump to bottom)"
              >
                ▼
              </button>
            </>
          )}
        </div>
        {/* Center: batch actions */}
        <div style={styles.actionGroup}>
          {(() => {
            const toolCallBlocks = blocks.filter(b => b.type === 'tool_call' && b.foldable && !b.folded && !b.pinned);
            return toolCallBlocks.length > 0 && (
              <button
                style={{ ...styles.actionBtn, color: theme.toolSuccess }}
                title="Fold all tool_call blocks"
                onClick={() => onAction({ type: 'fold_all_tool_calls' })}
              >
                🔧 Fold All
              </button>
            );
          })()}
        </div>
        {/* Right: actions */}
        <div style={styles.actionGroup}>
          {blocks.length > 0 && (() => {
            const selected = blocks[selectedIndex];
            return (
              <>
                <button
                  style={styles.actionBtn}
                  onClick={() => onAction({ type: 'inspect', blockId: selected.id })}
                >
                  Inspect
                </button>
                {selected.foldable && !selected.folded && !selected.pinned && (
                  <button
                    style={{ ...styles.actionBtn, color: theme.toolSuccess }}
                    onClick={() => onAction({ type: 'fold', blockId: selected.id })}
                  >
                    [f] Fold
                  </button>
                )}
                {selected.folded && selected.hasOriginal && (
                  <button
                    style={{ ...styles.actionBtn, color: theme.toolName }}
                    onClick={() => onAction({ type: 'unfold', blockId: selected.id })}
                  >
                    [u] Unfold
                  </button>
                )}
                <button
                  style={{ ...styles.actionBtn, color: theme.toolError }}
                  onClick={() => onAction({ type: 'delete', blockId: selected.id })}
                >
                  [d] Delete
                </button>
              </>
            );
          })()}
          <button
            style={styles.actionBtn}
            onClick={() => onAction({ type: 'close' })}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block Row
// ---------------------------------------------------------------------------

interface BlockRowProps {
  block: CanvasBlockSummary;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}

function BlockRow({ block, index, isSelected, onClick }: BlockRowProps): React.JSX.Element {
  const num = String(index + 1).padStart(2, '0');
  const icon = getTypeIcon(block.type);
  const label = getTypeLabel(block.type);
  const tokens = formatTokens(block.tokens).padStart(5);
  const preview = block.preview.replace(/[\n\r]+/g, ' ').slice(0, 50);

  // Visual indicators
  const indicators: string[] = [];
  if (block.pinned) indicators.push('\u{1F4CC}'); // 📌
  if (block.folded) indicators.push('\u{1F512}'); // 🔒

  const indicatorStr = indicators.length > 0 ? indicators.join('') + ' ' : '';

  const rowStyle: React.CSSProperties = {
    whiteSpace: 'pre',
    fontFamily: 'inherit',
    color: isSelected
      ? (theme.canvasBrowserSelected ?? theme.promptText)
      : block.folded
      ? (theme.canvasBrowserFolded ?? theme.dimText)
      : undefined,
    fontWeight: isSelected ? 'bold' : undefined,
    backgroundColor: isSelected ? theme.autocompleteHighlight : undefined,
    padding: '0.3em 1ch',
    cursor: 'pointer',
    touchAction: 'manipulation',
    minHeight: '2em',
    display: 'flex',
    alignItems: 'center',
  };

  return (
    <div style={rowStyle} onClick={onClick}>
      <span style={styles.marker}>{isSelected ? '>' : '\u00A0'}</span>
      [{num}] {icon} {label} {tokens}  {indicatorStr}{preview}
    </div>
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        onAction({ type: 'back' });
        return;
      }
      if (e.key === 'e' && inspectBlockId && inspectContent !== undefined) {
        e.preventDefault();
        onAction({ type: 'start_edit', blockId: inspectBlockId, content: inspectContent });
        return;
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [inspectBlockId, inspectContent, onAction]);

  // Truncate long content (max ~30 lines)
  const lines = (inspectContent ?? '').split('\n');
  const maxLines = 30;
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;
  const displayContent = displayLines.join('\n') + (truncated ? `\n... (${lines.length - maxLines} more lines)` : '');

  return (
    <div style={styles.container}>
      <div style={{ ...styles.header, color: theme.canvasBrowserHeader }}>
        Inspect: [{String(selectedIndex + 1).padStart(2, '0')}] {blockType} ({tokens} tokens)
      </div>

      <div style={styles.inspectContent}>
        <pre style={styles.pre}>{displayContent}</pre>
      </div>

      <div style={styles.actionBar}>
        <button
          style={styles.actionBtn}
          onClick={() => onAction({ type: 'back' })}
        >
          Back
        </button>
        {inspectBlockId && inspectContent !== undefined && (
          <button
            style={{ ...styles.actionBtn, color: theme.toolName }}
            onClick={() => onAction({ type: 'start_edit', blockId: inspectBlockId, content: inspectContent })}
          >
            [e] Edit
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Mode
// ---------------------------------------------------------------------------

function EditView({ state, onAction }: CanvasBrowserProps): React.JSX.Element {
  const { editBlockId, editContent, selectedIndex } = state;
  const block = state.snapshot.blocks.find(b => b.id === editBlockId);
  const blockType = block?.type ?? 'unknown';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      onAction({ type: 'back' });
      return;
    }
    // Ctrl+Enter or Meta+Enter to submit
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (editBlockId && editContent !== undefined) {
        onAction({ type: 'edit_submit', blockId: editBlockId, content: editContent });
      }
      return;
    }
  }, [editBlockId, editContent, onAction]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onAction({ type: 'edit_change', content: e.target.value });
  }, [onAction]);

  return (
    <div style={styles.container}>
      <div style={{ ...styles.header, color: theme.canvasBrowserHeader }}>
        Edit: [{String(selectedIndex + 1).padStart(2, '0')}] {blockType}
      </div>

      <div style={{ padding: '0.5em 1ch' }}>
        <textarea
          ref={textareaRef}
          value={editContent ?? ''}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          style={styles.textarea}
          rows={15}
        />
      </div>

      <div style={styles.actionBar}>
        <button
          style={{ ...styles.actionBtn, color: theme.toolSuccess, fontWeight: 'bold' }}
          onClick={() => {
            if (editBlockId && editContent !== undefined) {
              onAction({ type: 'edit_submit', blockId: editBlockId, content: editContent });
            }
          }}
        >
          Save
        </button>
        <button
          style={styles.actionBtn}
          onClick={() => onAction({ type: 'back' })}
        >
          Cancel
        </button>
      </div>
    </div>
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: `1px solid ${theme.canvasBrowserBorder}`,
    borderRadius: '4px',
    margin: '0.5em 1ch',
    padding: '0.5em 0',
    backgroundColor: theme.bgOverlay,
  },
  header: {
    fontWeight: 'bold',
    padding: '0 1ch 0.5em 1ch',
    borderBottom: `1px solid ${theme.canvasBrowserBorder}`,
    marginBottom: '0.25em',
  },
  blockList: {
    display: 'flex',
    flexDirection: 'column',
  },
  actionBar: {
    padding: '0.5em 1ch 0 1ch',
    borderTop: `1px solid ${theme.canvasBrowserBorder}`,
    marginTop: '0.25em',
    display: 'flex',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '0.5em',
  },
  actionGroup: {
    display: 'flex',
    gap: '0.5em',
    flexWrap: 'wrap',
  },
  actionBtn: {
    background: 'transparent',
    border: `1px solid ${theme.border}`,
    borderRadius: '3px',
    padding: '0.4em 1.2ch',
    color: theme.promptText,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    cursor: 'pointer',
    minHeight: '2.2em',
    touchAction: 'manipulation',
  },
  navBtn: {
    padding: '0.4em 1.6ch',
    fontWeight: 'bold',
  },
  marker: {
    display: 'inline-block',
    width: '2ch',
    textAlign: 'center',
    flexShrink: 0,
  },
  inspectContent: {
    padding: '0.5em 1ch',
    maxHeight: '60vh',
    overflowY: 'auto',
  },
  pre: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
  textarea: {
    width: '100%',
    minHeight: '10em',
    backgroundColor: theme.bgPrimary,
    color: theme.promptText,
    border: `1px solid ${theme.canvasBrowserBorder}`,
    borderRadius: '2px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    padding: '0.5em',
    resize: 'vertical',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
};
