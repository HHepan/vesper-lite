// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — DiffView / FileReadView Components
//
// Shared components for structured file tool result rendering.
// DiffView renders unified diff hunks (CC-style: line numbers, bg colors).
// FileReadView renders file_read summary (path + line count).
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Box, Text } from 'ink';
import type { DiffHunkLine, ToolResultMeta } from '@vesper/shared';
import { theme } from '../theme.js';

const MAX_DISPLAY_HUNKS = 10;
const MAX_DISPLAY_LINES = 40;

/**
 * Render line content with word-level highlight segments.
 * Splits content by highlight ranges and applies brighter background color
 * to changed portions.
 */
function renderHighlightedContent(
  content: string,
  highlights: Array<[number, number]>,
  highlightColor: string,
): React.JSX.Element {
  const sorted = [...highlights].sort((a, b) => a[0] - b[0]);
  const parts: React.JSX.Element[] = [];
  let pos = 0;

  for (let i = 0; i < sorted.length; i++) {
    const [start, end] = sorted[i]!;
    // Normal segment before this highlight
    if (pos < start) {
      parts.push(<Text key={`n${i}`} color={theme.diffContent}>{content.slice(pos, start)}</Text>);
    }
    // Highlighted segment
    parts.push(
      <Text key={`h${i}`} color={theme.diffContent} backgroundColor={highlightColor}>
        {content.slice(start, end)}
      </Text>
    );
    pos = end;
  }
  // Trailing normal segment
  if (pos < content.length) {
    parts.push(<Text key="tail" color={theme.diffContent}>{content.slice(pos)}</Text>);
  }

  return <Text>{...parts}</Text>;
}

// ---------------------------------------------------------------------------
// DiffView — renders file_write / file_edit diff hunks (CC-style)
// ---------------------------------------------------------------------------

interface DiffViewProps {
  meta: Extract<ToolResultMeta, { type: 'file_write' }> | Extract<ToolResultMeta, { type: 'file_edit' }>;
}

