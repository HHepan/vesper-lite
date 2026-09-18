/**
 * path-guard.ts — Self-contained path sandbox for agent tool calls & shell commands.
 *
 * Derived from just-bash's real-fs-utils.ts (Apache-2.0, Vercel Labs),
 * re-designed for the Vesper agent runtime.
 *
 * Design goals:
 *   - Guard Read/Write/Edit tool calls AND git-bash command paths
 *   - Windows-native (path.sep = '\\', drive letters, UNC paths)
 *   - TOCTOU-resistant: resolve symlinks, then use the canonical path
 *   - Fail-closed: any doubt → deny
 *   - Zero external dependencies (only node:fs, node:path)
 *
 * Usage:
 *   const guard = PathGuard.create({ roots: ['C:\\work\\project'] });
 *   const safe  = guard.resolve('/src/index.ts', 'read');   // → canonical path
 *   const safe2 = guard.resolve('../../../etc/passwd', 'read'); // → throws!
 *
 * @module path-guard
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AccessMode = "read" | "write";

export interface RootConfig {
  /** Absolute path to a directory on the real filesystem. */
  path: string;
  /** Access mode. Defaults to 'read'. 'write' implies 'read'. */
  mode?: AccessMode;
}

export interface PathGuardOptions {
  /**
   * Allowed root directories.
   *
   * Accepts either plain strings (read-write) or RootConfig objects.
   *
   * @example
   *   // Simple: one read-write root
   *   PathGuard.create({ roots: ['C:\\work\\project'] })
   *
   *   // Advanced: writable workspace + read-only reference
   *   PathGuard.create({ roots: [
   *     { path: 'C:\\work\\project', mode: 'write' },
   *     { path: 'C:\\docs\\reference', mode: 'read' },
   *   ]})
   */
  roots: (string | RootConfig)[];

  /**
   * Glob patterns of path segments to deny (matched against each segment).
   * Defaults to: ['.env', '.git/config', '*.pem', '*.key']
   * Pass `false` to disable.
   */
  denyPatterns?: string[] | false;

  /**
   * Maximum file size (bytes) for read operations.
   * Files larger than this cause resolve() to throw.
   * Defaults to 50 MB. Pass 0 to disable.
   */
  maxReadSize?: number;
}

export class PathGuardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "OUTSIDE_ROOT"
      | "NULL_BYTE"
      | "DENIED_PATTERN"
      | "NOT_DIRECTORY"
      | "NOT_FOUND"
      | "TOO_LARGE",
    public readonly path: string,
  ) {
    super(message);
    this.name = "PathGuardError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal low-level functions (derived from just-bash real-fs-utils.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether `resolved` is equal to, or a child of, `root`.
 *
 * Uses a boundary-safe prefix check (appends path.sep) so that
 * `C:\data` does NOT match `C:\datastore`.
 *
 * Both paths must be absolute and use the OS-native separator.
 * Case-insensitive comparison on Windows.
 */
function isWithinRoot(resolved: string, root: string): boolean {
  const norm = process.platform === "win32"
    ? (s: string) => s.toLowerCase()
    : (s: string) => s;

  const r = norm(resolved);
  const b = norm(root);

  return r === b || r.startsWith(b + nodePath.sep);
}

/**
 * Resolve a real path to its canonical form, verify it stays within `root`.
 *
 * Returns the canonical path on success, or `null` if it escapes.
 * For non-existent paths, walks up to the nearest existing parent.
 * Fail-closed on any unexpected error.
 */
function resolveCanonical(
  realPath: string,
  canonicalRoot: string,
): string | null {
  try {
    const resolved = fs.realpathSync(realPath);
    return isWithinRoot(resolved, canonicalRoot) ? resolved : null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      const parent = nodePath.dirname(realPath);
      if (parent === realPath) return null; // hit filesystem root
      const parentCanon = resolveCanonical(parent, canonicalRoot);
      if (parentCanon === null) return null;
      return nodePath.join(parentCanon, nodePath.basename(realPath));
    }
    // EACCES, EIO, etc. → fail closed
    return null;
  }
}

/**
 * Reject paths containing null bytes (truncation attack vector).
 */
function assertNoNullByte(p: string): void {
  if (p.includes("\0")) {
    throw new PathGuardError(
      `Path contains null byte: '${p}'`,
      "NULL_BYTE",
      p,
    );
  }
}

/**
 * Normalize a user-supplied path fragment that may be:
 *   - absolute with drive letter (C:\foo)
 *   - absolute unix-style (/foo, from git bash)
 *   - relative (src/index.ts, ../foo)
 *
 * Returns an absolute OS-native path.
 *
 * `base` is the anchor directory for resolving relative paths
 * (typically cwd or a root directory).
 */
