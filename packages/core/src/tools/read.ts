// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Tool: read
// ═══════════════════════════════════════════════════════════════════════════

import { readFile, stat } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry, ToolResultMeta, ImageAttachment } from '@vesper/shared';
import { TOOL_DESC } from '../prompts.js';

const MAX_OUTPUT_CHARS = 12000;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function getImageExtension(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? ext : null;
}

function extractDimensions(buf: Buffer, ext: string): { width: number; height: number } | undefined {
  try {
    if (ext === '.png') {
      if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      let offset = 2;
      while (offset < buf.length - 1) {
        if (buf[offset] !== 0xFF) break;
        const marker = buf[offset + 1]!;
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          if (offset + 9 <= buf.length) {
            const height = buf.readUInt16BE(offset + 5);
            const width = buf.readUInt16BE(offset + 7);
            return { width, height };
          }
          break;
        }
        if (offset + 3 >= buf.length) break;
        const segLen = buf.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    } else if (ext === '.gif') {
      if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49) {
        return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
      }
    } else if (ext === '.webp') {
      if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        const chunkType = buf.toString('ascii', 12, 16);
        if (chunkType === 'VP8 ' && buf.length >= 30) {
          const width = buf.readUInt16LE(26) & 0x3FFF;
          const height = buf.readUInt16LE(28) & 0x3FFF;
          return { width, height };
        } else if (chunkType === 'VP8L' && buf.length >= 25) {
          const bits = buf.readUInt32LE(21);
          const width = (bits & 0x3FFF) + 1;
          const height = ((bits >> 14) & 0x3FFF) + 1;
          return { width, height };
        }
      }
    }
  } catch {
    // Dimension extraction is best-effort
  }
  return undefined;
}

export const readToolDef: ToolDefinition = {
  name: 'read',
  description: TOOL_DESC.read,
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: TOOL_DESC.read_file_path,
      },
      offset: {
        type: 'number',
        description: TOOL_DESC.read_offset,
      },
      limit: {
        type: 'number',
        description: TOOL_DESC.read_limit,
      },
    },
    required: ['file_path'],
  },
};

export const readExecutor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
  const filePath = args.file_path as string;
  const offset = (args.offset as number | undefined) ?? 1;
  const limit = args.limit as number | undefined;

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      return { content: `Error: Path is a directory: ${filePath}`, isError: true };
    }

    // Image file branch
    const imageExt = getImageExtension(filePath);
    if (imageExt) {
      const sizeBytes = info.size;
      if (sizeBytes > MAX_IMAGE_SIZE) {
        return { content: `Error: Image file too large (${Math.round(sizeBytes / 1024 / 1024)}MB, max ${MAX_IMAGE_SIZE / 1024 / 1024}MB): ${filePath}`, isError: true };
      }
      const buf = await readFile(filePath);
      const data = buf.toString('base64');
      const mimeType = MIME_MAP[imageExt] ?? 'application/octet-stream';
      const dims = extractDimensions(buf, imageExt);
      const filename = basename(filePath);

      const dimStr = dims ? `${dims.width}x${dims.height}, ` : '';
      const sizeKB = Math.round(sizeBytes / 1024);
      const placeholder = `[image: ${filename} (${dimStr}${sizeKB}kB)]`;

      const attachment: ImageAttachment = {
        type: 'image',
        mimeType,
        data,
        filename,
        ...(dims ? { width: dims.width, height: dims.height } : {}),
        sizeBytes,
      };

      const meta: ToolResultMeta = {
        type: 'file_image',
        filePath,
        mimeType,
        ...(dims ? { width: dims.width, height: dims.height } : {}),
        sizeBytes,
      };

      return { content: placeholder, attachments: [attachment], meta };
    }

    // Text file branch
    const rawBytes = await readFile(filePath, 'utf-8');
    const raw = rawBytes.replace(/\r\n/g, '\n');
    const allLines = raw.split('\n');
    const totalLines = allLines.length;

    const startIndex = Math.max(0, offset - 1);
    const selectedLines = limit !== undefined
      ? allLines.slice(startIndex, startIndex + limit)
      : allLines.slice(startIndex);

    const formatted = selectedLines.map((line, i) => {
      const lineNum = startIndex + i + 1;
      const pad = String(lineNum).padStart(6, ' ');
      return `${pad}\t${line}`;
    });

    let output = formatted.join('\n');

    if (output.length > MAX_OUTPUT_CHARS) {
      const truncatedLines = [];
      let charCount = 0;
      for (const line of formatted) {
        if (charCount + line.length + 1 > MAX_OUTPUT_CHARS) break;
        truncatedLines.push(line);
        charCount += line.length + 1;
      }
      output = truncatedLines.join('\n');
      output += `\n... [truncated, showing ${truncatedLines.length} of ${totalLines} lines]`;
    }

    const startLine = startIndex + 1;
    const endLine = startIndex + selectedLines.length;
    const meta: ToolResultMeta = {
      type: 'file_read',
      filePath,
      fileContent: raw,
      lineCount: totalLines,
      startLine,
      endLine,
    };

    return { content: output, meta };
  } catch (err: any) {
    return { content: `Error reading ${filePath}: ${err.message}`, isError: true };
  }
};

export const readTool: ToolEntry = {
  definition: readToolDef,
  executor: readExecutor,
};
