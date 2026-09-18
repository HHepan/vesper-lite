// ============================================================================
// @vesper/bash — Filesystem Builtin Commands
// ls, cp, mv, rm, mkdir, rmdir, cat, head, tail, touch, ln, chmod
// ============================================================================

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { BuiltinFn, CommandContext, ExecResult } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(stdout = ''): ExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string, code = 1): ExecResult {
  return { stdout: '', stderr, exitCode: code };
}

/** Resolve a user-provided path relative to the command context's cwd. */
function resolve(cwd: string, p: string): string {
  return path.resolve(cwd, p);
}

/** Parse short flags like "-la" into Set<'l','a'> and collect non-flag args. */
function parseFlags(
  args: string[],
  known: Set<string>,
): { flags: Set<string>; rest: string[] } {
  const flags = new Set<string>();
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === '--') {
      // everything after -- is a positional arg
      rest.push(...args.slice(args.indexOf(arg) + 1));
      break;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (const ch of arg.slice(1)) {
        if (known.has(ch)) flags.add(ch);
      }
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

/**
 * Parse flags that accept a value, e.g. `-n 10`.
 * Returns the value associated with the flag, remaining flags, and rest args.
 */
function parseFlagWithValue(
  args: string[],
  flagChar: string,
  knownBool: Set<string>,
): { flags: Set<string>; flagValue: string | undefined; rest: string[] } {
  const flags = new Set<string>();
  const rest: string[] = [];
  let flagValue: string | undefined;
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const letters = arg.slice(1);
      // BSD shorthand: -<number> → -<flagChar> <number> (e.g. head -5 → head -n 5)
      if (/^\d+$/.test(letters)) {
        flagValue = letters;
        i++;
        continue;
      }
      for (let j = 0; j < letters.length; j++) {
        const ch = letters[j];
        if (ch === flagChar) {
          // value may be the rest of this token or the next token
          const remaining = letters.slice(j + 1);
          if (remaining.length > 0) {
            flagValue = remaining;
          } else {
            i++;
            flagValue = args[i];
          }
          // no more letters to process in this token
          j = letters.length;
        } else if (knownBool.has(ch)) {
          flags.add(ch);
        }
      }
    } else {
      rest.push(arg);
    }
    i++;
  }
  return { flags, flagValue, rest };
}

/** Format a file mode number into an `rwxrwxrwx` string. */
function formatMode(mode: number, isDir: boolean): string {
  const prefix = isDir ? 'd' : '-';
  const rwx = (m: number): string =>
    (m & 4 ? 'r' : '-') + (m & 2 ? 'w' : '-') + (m & 1 ? 'x' : '-');
  return prefix + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7);
}

/** Format file size to a human-readable right-aligned string. */
function padSize(size: number, width: number): string {
  return String(size).padStart(width);
}

/** Format file size in human-readable units (KB, MB, GB). */
function humanSize(size: number): string {
  if (size < 1024) return String(size);
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + 'K';
  if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + 'M';
  return (size / (1024 * 1024 * 1024)).toFixed(1) + 'G';
}

