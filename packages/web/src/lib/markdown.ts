// ═══════════════════════════════════════════════════════════════════════════
// Markdown renderer — converts markdown text to sanitized HTML
//
// TUI style: monospace font, ANSI-inspired colors via CSS variables.
// Uses `marked` for parsing. Code blocks get highlight.js syntax coloring.
// ═══════════════════════════════════════════════════════════════════════════

import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';

// Register commonly-used languages for highlight.js
// (lazy-loaded to keep bundle size reasonable)
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import csharp from 'highlight.js/lib/languages/csharp';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import diff from 'highlight.js/lib/languages/diff';
import shell from 'highlight.js/lib/languages/shell';
import lua from 'highlight.js/lib/languages/lua';
import perl from 'highlight.js/lib/languages/perl';
import r from 'highlight.js/lib/languages/r';
import scala from 'highlight.js/lib/languages/scala';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('zsh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('jsonc', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('scss', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('svg', xml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('golang', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('kt', kotlin);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('patch', diff);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('console', shell);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('perl', perl);
hljs.registerLanguage('r', r);
hljs.registerLanguage('scala', scala);

// ---------------------------------------------------------------------------
// Highlight code with highlight.js
// ---------------------------------------------------------------------------

function highlightCode(text: string, lang?: string): string {
  if (lang) {
    try {
      const result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
      return result.value;
    } catch {
      // Language not registered — fall through to auto-detect
    }
  }
  // Auto-detect for unknown or missing lang
  try {
    const result = hljs.highlightAuto(text);
    if (result.relevance > 5) return result.value;
  } catch { /* fallback */ }
  return escapeHtml(text);
}

// ---------------------------------------------------------------------------
// Configure marked
// ---------------------------------------------------------------------------

marked.setOptions({
  gfm: true,
  breaks: true,
});

// Custom renderer with TUI-style output
const renderer = new marked.Renderer();

renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const langLabel = lang
    ? `<div style="font-size:inherit;color:var(--text-muted);padding:2px 1ch;border-bottom:1px solid var(--border-color)">${escapeHtml(lang)}</div>`
    : '';
  const highlighted = highlightCode(text, lang ?? undefined);
  return `<div style="background:var(--bg-secondary);border-radius:2px;overflow:hidden;margin:0.5em 0">${langLabel}<pre style="margin:0;padding:0.5em 1ch;overflow-x:auto;line-height:1.5"><code>${highlighted}</code></pre></div>`;
};

renderer.codespan = function ({ text }: { text: string }) {
  return `<code style="background:var(--bg-tertiary);padding:0.1em 0.4ch;border-radius:2px;color:var(--md-codespan)">${text}</code>`;
};

renderer.link = function (token: any) {
  const href = token.href ?? '';
  const content = this.parser.parseInline(token.tokens);
  return `<a href="${escapeHtml(href)}" style="color:var(--md-link);text-decoration:underline" target="_blank" rel="noopener">${content}</a>`;
};

renderer.heading = function (token: any) {
  const depth = token.depth || 1;
  const content = this.parser.parseInline(token.tokens);
  const color = depth === 1 ? 'var(--md-first-heading)' : 'var(--md-heading)';
  const sizes = ['1.25em', '1.15em', '1.05em', '1em', '1em', '1em'];
  const fontSize = sizes[depth - 1] || '1em';
  return `<div style="font-weight:bold;font-size:${fontSize};margin:0.75em 0 0.25em;color:${color}">${content}</div>`;
};

renderer.list = function (token: any) {
  const tag = token.ordered ? 'ol' : 'ul';
  let body = '';
  for (const item of (token.items ?? [])) {
    body += this.listitem(item);
  }
  return `<${tag} style="padding-left:3ch;margin:0.25em 0">${body}</${tag}>`;
};

renderer.listitem = function (token: any) {
  const content = this.parser.parse(token.tokens, !!token.loose);
  return `<li style="margin:0.15em 0;line-height:1.5">${content}</li>`;
};

renderer.paragraph = function (token: any) {
  const content = this.parser.parseInline(token.tokens);
  return `<p class="md-p">${content}</p>`;
};

renderer.blockquote = function (token: any) {
  const content = this.parser.parse(token.tokens);
  return `<blockquote style="border-left:2px solid var(--md-blockquote);padding:0 1ch;margin:0.5em 0;color:var(--md-blockquote)">${content}</blockquote>`;
};

renderer.hr = function () {
  return `<hr style="border:none;border-top:1px solid #333;margin:0.5em 0">`;
};

renderer.table = function (token: any) {
  const headerCells = (token.header || []).map((cell: any) => {
    const content = this.parser.parseInline(cell.tokens);
    return `<th style="padding:0.25em 1ch;text-align:left;font-weight:bold;color:var(--text-muted)">${content}</th>`;
  }).join('');

  const bodyRows = (token.rows || []).map((row: any[]) => {
    const cells = row.map((cell: any) => {
      const content = this.parser.parseInline(cell.tokens);
      return `<td style="padding:0.25em 1ch">${content}</td>`;
    }).join('');
    return `<tr style="border-bottom:1px solid var(--border-color)">${cells}</tr>`;
  }).join('');

  return `<div style="overflow-x:auto;margin:0.5em 0"><table style="border-collapse:collapse;width:100%"><thead><tr style="border-bottom:1px solid var(--border-color)">${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
};

renderer.tablerow = function (token: any) {
  const content = this.parser.parseInline(token.tokens ?? []);
  return `<tr style="border-bottom:1px solid var(--border-color)">${content}</tr>`;
};

renderer.tablecell = function (token: any) {
  const content = this.parser.parseInline(token.tokens);
  const tag = token.header ? 'th' : 'td';
  const style = token.header
    ? `padding:0.25em 1ch;text-align:left;font-weight:bold;color:var(--text-muted)`
    : 'padding:0.25em 1ch';
  return `<${tag} style="${style}">${content}</${tag}>`;
};

marked.use({ renderer });

/**
 * Render markdown to sanitized HTML string.
 */
export function renderMarkdown(markdown: string): string {
  try {
    const html = marked.parse(markdown) as string;
    return sanitize(html);
  } catch {
    return escapeHtml(markdown);
  }
}

// ---------------------------------------------------------------------------
// Sanitization (lightweight, no external deps)
// ---------------------------------------------------------------------------

function sanitize(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\bon\w+\s*=\s*\S+/gi, '')
    .replace(/javascript:/gi, '');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
