// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Tool: glob
// ═══════════════════════════════════════════════════════════════════════════

import { readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry } from '@vesper/shared';
import { TOOL_DESC } from '../prompts.js';

const MAX_RESULTS = 500;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: `*` (any non-separator), `**` (any path), `?` (single char).
 */
function globToRegex(pattern: string): RegExp {
  // Normalize separators
  const normalized = pattern.replace(/\\/g, '/');

  let regex = '';
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];

    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        // ** — match any path segment(s)
        if (normalized[i + 2] === '/') {
          regex += '(?:.+/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        // * — match anything except /
        regex += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regex += '[^/]';
      i++;
    } else if (ch === '.') {
      regex += '\\.';
      i++;
    } else {
      regex += ch;
      i++;
    }
  }

  return new RegExp(`^${regex}$`);
}

export const globToolDef: ToolDefinition = {
  name: 'glob',
  description: TOOL_DESC.glob,
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: TOOL_DESC.glob_pattern,
      },
      path: {
        type: 'string',
        description: TOOL_DESC.glob_path,
      },
    },
    required: ['pattern'],
  },
};

export const globExecutor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
  const pattern = args.pattern as string;
  const basePath = (args.path as string | undefined) ?? process.cwd();
  const absBase = resolve(basePath);

  // Extract abort signal injected by runtime (not part of tool schema)
  const signal = args.__signal as AbortSignal | undefined;

  // Build a combined abort: whichever fires first — external abort or timeout
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), DEFAULT_TIMEOUT_MS);

  // Helper: check if we should stop
  const shouldAbort = () => signal?.aborted || timeoutCtrl.signal.aborted;

  try {
    if (signal?.aborted) {
      return { content: 'Aborted', isError: true };
    }

    const regex = globToRegex(pattern);
    const entries = await readdir(absBase, { recursive: true, withFileTypes: true });

    // Check abort after readdir completes (it may have taken a while)
    if (shouldAbort()) {
      return {
        content: signal?.aborted ? 'Aborted' : `Glob timed out after ${DEFAULT_TIMEOUT_MS}ms`,
        isError: true,
      };
    }

    const matches: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;

      // Periodically check abort (every 1000 entries)
      if (matches.length % 1000 === 0 && matches.length > 0 && shouldAbort()) {
        return {
          content: signal?.aborted ? 'Aborted' : `Glob timed out after ${DEFAULT_TIMEOUT_MS}ms`,
          isError: true,
        };
      }

      // Build relative path with forward slashes
      const parentPath = entry.parentPath ?? (entry as any).path ?? '';
      const fullPath = resolve(parentPath, entry.name);
      const relPath = relative(absBase, fullPath).replace(/\\/g, '/');

      if (regex.test(relPath)) {
        matches.push(relPath);
        if (matches.length >= MAX_RESULTS) break;
      }
    }

    if (matches.length === 0) {
      return { content: `No files matching "${pattern}" in ${absBase}` };
    }

    let output = matches.join('\n');
    if (matches.length >= MAX_RESULTS) {
      output += `\n... [truncated at ${MAX_RESULTS} results]`;
    }

    return { content: output };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { content: `Error: Directory not found: ${absBase}`, isError: true };
    }
    return { content: `Error listing files: ${err.message}`, isError: true };
  } finally {
    clearTimeout(timer);
  }
};

export const globTool: ToolEntry = {
  definition: globToolDef,
  executor: globExecutor,
};