/** Format a date for ls -l output. */
function formatDate(d: Date): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const mon = months[d.getMonth()];
  const day = String(d.getDate()).padStart(2, ' ');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${mon} ${day} ${hours}:${mins}`;
}

// ---------------------------------------------------------------------------
// ls
// ---------------------------------------------------------------------------

async function lsRecursive(
  dir: string,
  flags: Set<string>,
  ctx: CommandContext,
  prefix: string,
): Promise<string[]> {
  ctx.sandbox.checkPath(dir, 'read');
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const filtered = flags.has('a')
    ? entries
    : entries.filter((e) => !e.name.startsWith('.'));

  // Sort: default by name, -S by size (largest first), -t by mtime (newest first)
  if (flags.has('S') || flags.has('t')) {
    // Need stat info for sorting
    const withStats = await Promise.all(
      filtered.map(async (e) => {
        try {
          const s = await fs.stat(path.join(dir, e.name));
          return { entry: e, stat: s };
        } catch {
          return { entry: e, stat: null };
        }
      }),
    );
    if (flags.has('S')) {
      withStats.sort((a, b) => ((b.stat?.size ?? 0) - (a.stat?.size ?? 0)) || a.entry.name.localeCompare(b.entry.name));
    } else {
      withStats.sort((a, b) => ((b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0)) || a.entry.name.localeCompare(b.entry.name));
    }
    filtered.length = 0;
    filtered.push(...withStats.map((w) => w.entry));
  } else {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  const useHuman = flags.has('h');
  const lines: string[] = [];

  if (flags.has('l')) {
    for (const entry of filtered) {
      const fullPath = path.join(dir, entry.name);
      try {
        const stat = await fs.stat(fullPath);
        const mode = formatMode(stat.mode, stat.isDirectory());
        const size = useHuman ? humanSize(stat.size).padStart(8) : padSize(stat.size, 8);
        const date = formatDate(stat.mtime);
        lines.push(`${mode} ${size} ${date} ${prefix}${entry.name}`);
      } catch {
        lines.push(`?????????? ? ? ${prefix}${entry.name}`);
      }
    }
  } else {
    lines.push(filtered.map((e) => `${prefix}${e.name}`).join('\n'));
  }

  if (flags.has('R')) {
    for (const entry of filtered) {
      if (entry.isDirectory()) {
        const subDir = path.join(dir, entry.name);
        const subPrefix = `${prefix}${entry.name}/`;
        lines.push('');
        lines.push(`${subPrefix}:`);
        const subLines = await lsRecursive(subDir, flags, ctx, subPrefix);
        lines.push(...subLines);
      }
    }
  }

  return lines;
}

const ls: BuiltinFn = async (args, ctx) => {
  try {
    const { flags, rest } = parseFlags(args, new Set(['l', 'a', 'R', '1', 'S', 't', 'h']));
    const targets = rest.length > 0 ? rest : ['.'];
    const output: string[] = [];
    const multi = targets.length > 1;

    for (const target of targets) {
      const resolved = resolve(ctx.cwd, target);
      ctx.sandbox.checkPath(resolved, 'read');

      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch {
        return err(`ls: cannot access '${target}': No such file or directory`, 2);
      }

      if (!stat.isDirectory()) {
        // single file
        if (flags.has('l')) {
          const mode = formatMode(stat.mode, false);
          const size = padSize(stat.size, 8);
          const date = formatDate(stat.mtime);
          output.push(`${mode} ${size} ${date} ${target}`);
        } else {
          output.push(target);
        }
        continue;
      }

      if (multi) output.push(`${target}:`);
      const lines = await lsRecursive(resolved, flags, ctx, '');
      output.push(...lines);
      if (multi) output.push('');
    }

    return ok(output.join('\n').trimEnd() + '\n');
  } catch (e: unknown) {
    return err(`ls: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// cp
// ---------------------------------------------------------------------------

async function cpRecursive(
  src: string,
  dest: string,
  ctx: CommandContext,
): Promise<void> {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const entry of entries) {
      const srcEntry = path.join(src, entry);
      const destEntry = path.join(dest, entry);
      ctx.sandbox.checkPath(srcEntry, 'read');
      ctx.sandbox.checkPath(destEntry, 'write');
      await cpRecursive(srcEntry, destEntry, ctx);
    }
  } else {
    await fs.copyFile(src, dest);
  }
}

