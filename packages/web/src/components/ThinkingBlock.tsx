// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — ThinkingBlock (TUI style: ● yellow dot + tree border)
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { theme } from '../theme.js';
import { formatElapsed } from '../lib/format-utils.js';
import type { ThinkingEntry } from '../store.js';
import { TreeContent } from './TreeContent.js';
import { subflowContainerStyle, subflowBadgeStyle } from './subflow-styles.js';

interface ThinkingBlockProps {
  entry: ThinkingEntry;
  onToggle?: (id: string) => void;
}

export const ThinkingBlock = memo(function ThinkingBlock({ entry, onToggle }: ThinkingBlockProps) {
  const elapsed = entry.elapsedMs
    ? formatElapsed(entry.elapsedMs)
    : `${Math.floor((Date.now() - entry.startTime) / 1000)}s`;
  const isSubflow = !!entry.subflow;

  return (
    <div style={{
      ...styles.container,
      ...(isSubflow ? subflowContainerStyle : {}),
    }}>
      <div
        style={styles.header}
        onClick={() => onToggle?.(entry.id)}
        role="button"
        tabIndex={0}
      >
        <span style={{ color: theme.thinkingDot }}>● </span>
        {isSubflow && (
          <span style={subflowBadgeStyle}>{entry.subflow!.label}</span>
        )}
        <span style={{ color: theme.thinkingLabel }}>Thinking</span>
        <span style={{ color: theme.dimText }}> ({elapsed})</span>
        <span style={{ color: theme.dimText }}> {entry.collapsed ? '▸' : '▾'}</span>
      </div>
      {!entry.collapsed && (
        <TreeContent color={theme.thinkingDot}>
          <div style={{ color: theme.thinkingContent, whiteSpace: 'pre-wrap' }}>
            {entry.content}
          </div>
        </TreeContent>
      )}
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: '0.5em',
  },
  header: {
    cursor: 'pointer',
    userSelect: 'none',
    paddingLeft: '0.5ch',
  },
};
