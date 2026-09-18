// ═══════════════════════════════════════════════════════════════════════════
// @vesper/bash — Environment & Control-Flow Builtins
// env, export, unset, true, false, exit, test / [
// ═══════════════════════════════════════════════════════════════════════════

import { stat, access, lstat, constants } from 'node:fs/promises';
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

// ---------------------------------------------------------------------------
// env — Print all environment variables
// ---------------------------------------------------------------------------

const env: BuiltinFn = async (_args: string[], ctx: CommandContext): Promise<ExecResult> => {
  const lines = Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`);
  return ok(lines.join('\n'));
};

// ---------------------------------------------------------------------------
// export — Set environment variable
// Supports:
//   export VAR=value   → sets VAR to value
//   export VAR         → marks VAR for export (no-op in our model, just acknowledge)
//
// Returns ok(). The executor layer handles actual env mutation by parsing the
// original command line. For observability, stdout contains the assignment if one
// was provided.
// ---------------------------------------------------------------------------

const exportCmd: BuiltinFn = async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  if (args.length === 0) {
    // `export` with no args → print all exported variables (same as env)
    const lines = Object.entries(ctx.env).map(([k, v]) => `declare -x ${k}="${v}"`);
    return ok(lines.join('\n'));
  }

  const outputs: string[] = [];

  for (const arg of args) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx === -1) {
      // `export VAR` — mark for export without assignment
      // In our model, all env vars are "exported", so this is effectively a no-op.
      // Just confirm the variable exists.
      const val = ctx.env[arg];
      if (val !== undefined) {
        outputs.push(`declare -x ${arg}="${val}"`);
      } else {
        outputs.push(`declare -x ${arg}`);
      }
    } else {
      // `export VAR=value`
      const name = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);
      if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        return err(`export: '${arg}': not a valid identifier`);
      }
      // Store into ctx.env directly so subsequent commands in the same pipeline see it
      ctx.env[name] = value;
      outputs.push(`declare -x ${name}="${value}"`);
    }
  }

  return ok(outputs.join('\n'));
};

// ---------------------------------------------------------------------------
// unset — Remove environment variable(s)
// Returns the unset variable name(s) in stdout (one per line) for executor to
// confirm removal. Also removes from ctx.env directly.
// ---------------------------------------------------------------------------

const unset: BuiltinFn = async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  if (args.length === 0) return err('unset: not enough arguments');

  const removed: string[] = [];
  for (const name of args) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return err(`unset: '${name}': not a valid identifier`);
    }
    delete ctx.env[name];
    removed.push(name);
  }

  return ok(removed.join('\n'));
};

// ---------------------------------------------------------------------------
// true — Always succeed
// ---------------------------------------------------------------------------

const trueCmd: BuiltinFn = async (): Promise<ExecResult> => {
  return ok();
};

// ---------------------------------------------------------------------------
// false — Always fail
// ---------------------------------------------------------------------------

const falseCmd: BuiltinFn = async (): Promise<ExecResult> => {
  return { stdout: '', stderr: '', exitCode: 1 };
};

// ---------------------------------------------------------------------------
// exit — Exit with code
// ---------------------------------------------------------------------------

const exit: BuiltinFn = async (args: string[]): Promise<ExecResult> => {
  let code = 0;
  if (args.length > 0) {
    const parsed = parseInt(args[0], 10);
    if (Number.isNaN(parsed)) {
      return err(`exit: ${args[0]}: numeric argument required`, 2);
    }
    // Clamp to 0-255 like real shells
    code = ((parsed % 256) + 256) % 256;
  }
  return { stdout: '', stderr: '', exitCode: code };
};

// ---------------------------------------------------------------------------
// test / [ — Evaluate conditional expressions
//
// Supports:
//   -f file        file exists and is regular file
//   -d path        path exists and is directory
//   -e path        path exists (any type)
//   -z string      string has zero length
//   -n string      string has non-zero length
//   string = str   string equality
//   string != str  string inequality
//   ! expr         negate expression
//
// Exit code 0 = true, 1 = false, 2 = error
// ---------------------------------------------------------------------------

/**
 * Evaluate a test expression. Returns true/false or throws an error string.
 *
 * Supports:
 *   -f, -d, -e, -s, -r, -w, -x, -L, -h — file tests
 *   -z, -n — string tests
 *   =, != — string comparison
 *   -eq, -ne, -lt, -gt, -le, -ge — integer comparison
 *   -a, -o — logical AND/OR
 *   ! — negation
 */
async function evalTestExpr(args: string[], ctx: CommandContext): Promise<boolean> {
  if (args.length === 0) return false;

  // Handle -a (AND) and -o (OR) by splitting at these operators
  // -o has lower precedence than -a
  const oIdx = args.indexOf('-o');
  if (oIdx > 0 && oIdx < args.length - 1) {
    const left = await evalTestExpr(args.slice(0, oIdx), ctx);
    const right = await evalTestExpr(args.slice(oIdx + 1), ctx);
    return left || right;
  }
  const aIdx = args.indexOf('-a');
  if (aIdx > 0 && aIdx < args.length - 1) {
    const left = await evalTestExpr(args.slice(0, aIdx), ctx);
    const right = await evalTestExpr(args.slice(aIdx + 1), ctx);
    return left && right;
  }

  // Handle negation: `! expr`
  if (args[0] === '!') {
    if (args.length === 1) return true;
    const inner = await evalTestExpr(args.slice(1), ctx);
    return !inner;
  }

  // Single argument: true if non-empty string
  if (args.length === 1) {
    return args[0].length > 0;
  }

  // Unary file/string operators
  if (args.length === 2) {
    const [op, operand] = args;

    if (op === '-f') {
      const resolved = resolve(ctx, operand);
      try { ctx.sandbox.checkPath(resolved, 'read'); const s = await stat(resolved); return s.isFile(); } catch { return false; }
    }
    if (op === '-d') {
      const resolved = resolve(ctx, operand);
      try { ctx.sandbox.checkPath(resolved, 'read'); const s = await stat(resolved); return s.isDirectory(); } catch { return false; }
    }
    if (op === '-e') {
      const resolved = resolve(ctx, operand);
      try { ctx.sandbox.checkPath(resolved, 'read'); await stat(resolved); return true; } catch { return false; }
    }
    if (op === '-s') {
      const resolved = resolve(ctx, operand);
      try { ctx.sandbox.checkPath(resolved, 'read'); const s = await stat(resolved); return s.size > 0; } catch { return false; }
    }
    if (op === '-r') {
      const resolved = resolve(ctx, operand);
      try { ctx.sandbox.checkPath(resolved, 'read'); await access(resolved, constants.R_OK); return true; } catch { return false; }
    }
    if (op === '-w') {
      const resolved = resolve(ctx, operand);
      try { ctx.sandbox.checkPath(resolved, 'write'); await access(resolved, constants.W_OK); return true; } catch { return false; }
    }
    if (op === '-x') {
      const resolved = resolve(ctx, operand);
      try { await access(resolved, constants.X_OK); return true; } catch { return false; }
    }
    if (op === '-L' || op === '-h') {
      const resolved = resolve(ctx, operand);
      try { const s = await lstat(resolved); return s.isSymbolicLink(); } catch { return false; }
    }
    if (op === '-z') return operand.length === 0;
    if (op === '-n') return operand.length > 0;

    throw `test: unknown unary operator '${op}'`;
  }

  // Binary operators
  if (args.length === 3) {
    const [left, op, right] = args;

    if (op === '=') return left === right;
    if (op === '!=') return left !== right;

    if (op === '-eq' || op === '-ne' || op === '-lt' || op === '-gt' || op === '-le' || op === '-ge') {
      const l = parseInt(left, 10);
      const r = parseInt(right, 10);
      if (Number.isNaN(l)) throw `test: '${left}': integer expression expected`;
      if (Number.isNaN(r)) throw `test: '${right}': integer expression expected`;
      switch (op) {
        case '-eq': return l === r;
        case '-ne': return l !== r;
        case '-lt': return l < r;
        case '-gt': return l > r;
        case '-le': return l <= r;
        case '-ge': return l >= r;
      }
    }

    throw `test: unknown binary operator '${op}'`;
  }

  // 4+ args: try negation + expression
  if (args[0] === '!') {
    const inner = await evalTestExpr(args.slice(1), ctx);
    return !inner;
  }

  throw `test: too many arguments`;
}

const test: BuiltinFn = async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  try {
    const result = await evalTestExpr(args, ctx);
    return result ? ok() : { stdout: '', stderr: '', exitCode: 1 };
  } catch (e: unknown) {
    const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e));
    return err(msg, 2);
  }
};

/**
 * The `[` builtin — identical to `test` but requires a closing `]`.
 */
const bracket: BuiltinFn = async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  if (args.length === 0 || args[args.length - 1] !== ']') {
    return err('[: missing closing ]', 2);
  }

  // Strip the closing `]` and delegate to test
  const testArgs = args.slice(0, -1);
  return test(testArgs, ctx);
};

// ---------------------------------------------------------------------------
// Export registry
// ---------------------------------------------------------------------------

export const envBuiltins: Record<string, BuiltinFn> = {
  env,
  export: exportCmd,
  unset,
  true: trueCmd,
  false: falseCmd,
  exit,
  test,
  '[': bracket,
};