const cp: BuiltinFn = async (args, ctx) => {
  try {
    const { flags, rest } = parseFlags(args, new Set(['r', 'R']));
    const recursive = flags.has('r') || flags.has('R');

    if (rest.length < 2) {
      return err('cp: missing file operand');
    }

    const sources = rest.slice(0, -1);
    const destArg = rest[rest.length - 1];
    const destResolved = resolve(ctx.cwd, destArg);

    // If multiple sources, dest must be a directory
    let destIsDir = false;
    try {
      const destStat = await fs.stat(destResolved);
      destIsDir = destStat.isDirectory();
    } catch {
      // dest doesn't exist — fine for single source
    }

    if (sources.length > 1 && !destIsDir) {
      return err(`cp: target '${destArg}' is not a directory`);
    }

    for (const src of sources) {
      const srcResolved = resolve(ctx.cwd, src);
      ctx.sandbox.checkPath(srcResolved, 'read');

      let srcStat;
      try {
        srcStat = await fs.stat(srcResolved);
      } catch {
        return err(`cp: cannot stat '${src}': No such file or directory`);
      }

      if (srcStat.isDirectory() && !recursive) {
        return err(`cp: -r not specified; omitting directory '${src}'`);
      }

      const finalDest = destIsDir
        ? path.join(destResolved, path.basename(srcResolved))
        : destResolved;
      ctx.sandbox.checkPath(finalDest, 'write');

      if (srcStat.isDirectory()) {
        await cpRecursive(srcResolved, finalDest, ctx);
      } else {
        await fs.copyFile(srcResolved, finalDest);
      }
    }

    return ok();
  } catch (e: unknown) {
    return err(`cp: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// mv
// ---------------------------------------------------------------------------

const mv: BuiltinFn = async (args, ctx) => {
  try {
    const rest = args.filter((a) => !a.startsWith('-'));
    if (rest.length < 2) {
      return err('mv: missing file operand');
    }

    const sources = rest.slice(0, -1);
    const destArg = rest[rest.length - 1];
    const destResolved = resolve(ctx.cwd, destArg);

    let destIsDir = false;
    try {
      const destStat = await fs.stat(destResolved);
      destIsDir = destStat.isDirectory();
    } catch {
      // dest doesn't exist
    }

    if (sources.length > 1 && !destIsDir) {
      return err(`mv: target '${destArg}' is not a directory`);
    }

    for (const src of sources) {
      const srcResolved = resolve(ctx.cwd, src);
      ctx.sandbox.checkPath(srcResolved, 'write');

      try {
        await fs.access(srcResolved);
      } catch {
        return err(`mv: cannot stat '${src}': No such file or directory`);
      }

      const finalDest = destIsDir
        ? path.join(destResolved, path.basename(srcResolved))
        : destResolved;
      ctx.sandbox.checkPath(finalDest, 'write');

      await fs.rename(srcResolved, finalDest);
    }

    return ok();
  } catch (e: unknown) {
    return err(`mv: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// rm
// ---------------------------------------------------------------------------

const rm: BuiltinFn = async (args, ctx) => {
  try {
    const { flags, rest } = parseFlags(args, new Set(['r', 'R', 'f']));
    const recursive = flags.has('r') || flags.has('R');
    const force = flags.has('f');

    if (rest.length === 0) {
      return force ? ok() : err('rm: missing operand');
    }

    for (const target of rest) {
      const resolved = resolve(ctx.cwd, target);
      ctx.sandbox.checkPath(resolved, 'write');

      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch {
        if (force) continue;
        return err(`rm: cannot remove '${target}': No such file or directory`);
      }

      if (stat.isDirectory()) {
        if (!recursive) {
          return err(`rm: cannot remove '${target}': Is a directory`);
        }
        await fs.rm(resolved, { recursive: true, force: true });
      } else {
        await fs.unlink(resolved);
      }
    }

    return ok();
  } catch (e: unknown) {
    return err(`rm: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// mkdir
// ---------------------------------------------------------------------------

const mkdir: BuiltinFn = async (args, ctx) => {
  try {
    const { flags, rest } = parseFlags(args, new Set(['p']));
    const parents = flags.has('p');

    if (rest.length === 0) {
      return err('mkdir: missing operand');
    }

    for (const target of rest) {
      const resolved = resolve(ctx.cwd, target);
      ctx.sandbox.checkPath(resolved, 'write');

      try {
        await fs.mkdir(resolved, { recursive: parents });
      } catch (e: unknown) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' && !parents) {
          return err(`mkdir: cannot create directory '${target}': File exists`);
        }
        if (code === 'ENOENT' && !parents) {
          return err(
            `mkdir: cannot create directory '${target}': No such file or directory`,
          );
        }
        throw e;
      }
    }

    return ok();
  } catch (e: unknown) {
    return err(`mkdir: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// rmdir
// ---------------------------------------------------------------------------

const rmdir: BuiltinFn = async (args, ctx) => {
  try {
    if (args.length === 0) {
      return err('rmdir: missing operand');
    }

    for (const target of args) {
      if (target.startsWith('-')) continue; // skip unknown flags gracefully
      const resolved = resolve(ctx.cwd, target);
      ctx.sandbox.checkPath(resolved, 'write');

      try {
        await fs.rmdir(resolved);
      } catch (e: unknown) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return err(`rmdir: failed to remove '${target}': No such file or directory`);
        }
        if (code === 'ENOTEMPTY') {
          return err(`rmdir: failed to remove '${target}': Directory not empty`);
        }
        throw e;
      }
    }

    return ok();
  } catch (e: unknown) {
    return err(`rmdir: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// cat
// ---------------------------------------------------------------------------

const cat: BuiltinFn = async (args, ctx) => {
  try {
    const { flags, rest: files } = parseFlags(args, new Set(['n', 'b']));
    const numberAll = flags.has('n');
    const numberNonBlank = flags.has('b');

    if (files.length === 0) {
      const content = ctx.stdin;
      if (numberAll || numberNonBlank) {
        return ok(numberLines(content, numberNonBlank));
      }
      return ok(content);
    }

    const parts: string[] = [];
    for (const file of files) {
      if (file === '/dev/null') {
        parts.push('');
        continue;
      }
      const resolved = resolve(ctx.cwd, file);
      ctx.sandbox.checkPath(resolved, 'read');

      try {
        const content = await fs.readFile(resolved, 'utf-8');
        parts.push(content);
      } catch {
        return err(`cat: ${file}: No such file or directory`);
      }
    }

    let result = parts.join('');
    if (numberAll || numberNonBlank) {
      result = numberLines(result, numberNonBlank);
    }
    return ok(result);
  } catch (e: unknown) {
    return err(`cat: ${(e as Error).message}`);
  }
};

/** Add line numbers to content (for cat -n/-b). */
function numberLines(content: string, nonBlankOnly: boolean): string {
  const lines = content.split('\n');
  // If content ends with \n, last element is '' — preserve it without numbering
  const hasTrailingNewline = content.endsWith('\n') && lines.length > 0 && lines[lines.length - 1] === '';
  const toNumber = hasTrailingNewline ? lines.slice(0, -1) : lines;
  let lineNum = 1;
  const numbered = toNumber.map((line) => {
    if (nonBlankOnly && line.trim() === '') {
      return line;
    }
    const num = String(lineNum++).padStart(6, ' ');
    return `${num}\t${line}`;
  });
  if (hasTrailingNewline) numbered.push('');
  return numbered.join('\n');
}

// ---------------------------------------------------------------------------
// head
// ---------------------------------------------------------------------------

const head: BuiltinFn = async (args, ctx) => {
  try {
    // Check for -c flag (bytes mode) first
    let byteMode = false;
    let byteCount = 0;
    const filteredArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-c') {
        byteMode = true;
        i++;
        if (i < args.length) byteCount = parseInt(args[i], 10);
      } else if (args[i].startsWith('-c') && args[i].length > 2) {
        byteMode = true;
        byteCount = parseInt(args[i].slice(2), 10);
      } else {
        filteredArgs.push(args[i]);
      }
    }

    if (byteMode) {
      if (isNaN(byteCount) || byteCount < 0) return err('head: invalid number of bytes');
      let content: string;
      const rest = filteredArgs.filter(a => !a.startsWith('-'));
      if (rest.length === 0) {
        content = ctx.stdin;
      } else {
        const resolved = resolve(ctx.cwd, rest[0]);
        ctx.sandbox.checkPath(resolved, 'read');
        try { content = await fs.readFile(resolved, 'utf-8'); } catch { return err(`head: cannot open '${rest[0]}' for reading: No such file or directory`); }
      }
      return ok(content.slice(0, byteCount));
    }

    const { flags, flagValue, rest } = parseFlagWithValue(filteredArgs.length > 0 ? filteredArgs : args, 'n', new Set([]));
    void flags;
    const n = flagValue !== undefined ? parseInt(flagValue, 10) : 10;

    if (isNaN(n) || n < 0) {
      return err('head: invalid number of lines');
    }

    let content: string;
    if (rest.length === 0) {
      content = ctx.stdin;
    } else {
      const resolved = resolve(ctx.cwd, rest[0]);
      ctx.sandbox.checkPath(resolved, 'read');
      try {
        content = await fs.readFile(resolved, 'utf-8');
      } catch {
        return err(`head: cannot open '${rest[0]}' for reading: No such file or directory`);
      }
    }

    const lines = content.split('\n');
    const selected = lines.slice(0, n);
    const result = selected.join('\n');
    return ok(result.endsWith('\n') ? result : result + '\n');
  } catch (e: unknown) {
    return err(`head: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// tail
// ---------------------------------------------------------------------------

const tail: BuiltinFn = async (args, ctx) => {
  try {
    // Check for -c flag (bytes mode) first
    let byteMode = false;
    let byteCount = 0;
    let fromLine: number | null = null; // for +N syntax (tail -n +N: output starting from line N)
    const filteredArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-c') {
        byteMode = true;
        i++;
        if (i < args.length) byteCount = parseInt(args[i], 10);
      } else if (args[i].startsWith('-c') && args[i].length > 2) {
        byteMode = true;
        byteCount = parseInt(args[i].slice(2), 10);
      } else {
        filteredArgs.push(args[i]);
      }
    }

    if (byteMode) {
      if (isNaN(byteCount) || byteCount < 0) return err('tail: invalid number of bytes');
      let content: string;
      const rest = filteredArgs.filter(a => !a.startsWith('-'));
      if (rest.length === 0) {
        content = ctx.stdin;
      } else {
        const resolved = resolve(ctx.cwd, rest[0]);
        ctx.sandbox.checkPath(resolved, 'read');
        try { content = await fs.readFile(resolved, 'utf-8'); } catch { return err(`tail: cannot open '${rest[0]}' for reading: No such file or directory`); }
      }
      return ok(content.slice(-byteCount));
    }

    // Check for +N in -n flag value (tail -n +5 means start from line 5)
    const { flags, flagValue, rest } = parseFlagWithValue(filteredArgs.length > 0 ? filteredArgs : args, 'n', new Set([]));
    void flags;

    if (flagValue !== undefined && flagValue.startsWith('+')) {
      fromLine = parseInt(flagValue.slice(1), 10);
      if (isNaN(fromLine) || fromLine < 1) return err('tail: invalid number of lines');
    }

    const n = fromLine === null ? (flagValue !== undefined ? parseInt(flagValue, 10) : 10) : 0;
    if (fromLine === null && (isNaN(n) || n < 0)) {
      return err('tail: invalid number of lines');
    }

    let content: string;
    if (rest.length === 0) {
      content = ctx.stdin;
    } else {
      const resolved = resolve(ctx.cwd, rest[0]);
      ctx.sandbox.checkPath(resolved, 'read');
      try {
        content = await fs.readFile(resolved, 'utf-8');
      } catch {
        return err(`tail: cannot open '${rest[0]}' for reading: No such file or directory`);
      }
    }

    const lines = content.split('\n');

    let selected: string[];
    if (fromLine !== null) {
      // +N means output starting from line N (1-indexed)
      selected = lines.slice(fromLine - 1);
    } else {
      selected = lines.slice(-n);
    }

    const result = selected.join('\n');
    return ok(result.endsWith('\n') ? result : result + '\n');
  } catch (e: unknown) {
    return err(`tail: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// touch
// ---------------------------------------------------------------------------

const touch: BuiltinFn = async (args, ctx) => {
  try {
    const files = args.filter((a) => !a.startsWith('-'));
    if (files.length === 0) {
      return err('touch: missing file operand');
    }

    const now = new Date();
    for (const file of files) {
      const resolved = resolve(ctx.cwd, file);
      ctx.sandbox.checkPath(resolved, 'write');

      try {
        // Update timestamps if file exists
        await fs.utimes(resolved, now, now);
      } catch {
        // Create empty file if it doesn't exist
        try {
          await fs.writeFile(resolved, '', { flag: 'a' });
        } catch (e2: unknown) {
          return err(`touch: cannot touch '${file}': ${(e2 as Error).message}`);
        }
      }
    }

    return ok();
  } catch (e: unknown) {
    return err(`touch: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// ln
// ---------------------------------------------------------------------------

const ln: BuiltinFn = async (args, ctx) => {
  try {
    const { flags, rest } = parseFlags(args, new Set(['s']));
    const symbolic = flags.has('s');

    if (rest.length < 2) {
      return err('ln: missing file operand');
    }

    const target = resolve(ctx.cwd, rest[0]);
    const linkPath = resolve(ctx.cwd, rest[1]);
    ctx.sandbox.checkPath(target, 'read');
    ctx.sandbox.checkPath(linkPath, 'write');

    if (symbolic) {
      // For symbolic links, use the original target path (can be relative or absolute)
      await fs.symlink(target, linkPath);
    } else {
      await fs.link(target, linkPath);
    }

    return ok();
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return err(`ln: failed to create link '${args[args.length - 1]}': File exists`);
    }
    if (code === 'ENOENT') {
      return err(`ln: failed to access '${args[0]}': No such file or directory`);
    }
    return err(`ln: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// chmod — Change file permissions
// ---------------------------------------------------------------------------

/**
 * Parse symbolic mode string (e.g. "u+x", "go-w", "+x", "a+rwx").
 * Returns a function that transforms an existing mode number.
 */
function parseSymbolicMode(modeStr: string, currentMode: number): number {
  // Try octal first
  if (/^[0-7]{3,4}$/.test(modeStr)) {
    return parseInt(modeStr, 8);
  }

  let mode = currentMode;
  // Split by comma for multiple clauses: "u+x,g+w"
  const clauses = modeStr.split(',');

  for (const clause of clauses) {
    const match = clause.match(/^([ugoa]*)([+\-=])([rwx]*)$/);
    if (!match) continue;

    let [, who, op, perms] = match;
    if (!who || who === 'a') who = 'ugo';

    let bits = 0;
    if (perms.includes('r')) bits |= 4;
    if (perms.includes('w')) bits |= 2;
    if (perms.includes('x')) bits |= 1;

    for (const w of who) {
      const shift = w === 'u' ? 6 : w === 'g' ? 3 : 0;
      const shifted = bits << shift;
      if (op === '+') {
        mode |= shifted;
      } else if (op === '-') {
        mode &= ~shifted;
      } else if (op === '=') {
        // Clear the target bits, then set
        mode &= ~(7 << shift);
        mode |= shifted;
      }
    }
  }

  return mode;
}

const chmod: BuiltinFn = async (args, ctx) => {
  try {
    const { flags, rest } = parseFlags(args, new Set(['R']));
    const recursive = flags.has('R');

    if (rest.length < 2) {
      return err('chmod: missing operand');
    }

    const modeStr = rest[0];
    const targets = rest.slice(1);

    async function applyChmod(filePath: string): Promise<ExecResult | null> {
      ctx.sandbox.checkPath(filePath, 'write');
      let currentStat;
      try {
        currentStat = await fs.stat(filePath);
      } catch {
        return err(`chmod: cannot access '${filePath}': No such file or directory`);
      }

      const newMode = parseSymbolicMode(modeStr, currentStat.mode & 0o777);
      await fs.chmod(filePath, newMode);

      if (recursive && currentStat.isDirectory()) {
        const entries = await fs.readdir(filePath, { withFileTypes: true });
        for (const entry of entries) {
          const childPath = path.join(filePath, entry.name);
          const childErr = await applyChmod(childPath);
          if (childErr) return childErr;
        }
      }
      return null;
    }

    for (const target of targets) {
      const resolved = resolve(ctx.cwd, target);
      const result = await applyChmod(resolved);
      if (result) return result;
    }

    return ok();
  } catch (e: unknown) {
    return err(`chmod: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const fsBuiltins: Record<string, BuiltinFn> = {
  ls,
  cp,
  mv,
  rm,
  mkdir,
  rmdir,
  cat,
  head,
  tail,
  touch,
  ln,
  chmod,
};
