// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Tool: grep
// ═══════════════════════════════════════════════════════════════════════════

import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative, basename, dirname } from 'node:path';
import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry } from '@vesper/shared';
import { TOOL_DESC } from '../prompts.js';

const MAX_OUTPUT_CHARS = 12000;
const RG_TIMEOUT_MS = 5_000;
const NODE_FALLBACK_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// File type → glob mapping
// ---------------------------------------------------------------------------

const TYPE_GLOB_MAP: Record<string, string> = {
  js: '*.js',
  jsx: '*.jsx',
  ts: '*.ts',
  tsx: '*.tsx',
  py: '*.py',
  rust: '*.rs',
  rs: '*.rs',
  go: '*.go',
  java: '*.java',
  c: '*.c',
  cpp: '*.cpp',
  cc: '*.cc',
  h: '*.h',
  hpp: '*.hpp',
  cs: '*.cs',
  rb: '*.rb',
  php: '*.php',
  swift: '*.swift',
  kt: '*.kt',
  scala: '*.scala',
  lua: '*.lua',
  sh: '*.sh',
  bash: '*.sh',
  zsh: '*.zsh',
  json: '*.json',
  yaml: '*.yaml',
  yml: '*.yml',
  toml: '*.toml',
  xml: '*.xml',
  html: '*.html',
  css: '*.css',
  scss: '*.scss',
  less: '*.less',
  md: '*.md',
  sql: '*.sql',
  r: '*.r',
  dart: '*.dart',
  zig: '*.zig',
  nim: '*.nim',
  ex: '*.ex',
  exs: '*.exs',
  erl: '*.erl',
  hs: '*.hs',
  ml: '*.ml',
  vue: '*.vue',
  svelte: '*.svelte',
};

// ---------------------------------------------------------------------------
// Parsed arguments
// ---------------------------------------------------------------------------

interface GrepArgs {
  pattern: string;
  searchPath: string;
  glob: string | undefined;
  type: string | undefined;
  outputMode: 'content' | 'files_with_matches' | 'count';
  caseInsensitive: boolean;
  showLineNumbers: boolean;
  afterContext: number;
  beforeContext: number;
  headLimit: number;
  offset: number;
  multiline: boolean;
}

function parseArgs(args: Record<string, any>): GrepArgs {
  const outputMode = (args.output_mode as string | undefined) ?? 'files_with_matches';
  const contextC = (args['-C'] as number | undefined) ?? (args.context as number | undefined) ?? 0;
  const afterContext = (args['-A'] as number | undefined) ?? contextC;
  const beforeContext = (args['-B'] as number | undefined) ?? contextC;
  const showLineNumbers = (args['-n'] as boolean | undefined) ?? (outputMode === 'content');

  // Resolve type → glob
  let glob = args.glob as string | undefined;
  const type = args.type as string | undefined;
  if (!glob && type) {
    const mapped = TYPE_GLOB_MAP[type.toLowerCase()];
    if (mapped) glob = mapped;
    else glob = `*.${type}`;
  }

  return {
    pattern: args.pattern as string,
    searchPath: (args.path as string | undefined) ?? process.cwd(),
    glob,
    type,
    outputMode: outputMode as GrepArgs['outputMode'],
    caseInsensitive: (args['-i'] as boolean | undefined) ?? false,
    showLineNumbers,
    afterContext,
    beforeContext,
    headLimit: (args.head_limit as number | undefined) ?? 0,
    offset: (args.offset as number | undefined) ?? 0,
    multiline: (args.multiline as boolean | undefined) ?? false,
  };
}

// ---------------------------------------------------------------------------
// Ripgrep path (content mode)
// ---------------------------------------------------------------------------

async function ripgrepContent(ga: GrepArgs, signal?: AbortSignal): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    if (signal?.aborted) { resolveP(''); return; }

    const args = ['-n', '-e', ga.pattern];
    if (ga.caseInsensitive) args.push('-i');
    if (ga.multiline) args.push('-U', '--multiline-dotall');
    if (ga.glob) args.push('--glob', ga.glob);
    if (ga.afterContext > 0) args.push('-A', String(ga.afterContext));
    if (ga.beforeContext > 0) args.push('-B', String(ga.beforeContext));
    args.push(ga.searchPath);

    const child = execFile('rg', args, { timeout: RG_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      signal?.removeEventListener('abort', onAbort);
      if (err) {
        if ((err as any).code === 1) { resolveP(''); return; }
        rejectP(err);
        return;
      }
      resolveP(stdout);
    });

    // Kill the rg process when the flow is aborted
    const onAbort = () => { try { child.kill(); } catch { /* already dead */ } };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Ripgrep path (files_with_matches mode)
