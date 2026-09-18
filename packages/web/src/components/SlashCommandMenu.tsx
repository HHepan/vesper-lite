// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — SlashCommandMenu (TUI style autocomplete)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useRef, useEffect } from 'react';
import { theme } from '../theme.js';
import type { SlashCommandDef } from '../slash-commands.js';

interface SlashCommandMenuProps {
  commands: SlashCommandDef[];
  highlightIndex: number;
  onSelect?: (cmd: SlashCommandDef) => void;
}

export const SlashCommandMenu = memo(function SlashCommandMenu({ commands, highlightIndex, onSelect }: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Auto-scroll to keep highlighted item visible
  useEffect(() => {
    const highlightedItem = itemRefs.current[highlightIndex];
    const menu = menuRef.current;
    if (!highlightedItem || !menu) return;

    const menuRect = menu.getBoundingClientRect();
    const itemRect = highlightedItem.getBoundingClientRect();

    // If item is below visible area, scroll down
    if (itemRect.bottom > menuRect.bottom) {
      highlightedItem.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
    // If item is above visible area, scroll up
    else if (itemRect.top < menuRect.top) {
      highlightedItem.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [highlightIndex]);

  return (
    <div ref={menuRef} style={styles.menu}>
      {commands.map((cmd, i) => {
        const isHighlighted = i === highlightIndex;
        return (
          <div
            key={cmd.name}
            ref={el => { itemRefs.current[i] = el; }}
            style={{
              ...styles.item,
              background: isHighlighted ? theme.autocompleteHighlight : 'transparent',
            }}
            onClick={() => onSelect?.(cmd)}
          >
            <span style={{ color: theme.autocompleteCommand }}>/{cmd.name}</span>
            {cmd.argHint && (
              <span style={{ color: theme.dimText, marginLeft: '1ch' }}>{cmd.argHint}</span>
            )}
            <span style={{ color: theme.autocompleteDescription, marginLeft: '2ch' }}>
              {cmd.description}
            </span>
          </div>
        );
      })}
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  menu: {
    borderLeft: '1px solid var(--border-color)',
    maxHeight: '300px',  // Limit max height
    overflowY: 'auto',   // Enable vertical scrolling
  },
  item: {
    padding: '0.3em 1ch',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    minHeight: '2em',
    display: 'flex',
    alignItems: 'center',
    touchAction: 'manipulation',
  },
};
