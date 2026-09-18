// ═══════════════════════════════════════════════════════════════════════════════
// Vesper Core — Tool: web_search
//
// Searches the web via Bing's HTML interface and returns structured results
// (title, URL, snippet). No API key required. Infrastructure-level tool — always
// available. Designed to pair with `fetch` for deep content retrieval.
//
// Bing preserves a relatively clean HTML structure:
//   <li class="b_algo">
//     <h2><a href="REAL_URL">Title</a></h2>
//     <p class="b_lineclamp...">Snippet text</p>
//   </li>
//
// Note: Bing wraps some URLs in redirect links (bing.com/ck/a?...&u=a1BASE64).
// We decode the base64 payload to extract the real destination.
// ═══════════════════════════════════════════════════════════════════════════════

import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry } from '@vesper/shared';
import { ProxyAgent } from 'undici';
import { TOOL_DESC } from '../prompts.js';

// ─── Constants ────────────────────────────────────────────

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS_LIMIT = 20;
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BING_SEARCH_URL = 'https://www.bing.com/search';

// ─── System proxy detection ──────────────────────────────

function getSystemProxy(protocol: 'http:' | 'https:'): string | undefined {
  const env = process.env;
  if (protocol === 'https:') {
    return (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '').trim() || undefined;
  }
  return (env.HTTP_PROXY || env.http_proxy || env.HTTPS_PROXY || env.https_proxy || '').trim() || undefined;
}

function resolveProxy(protocol: 'http:' | 'https:', configProxy?: string): string | undefined {
  return getSystemProxy(protocol) || configProxy?.trim() || 'http://127.0.0.1:7890';
}

// ─── HTML entity decoding ────────────────────────────────

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&ensp;/g, ' ')
    .replace(/&#0183;/g, '·')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// ─── URL extraction ──────────────────────────────────────

/**
 * Bing wraps outbound URLs in redirect links:
 *   https://www.bing.com/ck/a?!&&p=...&u=a1aHR0cHM6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvSGVsbG8sX3dvcmxk&ntb=1
 * The `u` parameter contains base64-encoded real URL after the "a1" prefix.
 */
function extractBingUrl(bingHref: string): string {
  try {
    const match = bingHref.match(/[?&]u=a1([^&]+)/);
    if (match) {
      return Buffer.from(match[1], 'base64').toString('utf8');
    }
  } catch { /* fall through */ }
  return bingHref;
}

// ─── Result parsing ──────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Parse Bing HTML search results page.
 *
 * Bing results are in <li class="b_algo"> blocks:
 *   - <h2><a href="...">Title</a></h2>
 *   - <p class="b_lineclamp...">Snippet</p>
 *   - <cite>display-url</cite> (optional, for reference)
 *
 * URLs may go through Bing's redirect proxy (u=a1BASE64);
 * we extract the real destination URL.
 */
function parseResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Split by b_algo list items
  const blocks = html.split(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>/i);

  for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
    const block = blocks[i];

    // Extract title + URL from <h2><a href="...">
    const titleMatch = block.match(/<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    const rawUrl = titleMatch[1];
    const title = decodeEntities(stripTags(titleMatch[2]));

    // Resolve the real URL through Bing's redirect wrapper
    const url = extractBingUrl(
      rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl
    );

    // Skip empty titles or non-http URLs
    if (!title || (!url.startsWith('http://') && !url.startsWith('https://'))) continue;

    // Extract snippet from <p class="b_lineclamp...">
    const snippetMatch = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    let snippet = '';
    if (snippetMatch) {
      snippet = decodeEntities(stripTags(snippetMatch[1])).replace(/\s+/g, ' ').trim();
    }

    results.push({ title, url, snippet });
  }

  return results;
}

// ─── Tool Definition ──────────────────────────────────────

export const webSearchToolDef: ToolDefinition = {
  name: 'web_search',
  description: TOOL_DESC.web_search,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: TOOL_DESC.web_search_query,
      },
      max_results: {
        type: 'number',
        description: TOOL_DESC.web_search_max_results,
      },
    },
    required: ['query'],
  },
};

// ─── Executor Factory ─────────────────────────────────────

function createWebSearchExecutor(configProxy?: string): ToolExecutor {
  return async (args: Record<string, any>): Promise<ToolResult> => {
    const query = (args.query as string || '').trim();
    const maxResults = Math.min(
      (args.max_results as number | undefined) ?? DEFAULT_MAX_RESULTS,
      MAX_RESULTS_LIMIT
    );
    const signal = args.__signal as AbortSignal | undefined;

    if (!query) {
      return { content: 'Error: query is required.', isError: true };
    }

    try {
      const searchUrl = `${BING_SEARCH_URL}?q=${encodeURIComponent(query)}&mkt=zh-CN&setlang=zh-Hans`;

      // Timeout control
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

      if (signal) {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      const fetchOpts: any = {
        signal: controller.signal,
        headers: {
          'User-Agent': DEFAULT_UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        } as Record<string, string>,
        redirect: 'follow' as RequestRedirect,
      };

      const proxyUrl = resolveProxy('https:', configProxy);

      let response: Response;
      try {
        if (proxyUrl) {
          const dispatcher = new ProxyAgent(proxyUrl);
          const undici = await import('undici');
          response = await (undici as any).fetch(searchUrl, { ...fetchOpts, dispatcher }) as unknown as Response;
        } else {
          response = await fetch(searchUrl, fetchOpts);
        }
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        return {
          content: `Error: Bing returned HTTP ${response.status} ${response.statusText}`,
          isError: true,
        };
      }

      const html = await response.text();

      // Check for CAPTCHA / bot detection page
      if (html.includes('anomaly-modal__title') || html.includes('challenge-form') || html.includes('captcha')) {
        return {
          content: `Error: Bing bot-detection triggered. The current IP may be flagged. Try switching to a different proxy node, or wait a few minutes and retry.`,
          isError: true,
        };
      }

      // Check for empty or truncated response
      if (html.length < 500) {
        return {
          content: `Error: Received unexpected response from Bing (${html.length} bytes). The service may be temporarily unavailable.`,
          isError: true,
        };
      }

      const results = parseResults(html, maxResults);

      if (results.length === 0) {
        return {
          content: `No results found for "${query}". Try different keywords or a broader query.`,
        };
      }

      // Format output
      let output = `Search results for: ${query}\n\n`;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        output += `**${i + 1}. ${r.title}**\n`;
        output += `   URL: ${r.url}\n`;
        if (r.snippet) {
          output += `   ${r.snippet}\n`;
        }
        output += '\n';
      }

      output += `---\n${results.length} result(s) from Bing. Use fetch on any URL above for full page content.`;

      return { content: output };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return {
          content: `Error: Search request timed out after ${DEFAULT_TIMEOUT}ms. The network may be slow or Bing is unreachable.`,
          isError: true,
        };
      }
      return {
        content: `Error searching for "${query}": ${err?.message || String(err)}`,
        isError: true,
      };
    }
  };
}

// ─── Factory ──────────────────────────────────────────────

/**
 * Create the `web_search` tool entry.
 * @param configProxy — Vesper config.proxy value, used as fallback when env proxy is empty.
 */
export function createWebSearchToolEntry(configProxy?: string): ToolEntry {
  return {
    definition: webSearchToolDef,
    executor: createWebSearchExecutor(configProxy),
  };
}

// ─── Static singleton (no config proxy fallback) ─────────

export const webSearchExecutor: ToolExecutor = createWebSearchExecutor();

export const webSearchTool: ToolEntry = {
  definition: webSearchToolDef,
  executor: webSearchExecutor,
};
