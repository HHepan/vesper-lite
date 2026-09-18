// ═══════════════════════════════════════════════════════════════════════════
// @vesper/bash — Navigation & Path Builtins
// cd, pwd, find, which, realpath, dirname, basename
// ═══════════════════════════════════════════════════════════════════════════

import { stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

/** Resolve a user-supplied path against the current working directory. */
function resolve(ctx: CommandContext, p: string): string {
  if (path.isAbsolute(p)) return path.normalize(p);
  return path.resolve(ctx.cwd, p);
}

/**
 * Simple glob-style pattern match (supports `*` and `?`).
 * Used by `find -name`.
 */
function globMatch(pattern: string, name: string): boolean {
  // Escape regex specials except * and ?
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if ('.+^${}()|[]\\'.includes(ch)) re += '\\' + ch;
    else re += ch;
  }
  return new RegExp(`^${re}$`).test(name);
}

// ---------------------------------------------------------------------------
// cd — Change directory
// ---------------------------------------------------------------------------

const cd: BuiltinFn = async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  let target: string;

  if (args.length === 0 || args[0] === '~') {
    // cd with no args or cd ~ → home directory
    target = ctx.env['HOME'] || ctx.env['USERPROFILE'] || '/';
  } else if (args[0] === '-') {
    // cd - → previous directory
    const oldpwd = ctx.env['OLDPWD'];
    if (!oldpwd) {
      return err('cd: OLDPWD not set');
    }
    target = oldpwd;
  } else if (args[0].startsWith('~/')) {
    // cd ~/something → expand home
    const home = ctx.env['HOME'] || ctx.env['USERPROFILE'] || '/';
    target = path.join(home, args[0].slice(2));
  } else {
    target = args[0];
  }

  const resolved = resolve(ctx, target);

  // Sandbox check — cd is a read operation
  try {
    ctx.sandbox.checkPath(resolved, 'read');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`cd: ${msg}`);
  }

  // Verify the target exists and is a directory
  try {
    const s = await stat(resolved);
    if (!s.isDirectory()) {
      return err(`cd: ${target}: Not a directory`);
    }
  } catch {
    return err(`cd: ${target}: No such file or directory`);
  }

  // Return the resolved absolute path in stdout so the executor can update cwd.
  // The executor is responsible for updating ctx.cwd, OLDPWD, and PWD.
  return { stdout: resolved, stderr: '', exitCode: 0 };
};

// ---------------------------------------------------------------------------
// pwd — Print working directory
// ---------------------------------------------------------------------------

const pwd: BuiltinFn = async (_args: string[], ctx: CommandContext): Promise<ExecResult> => {
  return ok(ctx.cwd);
};

// ---------------------------------------------------------------------------
// find — Recursive file finder
// Supports: find [path] -name <pattern> -type <f|d>
// ---------------------------------------------------------------------------

interface FindOptions {
  startPath: string;
  namePattern: string | null;
  typeFilter: 'f' | 'd' | null;
  maxDepth: number;
  minDepth: number;
  negate: boolean;
  sizeFilter: string | null; // e.g. "+10k", "-1M", "100c"
  mtimeFilter: string | null; // e.g. "+7", "-1"
}

function parseFindArgs(args: string[], ctx: CommandContext): FindOptions | ExecResult {
  let startPath = ctx.cwd;
  let namePattern: string | null = null;
  let typeFilter: 'f' | 'd' | null = null;
  let maxDepth = Infinity;
  let minDepth = 0;
  let negate = false;
  let sizeFilter: string | null = null;
  let mtimeFilter: string | null = null;
  let i = 0;

  // First non-flag argument is the start path
  if (i < args.length && !args[i].startsWith('-') && args[i] !== '!') {
    startPath = resolve(ctx, args[i]);
    i++;
  }

  while (i < args.length) {
    const flag = args[i];
    if (flag === '-name') {
      i++;
      if (i >= args.length) return err('find: missing argument to -name');
      namePattern = args[i];
    } else if (flag === '-type') {
      i++;
      if (i >= args.length) return err('find: missing argument to -type');
      const t = args[i];
      if (t !== 'f' && t !== 'd') {
        return err(`find: unknown type '${t}' (use f or d)`);
      }
      typeFilter = t;
    } else if (flag === '-maxdepth') {
      i++;
      if (i >= args.length) return err('find: missing argument to -maxdepth');
      maxDepth = parseInt(args[i], 10);
      if (isNaN(maxDepth)) return err('find: invalid argument to -maxdepth');
    } else if (flag === '-mindepth') {
      i++;
      if (i >= args.length) return err('find: missing argument to -mindepth');
      minDepth = parseInt(args[i], 10);
      if (isNaN(minDepth)) return err('find: invalid argument to -mindepth');
    } else if (flag === '-not' || flag === '!') {
      negate = !negate;
    } else if (flag === '-size') {
      i++;
      if (i >= args.length) return err('find: missing argument to -size');
      sizeFilter = args[i];
    } else if (flag === '-mtime') {
      i++;
      if (i >= args.length) return err('find: missing argument to -mtime');
      mtimeFilter = args[i];
    } else if (!flag.startsWith('-')) {
      startPath = resolve(ctx, flag);
    } else {
      // Silently ignore unknown flags instead of erroring
      // to be more lenient with LLM-generated commands
    }
    i++;
  }

  return { startPath, namePattern, typeFilter, maxDepth, minDepth, negate, sizeFilter, mtimeFilter };
}

