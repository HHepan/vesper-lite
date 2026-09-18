// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Tool Card Component (CC-style ● dot + borderLeft tree)
//
// ● pending  (blinking gray dot)
// ● success  (green dot)
// ● error    (red dot)
// Completed results shown in borderLeft tree, clamped to max 3 lines / 200 chars.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { ToolResultMeta } from '@vesper/shared';
import type { ToolCallEntry } from '../store.js';
import { formatElapsed } from '../store.js';
import { TreeContent } from './TreeContent.js';
import { DiffView, FileReadView, FileImageView, FileDocumentView } from './DiffView.js';
import { theme } from '../theme.js';

/** Format line range suffix, e.g. " :100-200" or "" if reading entire file. */
function formatLineRange(m: { startLine: number; endLine: number; lineCount: number }): string {
  if (m.startLine === 1 && m.endLine === m.lineCount) return '';
  return ` :${m.startLine}-${m.endLine}`;
}

function formatFileToolHeader(meta: ToolResultMeta): { label: string; path: string } {
  switch (meta.type) {
    case 'file_read':
      return { label: 'Read ', path: meta.filePath + formatLineRange(meta) };
    case 'file_write':
      return { label: meta.created ? 'Write ' : 'Update ', path: meta.filePath };
    case 'file_edit':
      return { label: 'Update ', path: meta.filePath };
    case 'file_image':
      return { label: 'Image ', path: meta.filePath };
    case 'file_document':
      return { label: 'Document ', path: meta.filePath + formatLineRange(meta) };
    case 'file_attachment':
      return { label: 'Send ', path: meta.filename };
    default:
      return { label: 'File ', path: '' };
  }
}

const MAX_RESULT_LINES = 3;
const MAX_RESULT_CHARS = 200;

/** Big dot for top-level items (U+25CF BLACK CIRCLE). */
const DOT = '● ';

function clampResult(text: string): string {
  // Clamp by character count first
  let clamped = text;
  let charClamped = false;
  if (clamped.length > MAX_RESULT_CHARS) {
    clamped = clamped.slice(0, MAX_RESULT_CHARS);
    charClamped = true;
  }
  // Then clamp by line count
  const lines = clamped.split('\n');
  if (lines.length > MAX_RESULT_LINES) {
    return lines.slice(0, MAX_RESULT_LINES).join('\n') + `\n... (+${text.split('\n').length - MAX_RESULT_LINES} lines)`;
  }
  if (charClamped) {
    return clamped + '...';
  }
  return clamped;
}

function formatArgsPreview(args: Record<string, any>): string {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const val = typeof v === 'string'
      ? (v.length > 30 ? `"${v.slice(0, 30)}..."` : `"${v}"`)
      : JSON.stringify(v);
    pairs.push(`${k}=${val}`);
  }
  const joined = pairs.join(', ');
  return joined.length > 80 ? joined.slice(0, 80) + '...' : joined;
}

/** Blinking gray dot for pending tool calls. */
function BlinkingDot(): React.JSX.Element {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((prev) => !prev);
    }, 500);
    return () => clearInterval(timer);
  }, []);
  return <Text color={theme.toolPending}>{visible ? DOT : '  '}</Text>;
}

interface CardProps {
  entry: ToolCallEntry;
  onToggle: (id: string) => void;
}

export const ToolCard = React.memo(function ToolCard({ entry, onToggle }: CardProps): React.JSX.Element {
  const hasResult = !!entry.result;
  const isError = entry.result?.isError;

  // ── Pending: blinking gray ● dot + tool name + args ─────────────────────
  if (!hasResult) {
    const argsPreview = formatArgsPreview(entry.call.arguments);
    return (
      <Box marginBottom={1}>
        <BlinkingDot />
        <Text color={theme.toolName} bold>{entry.call.name}</Text>
        <Text color={theme.toolArgs} dimColor>{` ${argsPreview}`}</Text>
      </Box>
    );
  }

  // ── Completed: ● dot header + borderLeft tree for clamped result ────────
  const dotColor = isError ? theme.toolError : theme.toolSuccess;
  const argsPreview = formatArgsPreview(entry.call.arguments);
  const meta = entry.result?.meta;

  // Structured rendering for file tools with meta
  const structuredContent = meta?.type === 'file_read'
    ? <FileReadView meta={meta} />
    : (meta?.type === 'file_write' || meta?.type === 'file_edit')
      ? <DiffView meta={meta} />
      : meta?.type === 'file_image'
        ? <FileImageView meta={meta} />
        : meta?.type === 'file_document'
          ? <FileDocumentView meta={meta} />
          : null;

  // Fallback: clamped text for tools without meta or on error
  const fallbackText = !structuredContent && entry.result
    ? clampResult(entry.result.content)
    : '';
  const hasContent = !!structuredContent || fallbackText.length > 0;

  // CC-style header override for file tools with meta
  const fileHeader = !isError && meta ? formatFileToolHeader(meta) : null;
  const elapsed = entry.elapsedMs != null ? ` (${formatElapsed(entry.elapsedMs)})` : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header line: ● Label(path) or ● tool_name args_preview */}
      <Box>
        <Text color={dotColor}>{DOT}</Text>
        {fileHeader ? (
          <>
            <Text color={theme.toolName} bold>{fileHeader.label}</Text>
            <Text color={theme.toolArgs} dimColor>{`(${fileHeader.path})`}</Text>
          </>
        ) : (
          <>
            <Text color={theme.toolName} bold>{entry.call.name}</Text>
            <Text color={theme.toolArgs} dimColor>{` ${argsPreview}`}</Text>
          </>
        )}
        {elapsed && <Text color={theme.thinkingLabel} dimColor>{elapsed}</Text>}
      </Box>

      {/* Result in borderLeft tree */}
      {hasContent && (
        <TreeContent>
          {structuredContent ?? <Text color={theme.toolResult}>{fallbackText}</Text>}
        </TreeContent>
      )}
    </Box>
  );
});

// Re-export for backwards compatibility
export { ToolCard as ToolPanel };
