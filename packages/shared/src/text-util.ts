// ---------------------------------------------------------------------------
// Text utilities shared across packages
// ---------------------------------------------------------------------------

/**
 * Strip a leading UTF-8 BOM (U+FEFF) if present.
 * Editors like Notepad may prepend it when saving as "UTF-8".
 */
export function stripBOM(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
