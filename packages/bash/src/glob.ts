// ============================================================================
// @vesper/bash — Pure Node.js glob pattern expansion
// Supports *, ?, and ** patterns.  Uses only node:fs and node:path.
// ============================================================================

import { readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Expand a glob pattern relative to `cwd` and return matching file paths.
 *
 * Behaviour mirrors bash conventions:
 *   - `*`  matches any sequence of characters except `/`
 *   - `?`  matches exactly one character except `/`
 *   - `**` matches zero or more directories at any depth
 *   - If no matches are found, the original pattern is returned verbatim
 *   - Results are sorted alphabetically
 *   - Literal paths (no glob meta-characters) are returned as-is if they exist
 *
 * @param pattern  Glob pattern, may contain `*`, `?`, `**`
 * @param cwd      Base directory for relative patterns
 * @returns        Sorted array of matched paths (relative to cwd)
 */
export async function expandGlob(pattern: string, cwd: string): Promise<string[]> {
  // Fast path: no glob meta-characters — just check existence
  if (!hasGlobChars(pattern)) {
    const abs = resolve(cwd, pattern);
    try {
      await stat(abs);
      return [pattern];
    } catch {
      // bash convention: return the literal pattern even if it doesn't exist
      return [pattern];
    }
  }

  // Normalise separators to forward slashes for consistent matching
  const normalised = pattern.replace(/\\/g, '/');
  const segments = normalised.split('/');

  // Collect matches by walking the file tree
  const matches: string[] = [];
  await walkGlob(cwd, segments, 0, '', matches);

  if (matches.length === 0) {
    // bash convention: no matches → return the original pattern
    return [pattern];
  }

  matches.sort((a, b) => a.localeCompare(b));
  return matches;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Return true if the string contains any unescaped glob meta-characters. */
function hasGlobChars(s: string): boolean {
  return /[*?]/.test(s);
}

/**
 * Compile a single glob segment (e.g. `*.ts`, `foo?bar`) into a RegExp.
 *
 * - `*`  → `[^/]*`
 * - `?`  → `[^/]`
 * - All other regex special characters are escaped.
 */
function segmentToRegex(segment: string): RegExp {
  let re = '';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      // Escape regex special chars
      re += escapeRegexChar(ch);
    }
  }
  return new RegExp(`^${re}$`);
}

/** Escape a single character for use inside a RegExp. */
function escapeRegexChar(ch: string): string {
  if ('.+^${}()|[]\\'.includes(ch)) {
    return '\\' + ch;
  }
  return ch;
}

/**
 * Recursive walker that matches segments of a glob pattern against the
 * filesystem tree.
 *
 * @param base       Absolute path of the current directory being scanned
 * @param segments   The full array of glob pattern segments
 * @param segIdx     Index of the segment we are currently matching
 * @param relPrefix  Relative path prefix accumulated so far (for result strings)
 * @param out        Accumulator for matched paths
 */
async function walkGlob(
  base: string,
  segments: string[],
  segIdx: number,
  relPrefix: string,
  out: string[],
): Promise<void> {
  // All segments consumed — the current `relPrefix` is a match
  if (segIdx >= segments.length) {
    if (relPrefix !== '') {
      out.push(relPrefix);
    }
    return;
  }

  const segment = segments[segIdx];
  const isLast = segIdx === segments.length - 1;

  // --- Handle `**` (globstar) ---
  if (segment === '**') {
    // `**` matches zero or more directory levels.
    // Strategy: try matching the *rest* of the pattern starting from the
    // current directory (zero depth), and also recurse into every sub-
    // directory (increasing depth).

    // Zero depth — skip this `**` segment entirely
    await walkGlob(base, segments, segIdx + 1, relPrefix, out);

    // Recurse into child directories
    let entries: string[];
    try {
      entries = await readdirSafe(base);
    } catch {
      return;
    }

    for (const name of entries) {
      const childPath = join(base, name);
      const childRel = relPrefix === '' ? name : relPrefix + '/' + name;

      let childStat;
      try {
        childStat = await stat(childPath);
      } catch {
        continue;
      }

      if (childStat.isDirectory()) {
        // Continue trying `**` at the deeper level
        await walkGlob(childPath, segments, segIdx, childRel, out);
      }
    }

    return;
  }

  // --- Handle literal or wildcard segment ---
  let entries: string[];
  try {
    entries = await readdirSafe(base);
  } catch {
    return;
  }

  const regex = segmentToRegex(segment);

  for (const name of entries) {
    if (!regex.test(name)) continue;

    const childPath = join(base, name);
    const childRel = relPrefix === '' ? name : relPrefix + '/' + name;

    if (isLast) {
      // This is the final segment — the match is complete
      out.push(childRel);
    } else {
      // More segments remain — the match must be a directory
      let childStat;
      try {
        childStat = await stat(childPath);
      } catch {
        continue;
      }
      if (childStat.isDirectory()) {
        await walkGlob(childPath, segments, segIdx + 1, childRel, out);
      }
    }
  }
}

/**
 * Safe readdir that returns an empty array on permission / ENOENT errors
 * instead of throwing.
 */
async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Utility exports (useful for callers that want to test patterns)
// ---------------------------------------------------------------------------

/**
 * Test whether a path string matches a glob pattern.
 * Both `pattern` and `path` should use forward slashes.
 *
 * This is a pure string-level match — no filesystem access.
 */
export function matchGlob(pattern: string, path: string): boolean {
  const patParts = pattern.replace(/\\/g, '/').split('/');
  const pathParts = path.replace(/\\/g, '/').split('/');
  return matchParts(patParts, 0, pathParts, 0);
}

/**
 * Recursive segment-by-segment matcher for `matchGlob`.
 */
function matchParts(
  pat: string[],
  pi: number,
  path: string[],
  ti: number,
): boolean {
  // Both exhausted — match
  if (pi === pat.length && ti === path.length) return true;
  // Pattern exhausted but path remains — no match
  if (pi === pat.length) return false;

  const segment = pat[pi];

  // Globstar
  if (segment === '**') {
    // Try consuming 0, 1, 2, … path segments
    for (let skip = 0; skip <= path.length - ti; skip++) {
      if (matchParts(pat, pi + 1, path, ti + skip)) return true;
    }
    return false;
  }

  // Path exhausted but non-** pattern remains — no match
  if (ti === path.length) return false;

  // Match current segment
  const regex = segmentToRegex(segment);
  if (!regex.test(path[ti])) return false;

  return matchParts(pat, pi + 1, path, ti + 1);
}
