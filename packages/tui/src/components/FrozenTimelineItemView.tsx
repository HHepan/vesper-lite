// ═══════════════════════════════════════════════════════════════════════════
// Vesper TUI — Frozen Timeline Item View (for Static zone)
//
// Renders a single completed timeline item promoted to Static (no re-draws).
// Uses CC-style ● dot prefix + borderLeft tree for hierarchy.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { Box, Text } from 'ink';
import type { ToolResultMeta } from '@vesper/shared';
import type { TimelineItem } from '../store.js';
import { formatElapsed } from '../store.js';
import { TreeContent } from './TreeContent.js';
import { DiffView, FileReadView, FileImageView, FileDocumentView } from './DiffView.js';
import { renderMarkdown } from '../render-markdown.js';
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

// ── Shared visual constants ──────────────────────────────────────────────

/** Big dot for top-level items (U+25CF BLACK CIRCLE). */
const DOT = '● ';

const MAX_RESULT_LINES = 3;
const MAX_RESULT_CHARS = 200;

function clampResult(text: string): string {
  let clamped = text;
  let charClamped = false;
  if (clamped.length > MAX_RESULT_CHARS) {
    clamped = clamped.slice(0, MAX_RESULT_CHARS);
    charClamped = true;
  }
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
      ? (v.length > 40 ? `"${v.slice(0, 40)}..."` : `"${v}"`)
      : JSON.stringify(v);
    pairs.push(`${k}=${val}`);
  }
  const joined = pairs.join(', ');
  return joined.length > 100 ? joined.slice(0, 100) + '...' : joined;
}

interface Props {
  item: TimelineItem;
}

export const FrozenTimelineItemView = React.memo(function FrozenTimelineItemView({ item }: Props): React.JSX.Element {
  // ── User prompt ────────────────────────────────────────────────────────
  if (item.kind === 'prompt') {
    return (
      <Box marginBottom={1}>
        <Text backgroundColor={theme.promptBg}>
          {'  '}<Text color={theme.promptMarker} dimColor>{'>'}</Text>{' '}<Text color={theme.promptText}>{item.entry.content}</Text>{'  '}
        </Text>
      </Box>
    );
  }

  // ── Thinking (frozen = show full content in tree) ──────────────────────
  if (item.kind === 'thinking') {
    const elapsed = item.entry.elapsedMs != null ? ` (${formatElapsed(item.entry.elapsedMs)})` : '';
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={theme.thinkingDot}>{DOT}</Text>
          <Text color={theme.thinkingLabel} dimColor>{`Thinking${elapsed}`}</Text>
        </Box>
        <TreeContent>
          <Text color={theme.thinkingContent} dimColor>{item.entry.content}</Text>
        </TreeContent>
      </Box>
    );
  }

  // ── Tool call (frozen = completed, show clamped result in tree) ────────
  if (item.kind === 'tool') {
    const entry = item.entry;
    const isError = entry.result?.isError;
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
        {hasContent && (
          <TreeContent>
            {structuredContent ?? <Text color={theme.toolResult}>{fallbackText}</Text>}
          </TreeContent>
        )}
      </Box>
    );
  }

  // ── System message ─────────────────────────────────────────────────────
  if (item.kind === 'system') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={theme.systemDot}>{DOT}</Text>
          <Text color={theme.systemLabel} dimColor>{'System'}</Text>
        </Box>
        <TreeContent>
          <Text color={theme.systemText}>{item.entry.content}</Text>
        </TreeContent>
      </Box>
    );
  }

  // ── Text block (assistant output, Markdown-rendered) ───────────────────
  const rendered = renderMarkdown(item.entry.content);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.assistantDot}>{DOT}</Text>
      </Box>
      <TreeContent>
        <Text>{rendered}</Text>
      </TreeContent>
    </Box>
  );
});