// ---------------------------------------------------------------------------

async function ripgrepFiles(ga: GrepArgs, signal?: AbortSignal): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    if (signal?.aborted) { resolveP(''); return; }

    const args = ['-l', '-e', ga.pattern];
    if (ga.caseInsensitive) args.push('-i');
    if (ga.multiline) args.push('-U', '--multiline-dotall');
    if (ga.glob) args.push('--glob', ga.glob);
    args.push(ga.searchPath);

    const child = execFile('rg', args, { timeout: RG_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      signal?.removeEventListener('abort', onAbort);
      if (err) {
        if ((err as any).code === 1) { resolveP(''); return; }
        rejectP(err);
        return;
      }
      resolveP(stdout);
    });

    const onAbort = () => { try { child.kill(); } catch { /* already dead */ } };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Ripgrep path (count mode)
// ---------------------------------------------------------------------------

async function ripgrepCount(ga: GrepArgs, signal?: AbortSignal): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    if (signal?.aborted) { resolveP(''); return; }

    const args = ['-c', '-e', ga.pattern];
    if (ga.caseInsensitive) args.push('-i');
    if (ga.multiline) args.push('-U', '--multiline-dotall');
    if (ga.glob) args.push('--glob', ga.glob);
    args.push(ga.searchPath);

    const child = execFile('rg', args, { timeout: RG_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      signal?.removeEventListener('abort', onAbort);
      if (err) {
        if ((err as any).code === 1) { resolveP(''); return; }
        rejectP(err);
        return;
      }
      resolveP(stdout);
    });

    const onAbort = () => { try { child.kill(); } catch { /* already dead */ } };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Node.js fallback — collect per-file matches
// ---------------------------------------------------------------------------

interface FileMatch {
  relPath: string;
  matches: Array<{ lineNo: number; line: string }>;
}

async function grepSingleFile(
  fullPath: string, relPath: string, regex: RegExp, multiline: boolean,
): Promise<FileMatch | null> {
  try {
    const content = await readFile(fullPath, 'utf-8');
    if (content.length > 1024 * 1024) return null; // Skip files > 1MB

    if (multiline) {
      if (regex.test(content)) {
        return { relPath, matches: [{ lineNo: 1, line: content.split('\n')[0] }] };
      }
    } else {
      const lines = content.split('\n');
      const fileMatches: FileMatch['matches'] = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          fileMatches.push({ lineNo: i + 1, line: lines[i] });
        }
      }
      if (fileMatches.length > 0) {
        return { relPath, matches: fileMatches };
      }
    }
  } catch {
    // Skip unreadable files
  }
  return null;
}

