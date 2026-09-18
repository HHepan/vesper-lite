import type { TimelineItem, ToolCallEntry } from '../store.js';

export type GroupedTimelineItem =
  | TimelineItem
  | { kind: 'tool_group'; id: string; entries: ToolCallEntry[] };

/**
 * Groups consecutive tool calls in a timeline if there are >= threshold (default 3).
 * Keeps non-tool items and isolated (< threshold) tool calls intact.
 */
export function groupTimelineItems(
  items: TimelineItem[],
  threshold = 3
): GroupedTimelineItem[] {
  const result: GroupedTimelineItem[] = [];
  let currentGroup: ToolCallEntry[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 0) return;

    if (currentGroup.length >= threshold) {
      result.push({
        kind: 'tool_group',
        id: `group-${currentGroup[0].id}`,
        entries: [...currentGroup],
      });
    } else {
      for (const entry of currentGroup) {
        result.push({ kind: 'tool', entry });
      }
    }
    currentGroup = [];
  };

  for (const item of items) {
    if (item.kind === 'tool') {
      currentGroup.push(item.entry as ToolCallEntry);
    } else {
      flushGroup();
      result.push(item);
    }
  }

  flushGroup();
  return result;
}