/** Parse size filter like "+10k", "-1M", "100c" */
function matchSizeFilter(filter: string, fileSize: number): boolean {
  const match = filter.match(/^([+-]?)(\d+)([ckMG]?)$/);
  if (!match) return true;
  const [, sign, numStr, unit] = match;
  let targetSize = parseInt(numStr, 10);
  switch (unit) {
    case 'c': break; // bytes
    case 'k': targetSize *= 1024; break;
    case 'M': targetSize *= 1024 * 1024; break;
    case 'G': targetSize *= 1024 * 1024 * 1024; break;
    default: targetSize *= 512; break; // default: 512-byte blocks
  }
  if (sign === '+') return fileSize > targetSize;
  if (sign === '-') return fileSize < targetSize;
  return fileSize === targetSize;
}

/** Parse mtime filter like "+7", "-1" (days) */
function matchMtimeFilter(filter: string, mtimeMs: number): boolean {
  const match = filter.match(/^([+-]?)(\d+)$/);
  if (!match) return true;
  const [, sign, numStr] = match;
  const days = parseInt(numStr, 10);
  const nowMs = Date.now();
  const ageInDays = (nowMs - mtimeMs) / (1000 * 60 * 60 * 24);
  if (sign === '+') return ageInDays > days;
  if (sign === '-') return ageInDays < days;
  return Math.floor(ageInDays) === days;
}

async function walkDir(
  dir: string,
  opts: FindOptions,
  results: string[],
  sandbox: CommandContext['sandbox'],
  depth: number,
): Promise<void> {
  if (depth > opts.maxDepth) return;

  let entries;
  try {
    sandbox.checkPath(dir, 'read');
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const isDir = entry.isDirectory();
    const isFile = entry.isFile();

    // Type filter
    let typeOk =
      opts.typeFilter === null ||
      (opts.typeFilter === 'f' && isFile) ||
      (opts.typeFilter === 'd' && isDir);

    // Name filter
    let nameOk = opts.namePattern === null || globMatch(opts.namePattern, entry.name);

    // Size filter (only for files)
    let sizeOk = true;
    if (opts.sizeFilter && isFile) {
      try {
        const s = await stat(fullPath);
        sizeOk = matchSizeFilter(opts.sizeFilter, s.size);
      } catch { sizeOk = false; }
    }

    // Mtime filter
    let mtimeOk = true;
    if (opts.mtimeFilter) {
      try {
        const s = await stat(fullPath);
        mtimeOk = matchMtimeFilter(opts.mtimeFilter, s.mtimeMs);
      } catch { mtimeOk = false; }
    }

    let match = typeOk && nameOk && sizeOk && mtimeOk;
    if (opts.negate) match = !match;

    if (match && depth >= opts.minDepth) {
      results.push(fullPath);
    }

    if (isDir) {
      await walkDir(fullPath, opts, results, sandbox, depth + 1);
    }
  }
}

