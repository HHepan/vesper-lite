// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — FrozenTimeline (completed items, memo'd for performance)
//
// Equivalent to TUI's <Static> zone. Items are rendered once and never
// re-rendered (via React.memo + stable keys).
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import type { TimelineItem } from '../store.js';
import { TimelineItemView } from './TimelineItem.js';
import { theme } from '../theme.js';

interface FrozenTimelineProps {
  items: TimelineItem[];
  onToggleTool?: (id: string) => void;
  onToggleThinking?: (id: string) => void;
}

/** Individual frozen item — memoized so it never re-renders. */
const FrozenItem = memo(function FrozenItem({
  item,
  onToggleTool,
  onToggleThinking,
}: {
  item: TimelineItem;
  onToggleTool?: (id: string) => void;
  onToggleThinking?: (id: string) => void;
}) {
  return (
    <TimelineItemView
      item={item}
      onToggleTool={onToggleTool}
      onToggleThinking={onToggleThinking}
    />
  );
});

export const FrozenTimeline = memo(function FrozenTimeline({
  items,
  onToggleTool,
  onToggleThinking,
}: FrozenTimelineProps) {
  if (items.length === 0) return null;

  return (
    <div>
      {items.map((item) => (
        <FrozenItem
          key={item.entry.id}
          item={item}
          onToggleTool={onToggleTool}
          onToggleThinking={onToggleThinking}
        />
      ))}
    </div>
  );
});
