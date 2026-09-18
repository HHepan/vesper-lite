/**
 * Unit tests for DiffView's long-line handling.
 *
 * Regression guard: each diff line is a plain block `<div>` inside a
 * horizontally scrollable container. A block child's width is clamped to the
 * container's *visible* width, so when a line's content overflows (long line),
 * the `+`/`-` background stopped at the visible edge and "broke" once you
 * scrolled right — even though the text (white-space: pre) kept overflowing.
 * The fix wraps all lines in a shrink-wrap container (`width: fit-content;
 * min-width: 100%`) so every line's background spans the full scroll width
 * while short diffs still fill the box.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiffView } from '../src/components/DiffView';

const meta = {
  type: 'file_edit' as const,
  filePath: '/tmp/example.ts',
  diff: [
    {
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      lines: [
        { type: '-' as const, content: 'const x = 1;' },
        { type: '+' as const, content: 'const x = ' + 'a'.repeat(400) + ';' },
        { type: ' ' as const, content: 'const y = 2;' },
      ],
    },
  ],
  linesAdded: 1,
  linesRemoved: 1,
};

describe('DiffView', () => {
  it('wraps diff lines in a shrink-wrap container so +/- backgrounds span the full scroll width', () => {
    const html = renderToStaticMarkup(createElement(DiffView, { meta }));

    // The inner shrink-wrap wrapper is present…
    expect(html).toContain('width:fit-content');
    expect(html).toContain('min-width:100%');
  });

  it('keeps the shrink-wrap wrapper inside the horizontal scroll container', () => {
    const html = renderToStaticMarkup(createElement(DiffView, { meta }));

    const scrollIdx = html.indexOf('overflow:auto');
    const innerIdx = html.indexOf('width:fit-content');
    const firstLineIdx = html.indexOf('const x = 1;');

    expect(scrollIdx).toBeGreaterThanOrEqual(0);
    expect(innerIdx).toBeGreaterThan(scrollIdx); // wrapper nested in the scroll container
    expect(firstLineIdx).toBeGreaterThan(innerIdx); // lines nested in the wrapper
  });

  it('renders the added/removed lines without truncating long content', () => {
    const html = renderToStaticMarkup(createElement(DiffView, { meta }));
    const longLine = 'a'.repeat(400);
    expect(html).toContain(longLine);
  });

  it('renders a placeholder when there are no changes', () => {
    const empty = { ...meta, diff: [], linesAdded: 0, linesRemoved: 0 };
    const html = renderToStaticMarkup(createElement(DiffView, { meta: empty }));
    expect(html).toContain('No changes');
  });
});