async function nodeFallbackCollect(ga: GrepArgs, signal?: AbortSignal): Promise<FileMatch[]> {
  const flags = (ga.caseInsensitive ? 'i' : '') + (ga.multiline ? 's' : '');
  const regex = new RegExp(ga.pattern, flags);
  const absBase = resolve(ga.searchPath);
  const results: FileMatch[] = [];

  // Deadline for the entire fallback scan
  const deadline = Date.now() + NODE_FALLBACK_TIMEOUT_MS;
  const isExpired = () => signal?.aborted || Date.now() > deadline;

  // Check if path is a file (not a directory)
  const pathStat = await stat(absBase);
  if (pathStat.isFile()) {
    const relPath = basename(absBase);
    const match = await grepSingleFile(absBase, relPath, regex, ga.multiline);
    if (match) results.push(match);
    return results;
  }

  // Simple extension filter from glob (*.ext)
  let extFilter: string | null = null;
  if (ga.glob && ga.glob.startsWith('*.')) {
    extFilter = ga.glob.slice(1); // e.g. ".ts"
  }

  const entries = await readdir(absBase, { recursive: true, withFileTypes: true });

  let scanned = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;

    // Check abort / timeout periodically (every 200 files)
    if (++scanned % 200 === 0 && isExpired()) break;

    const parentPath = entry.parentPath ?? (entry as any).path ?? '';
    const fullPath = resolve(parentPath, entry.name);
    const relPath = relative(absBase, fullPath).replace(/\\/g, '/');

    // Apply extension filter
    if (extFilter && !entry.name.endsWith(extFilter)) continue;

    const match = await grepSingleFile(fullPath, relPath, regex, ga.multiline);
    if (match) results.push(match);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Node fallback formatters
// ---------------------------------------------------------------------------

function nodeFormatContent(ga: GrepArgs, fileMatches: FileMatch[]): string {
  const lines: string[] = [];
  for (const fm of fileMatches) {
    for (const m of fm.matches) {
      if (ga.showLineNumbers) {
        lines.push(`${fm.relPath}:${m.lineNo}:${m.line}`);
      } else {
        lines.push(`${fm.relPath}:${m.line}`);
      }
    }
  }
  return lines.join('\n');
}

function nodeFormatContentWithContext(ga: GrepArgs, fileMatches: FileMatch[]): string {
  // Context lines require re-reading files — fallback provides basic content mode only.
  // The ripgrep path handles context natively; this is a best-effort fallback.
  return nodeFormatContent(ga, fileMatches);
}

function nodeFormatFiles(fileMatches: FileMatch[]): string {
  return fileMatches.map(fm => fm.relPath).join('\n');
}

function nodeFormatCount(fileMatches: FileMatch[]): string {
  return fileMatches.map(fm => `${fm.relPath}:${fm.matches.length}`).join('\n');
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

function applyPagination(output: string, offset: number, headLimit: number): string {
  if (offset === 0 && headLimit === 0) return output;
  let lines = output.split('\n');
  if (offset > 0) lines = lines.slice(offset);
  if (headLimit > 0) lines = lines.slice(0, headLimit);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const grepToolDef: ToolDefinition = {
  name: 'grep',
  description: TOOL_DESC.grep,
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: TOOL_DESC.grep_pattern,
      },
      path: {
        type: 'string',
        description: TOOL_DESC.grep_path,
      },
      glob: {
        type: 'string',
        description: TOOL_DESC.grep_glob,
      },
      type: {
        type: 'string',
        description: TOOL_DESC.grep_type,
      },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: TOOL_DESC.grep_output_mode,
      },
      '-i': {
        type: 'boolean',
        description: TOOL_DESC.grep_case_insensitive,
      },
      '-n': {
        type: 'boolean',
        description: TOOL_DESC.grep_line_numbers,
      },
      '-A': {
        type: 'number',
        description: TOOL_DESC.grep_after_context,
      },
      '-B': {
        type: 'number',
        description: TOOL_DESC.grep_before_context,
      },
      '-C': {
        type: 'number',
        description: TOOL_DESC.grep_context,
      },
      context: {
        type: 'number',
        description: TOOL_DESC.grep_context_alias,
      },
      head_limit: {
        type: 'number',
        description: TOOL_DESC.grep_head_limit,
      },
      offset: {
        type: 'number',
        description: TOOL_DESC.grep_offset,
      },
      multiline: {
        type: 'boolean',
        description: TOOL_DESC.grep_multiline,
      },
    },
    required: ['pattern'],
  },
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export const grepExecutor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
  const ga = parseArgs(args);

  // Extract abort signal injected by runtime (not part of tool schema)
  const signal = args.__signal as AbortSignal | undefined;

  if (signal?.aborted) {
    return { content: 'Aborted', isError: true };
  }

  try {
    let output: string;

    try {
      // Try ripgrep first
      switch (ga.outputMode) {
        case 'content':
          output = await ripgrepContent(ga, signal);
          break;
        case 'count':
          output = await ripgrepCount(ga, signal);
          break;
        case 'files_with_matches':
        default:
          output = await ripgrepFiles(ga, signal);
          break;
      }
    } catch {
      // Fallback to Node.js search
      const fileMatches = await nodeFallbackCollect(ga, signal);
      switch (ga.outputMode) {
        case 'content':
          output = (ga.afterContext > 0 || ga.beforeContext > 0)
            ? nodeFormatContentWithContext(ga, fileMatches)
            : nodeFormatContent(ga, fileMatches);
          break;
        case 'count':
          output = nodeFormatCount(fileMatches);
          break;
        case 'files_with_matches':
        default:
          output = nodeFormatFiles(fileMatches);
          break;
      }
    }

    if (!output || output.trim().length === 0) {
      return { content: `No matches found for pattern "${ga.pattern}"` };
    }

    // Apply pagination (offset + head_limit)
    output = applyPagination(output, ga.offset, ga.headLimit);

    if (!output || output.trim().length === 0) {
      return { content: `No matches found for pattern "${ga.pattern}" (after pagination)` };
    }

    // Truncation protection
    if (output.length > MAX_OUTPUT_CHARS) {
      output = output.substring(0, MAX_OUTPUT_CHARS);
      output += '\n... [truncated]';
    }

    return { content: output };
  } catch (err: any) {
    return { content: `Error searching: ${err.message}`, isError: true };
  }
};

// ---------------------------------------------------------------------------
// Combined ToolEntry
// ---------------------------------------------------------------------------

export const grepTool: ToolEntry = {
  definition: grepToolDef,
  executor: grepExecutor,
};

