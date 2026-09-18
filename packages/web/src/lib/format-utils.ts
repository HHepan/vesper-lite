// =============================================================================
// Vesper WebUI — Format Utilities
//
// Extracted helpers used across multiple components.
// =============================================================================

/** Format elapsed milliseconds as a human-readable duration string (e.g. "3s", "1m 27s"). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** Format token count for display (e.g. 1234 → "1.2k", 1234567 → "1.2M"). */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

const MAX_RESULT_LINES = 3;
const MAX_RESULT_CHARS = 200;

/** Clamp tool result text: max 3 lines + 200 chars (matching TUI behavior). */
export function clampResult(text: string): string {
  let clamped = text;
  let charClamped = false;
  if (clamped.length > MAX_RESULT_CHARS) {
    clamped = clamped.slice(0, MAX_RESULT_CHARS);
    charClamped = true;
  }
  const lines = clamped.split('\n');
  if (lines.length > MAX_RESULT_LINES) {
    return lines.slice(0, MAX_RESULT_LINES).join('\n') + `\n... (+${text.split('\n').length - MAX_RESULT_LINES} lines)`;
  }
  if (charClamped) {
    return clamped + '...';
  }
  return clamped;
}

/** Format tool arguments for preview display. */
export function formatArgsPreview(args: Record<string, any>, maxLen: number = 80): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';

  const parts: string[] = [];
  let totalLen = 0;

  for (const [key, value] of entries) {
    const strVal = typeof value === 'string' ? value : JSON.stringify(value);
    const truncVal = strVal.length > 40 ? strVal.slice(0, 40) + '…' : strVal;
    const part = `${key}=${truncVal}`;
    if (totalLen + part.length > maxLen && parts.length > 0) {
      parts.push('…');
      break;
    }
    parts.push(part);
    totalLen += part.length;
  }

  return parts.join(' ');
}

/** Format file tool header from meta (e.g. "Read src/index.ts (42 lines)"). */
export function formatFileToolHeader(meta: { filePath?: string; lineCount?: number; action?: string } | undefined): string | null {
  if (!meta?.filePath) return null;
  const action = meta.action || 'File';
  const lines = meta.lineCount ? ` (${meta.lineCount} lines)` : '';
  return `${action} ${meta.filePath}${lines}`;
}