function toAbsolute(userPath: string, base: string): string {
  // On Windows, git bash often passes /c/Users/... style paths.
  // Convert /c/... → C:\... for Windows native path resolution.
  let adjusted = userPath;
  if (
    process.platform === "win32" &&
    /^\/[a-zA-Z]\//.test(adjusted)
  ) {
    adjusted = `${adjusted[1].toUpperCase()}:\\${adjusted.slice(3).replace(/\//g, "\\")}`;
  }

  if (nodePath.isAbsolute(adjusted)) {
    return nodePath.resolve(adjusted);
  }
  return nodePath.resolve(base, adjusted);
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple glob segment matcher (no external deps)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Match a single filename against a simple glob pattern.
 * Supports only `*` (any chars) and `?` (single char).
 * Case-insensitive on Windows.
 */
function segmentMatches(segment: string, pattern: string): boolean {
  const s = process.platform === "win32" ? segment.toLowerCase() : segment;
  const p = process.platform === "win32" ? pattern.toLowerCase() : pattern;

  // Convert glob pattern to regex
  let re = "^";
  for (const c of p) {
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  re += "$";

  return new RegExp(re).test(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// PathGuard class
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedRoot {
  canonical: string; // fs.realpathSync(root)
  mode: AccessMode;
}

export class PathGuard {
  private roots: ResolvedRoot[];
  private readonly denyPatterns: string[] | false;
  private readonly maxReadSize: number;
  private cwd: string;

  private constructor(
    roots: ResolvedRoot[],
    denyPatterns: string[] | false,
    maxReadSize: number,
  ) {
    this.roots = roots;
    this.denyPatterns = denyPatterns;
    this.maxReadSize = maxReadSize;
    this.cwd = roots[0]?.canonical ?? process.cwd();
  }

  /**
   * Create a PathGuard instance.
   *
   * Validates that all root directories exist and are directories.
   * Resolves symlinks in root paths at construction time.
   */
  static create(options: PathGuardOptions): PathGuard {
    if (options.roots.length === 0) {
      throw new Error("PathGuard requires at least one root directory");
    }

    const resolved: ResolvedRoot[] = options.roots.map((r) => {
      const cfg: RootConfig =
        typeof r === "string" ? { path: r, mode: "write" } : r;

      const abs = nodePath.resolve(cfg.path);

      if (!fs.existsSync(abs)) {
        throw new PathGuardError(
          `Root does not exist: ${abs}`,
          "NOT_FOUND",
          abs,
        );
      }
      if (!fs.statSync(abs).isDirectory()) {
        throw new PathGuardError(
          `Root is not a directory: ${abs}`,
          "NOT_DIRECTORY",
          abs,
        );
      }

      const canonical = fs.realpathSync(abs);

      return {
        canonical,
        mode: cfg.mode ?? "write",
      };
    });

    const deny =
      options.denyPatterns === false
        ? false
        : options.denyPatterns ?? [".env", ".git/config", "*.pem", "*.key"];

    const maxRead = options.maxReadSize ?? 50 * 1024 * 1024; // 50 MB

    const guard = new PathGuard(resolved, deny, maxRead);
    guard.cwd = resolved[0].canonical;
    return guard;
  }

  // ─── Dynamic root / CWD management ─────────────────────────────────

  /**
   * Add a new allowed root directory (e.g. after /cd or /add-dir).
   * Silently deduplicates by canonical path.
   */
  addRoot(root: string | RootConfig): void {
    const cfg: RootConfig = typeof root === 'string' ? { path: root, mode: 'write' } : root;
    const abs = nodePath.resolve(cfg.path);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      throw new PathGuardError(`Cannot add root: ${abs}`, 'NOT_DIRECTORY', abs);
    }
    const canonical = fs.realpathSync(abs);
    if (this.roots.some(r => r.canonical === canonical)) return;
    this.roots.push({ canonical, mode: cfg.mode ?? 'write' });
  }

  /**
   * Update the working directory (called by /cd handler).
   * Automatically adds the directory as a root if not already covered.
   */
  setCwd(newCwd: string): void {
    const abs = nodePath.resolve(newCwd);
    let canonical: string;
    try {
      canonical = fs.realpathSync(abs);
    } catch {
      canonical = abs;
    }
    this.cwd = canonical;
    // Auto-add as root if not already covered by an existing root
    if (!this.roots.some(r => isWithinRoot(canonical, r.canonical))) {
      this.roots.push({ canonical, mode: 'write' });
    }
  }

  /** Get the current working directory (canonical path). */
  getCwd(): string {
    return this.cwd;
  }

  // ─── Primary API ────────────────────────────────────────────────────────

  /**
   * Resolve and validate a user-supplied path.
   *
   * Returns the **canonical OS path** that is safe to use for I/O.
   * Throws PathGuardError if the path escapes the sandbox or is denied.
   *
   * @param userPath - Path from agent (absolute, relative, or git-bash style)
   * @param mode     - 'read' or 'write'
   * @param base     - Base for resolving relative paths. Defaults to first root.
   */
  resolve(
    userPath: string,
    mode: AccessMode = "read",
    base?: string,
  ): string {
    assertNoNullByte(userPath);

    const anchor = base
      ? nodePath.resolve(base)
      : this.cwd;

    const absolute = toAbsolute(userPath, anchor);

    // Check deny patterns on each segment of the path
    if (this.denyPatterns !== false) {
      this.checkDenyPatterns(absolute, userPath);
    }

    // Find a matching root and validate access
    const match = this.findMatchingRoot(absolute, mode);
    if (!match) {
      throw new PathGuardError(
        `Access denied: '${userPath}' is outside all allowed roots` +
        (mode === "write" ? " (or root is read-only)" : ""),
        "OUTSIDE_ROOT",
        userPath,
      );
    }

    return match.canonical;
  }

  /**
   * Check a path without throwing. Returns the canonical path or null.
   */
  tryResolve(
    userPath: string,
    mode: AccessMode = "read",
    base?: string,
  ): string | null {
    try {
      return this.resolve(userPath, mode, base);
    } catch {
      return null;
    }
  }

  /**
   * Validate a path and also check file size for read operations.
   * Returns the canonical path.
   */
  resolveForRead(userPath: string, base?: string): string {
    const canonical = this.resolve(userPath, "read", base);

    if (this.maxReadSize > 0) {
      try {
        const stat = fs.statSync(canonical);
        if (stat.isFile() && stat.size > this.maxReadSize) {
          throw new PathGuardError(
            `File too large: '${userPath}' (${stat.size} bytes, max ${this.maxReadSize})`,
            "TOO_LARGE",
            userPath,
          );
        }
      } catch (e) {
        if (e instanceof PathGuardError) throw e;
        // ENOENT is fine (file will be created), other errors → ignore
      }
    }

    return canonical;
  }

  /**
   * Validate multiple paths at once (e.g. for a shell command's arguments).
   * Returns an array of canonical paths.
   * Throws on the first violation.
   */
  resolveAll(
    paths: string[],
    mode: AccessMode = "read",
    base?: string,
  ): string[] {
    return paths.map((p) => this.resolve(p, mode, base));
  }

  // ─── Shell integration helpers ──────────────────────────────────────────

  /**
   * Build a safe `--cwd` value for git-bash execution.
   * Ensures the directory is within an allowed root.
   */
  safeCwd(cwd: string): string {
    const canonical = this.resolve(cwd, "read");
    try {
      const stat = fs.statSync(canonical);
      if (!stat.isDirectory()) {
        throw new PathGuardError(
          `Not a directory: '${cwd}'`,
          "NOT_DIRECTORY",
          cwd,
        );
      }
    } catch (e) {
      if (e instanceof PathGuardError) throw e;
      throw new PathGuardError(
        `Cannot access: '${cwd}'`,
        "NOT_FOUND",
        cwd,
      );
    }
    return canonical;
  }

  // ─── Introspection ─────────────────────────────────────────────────────

  /** Get all root canonical paths (for debugging / logging). */
  getRoots(): Array<{ canonical: string; mode: AccessMode }> {
    return this.roots.map((r) => ({
      canonical: r.canonical,
      mode: r.mode,
    }));
  }

  /** Check if a path would be allowed (non-throwing). */
  isAllowed(userPath: string, mode: AccessMode = "read", base?: string): boolean {
    return this.tryResolve(userPath, mode, base) !== null;
  }

  // ─── Private ───────────────────────────────────────────────────────────

  private findMatchingRoot(
    absolute: string,
    mode: AccessMode,
  ): { root: ResolvedRoot; canonical: string } | null {
    for (const root of this.roots) {
      // Mode check: write requires 'write' root, read accepts both
      if (mode === "write" && root.mode === "read") continue;

      const canonical = resolveCanonical(absolute, root.canonical);
      if (canonical !== null) {
        return { root, canonical };
      }
    }
    return null;
  }

  private checkDenyPatterns(absolute: string, originalPath: string): void {
    if (this.denyPatterns === false) return;

    // Split into segments and check each against deny patterns
    const segments = absolute.split(nodePath.sep).filter(Boolean);

    for (const segment of segments) {
      for (const pattern of this.denyPatterns) {
        // Pattern can be "dir/file" for multi-segment match
        if (pattern.includes("/") || pattern.includes("\\")) {
          // Multi-segment: check if the joined path contains this subsequence
          const normalized = absolute.replace(/\\/g, "/").toLowerCase();
          const normPattern = pattern.replace(/\\/g, "/").toLowerCase();
          if (normalized.includes(normPattern)) {
            throw new PathGuardError(
              `Denied by pattern '${pattern}': '${originalPath}'`,
              "DENIED_PATTERN",
              originalPath,
            );
          }
        } else {
          // Single segment glob match
          if (segmentMatches(segment, pattern)) {
            throw new PathGuardError(
              `Denied by pattern '${pattern}': '${originalPath}'`,
              "DENIED_PATTERN",
              originalPath,
            );
          }
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export low-level utilities for advanced use
// ─────────────────────────────────────────────────────────────────────────────

export {
  isWithinRoot,
  resolveCanonical,
  assertNoNullByte,
  toAbsolute,
  segmentMatches,
};
