// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — ScreenshotRenderer
//
// Renders a complete session timeline WITHOUT virtualisation into an HTML
// string, then delegates to screenshotHtmlToClipboard() which handles the
// temporary DOM container, html-to-image capture, and clipboard copy.
//
// Used by the "Copy as PNG" context menu action on session tabs.
// ═══════════════════════════════════════════════════════════════════════════

import type { WebStoreState, TimelineItem } from '../store.js';
import type { WebStore } from '../store.js';
import { screenshotHtmlToClipboard } from '../lib/screenshot.js';
import { renderMarkdown } from '../lib/markdown.js';

/**
 * Capture a full session screenshot to clipboard.
 *
 * Reads all timeline data from the store, builds a complete HTML string
 * mirroring the live UI, and passes it to screenshotHtmlToClipboard()
 * which handles the rest (container creation, capture, clipboard, cleanup).
 */
export async function captureSessionToClipboard(store: WebStore): Promise<void> {
  const state = store.getSnapshot();

  // Get the width from the actual session panel if visible
  const sessionEl = document.querySelector<HTMLElement>(`[data-session-id="${state.sessionId}"]`);
  const panelWidth = sessionEl?.clientWidth ?? 900;

  // Build complete HTML for all timeline items
  const html = buildTimelineHtml(state);

  // Delegate to screenshot utility — it creates the z-index:-1 container,
  // waits for layout, captures with toBlob, copies to clipboard, cleans up.
  await screenshotHtmlToClipboard(html, { width: panelWidth });
}

// ---------------------------------------------------------------------------
// HTML builders — mirror the React component output but as static HTML
// ---------------------------------------------------------------------------

