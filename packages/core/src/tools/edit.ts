// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Tool: edit
// ═══════════════════════════════════════════════════════════════════════════

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry, ToolResultMeta } from '@vesper/shared';
import { TOOL_DESC } from '../prompts.js';
import { computeDiffHunks, isWithinDiffLimit } from './diff-utils.js';

export const editToolDef: ToolDefinition = {
  name: 'edit',
  description: TOOL_DESC.edit,
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: TOOL_DESC.edit_file_path,
      },
      old_string: {
        type: 'string',
        description: TOOL_DESC.edit_old_string,
      },
      new_string: {
        type: 'string',
        description: TOOL_DESC.edit_new_string,
      },
      replace_all: {
        type: 'boolean',
        description: TOOL_DESC.edit_replace_all,
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
};

export const editExecutor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
  const filePath = args.file_path as string;
  const oldString = args.old_string as string;
  const newString = args.new_string as string;
  const replaceAll = args.replace_all as boolean | undefined;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // Normalize CRLF → LF for matching purposes
  const normLF = (s: string) => s.replace(/\r\n/g, '\n');

  // Detect whether original file uses CRLF
  const isCRLF = (s: string) => s.includes('\r\n');

  // Restore the file's original line-ending style when writing back
  const toFileEnding = (s: string, useCRLF: boolean) =>
    useCRLF ? s.replace(/\n/g, '\r\n') : s;

  // Count non-overlapping occurrences of `needle` in `haystack`
  function countOccurrences(haystack: string, needle: string): number {
    let count = 0;
    let pos = 0;
    while (true) {
      const idx = haystack.indexOf(needle, pos);
      if (idx === -1) break;
      count++;
      pos = idx + needle.length;
    }
    return count;
  }

  // Fuzzy whitespace fallback: trim trailing whitespace from each line before
  // matching. Returns the original-content substring that matched (for precise
  // replacement), or null if still no match.
  function fuzzyMatch(fileContent: string, search: string): { matched: string; count: number } | null {
    const trimTrailing = (s: string) =>
      s.split('\n').map(l => l.trimEnd()).join('\n');
    const fileTrimmed = trimTrailing(fileContent);
    const searchTrimmed = trimTrailing(search);
    const count = countOccurrences(fileTrimmed, searchTrimmed);
    if (count === 0) return null;

    // Map the match position(s) in trimmed text back to original text.
    // We do this by finding the byte offset in trimmed → scanning original
    // lines to reconstruct the exact original substring.
    const idx = fileTrimmed.indexOf(searchTrimmed);
    // Convert offset in trimmed text to line/col
    const trimmedBefore = fileTrimmed.slice(0, idx);
    const startLine = trimmedBefore.split('\n').length - 1;
    const searchLines = searchTrimmed.split('\n');
    const endLine = startLine + searchLines.length - 1;

    const origLines = fileContent.split('\n');
    const matched = origLines.slice(startLine, endLine + 1).join('\n');

    // Verify the first and last trimmed lines actually align
    if (trimTrailing(matched) !== searchTrimmed) return null;

    return { matched, count };
  }

  // Compute edit diff meta
  async function buildEditMeta(oldFileContent: string, newFileContent: string): Promise<ToolResultMeta | undefined> {
    if (!isWithinDiffLimit(oldFileContent) || !isWithinDiffLimit(newFileContent)) return undefined;
    const diffResult = await computeDiffHunks(oldFileContent, newFileContent, filePath);
    if (!diffResult) return undefined;
    return {
      type: 'file_edit',
      filePath,
      diff: diffResult.hunks,
      linesAdded: diffResult.linesAdded,
      linesRemoved: diffResult.linesRemoved,
    };
  }

  // ---------------------------------------------------------------------------
  // Special case: empty old_string + file does not exist → create new file
  // ---------------------------------------------------------------------------

  if (oldString === '') {
    try {
      await readFile(filePath, 'utf-8');
      return {
        content: 'Error: old_string is empty but file already exists. Provide a non-empty old_string to edit.',
        isError: true,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, newString, 'utf-8');
        const meta = await buildEditMeta('', newString);
        return { content: `Created new file: ${filePath}`, ...(meta ? { meta } : {}) };
      }
      return { content: `Error reading file: ${err.message}`, isError: true };
    }
  }

  // ---------------------------------------------------------------------------
  // Main edit logic with 3-tier matching
  // ---------------------------------------------------------------------------

  try {
    const rawContent = await readFile(filePath, 'utf-8');
    const fileCRLF = isCRLF(rawContent);

    // Tier 1: Exact match on raw content
    const exactCount = countOccurrences(rawContent, oldString);
    if (exactCount > 0) {
      return applyEdit(rawContent, oldString, newString, exactCount, fileCRLF, false);
    }

    // Tier 2: Normalize CRLF → LF on both sides and retry
    const normContent = normLF(rawContent);
    const normOld = normLF(oldString);
    const normNew = normLF(newString);
    const normCount = countOccurrences(normContent, normOld);
    if (normCount > 0) {
      return applyEdit(normContent, normOld, normNew, normCount, fileCRLF, true);
    }

    // Tier 3: Fuzzy whitespace (trim trailing spaces per line)
    const fuzzy = fuzzyMatch(normContent, normOld);
    if (fuzzy) {
      return applyEdit(normContent, fuzzy.matched, normNew, fuzzy.count, fileCRLF, true);
    }

    return { content: 'Error: String not found in file', isError: true };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { content: `Error: File not found: ${filePath}`, isError: true };
    }
    if (err.code === 'EACCES') {
      return { content: `Error: Permission denied: ${filePath}`, isError: true };
    }
    return { content: `Error editing file: ${err.message}`, isError: true };
  }

  // Apply the replacement, write back, and build meta
  async function applyEdit(
    content: string,
    matchStr: string,
    replacement: string,
    count: number,
    useCRLF: boolean,
    normalized: boolean,
  ): Promise<ToolResult> {
    if (replaceAll) {
      const updated = content.split(matchStr).join(replacement);
      const finalContent = normalized ? toFileEnding(updated, useCRLF) : updated;
      await writeFile(filePath, finalContent, 'utf-8');
      const resultText = `Successfully edited ${filePath} (replaced ${count} occurrence${count > 1 ? 's' : ''})`;
      const meta = await buildEditMeta(content, updated);
      return { content: resultText, ...(meta ? { meta } : {}) };
    }

    if (count > 1) {
      return {
        content: `Error: Found ${count} occurrences, provide more specific match or set replace_all to true`,
        isError: true,
      };
    }

    const updated = content.replace(matchStr, replacement);
    const finalContent = normalized ? toFileEnding(updated, useCRLF) : updated;
    await writeFile(filePath, finalContent, 'utf-8');
    const meta = await buildEditMeta(content, updated);
    return { content: `Successfully edited ${filePath}`, ...(meta ? { meta } : {}) };
  }
};

export const editTool: ToolEntry = {
  definition: editToolDef,
  executor: editExecutor,
};

