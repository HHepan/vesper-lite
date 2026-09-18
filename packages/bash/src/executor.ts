// ═══════════════════════════════════════════════════════════════════════════
// @vesper/bash — Command Executor (dispatch + pipeline execution)
// ═══════════════════════════════════════════════════════════════════════════

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile as cpExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(cpExecFile);
import type {
  BashConfig,
  BashExecutor,
  ExecResult,
  CommandContext,
  SimpleCommand,
  Pipeline,
  CommandList,
} from './types.js';
import { parseCommand } from './parser.js';
import { expandGlob } from './glob.js';
import { createSandbox } from './sandbox.js';
import { getBuiltin, listBuiltins } from './builtins/index.js';

const DEFAULT_MAX_OUTPUT = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 120000;
const IS_WIN = process.platform === 'win32';

function isDevNull(p: string): boolean {
  return p === '/dev/null';
}

/**
 * Map Unix-conventional paths to platform equivalents on Windows.
 * LLM agents write `/tmp/...` even on Windows — redirect to os.tmpdir().
 */
function mapPlatformPath(p: string): string {
  if (IS_WIN && p.startsWith('/tmp')) {
    return resolve(tmpdir(), p.slice(4) || '.');
  }
  return p;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBashExecutor(config: BashConfig): BashExecutor {
  let cwd = resolve(config.cwd);
  const env: Record<string, string> = {
    HOME: process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
    PATH: '',
    PWD: cwd,
    ...(config.env ?? {}),
  };
  const sandbox = createSandbox(config);
  const maxOutput = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const defaultTimeout = config.timeout ?? DEFAULT_TIMEOUT;

  async function execute(
    command: string,
    options?: { cwd?: string; timeout?: number },
  ): Promise<ExecResult> {
    const execCwd = options?.cwd ? resolve(options.cwd) : cwd;
    const timeout = options?.timeout ?? defaultTimeout;

    // Split at top-level &&, ||, ; boundaries (respecting quotes).
    // Each segment is parsed separately with the CURRENT env so that
    // `export FOO=bar && echo $FOO` works — $FOO is expanded after export runs.
    const segments = splitCommandList(command);

    const executeSegments = async (): Promise<ExecResult> => {
      let lastResult: ExecResult = { stdout: '', stderr: '', exitCode: 0 };
      let currentCwd = execCwd;

      for (const { segment, operator } of segments) {
        // Short-circuit for && and ||
        if (operator === '&&' && lastResult.exitCode !== 0) continue;
        if (operator === '||' && lastResult.exitCode === 0) continue;

        const trimmed = segment.trim();
        if (!trimmed) continue;

        // Parse this segment with the CURRENT env (deferred expansion)
        let commandList: CommandList;
        try {
          commandList = parseCommand(trimmed, env);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { stdout: '', stderr: `parse error: ${msg}`, exitCode: 2 };
        }

        lastResult = await executeList(commandList, currentCwd, env, sandbox, maxOutput);
        currentCwd = cwd; // re-sync from closure (cd updates it)
      }

      return truncateResult(lastResult, maxOutput);
    };

    // Execute with timeout
    const result = await Promise.race([
      executeSegments(),
      timeoutPromise(timeout),
    ]);

    return result;
  }

  return {
    execute,
    getCwd() { return cwd; },
    setCwd(newCwd: string) { cwd = resolve(newCwd); env['PWD'] = cwd; },
    getEnv() { return { ...env }; },
    addAllowedDir(dir: string) { sandbox.addAllowedDir(dir); },
  };

  // -- internal helpers (closure over cwd/env) --

  async function executeList(
    list: CommandList,
    execCwd: string,
    execEnv: Record<string, string>,
    sandboxChecker: typeof sandbox,
    maxOut: number,
  ): Promise<ExecResult> {
    let lastResult: ExecResult = { stdout: '', stderr: '', exitCode: 0 };
    let currentCwd = execCwd;

    for (const entry of list.entries) {
      const { pipeline, operator } = entry;

      // Check short-circuit for && and ||
      if (operator === '&&' && lastResult.exitCode !== 0) continue;
      if (operator === '||' && lastResult.exitCode === 0) continue;

      lastResult = await executePipeline(pipeline, currentCwd, execEnv, sandboxChecker, maxOut);
      currentCwd = cwd; // re-sync from closure (cd updates it)
    }

    return truncateResult(lastResult, maxOut);
  }

  async function executePipeline(
    pipeline: Pipeline,
    execCwd: string,
    execEnv: Record<string, string>,
    sandboxChecker: typeof sandbox,
    maxOut: number,
  ): Promise<ExecResult> {
    let stdin = '';
    let lastResult: ExecResult = { stdout: '', stderr: '', exitCode: 0 };

    for (let i = 0; i < pipeline.commands.length; i++) {
      const cmd = pipeline.commands[i];
      const isLast = i === pipeline.commands.length - 1;

      // Merge per-command env assignments
      const cmdEnv = cmd.env ? { ...execEnv, ...cmd.env } : execEnv;

      // Expand globs in arguments and map platform paths
      const expandedArgs: string[] = [];
      for (const arg of cmd.args) {
        const mapped = mapPlatformPath(arg);
        if (mapped.includes('*') || mapped.includes('?')) {
          const expanded = await expandGlob(mapped, execCwd);
          expandedArgs.push(...expanded);
        } else {
          expandedArgs.push(mapped);
        }
      }

      // Handle input redirection
      let effectiveStdin = stdin;
      for (const redir of cmd.redirects) {
        if (redir.type === 'in') {
          const mappedTarget = mapPlatformPath(redir.target);
          if (isDevNull(redir.target)) {
            effectiveStdin = '';
          } else {
            const redirPath = resolve(execCwd, mappedTarget);
            sandboxChecker.checkPath(redirPath, 'read');
            effectiveStdin = await readFile(redirPath, 'utf-8');
          }
        }
      }

      // Create context
      const ctx: CommandContext = {
        cwd: execCwd,
        env: cmdEnv,
        stdin: effectiveStdin,
        sandbox: sandboxChecker,
        executeCommand: (command: string) => execute(command, { cwd: execCwd }),
      };

      // Dispatch to builtin or external command
      const builtin = getBuiltin(cmd.name);
      try {
        sandboxChecker.checkCommand(cmd.name);
        if (builtin) {
          lastResult = await builtin(expandedArgs, ctx);
        } else if (config.allowExternalCommands) {
          lastResult = await executeExternalCommand(cmd.name, expandedArgs, execCwd, cmdEnv, effectiveStdin, defaultTimeout);
        } else {
          lastResult = { stdout: '', stderr: `${cmd.name}: command not found`, exitCode: 127 };
          break;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastResult = { stdout: '', stderr: msg, exitCode: 1 };
        break;
      }

      // Handle cd: update executor's cwd
      if (cmd.name === 'cd' && lastResult.exitCode === 0 && lastResult.stdout) {
        cwd = lastResult.stdout.trim();
        env['OLDPWD'] = env['PWD'] ?? execCwd;
        env['PWD'] = cwd;
        execCwd = cwd;
        lastResult = { stdout: '', stderr: '', exitCode: 0 };
      }

      // Handle export: update env
      if (cmd.name === 'export' && lastResult.exitCode === 0) {
        for (const arg of expandedArgs) {
          const eqIdx = arg.indexOf('=');
          if (eqIdx > 0) {
            env[arg.substring(0, eqIdx)] = arg.substring(eqIdx + 1);
          }
        }
      }

      // Handle unset: remove from env
      if (cmd.name === 'unset' && lastResult.exitCode === 0) {
        for (const arg of expandedArgs) {
          delete env[arg];
        }
      }

      // Handle output redirections
      for (const redir of cmd.redirects) {
        if (redir.type === 'out' || redir.type === 'append') {
          const mappedTarget = mapPlatformPath(redir.target);
          if (isDevNull(redir.target)) {
            // /dev/null — discard output silently
            if (cmd.name !== 'tee') {
              lastResult = { ...lastResult, stdout: '' };
            }
          } else {
            const redirPath = resolve(execCwd, mappedTarget);
            sandboxChecker.checkPath(redirPath, 'write');
            if (redir.type === 'out') {
              await writeFile(redirPath, lastResult.stdout, 'utf-8');
            } else {
              await appendFile(redirPath, lastResult.stdout, 'utf-8');
            }
            // Clear stdout since it went to file (unless this is tee)
            if (cmd.name !== 'tee') {
              lastResult = { ...lastResult, stdout: '' };
            }
          }
        }
      }

      // Pipe stdout to next command's stdin
      if (!isLast) {
        stdin = lastResult.stdout;
      }
    }

    return lastResult;
  }

  async function executeExternalCommand(
    name: string,
    args: string[],
    execCwd: string,
    cmdEnv: Record<string, string>,
    stdin: string,
    timeout: number,
  ): Promise<ExecResult> {
    try {
      // Merge process.env (filtering out undefined values) with command env.
      // Only overlay cmdEnv entries that have a non-empty value to avoid
      // the executor's default `PATH: ''` from wiping out the system PATH.
      const mergedEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) mergedEnv[k] = v;
      }
      for (const [k, v] of Object.entries(cmdEnv)) {
        if (v) mergedEnv[k] = v;
      }
      const options: {
        cwd: string;
        env: Record<string, string>;
        timeout: number;
        maxBuffer: number;
        input?: string;
        windowsHide: boolean;
        shell: boolean;
      } = {
        cwd: execCwd,
        env: mergedEnv,
        timeout,
        maxBuffer: maxOutput,
        windowsHide: true,
        shell: IS_WIN,  // enables cmd.exe resolution of .cmd/.bat (npm, npx, pnpm, etc.)
      };
      if (stdin) {
        options.input = stdin;
      }
      const { stdout, stderr } = await execFileAsync(name, args, options);
      return { stdout, stderr, exitCode: 0 };
    } catch (e: unknown) {
      const error = e as { code?: string | number; killed?: boolean; stdout?: string; stderr?: string; status?: number };
      if (error.code === 'ENOENT') {
        return { stdout: '', stderr: `${name}: command not found`, exitCode: 127 };
      }
      if (error.killed) {
        return { stdout: error.stdout ?? '', stderr: `${name}: timed out`, exitCode: 124 };
      }
      // On Windows with shell: true, cmd.exe returns exit code 1 or 9009 for
      // commands not found (instead of ENOENT). Detect via stderr pattern or
      // code value (numeric exit codes from cmd.exe, not string error codes).
      if (IS_WIN && typeof error.code === 'number' && error.stderr &&
          !error.stdout && isWindowsNotFound(error.stderr, error.code)) {
        return { stdout: '', stderr: `${name}: command not found`, exitCode: 127 };
      }
      // Non-zero exit code
      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? (e instanceof Error ? e.message : String(e)),
        exitCode: typeof error.status === 'number' ? error.status : 1,
      };
    }
  }
}