/** Wrap content HTML in a TreeContent-style border with rounded bottom cap. */
function wrapTreeContent(innerHtml: string, borderColor = 'var(--border-color)'): string {
  return `<div style="margin-left:1ch">
    <div style="border-left:1px solid ${borderColor};padding-left:1ch">
      ${innerHtml}
    </div>
    <div style="width:1.5ch;height:6px;border-left:1px solid ${borderColor};border-bottom:1px solid ${borderColor};border-bottom-left-radius:6px"></div>
  </div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTimelineHtml(state: WebStoreState): string {
  const parts: string[] = [];

  // Collect all timeline items: past turns + frozen + current
  const allItems: TimelineItem[] = [];
  for (const turn of state.turns) {
    for (const ti of turn.timeline) {
      allItems.push(ti);
    }
  }
  for (const ti of state.frozenTimeline) {
    allItems.push(ti);
  }
  for (const ti of state.timeline) {
    allItems.push(ti);
  }

  for (const item of allItems) {
    parts.push(renderTimelineItem(item));
  }

  // Tasks
  if (state.tasks.length > 0) {
    parts.push(renderTasks(state.tasks));
  }

  return parts.join('');
}

function renderTimelineItem(item: TimelineItem): string {
  switch (item.kind) {
    case 'prompt':
      return `<div style="display:flex;align-items:flex-start;padding:0.25em 0;margin-bottom:0.5em">
        <span style="color:var(--ansi-blue);padding-left:0.5ch;margin-right:1ch;flex-shrink:0">&gt;</span>
        <span style="color:var(--text-primary);font-weight:bold;white-space:pre-wrap;word-break:break-word;flex:1;min-width:0">${escapeHtml(item.entry.content)}</span>
      </div>`;

    case 'thinking':
      return renderThinkingItem(item.entry);

    case 'tool':
      return renderToolItem(item.entry);

    case 'text':
      return renderTextItem(item.entry);

    case 'system':
      return `<div style="margin-bottom:0.5em">
        <div style="padding-left:0.5ch">
          <span style="color:var(--accent-blue)">● </span>
          <span style="color:var(--accent-blue);font-weight:bold">System</span>
        </div>
        ${wrapTreeContent(`<div style="color:#999999;white-space:pre-wrap;word-break:break-word">${escapeHtml(item.entry.content)}</div>`, 'var(--accent-blue)')}
      </div>`;

    case 'link_message': {
      const content = item.entry.content;
      const linkMatch = content.match(/^\[来自其他session:\s*([^\]]+)\]\s*(.*)/s);
      const alertMatch = !linkMatch && content.match(/^\[LINK ALERT\s+from\s+([^\]]+)\]\s*(.*)/s);
      const sessionName = linkMatch ? linkMatch[1].trim() : alertMatch ? alertMatch[1].trim() : null;
      const messageContent = linkMatch ? linkMatch[2] : alertMatch ? alertMatch[2] : content;
      return `<div style="margin-bottom:0.5em">
        <div style="padding-left:0.5ch;display:flex;align-items:center;gap:0.5ch">
          <span style="color:var(--status-warning)">●</span>
          ${sessionName ? `<span style="color:var(--status-warning);font-weight:bold;font-size:0.85em">↗ ${escapeHtml(sessionName)}</span>` : ''}
        </div>
        ${wrapTreeContent(`<div style="color:#CCCCCC;white-space:pre-wrap;word-break:break-word">${escapeHtml(messageContent)}</div>`, 'var(--status-warning)')}
      </div>`;
    }

    default:
      return '';
  }
}

function renderThinkingItem(entry: { id: string; content: string; collapsed: boolean; elapsedMs?: number }): string {
  const timeStr = entry.elapsedMs != null ? `${(entry.elapsedMs / 1000).toFixed(1)}s` : '';

  if (entry.collapsed) {
    return `<div style="padding:0.25em 0;padding-left:0.5ch;margin-bottom:0.25em">
      <span style="color:var(--ansi-magenta)">◆</span>
      <span style="color:var(--text-muted);margin-left:0.5ch">Thinking${timeStr ? ` (${timeStr})` : ''}</span>
    </div>`;
  }

  return `<div style="margin-bottom:0.5em">
    <div style="padding-left:0.5ch">
      <span style="color:var(--ansi-magenta)">◆</span>
      <span style="color:var(--text-muted);margin-left:0.5ch">Thinking${timeStr ? ` (${timeStr})` : ''}</span>
    </div>
    ${wrapTreeContent(`<div style="color:var(--text-muted);white-space:pre-wrap;word-break:break-word;max-height:20em;overflow:hidden">${escapeHtml(entry.content)}</div>`, 'var(--border-color)')}
  </div>`;
}

function renderToolItem(entry: {
  id: string;
  call: { name: string; arguments: Record<string, any> };
  result?: { content: string; isError?: boolean; meta?: any };
  collapsed: boolean;
  elapsedMs?: number;
}): string {
  const isError = entry.result?.isError;
  const dotColor = isError ? 'var(--status-error)' : entry.result ? '#0DBC79' : '#E5E510';
  const timeStr = entry.elapsedMs != null ? `${(entry.elapsedMs / 1000).toFixed(1)}s` : '';

  // Tool header
  const toolName = entry.call.name;
  const args = Object.entries(entry.call.arguments)
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      const truncated = val.length > 60 ? val.slice(0, 57) + '...' : val;
      return `${k}=${truncated}`;
    })
    .join(' ');

  if (entry.collapsed) {
    return `<div style="padding:0.25em 0;padding-left:0.5ch;margin-bottom:0.25em">
      <span style="color:${dotColor}">●</span>
      <span style="color:var(--ansi-blue);margin-left:0.5ch">${escapeHtml(toolName)}</span>
      <span style="color:var(--text-muted);margin-left:0.5ch">${escapeHtml(args)}</span>
      ${timeStr ? `<span style="color:var(--text-muted);margin-left:0.5ch">(${timeStr})</span>` : ''}
    </div>`;
  }

  let resultHtml = '';
  if (entry.result) {
    const content = entry.result.content;
    const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n... [truncated]' : content;
    const borderColor = isError ? '#FF6B80' : '#4EBA65';
    resultHtml = wrapTreeContent(
      `<div style="color:${isError ? '#FF6B80' : '#999999'};white-space:pre-wrap;word-break:break-word;max-height:30em;overflow:hidden;font-size:0.9em">${escapeHtml(truncated)}</div>`,
      borderColor,
    );
  }

  return `<div style="margin-bottom:0.5em">
    <div style="padding-left:0.5ch">
      <span style="color:${dotColor}">●</span>
      <span style="color:var(--ansi-blue);margin-left:0.5ch">${escapeHtml(toolName)}</span>
      <span style="color:var(--text-muted);margin-left:0.5ch">${escapeHtml(args)}</span>
      ${timeStr ? `<span style="color:var(--text-muted);margin-left:0.5ch">(${timeStr})</span>` : ''}
    </div>
    ${resultHtml}
  </div>`;
}

function renderTextItem(entry: { id: string; content: string }): string {
  // Use the same markdown renderer as the live UI for proper formatting
  const html = renderMarkdown(entry.content);
  return `<div style="margin-bottom:0.5em">
    <div style="padding-left:0.5ch">
      <span style="color:var(--ansi-blue)">●</span>
    </div>
    ${wrapTreeContent(`<div style="white-space:pre-wrap;word-break:break-word">${html}</div>`)}
  </div>`;
}

function renderTasks(tasks: WebStoreState['tasks']): string {
  const lines = tasks.map(t => {
    const icon = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◎' : '○';
    const color = t.status === 'completed' ? '#0DBC79' : t.status === 'in_progress' ? '#E5E510' : 'var(--text-muted)';
    return `<div style="padding-left:1ch;color:${color}">${icon} ${escapeHtml(t.subject)}</div>`;
  });
  return `<div style="margin:0.5em 0;padding:0.5em 0;border-top:1px solid var(--border-color)">${lines.join('')}</div>`;
}
