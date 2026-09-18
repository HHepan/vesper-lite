// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — AtMentionMenu (@-mention file/folder autocomplete)
//
// Displays search results for file paths when the user types @ in InputBox.
// Follows the same visual style as SlashCommandMenu.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { theme } from '../theme.js';

export interface FileSearchResultItem {
  path: string;
  type: 'file' | 'dir';
  /** Absolute path (cwd + path). Used when inserting into the input box. */
  absolutePath?: string;
}

interface AtMentionMenuProps {
  results: FileSearchResultItem[];
  highlightIndex: number;
  query: string;
  onSelect?: (item: FileSearchResultItem) => void;
}

export const AtMentionMenu = memo(function AtMentionMenu({
  results,
  highlightIndex,
  query,
  onSelect,
}: AtMentionMenuProps) {
  if (results.length === 0) {
    return (
      <div style={styles.menu}>
        <div style={styles.emptyItem}>
          <span style={{ color: theme.dimText }}>
            {query ? `No matches for @${query}` : 'Loading…'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.menu}>
      {results.map((item, i) => {
        const isHighlighted = i === highlightIndex;
        const icon = item.type === 'dir' ? '📁' : '📄';
        const parts = item.path.split('/');
        const fileName = parts.pop() ?? '';
        const dirPrefix = parts.length > 0 ? parts.join('/') + '/' : '';

        return (
          <div
            key={item.path}
            style={{
              ...styles.item,
              background: isHighlighted ? theme.autocompleteHighlight : 'transparent',
            }}
            onClick={() => onSelect?.(item)}
          >
            <span style={styles.icon}>{icon}</span>
            {dirPrefix && (
              <span style={{ color: theme.dimText }}>{dirPrefix}</span>
            )}
            <span style={{ color: theme.autocompleteCommand }}>{fileName}</span>
            {item.type === 'dir' && (
              <span style={{ color: theme.dimText }}>/</span>
            )}
          </div>
        );
      })}
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  menu: {
    borderLeft: '1px solid var(--border-color)',
    marginLeft: '2ch',
    paddingLeft: '1ch',
    maxHeight: '16em',
    overflowY: 'auto',
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
  emptyItem: {
    padding: '0.3em 1ch',
    minHeight: '2em',
    display: 'flex',
    alignItems: 'center',
  },
  icon: {
    marginRight: '0.8ch',
    fontSize: '0.9em',
    flexShrink: 0,
  },
};