export function DiffView({ meta }: DiffViewProps): React.JSX.Element {
  const hunks = meta.diff;

  // Stats fragments (colored numbers)
  const statsFragments: React.JSX.Element[] = [];
  if (meta.linesAdded > 0) {
    statsFragments.push(
      <Text key="add" color={theme.dimText}>
        {'Added '}<Text color={theme.diffAdded}>{meta.linesAdded}</Text>{` line${meta.linesAdded !== 1 ? 's' : ''}`}
      </Text>
    );
  }
  if (meta.linesRemoved > 0) {
    if (statsFragments.length > 0) statsFragments.push(<Text key="comma" color={theme.dimText}>{', '}</Text>);
    statsFragments.push(
      <Text key="rem" color={theme.dimText}>
        {'removed '}<Text color={theme.diffRemoved}>{meta.linesRemoved}</Text>{` line${meta.linesRemoved !== 1 ? 's' : ''}`}
      </Text>
    );
  }
  if (statsFragments.length === 0) {
    statsFragments.push(<Text key="none" color={theme.dimText}>{'no changes'}</Text>);
  }

  // Truncation: count total lines across hunks
  let totalLines = 0;
  for (const h of hunks) totalLines += h.lines.length;
  const truncated = hunks.length > MAX_DISPLAY_HUNKS || totalLines > MAX_DISPLAY_LINES;

  // Compute max line number across all hunks for gutter width
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

  // Slice hunks for display
  const displayHunks = hunks.slice(0, MAX_DISPLAY_HUNKS);
  let linesRendered = 0;
  let prevHunkEndLine = -1; // track for hunk separator

  const renderedHunks: React.JSX.Element[] = [];

  for (let hi = 0; hi < displayHunks.length; hi++) {
    const hunk = displayHunks[hi]!;
    const remainingLines = MAX_DISPLAY_LINES - linesRendered;
    if (remainingLines <= 0) break;
    const linesToShow = hunk.lines.slice(0, remainingLines);

    // Insert hunk separator if line numbers are non-contiguous
    if (hi > 0 && prevHunkEndLine >= 0 && hunk.newStart > prevHunkEndLine + 1) {
      renderedHunks.push(
        <Text key={`sep-${hi}`} color={theme.dimText}>{'  ...'}</Text>
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
      const key = `h${hi}-l${li}`;

      if (line.type === '+') {
        const gutter = `${lineNoStr} ${prefix} `;
        renderedHunks.push(
          <Box key={key} backgroundColor={theme.diffAddedBg} width="100%">
            {line.highlights
              ? <Text><Text color={theme.diffContent}>{gutter}</Text>{renderHighlightedContent(line.content, line.highlights, theme.diffAddedHighlight)}</Text>
              : <Text color={theme.diffContent}>{gutter}{line.content}</Text>
            }
          </Box>
        );
      } else if (line.type === '-') {
        const gutter = `${lineNoStr} ${prefix} `;
        renderedHunks.push(
          <Box key={key} backgroundColor={theme.diffRemovedBg} width="100%">
            {line.highlights
              ? <Text><Text color={theme.diffContent}>{gutter}</Text>{renderHighlightedContent(line.content, line.highlights, theme.diffRemovedHighlight)}</Text>
              : <Text color={theme.diffContent}>{gutter}{line.content}</Text>
            }
          </Box>
        );
      } else {
        renderedHunks.push(
          <Text key={key}>
            <Text color={theme.diffLineNumber}>{lineNoStr}</Text>
            <Text color={theme.diffContext}>{'  '}{line.content}</Text>
          </Text>
        );
      }

      linesRendered++;
    }

    // Track where this hunk ended for separator logic
    prevHunkEndLine = newLine - 1;
  }

  return (
    <Box flexDirection="column" width="100%">
      {/* Stats line */}
      <Text>{...statsFragments}</Text>

      {/* Diff lines */}
      {renderedHunks}

      {truncated && (
        <Text color={theme.dimText} dimColor>
          {`  ... (${hunks.length} hunks, ${totalLines} lines total — showing first ${MAX_DISPLAY_LINES})`}
        </Text>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// FileReadView — renders file_read summary
// ---------------------------------------------------------------------------

interface FileReadViewProps {
  meta: Extract<ToolResultMeta, { type: 'file_read' }>;
}

export function FileReadView({ meta }: FileReadViewProps): React.JSX.Element {
  return (
    <Text color={theme.dimText}>
      {`${meta.lineCount} line${meta.lineCount !== 1 ? 's' : ''}`}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// FileImageView — renders file_image summary (dimensions, size, format)
// ---------------------------------------------------------------------------

interface FileImageViewProps {
  meta: Extract<ToolResultMeta, { type: 'file_image' }>;
}

export function FileImageView({ meta }: FileImageViewProps): React.JSX.Element {
  const sizeKB = Math.round(meta.sizeBytes / 1024);
  const dimStr = meta.width && meta.height ? `${meta.width}\u00D7${meta.height}, ` : '';
  const format = meta.mimeType.split('/')[1]?.toUpperCase() ?? 'IMAGE';
  return (
    <Text color={theme.dimText}>{`${dimStr}${sizeKB}kB ${format}`}</Text>
  );
}

// ---------------------------------------------------------------------------
// FileDocumentView — renders file_document summary (format, pages, lines)
// ---------------------------------------------------------------------------

interface FileDocumentViewProps {
  meta: Extract<ToolResultMeta, { type: 'file_document' }>;
}

export function FileDocumentView({ meta }: FileDocumentViewProps): React.JSX.Element {
  const format = meta.format.toUpperCase();
  const pageStr = meta.pageCount !== undefined ? `${meta.pageCount} page${meta.pageCount !== 1 ? 's' : ''}, ` : '';
  const isPartial = meta.startLine !== 1 || meta.endLine !== meta.lineCount;
  const lineStr = isPartial
    ? `lines ${meta.startLine}-${meta.endLine} of ${meta.lineCount}`
    : `${meta.lineCount} line${meta.lineCount !== 1 ? 's' : ''}`;
  return (
    <Text color={theme.dimText}>{`${pageStr}${lineStr} (${format})`}</Text>
  );
}