/**
 * Detect Windows cmd.exe "command not found" errors.
 *
 * When shell: true, cmd.exe handles "not found" internally.
 * Its error message varies by locale (English, Chinese, Japanese, etc.)
 * and the stderr encoding may be garbled (cp936/cp932 read as UTF-8).
 *
 * Heuristics:
 *  1. English: contains "is not recognized"
 *  2. Exit code 9009: standard cmd.exe "not found" code
 *  3. Exit code 1 + stderr has the command name in quotes: cmd.exe wraps
 *     the unrecognized command name in single-byte apostrophes (0x27)
 */
function isWindowsNotFound(stderr: string, exitCode: number): boolean {
  const lower = stderr.toLowerCase();
  // English locale
  if (lower.includes('is not recognized') || lower.includes('not recognized')) {
    return true;
  }
  // Exit code 9009 is the standard "not found" code from cmd.exe
  if (exitCode === 9009) {
    return true;
  }
  // Exit code 1 with stderr that starts with quoted command name:
  // cmd.exe outputs: 'command_name' followed by locale-specific text
  if (exitCode === 1 && stderr.length > 0 && stderr[0] === "'") {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Command List Splitter (deferred variable expansion support)
// ---------------------------------------------------------------------------

interface CommandSegment {
  segment: string;
  operator: 'start' | '&&' | '||' | ';';
}

/**
 * Split a raw command string at top-level `&&`, `||`, `;` boundaries,
 * respecting single/double quotes and backslash escaping.
 *
 * Returns segments with their preceding operator, so they can be
 * individually parsed with the current (mutated) environment.
 */
function splitCommandList(input: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  const len = input.length;
  let i = 0;
  let start = 0;
  let currentOp: CommandSegment['operator'] = 'start';

  while (i < len) {
    const ch = input[i];

    // Skip single-quoted strings
    if (ch === "'") {
      i++;
      while (i < len && input[i] !== "'") i++;
      if (i < len) i++; // skip closing '
      continue;
    }

    // Skip double-quoted strings
    if (ch === '"') {
      i++;
      while (i < len && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < len) { i += 2; continue; }
        i++;
      }
      if (i < len) i++; // skip closing "
      continue;
    }

    // Skip backslash escapes
    if (ch === '\\' && i + 1 < len) {
      i += 2;
      continue;
    }

    // Check for && operator
    if (ch === '&' && i + 1 < len && input[i + 1] === '&') {
      segments.push({ segment: input.substring(start, i), operator: currentOp });
      currentOp = '&&';
      i += 2;
      start = i;
      continue;
    }

    // Check for || operator
    if (ch === '|' && i + 1 < len && input[i + 1] === '|') {
      segments.push({ segment: input.substring(start, i), operator: currentOp });
      currentOp = '||';
      i += 2;
      start = i;
      continue;
    }

    // Check for ; operator (but not inside quotes, already handled above)
    if (ch === ';') {
      segments.push({ segment: input.substring(start, i), operator: currentOp });
      currentOp = ';';
      i++;
      start = i;
      continue;
    }

    i++;
  }

  // Push the final segment
  segments.push({ segment: input.substring(start), operator: currentOp });

  return segments;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeoutPromise(ms: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ stdout: '', stderr: `Command timed out after ${ms}ms`, exitCode: 124 });
    }, ms);
  });
}

function truncateResult(result: ExecResult, maxBytes: number): ExecResult {
  let { stdout, stderr } = result;
  if (stdout.length > maxBytes) {
    stdout = stdout.substring(0, maxBytes) + '\n... [output truncated]';
  }
  if (stderr.length > maxBytes) {
    stderr = stderr.substring(0, maxBytes) + '\n... [stderr truncated]';
  }
  return { stdout, stderr, exitCode: result.exitCode };
}
