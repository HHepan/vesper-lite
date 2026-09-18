// ============================================================================
// @vesper/bash — Sandbox permission enforcement
// Uses only node:path.  Zero external dependencies.
// ============================================================================

import { resolve, normalize, sep } from 'node:path';
import type { BashConfig, SandboxChecker } from './types.js';

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

const IS_WIN = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a `SandboxChecker` from a `BashConfig`.
 *
 * The checker enforces:
 *   1. **Path sandboxing** — all file-system operations must target paths that
 *      are within `allowedDirs` (defaults to `[config.cwd]`) AND not within
 *      any `deniedDirs`.
 *   2. **Read-only mode** — when `config.readOnly` is true, all write
 *      operations are blocked.
 *   3. **Command allow/deny lists** — if `allowedCommands` is set, only those
 *      commands may execute.  `deniedCommands` always blocks the listed names.
 *
 * Path comparisons are **case-insensitive on Windows** (`process.platform ===
 * 'win32'`) and case-sensitive elsewhere.
 *
 * All checking methods throw a descriptive `Error` on violation.
 */
export function createSandbox(config: BashConfig): SandboxChecker {
  const cwd = resolveAndNormalise(config.cwd);

  // Resolve allowed directories to absolute, normalised paths.
  // Default: only the configured cwd is allowed.
  const allowed: string[] = (config.allowedDirs && config.allowedDirs.length > 0)
    ? config.allowedDirs.map(d => resolveAndNormalise(d))
    : [cwd];

  // Resolve denied directories.
  const denied: string[] = (config.deniedDirs ?? []).map(d => resolveAndNormalise(d));

  // Normalise command lists to lowercase arrays (for case-insensitive matching
  // on Windows where `cmd.exe` / PowerShell is case-insensitive, and for
  // consistency on Unix where command names *are* case-sensitive but we still
  // normalise the allow/deny lists for predictable matching).
  const allowedCmds: string[] | undefined = config.allowedCommands
    ? config.allowedCommands.map(c => normCmd(c))
    : undefined;
  const deniedCmds: string[] = (config.deniedCommands ?? []).map(c => normCmd(c));

  const readOnly = config.readOnly === true;

  // -----------------------------------------------------------------------
  // SandboxChecker implementation
  // -----------------------------------------------------------------------
  return {
    checkPath(path: string, operation: 'read' | 'write'): void {
      // Block all writes in read-only mode
      if (operation === 'write' && readOnly) {
        throw new Error(
          `Sandbox violation: write operation blocked in read-only mode ` +
          `(target: ${path})`,
        );
      }

      // Resolve the target path relative to cwd so that relative paths work
      const abs = resolveAndNormalise(resolve(cwd, path));

      // Check denied list first (deny takes priority over allow)
      for (const d of denied) {
        if (isEqualOrDescendant(abs, d)) {
          throw new Error(
            `Sandbox violation: path "${path}" resolves to "${abs}" ` +
            `which is inside denied directory "${d}"`,
          );
        }
      }

      // Check that the path is inside at least one allowed directory
      let insideAllowed = false;
      for (const a of allowed) {
        if (isEqualOrDescendant(abs, a)) {
          insideAllowed = true;
          break;
        }
      }

      if (!insideAllowed) {
        throw new Error(
          `Sandbox violation: path "${path}" resolves to "${abs}" ` +
          `which is outside all allowed directories [${allowed.join(', ')}]`,
        );
      }
    },

    checkCommand(name: string): void {
      const norm = normCmd(name);

      // Deny list always wins
      if (deniedCmds.includes(norm)) {
        throw new Error(
          `Sandbox violation: command "${name}" is in the denied commands list`,
        );
      }

      // If an allow list is configured, the command must appear in it
      if (allowedCmds !== undefined && !allowedCmds.includes(norm)) {
        throw new Error(
          `Sandbox violation: command "${name}" is not in the allowed commands list ` +
          `[${config.allowedCommands!.join(', ')}]`,
        );
      }
    },

    isReadOnly(): boolean {
      return readOnly;
    },

    addAllowedDir(dir: string): void {
      const abs = resolveAndNormalise(dir);
      if (!allowed.includes(abs)) {
        allowed.push(abs);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a path to absolute form and normalise it (collapse `.`, `..`,
 * remove trailing separators).
 */
function resolveAndNormalise(p: string): string {
  let result = normalize(resolve(p));
  // Remove trailing separator (unless it's a root like `/` or `C:\`)
  if (result.length > 1 && result.endsWith(sep)) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * Check whether `target` is equal to `base` or is a descendant (child) of
 * `base`.
 *
 * Both paths must already be absolute and normalised.
 *
 * On Windows the comparison is case-insensitive; on other platforms it is
 * case-sensitive.
 */
function isEqualOrDescendant(target: string, base: string): boolean {
  const t = forComparison(target);
  const b = forComparison(base);

  if (t === b) return true;

  // `target` is a descendant if it starts with `base` followed by a separator.
  // We append `sep` to `base` to avoid false positives where base="/foo" and
  // target="/foobar".
  const prefix = b.endsWith(sepForComparison()) ? b : b + sepForComparison();
  return t.startsWith(prefix);
}

/**
 * Prepare a path string for comparison.
 * On Windows: lowercase.  On Unix: unchanged.
 */
function forComparison(p: string): string {
  return IS_WIN ? p.toLowerCase() : p;
}

/**
 * Return the separator character used in comparison strings.
 */
function sepForComparison(): string {
  return IS_WIN ? sep.toLowerCase() : sep;
}

/**
 * Normalise a command name for allow/deny list comparison.
 *
 * On Windows, strip common extensions (.exe, .cmd, .bat, .com) and lowercase.
 * On Unix, just return as-is (commands are case-sensitive but we still trim
 * path prefixes — allow/deny lists use bare names like "rm", not "/usr/bin/rm").
 */
function normCmd(name: string): string {
  // Extract just the base name if a path was provided
  let base = name;
  const lastSlash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
  if (lastSlash >= 0) {
    base = base.slice(lastSlash + 1);
  }

  if (IS_WIN) {
    base = base.toLowerCase();
    // Strip known Windows executable extensions
    for (const ext of ['.exe', '.cmd', '.bat', '.com']) {
      if (base.endsWith(ext)) {
        base = base.slice(0, -ext.length);
        break;
      }
    }
  }

  return base;
}
