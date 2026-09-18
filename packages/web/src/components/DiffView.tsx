// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — DiffView (structured diff rendering with word-level highlights)
//
// Consumes structured DiffHunk[] from meta.diff (same data as TUI).
// Renders line numbers, +/- prefixes, colored backgrounds, word highlights.
// ═══════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { theme } from '../theme.js';
import { escapeHtml } from '../lib/markdown.js';

// ---------------------------------------------------------------------------
// Types (mirrored from @vesper/shared to avoid import issues in Vite dev)
// ---------------------------------------------------------------------------

interface DiffHunkLine {
  type: '+' | '-' | ' ';
  content: string;
  highlights?: Array<[number, number]>;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffHunkLine[];
}

interface DiffMeta {
  type: 'file_write' | 'file_edit';
  filePath: string;
  diff: DiffHunk[];
  created?: boolean;
  linesAdded: number;
  linesRemoved: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// WebUI shows full diff — no truncation (TUI has its own limits for terminal).

// ---------------------------------------------------------------------------
// Word-level highlight rendering
// ---------------------------------------------------------------------------

function renderHighlighted(
  content: string,
  highlights: Array<[number, number]>,
  highlightColor: string,
): string {
  const sorted = [...highlights].sort((a, b) => a[0] - b[0]);
  let result = '';
  let pos = 0;

  for (const [start, end] of sorted) {
    if (pos < start) {
      result += escapeHtml(content.slice(pos, start));
    }
    result += `<span style="background:${highlightColor}">${escapeHtml(content.slice(start, end))}</span>`;
    pos = end;
  }
  if (pos < content.length) {
    result += escapeHtml(content.slice(pos));
  }
  return result;
}

// ---------------------------------------------------------------------------
// DiffView — renders file_write / file_edit structured diff hunks
// ---------------------------------------------------------------------------

interface DiffViewProps {
  meta: DiffMeta;
}

export const DiffView = memo(function DiffView({ meta }: DiffViewProps) {
  const hunks = meta.diff;
  if (!hunks || hunks.length === 0) {
    return <div style={{ color: theme.dimText }}>No changes</div>;
  }

  // Stats line
  const statsFragments: string[] = [];
  if (meta.linesAdded > 0) {
    statsFragments.push(`Added <span style="color:${theme.diffAdded}">${meta.linesAdded}</span> line${meta.linesAdded !== 1 ? 's' : ''}`);
  }
  if (meta.linesRemoved > 0) {
    if (statsFragments.length > 0) statsFragments.push(', ');
    statsFragments.push(`removed <span style="color:${theme.diffRemoved}">${meta.linesRemoved}</span> line${meta.linesRemoved !== 1 ? 's' : ''}`);
  }
  const statsHtml = statsFragments.length > 0 ? statsFragments.join('') : 'no changes';

  // Compute max line number for gutter width
  let maxLineNo = 0;
  for (const hunk of hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.type === '-') {
        maxLineNo = Math.max(maxLineNo, oldLine);
        oldLine++;
      } else if (line.type === '+') {
        maxLineNo = Math.max(maxLineNo, newLine);
        newLine++;
      } else {
        maxLineNo = Math.max(maxLineNo, newLine);
        oldLine++;
        newLine++;
      }
    }
  }
  const gutterWidth = Math.max(String(maxLineNo).length, 3);

  // Render all hunks (no truncation in WebUI)
  let prevHunkEndLine = -1;

  const renderedLines: React.JSX.Element[] = [];

  for (let hi = 0; hi < hunks.length; hi++) {
    const hunk = hunks[hi]!;
    const linesToShow = hunk.lines;

    // Hunk separator (ellipsis between non-contiguous hunks)
    if (hi > 0 && prevHunkEndLine >= 0 && hunk.newStart > prevHunkEndLine + 1) {
      renderedLines.push(
        <div key={`sep-${hi}`} style={{ ...styles.line, color: theme.dimText }}>{'  ...'}</div>
      );
    }

    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (let li = 0; li < linesToShow.length; li++) {
      const line = linesToShow[li]!;
      let lineNo: number;
      let prefix: string;

      if (line.type === '-') {
        lineNo = oldLine;
        prefix = '-';
        oldLine++;
      } else if (line.type === '+') {
        lineNo = newLine;
        prefix = '+';
        newLine++;
      } else {
        lineNo = newLine;
        prefix = ' ';
        oldLine++;
        newLine++;
      }

      const lineNoStr = String(lineNo).padStart(gutterWidth);
      const gutter = `${lineNoStr} ${prefix} `;
      const key = `h${hi}-l${li}`;

      if (line.type === '+') {
        const contentHtml = line.highlights
          ? renderHighlighted(line.content, line.highlights, theme.diffAddedHighlight)
          : escapeHtml(line.content);
        renderedLines.push(
          <div key={key} style={{ ...styles.line, background: theme.diffAddedBg }}>
            <span style={{ color: theme.diffContent }}>{gutter}</span>
            <span
              style={{ color: theme.diffContent }}
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          </div>
        );
      } else if (line.type === '-') {
        const contentHtml = line.highlights
          ? renderHighlighted(line.content, line.highlights, theme.diffRemovedHighlight)
          : escapeHtml(line.content);
        renderedLines.push(
          <div key={key} style={{ ...styles.line, background: theme.diffRemovedBg }}>
            <span style={{ color: theme.diffContent }}>{gutter}</span>
            <span
              style={{ color: theme.diffContent }}
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          </div>
        );
      } else {
        renderedLines.push(
          <div key={key} style={styles.line}>
            <span style={{ color: theme.diffLineNumber }}>{lineNoStr}</span>
            <span style={{ color: theme.diffContext }}>{'  '}{line.content}</span>
          </div>
        );
      }

      // no line counter needed — showing all lines
    }

    prevHunkEndLine = newLine - 1;
  }

  return (
    <div style={styles.container}>
      {/* Stats */}
      <div
        style={{ color: theme.dimText }}
        dangerouslySetInnerHTML={{ __html: statsHtml }}
      />
      {/* Diff lines */}
      <div style={styles.diff}>
        <div style={styles.diffInner}>
          {renderedLines}
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// FileReadView — renders file_read summary
// ---------------------------------------------------------------------------

interface FileReadViewProps {
  meta: { filePath?: string; lineCount?: number; startLine?: number; endLine?: number; type?: string };
}

export const FileReadView = memo(function FileReadView({ meta }: FileReadViewProps) {
  const count = meta.lineCount ?? 0;
  const startLine = meta.startLine ?? 1;
  const endLine = meta.endLine ?? count;
  const isPartial = startLine !== 1 || endLine !== count;
  const rangeStr = isPartial
    ? `lines ${startLine}-${endLine} of ${count}`
    : `${count} line${count !== 1 ? 's' : ''}`;
  return (
    <div style={{ color: theme.dimText }}>{rangeStr}</div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  container: {
    margin: '0.25em 0',
  },
  diff: {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    overflow: 'auto',
  },
  // Shrink-wrap to the widest line so +/- line backgrounds extend across the
  // full horizontal scroll width; min-width keeps short diffs filling the box.
  diffInner: {
    width: 'fit-content',
    minWidth: '100%',
  },
  line: {
    whiteSpace: 'pre',
    padding: '0 1ch 1px 1ch',
    marginBottom: -1,
    lineHeight: 1.4,
  },
};
