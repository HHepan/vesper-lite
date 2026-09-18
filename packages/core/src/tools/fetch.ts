// ═══════════════════════════════════════════════════════════════════════════════
// Vesper Lite — Tool: fetch
// ═══════════════════════════════════════════════════════════════════════════════

import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry } from '@vesper/shared';
import { Window } from 'happy-dom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { ProxyAgent } from 'undici';
import { TOOL_DESC } from '../prompts.js';

const DEFAULT_TIMEOUT = 30_000;
const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getSystemProxy(protocol: 'http:' | 'https:'): string | undefined {
  const env = process.env;
  if (protocol === 'https:') {
    return (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '').trim() || undefined;
  }
  return (env.HTTP_PROXY || env.http_proxy || env.HTTPS_PROXY || env.https_proxy || '').trim() || undefined;
}

const DEFAULT_CONTENT_SELECTORS = [
  'article',
  '[role="main"]',
  'main',
  '.post-content',
  '.article-content',
  '.entry-content',
  '.content',
  '.markdown-body',
  '.documentation',
  '#main',
  '#content',
];

let _turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (!_turndown) {
    _turndown = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
    });

    _turndown.addRule('pre-code', {
      filter: (node) =>
        node.nodeName === 'PRE' && !!node.querySelector('code'),
      replacement: (_content, node) => {
        const code = (node as HTMLElement).querySelector('code')!;
        const lang =
          (code.className || '').match(/language-(\S+)/)?.[1] || '';
        const text = code.textContent || '';
        return `\n\n\`\`\`${lang}\n${text.replace(/\n$/, '')}\n\`\`\`\n\n`;
      },
    });
  }
  return _turndown;
}

function parseHTML(html: string, url: string): { window: InstanceType<typeof Window>; document: Document } {
  const window = new Window({ url });
  window.document.documentElement.innerHTML = html;
  return { window, document: window.document as unknown as Document };
}

function cleanDOM(doc: Document): void {
  const selectors = [
    'script', 'style', 'noscript', 'iframe',
    'nav', 'footer', 'header:not(article header)',
    '.sidebar', '.advertisement', '.ads',
    '.social-share', '.comments', '.related-posts',
    '[role="banner"]', '[role="navigation"]',
    '[role="complementary"]', '[aria-hidden="true"]',
  ];

  for (const sel of selectors) {
    try {
      const els = doc.querySelectorAll(sel);
      for (const el of els) el.remove();
    } catch {
      // ignore
    }
  }
}

interface Extracted {
  title: string;
  contentHTML: string;
  excerpt: string;
  byline: string;
  siteName: string;
  lang: string;
  _fallback?: string;
  _selector?: string;
}

function extractReadability(doc: Document): Extracted | null {
  const reader = new Readability(doc as any, { charThreshold: 50 });
  const article = reader.parse();
  if (!article) return null;

  return {
    title: article.title || '',
    contentHTML: article.content || '',
    excerpt: article.excerpt || '',
    byline: article.byline || '',
    siteName: article.siteName || '',
    lang: article.lang || '',
  };
}

function extractBasic(doc: Document, selectors: string[] = []): Extracted {
  const allSelectors = [...selectors, ...DEFAULT_CONTENT_SELECTORS];

  let contentEl: Element | null = null;
  let usedSelector = '';

  for (const sel of allSelectors) {
    try {
      const el = doc.querySelector(sel);
      if (el && (el.textContent || '').length > 200) {
        contentEl = el;
        usedSelector = sel;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!contentEl) {
    contentEl = doc.body;
    usedSelector = 'body';
  }

  const title =
    doc.querySelector('title')?.textContent ||
    doc.querySelector('h1')?.textContent || '';

  return {
    title: title.trim(),
    contentHTML: contentEl?.innerHTML || '',
    excerpt: '',
    byline: '',
    siteName: '',
    lang: doc.documentElement?.getAttribute('lang') || '',
    _selector: usedSelector,
  };
}

function html2md(html: string, url: string): { title: string; markdown: string; mode: string } {
  const { window, document: doc } = parseHTML(html, url);

  let extracted = extractReadability(doc);
  let mode = 'readability';
  if (!extracted) {
    cleanDOM(doc);
    extracted = extractBasic(doc);
    mode = 'readability→basic';
  }

  const td = getTurndown();
  let markdown = td.turndown(extracted.contentHTML);
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  window.happyDOM.close();

  return { title: extracted.title, markdown, mode };
}

export const fetchToolDef: ToolDefinition = {
  name: 'fetch',
  description: TOOL_DESC.fetch,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: TOOL_DESC.fetch_url,
      },
      max_length: {
        type: 'number',
        description: TOOL_DESC.fetch_max_length,
      },
      timeout: {
        type: 'number',
        description: TOOL_DESC.fetch_timeout,
      },
      raw: {
        type: 'boolean',
        description: TOOL_DESC.fetch_raw,
      },
    },
    required: ['url'],
  },
};

