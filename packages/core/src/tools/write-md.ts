// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Tool: write_md (Markdown-only write)
// Wraps the standard write executor with a hard .md extension check.
// ═══════════════════════════════════════════════════════════════════════════

import { extname } from 'node:path';
import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry } from '@vesper/shared';
import { TOOL_DESC } from '../prompts.js';
import { writeExecutor } from './write.js';

export const writeMdToolDef: ToolDefinition = {
  name: 'write_md',
  description: TOOL_DESC.write_md,
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: TOOL_DESC.write_md_file_path,
      },
      content: {
        type: 'string',
        description: TOOL_DESC.write_md_content,
      },
    },
    required: ['file_path', 'content'],
  },
};

export const writeMdExecutor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
  const filePath = args.file_path as string;

  // Hard gate: only .md files allowed
  if (extname(filePath).toLowerCase() !== '.md') {
    return {
      content: `Error: write_md only accepts .md files. Got: "${filePath}"`,
      isError: true,
    };
  }

  // Delegate to the standard write executor
  return writeExecutor(args);
};

export const writeMdTool: ToolEntry = {
  definition: writeMdToolDef,
  executor: writeMdExecutor,
};
