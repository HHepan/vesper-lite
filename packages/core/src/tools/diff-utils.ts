// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Diff Utilities (structured diff hunks for TUI rendering)
// ═══════════════════════════════════════════════════════════════════════════

import { structuredPatch, diffWordsWithSpace } from 'diff';
import type { DiffHunk, DiffHunkLine } from '@vesper/shared';

const MAX_OLD_FILE_SIZE = 512 * 1024; // 512KB
const MAX_DIFF_LINES = 500;

export function computeDiffHunks(
  oldContent: string,
  newContent: string,
  filePath: string,
  contextLines = 3,
): { hunks: DiffHunk[]; linesAdded: number; linesRemoved: number } | null {
  const patch = structuredPatch(filePath, filePath, oldContent, newContent, '', '', { context: contextLines });

  let linesAdded = 0;
  let linesRemoved = 0;
  let totalDiffLines = 0;

  const hunks: DiffHunk[] = patch.hunks.map(h => {
    const lines: DiffHunkLine[] = h.lines.map(line => {
      const type = line[0] as '+' | '-' | ' ';
      if (type === '+') linesAdded++;
      if (type === '-') linesRemoved++;
      totalDiffLines++;
      return { type, content: line.substring(1) };
    });
    return {
      oldStart: h.oldStart,
      oldCount: h.oldLines,
      newStart: h.newStart,
      newCount: h.newLines,
      lines,
    };
  });

  // Skip meta if diff is too large (prevents wire protocol bloat)
  if (totalDiffLines > MAX_DIFF_LINES) {
    return null;
  }

  // Compute word-level highlights for paired -/+ lines
  for (const hunk of hunks) {
    computeWordHighlights(hunk.lines);
  }

  return { hunks, linesAdded, linesRemoved };
}

/**
 * Compute word-level highlight ranges for paired -/+ lines within a hunk.
 * Mutates the lines in place, adding `highlights` arrays where applicable.
 */
function computeWordHighlights(lines: DiffHunkLine[]): void {
  let i = 0;
  while (i < lines.length) {
    // Find a consecutive block of '-' lines
    const removeStart = i;
    while (i < lines.length && lines[i]!.type === '-') i++;
    const removeEnd = i;

    // Find the immediately following block of '+' lines
    const addStart = i;
    while (i < lines.length && lines[i]!.type === '+') i++;
    const addEnd = i;

    const removeCount = removeEnd - removeStart;
    const addCount = addEnd - addStart;

    // Only process if we have both removes and adds (paired block)
    if (removeCount > 0 && addCount > 0) {
      const pairCount = Math.min(removeCount, addCount);
      for (let p = 0; p < pairCount; p++) {
        const removeLine = lines[removeStart + p]!;
        const addLine = lines[addStart + p]!;

        // Skip if content is identical (whitespace-only diff edge case)
        if (removeLine.content === addLine.content) continue;

        const changes = diffWordsWithSpace(removeLine.content, addLine.content);

        // Check if entire content changed (no common parts) → skip highlights
        const hasCommon = changes.some(c => !c.added && !c.removed);
        if (!hasCommon) continue;

        const removeHighlights: Array<[number, number]> = [];
        const addHighlights: Array<[number, number]> = [];
        let removePos = 0;
        let addPos = 0;

        for (const change of changes) {
          const len = change.value.length;
          if (change.removed) {
            removeHighlights.push([removePos, removePos + len]);
            removePos += len;
          } else if (change.added) {
            addHighlights.push([addPos, addPos + len]);
            addPos += len;
          } else {
            // Common text — advance both positions
            removePos += len;
            addPos += len;
          }
        }

        if (removeHighlights.length > 0) removeLine.highlights = removeHighlights;
        if (addHighlights.length > 0) addLine.highlights = addHighlights;
      }
    }

    // Skip context lines
    if (i === removeEnd && i === addStart && addEnd === addStart) {
      // No + block found, advance past non-changed lines
      while (i < lines.length && lines[i]!.type === ' ') i++;
      if (i === removeEnd) i++; // safety: advance at least 1 to avoid infinite loop
    } else if (i < lines.length && lines[i]!.type === ' ') {
      while (i < lines.length && lines[i]!.type === ' ') i++;
    }
  }
}

export function isWithinDiffLimit(content: string): boolean {
  return content.length <= MAX_OLD_FILE_SIZE;
}