const find: BuiltinFn = async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  const parsed = parseFindArgs(args, ctx);
  if ('exitCode' in parsed) return parsed;

  const opts = parsed as FindOptions;

  try {
    ctx.sandbox.checkPath(opts.startPath, 'read');
  } catch (e: unknown) {
    return err(`find: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const s = await stat(opts.startPath);
    if (!s.isDirectory()) {
      return err(`find: '${opts.startPath}': Not a directory`);
    }
  } catch {
    return err(`find: '${opts.startPath}': No such file or directory`);
  }

  const results: string[] = [];
  await walkDir(opts.startPath, opts, results, ctx.sandbox, 0);

  return ok(results.join('\n'));
};

// ---------------------------------------------------------------------------
// which — Locate a builtin command
// ---------------------------------------------------------------------------

// Lazy import to avoid circular dependency — we check builtins at runtime
const which: BuiltinFn = async (args: string[], _ctx: CommandContext): Promise<ExecResult> => {
  if (args.length === 0) return err('which: missing argument');

  const name = args[0];

  // Dynamic import to break potential circular dependency with index.ts
  const { getBuiltin } = await import('./index.js');

  if (getBuiltin(name)) {
    return ok(`builtin: ${name}`);
  }

  return err(`which: ${name}: not found`);
};

// ---------------------------------------------------------------------------
// type — Identify command type
// ---------------------------------------------------------------------------

const type_: BuiltinFn = async (args: string[], _ctx: CommandContext): Promise<ExecResult> => {
  if (args.length === 0) return err('type: missing argument');

  const { getBuiltin } = await import('./index.js');
  const output: string[] = [];
  let failed = false;

  for (const name of args) {
    if (getBuiltin(name)) {
      output.push(`${name} is a shell builtin`);
    } else {
      output.push(`bash: type: ${name}: not found`);
      failed = true;
    }
  }

  return { stdout: output.join('\n') + '\n', stderr: '', exitCode: failed ? 1 : 0 };
};

// ---------------------------------------------------------------------------
// command — Execute or identify commands (POSIX portability)
// ---------------------------------------------------------------------------

const command_: BuiltinFn = async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  if (args.length === 0) return err('command: missing argument');

  const { getBuiltin } = await import('./index.js');

  // command -v name → print name if found (exit 0), or exit 1
  if (args[0] === '-v') {
    if (args.length < 2) return err('command: -v: missing argument');
    const name = args[1];
    if (getBuiltin(name)) {
      return ok(name + '\n');
    }
    return { stdout: '', stderr: '', exitCode: 1 };
  }

  // command -V name → verbose identification
  if (args[0] === '-V') {
    if (args.length < 2) return err('command: -V: missing argument');
    const name = args[1];
    if (getBuiltin(name)) {
      return ok(`${name} is a shell builtin\n`);
    }
    return { stdout: '', stderr: `bash: command: ${name}: not found`, exitCode: 1 };
  }

  // command <name> [args...] → execute directly (bypass aliases/functions)
  const cmdName = args[0];
  const cmdArgs = args.slice(1);
  const builtin = getBuiltin(cmdName);
  if (builtin) {
    return builtin(cmdArgs, ctx);
  }
  return { stdout: '', stderr: `${cmdName}: command not found`, exitCode: 127 };
};

// ---------------------------------------------------------------------------
// realpath — Resolve path to absolute canonical form
// ---------------------------------------------------------------------------

const realpath: BuiltinFn = async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  if (args.length === 0) return err('realpath: missing operand');

  const results: string[] = [];
  for (const arg of args) {
    const resolved = resolve(ctx, arg);

    try {
      ctx.sandbox.checkPath(resolved, 'read');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(`realpath: ${arg}: ${msg}`);
    }

    // Verify the path exists
    if (!existsSync(resolved)) {
      return err(`realpath: ${arg}: No such file or directory`);
    }

    results.push(path.resolve(resolved));
  }

  return ok(results.join('\n'));
};

// ---------------------------------------------------------------------------
// dirname — Print directory portion of pathname
// ---------------------------------------------------------------------------

const dirname: BuiltinFn = async (args: string[], _ctx: CommandContext): Promise<ExecResult> => {
  if (args.length === 0) return err('dirname: missing operand');

  const results = args.map((arg) => path.dirname(arg));
  return ok(results.join('\n'));
};

// ---------------------------------------------------------------------------
// basename — Print filename portion of pathname
// ---------------------------------------------------------------------------

const basename: BuiltinFn = async (args: string[], _ctx: CommandContext): Promise<ExecResult> => {
  if (args.length === 0) return err('basename: missing operand');

  const filePath = args[0];
  // Optional second argument: suffix to remove
  const suffix = args.length > 1 ? args[1] : undefined;

  let result = path.basename(filePath);
  if (suffix && result.endsWith(suffix)) {
    result = result.slice(0, -suffix.length);
  }

  return ok(result);
};

// ---------------------------------------------------------------------------
// Export registry
// ---------------------------------------------------------------------------

export const navBuiltins: Record<string, BuiltinFn> = {
  cd,
  pwd,
  find,
  which,
  type: type_,
  command: command_,
  realpath,
  dirname,
  basename,
};
