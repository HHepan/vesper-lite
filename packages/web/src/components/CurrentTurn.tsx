// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — CurrentTurn (streaming tail + blinking cursor)
//
// Mirrors TUI's CurrentTurnView: ● Response header + TreeContent for text,
// streaming cursor inside the tree border.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo, useMemo } from 'react';
import type { TimelineItem } from '../store.js';
import { TimelineItemView } from './TimelineItem.js';
import { TreeContent } from './TreeContent.js';
import { ToolGroup } from './ToolGroup.js';
import { groupTimelineItems } from '../lib/group-tools.js';
import { theme } from '../theme.js';
import { renderMarkdown } from '../lib/markdown.js';

interface CurrentTurnProps {
  timeline: TimelineItem[];
  lastError: string | null;
  status: string;
  onToggleTool?: (id: string) => void;
  onToggleThinking?: (id: string) => void;
}

const StreamingMarkdown = memo(function StreamingMarkdown({ content }: { content: string }) {
  const html = useMemo(() => {
    const rendered = renderMarkdown(content);
    const cursor = `<span class="tui-cursor" style="color:${theme.streamingCursor}">█</span>`;
    return rendered + cursor;
  }, [content]);

  return (
    <div
      style={styles.textContent}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export const CurrentTurn = memo(function CurrentTurn({
  timeline,
  lastError,
  status,
  onToggleTool,
  onToggleThinking,
}: CurrentTurnProps) {
  const isStreaming = status === 'streaming';
  const lastItem = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const trailingTextId = isStreaming && lastItem?.kind === 'text' ? lastItem.entry.id : null;

  const grouped = useMemo(() => groupTimelineItems(timeline), [timeline]);

  return (
    <div>
      {grouped.map((item) => {
        // Group of consecutive tool calls
        if (item.kind === 'tool_group') {
          return (
            <ToolGroup
              key={item.id}
              entries={item.entries}
              onToggleTool={onToggleTool}
            />
          );
        }

        // Streaming text: custom rendering with cursor inside TreeContent
        if (item.kind === 'text' && item.entry.id === trailingTextId) {
          return (
            <div key={item.entry.id} style={{ marginBottom: '0.5em' }}>
              <div style={{ paddingLeft: '0.5ch' }}>
                <span style={{ color: theme.assistantDot }}>●</span>
              </div>
              <TreeContent>
                <StreamingMarkdown content={item.entry.content} />
              </TreeContent>
            </div>
          );
        }

        // All other items: delegate to TimelineItemView
        return (
          <TimelineItemView
            key={item.entry.id}
            item={item}
            onToggleTool={onToggleTool}
            onToggleThinking={onToggleThinking}
          />
        );
      })}

      {/* Error display */}
      {lastError && (
        <div style={styles.error}>
          <span style={{ color: theme.errorDot }}>● </span>
          <span style={{ color: theme.errorText }}>{lastError}</span>
        </div>
      )}
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  textContent: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  error: {
    padding: '0.25em 0',
    paddingLeft: '0.5ch',
    marginBottom: '0.5em',
  },
};