function resolveProxy(protocol: 'http:' | 'https:', configProxy?: string): string | undefined {
  return getSystemProxy(protocol) || configProxy?.trim() || undefined;
}

function createFetchExecutor(configProxy?: string): ToolExecutor {
  return async (args: Record<string, any>): Promise<ToolResult> => {
    const url = args.url as string;
    const maxLength = (args.max_length as number | undefined) ?? MAX_OUTPUT_CHARS;
    const timeout = (args.timeout as number | undefined) ?? DEFAULT_TIMEOUT;
    const raw = (args.raw as boolean | undefined) ?? false;
    const signal = args.__signal as AbortSignal | undefined;

    if (!url || !url.trim()) {
      return { content: 'Error: url is required.', isError: true };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { content: `Error: Invalid URL: ${url}`, isError: true };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { content: `Error: Only http/https URLs are supported. Got: ${parsed.protocol}`, isError: true };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      if (signal) {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      const fetchOpts: any = {
        signal: controller.signal,
        headers: {
          'User-Agent': DEFAULT_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        } as Record<string, string>,
        redirect: 'follow',
      };

      const proxyUrl = resolveProxy(parsed.protocol as 'http:' | 'https:', configProxy);

      let response: Response;
      try {
        if (proxyUrl) {
          const dispatcher = new ProxyAgent(proxyUrl);
          const undici = await import('undici');
          response = await (undici as any).fetch(url, { ...fetchOpts, dispatcher }) as unknown as Response;
        } else {
          response = await fetch(url, fetchOpts);
        }
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        return {
          content: `Error: HTTP ${response.status} ${response.statusText} fetching ${url}`,
          isError: true,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      const body = await response.text();

      const isHtml = contentType.includes('html') || contentType.includes('xml');

      if (raw || !isHtml) {
        let output = body;
        let truncated = false;
        if (output.length > maxLength) {
          output = output.slice(0, maxLength);
          truncated = true;
        }

        const header = `URL: ${url}\nContent-Type: ${contentType}\nSize: ${body.length} chars${truncated ? ` (truncated to ${maxLength})` : ''}\n\n`;
        return { content: header + output };
      }

      const { title, markdown, mode } = html2md(body, url);

      let output = '';
      if (title) {
        output += `# ${title}\n\n`;
      }
      output += `Source: ${url}\n\n---\n\n`;
      output += markdown;

      let truncated = false;
      if (output.length > maxLength) {
        output = output.slice(0, maxLength);
        const lastNewline = output.lastIndexOf('\n', maxLength - 100);
        if (lastNewline > maxLength * 0.8) {
          output = output.slice(0, lastNewline);
        }
        truncated = true;
      }

      if (truncated) {
        output += `\n\n---\n[Content truncated. Original: ${body.length} chars HTML → ${markdown.length} chars Markdown. Showing first ${maxLength} chars. Use max_length to adjust.]`;
      }

      return { content: output };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { content: `Error: Request timed out after ${timeout}ms fetching ${url}`, isError: true };
      }
      return { content: `Error fetching ${url}: ${err?.message || String(err)}`, isError: true };
    }
  };
}

export function createFetchToolEntry(configProxy?: string): ToolEntry {
  return {
    definition: fetchToolDef,
    executor: createFetchExecutor(configProxy),
  };
}

export const fetchExecutor: ToolExecutor = createFetchExecutor();

export const fetchTool: ToolEntry = {
  definition: fetchToolDef,
  executor: fetchExecutor,
};
