// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Tool: write
// ═══════════════════════════════════════════════════════════════════════════

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry, ToolResultMeta } from '@vesper/shared';
import { TOOL_DESC } from '../prompts.js';
import { computeDiffHunks, isWithinDiffLimit } from './diff-utils.js';

export const writeToolDef: ToolDefinition = {
  name: 'write',
  description: TOOL_DESC.write,
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: TOOL_DESC.write_file_path,
      },
      content: {
        type: 'string',
        description: TOOL_DESC.write_content,
      },
    },
    required: ['file_path', 'content'],
  },
};

export const writeExecutor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
  const filePath = args.file_path as string;
  const content = args.content as string;

  try {
    // Read old content for diff (before write)
    let oldContent: string | null = null;
    let created = false;
    try {
      const old = await readFile(filePath, 'utf-8');
      if (isWithinDiffLimit(old)) {
        oldContent = old;
      }
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        created = true;
        oldContent = '';
      }
      // Other errors: skip diff silently
    }

    await mkdir(dirname(filePath), { recursive: true });
    const buf = Buffer.from(content, 'utf-8');
    await writeFile(filePath, buf);

    const resultContent = `Successfully wrote ${buf.byteLength} bytes to ${filePath}`;

    // Compute diff meta for TUI
    if (oldContent !== null && isWithinDiffLimit(content)) {
      const diffResult = await computeDiffHunks(oldContent, content, filePath);
      if (diffResult) {
        const meta: ToolResultMeta = {
          type: 'file_write',
          filePath,
          diff: diffResult.hunks,
          created,
          linesAdded: diffResult.linesAdded,
          linesRemoved: diffResult.linesRemoved,
        };
        return { content: resultContent, meta };
      }
    }

    return { content: resultContent };
  } catch (err: any) {
    if (err.code === 'EACCES') {
      return { content: `Error: Permission denied: ${filePath}`, isError: true };
    }
    return { content: `Error writing file: ${err.message}`, isError: true };
  }
};

export const writeTool: ToolEntry = {
  definition: writeToolDef,
  executor: writeExecutor,
};
