// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Shell Bridge (native system shell spawn)
// ═══════════════════════════════════════════════════════════════════════════

import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry } from '@vesper/shared';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { TOOL_DESC } from '../prompts.js';
import type { PathGuard, PathGuardError } from '../path-guard.js';

// ---------------------------------------------------------------------------
// Local types (replacing @vesper/bash dependency)
// ---------------------------------------------------------------------------

/** Configuration for the native shell tool. */
export interface ShellConfig {
  cwd: string;
  env?: Record<string, string>;
  maxOutputBytes?: number;  // default 5MB
  timeout?: number;         // default 120_000ms
}

/** Result of executing a shell command. */
export interface ShellExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Detected shell metadata exposed to callers (e.g. for <env> block rendering). */
export interface ShellMeta {
  /** Absolute path to the shell binary, e.g. "C:\\Program Files\\Git\\bin\\bash.exe" */
  path: string;
  /** Shell flavour: 'bash' or 'sh' */
  type: 'bash' | 'sh';
}

/** Interface for shell execution with CWD tracking. */
export interface ShellExecutor {
  execute(command: string, options?: { cwd?: string; timeout?: number; signal?: AbortSignal; noKill?: boolean }): Promise<ShellExecResult>;
  getCwd(): string;
  setCwd(newCwd: string): void;
  getEnv(): Record<string, string>;
  /** Returns detected shell info, or null if no shell is available. */
  getShellMeta(): ShellMeta | null;
}

// ---------------------------------------------------------------------------
// Native system shell detection
// ---------------------------------------------------------------------------

interface ShellInfo {
  path: string;       // e.g. "C:\\Program Files\\Git\\bin\\bash.exe"
  type: 'bash' | 'sh';
}

/**
 * Detect a usable system shell. On Windows, searches for Git Bash in
 * common installation locations. On Unix/Mac, checks standard paths.
 * Returns null if no shell is found.
 */
function detectSystemShell(): ShellInfo | null {
  if (process.platform === 'win32') {
    const candidates: string[] = [];
    const programFiles = process.env['PROGRAMFILES'];
    if (programFiles) candidates.push(resolve(programFiles, 'Git', 'bin', 'bash.exe'));
    candidates.push('C:\\Program Files\\Git\\bin\\bash.exe');
    candidates.push('C:\\Program Files (x86)\\Git\\bin\\bash.exe');
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData) candidates.push(resolve(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'));
    const userProfile = process.env['USERPROFILE'];
    if (userProfile) candidates.push(resolve(userProfile, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'));

    // Deduplicate (PROGRAMFILES and hardcoded may overlap)
    const seen = new Set<string>();
    for (const c of candidates) {
      const normalized = c.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      if (existsSync(c)) return { path: c, type: 'bash' };
    }

    // Scan PATH for bash.exe, but skip WSL's bash.exe in system32 — it
    // requires a working WSL installation and fails with ENOENT otherwise.
    const pathDirs = (process.env['PATH'] || '').split(';');
    for (const dir of pathDirs) {
      if (!dir) continue;
      // Skip Windows\system32 — that's WSL's bash.exe, not Git Bash
      if (dir.toLowerCase().endsWith('\\windows\\system32')) continue;
      const candidate = resolve(dir, 'bash.exe');
      if (existsSync(candidate)) return { path: candidate, type: 'bash' };
    }

    return null;
  }

  // Unix / macOS
  for (const p of ['/bin/bash', '/usr/bin/bash']) {
    if (existsSync(p)) return { path: p, type: 'bash' };
  }
  if (existsSync('/bin/sh')) return { path: '/bin/sh', type: 'sh' };
  return null;
}

// ---------------------------------------------------------------------------
// Path conversion utilities
// ---------------------------------------------------------------------------

/** Convert Windows path to Git Bash unix-style path: C:\Users\foo → /c/Users/foo */
function winToUnixPath(p: string): string {
  if (process.platform !== 'win32') return p;
  // Match drive letter: C:\ or C:/
  const m = p.match(/^([A-Za-z]):[/\\](.*)/);
  if (!m) return p;
  const drive = m[1].toLowerCase();
  const rest = m[2].replace(/\\/g, '/');
  return `/${drive}/${rest}`;
}

/** Convert Git Bash unix-style path to Windows path: /c/Users/foo → C:\Users\foo */
function unixToWinPath(p: string): string {
  if (process.platform !== 'win32') return p;
  const m = p.match(/^\/([A-Za-z])\/(.*)/);
  if (!m) return p;
  const drive = m[1].toUpperCase();
  const rest = m[2].replace(/\//g, '\\');
  return `${drive}:\\${rest}`;
}

/** On Windows, replace /tmp references with the real OS tmpdir in Git Bash format */
function mapTmpPath(command: string): string {
  if (process.platform !== 'win32') return command;
  const realTmp = winToUnixPath(tmpdir());
  // Replace standalone /tmp references (not /tmpfoo)
  return command.replace(/\/tmp(?=\/|$|\s|")/g, realTmp);
}

// ---------------------------------------------------------------------------
// Native shell tool entry factory
// ---------------------------------------------------------------------------

/**
 * Create a tool entry backed by a real system shell (Git Bash on Windows,
 * /bin/bash on Unix). Returns a stub that always errors when no shell is found.
 */
export function createNativeShellToolEntry(
  config: ShellConfig,
  pathGuard?: PathGuard,
): ToolEntry & { shellExecutor: ShellExecutor } {
  const shell = detectSystemShell();

  // Tool definition (shared by both real and stub executors)
  const definition: ToolDefinition = {
    name: 'bash',
    description: TOOL_DESC.bash,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: TOOL_DESC.bash_command },
        timeout: { type: 'number', description: TOOL_DESC.bash_timeout },
        cwd: { type: 'string', description: TOOL_DESC.bash_cwd },
        description: { type: 'string', description: TOOL_DESC.bash_description },
        run_in_background: { type: 'boolean', description: TOOL_DESC.bash_run_in_background },
        no_kill: { type: 'boolean', description: 'If true, disable timeout-based process killing. Use for long-running commands that should not be interrupted.' },
      },
      required: ['command'],
    },
  };

  // Fallback: no native shell available → return stub executor
  if (!shell) {
    process.stderr.write('[bash] WARNING: No native shell found.\n');
    process.stderr.write('[bash] On Windows, install Git for Windows: https://git-scm.com/download/win\n');

    const stubExecutor: ShellExecutor = {
      async execute(): Promise<ShellExecResult> {
        return { stdout: '', stderr: 'No shell available. Install Git for Windows.', exitCode: 127 };
      },
      getCwd(): string { return config.cwd; },
      setCwd(): void { /* no-op */ },
      getEnv(): Record<string, string> { return {}; },
      getShellMeta(): ShellMeta | null { return null; },
    };

    const stubToolExecutor: ToolExecutor = async () => ({
      content: 'Shell error: No native shell found. On Windows, install Git for Windows: https://git-scm.com/download/win',
      isError: true,
    });

    return { definition, executor: stubToolExecutor, shellExecutor: stubExecutor };
  }

  process.stderr.write(`[bash] Using native shell: ${shell.path} (${shell.type})\n`);

  // Mutable state tracked across calls
  let currentCwd = config.cwd;
  const env: Record<string, string> = { ...process.env as Record<string, string>, ...config.env };
  const maxOutputBytes = config.maxOutputBytes ?? 5_242_880;
  const defaultTimeout = config.timeout ?? 120_000;

  // ShellExecutor implementation backed by native shell spawn
  const nativeExecutor: ShellExecutor = {
    async execute(command: string, options?: { cwd?: string; timeout?: number; signal?: AbortSignal; noKill?: boolean }): Promise<ShellExecResult> {
      const cwd = options?.cwd ?? currentCwd;
      const timeout = options?.timeout ?? defaultTimeout;
      const abortSignal = options?.signal;
      const noKill = options?.noKill ?? false;

      // If already aborted before we even start, return immediately
      if (abortSignal?.aborted) {
        return { stdout: '', stderr: 'Aborted', exitCode: 130 };
      }

      // Build unique delimiter for state extraction
      const delim = `__VESPER_STATE_${Date.now()}__`;

      // Map /tmp on Windows and wrap command with state extraction suffix
      const mappedCommand = mapTmpPath(command);
      const wrapped = [
        mappedCommand,
        `__lux_ec=$?`,
        `printf '\\n${delim}\\n'`,
        `pwd`,
        `printf '\\n${delim}\\n'`,
        `exit $__lux_ec`,
      ].join('\n');

      return new Promise<ShellExecResult>((resolveExec, rejectExec) => {
        const child = spawn(shell.path, ['-c', wrapped], {
          cwd,
          env,
          detached: true,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let killed = false;
        let timedOut = false;
        let aborted = false;

        // Kill process group: SIGTERM first, then SIGKILL after 2s
        const killProcessGroup = (reason: 'timeout' | 'abort' | 'output_overflow') => {
          if (killed) return;
          killed = true;

          if (reason === 'timeout') timedOut = true;
          if (reason === 'abort') aborted = true;

          try {
            process.kill(-child.pid!, 'SIGTERM');
          } catch {
            try { child.kill('SIGTERM'); } catch {}
          }

          setTimeout(() => {
            try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
            try { child.kill('SIGKILL'); } catch {}
          }, 2000);
        };

        const timeoutTimer = noKill ? null : setTimeout(() => {
          killProcessGroup('timeout');
        }, timeout);

        const onAbort = () => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          killProcessGroup('abort');
        };
        abortSignal?.addEventListener('abort', onAbort, { once: true });

        child.stdout!.on('data', (chunk: Buffer) => {
          if (killed) return;
          stdout += chunk.toString();
          if (stdout.length > maxOutputBytes) {
            killProcessGroup('output_overflow');
          }
        });

        child.stderr!.on('data', (chunk: Buffer) => {
          if (killed) return;
          stderr += chunk.toString();
          if (stderr.length > maxOutputBytes) {
            killProcessGroup('output_overflow');
          }
        });

        child.on('error', (err) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          abortSignal?.removeEventListener('abort', onAbort);
          rejectExec(err);
        });

        child.on('close', (code, closeSignal) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          abortSignal?.removeEventListener('abort', onAbort);

          // Parse state from stdout using delimiter
          const delimPattern = `\n${delim}\n`;
          const firstDelim = stdout.indexOf(delimPattern);

          let userStdout: string;
          let newPwd: string | undefined;

          if (firstDelim !== -1) {
            userStdout = stdout.slice(0, firstDelim);
            const afterFirst = stdout.slice(firstDelim + delimPattern.length);
            const secondDelim = afterFirst.indexOf(delimPattern);
            if (secondDelim !== -1) {
              newPwd = afterFirst.slice(0, secondDelim).trim();
            }
          } else {
            userStdout = stdout;
          }

          // Update tracked cwd from pwd output
          if (newPwd) {
            currentCwd = process.platform === 'win32' ? unixToWinPath(newPwd) : newPwd;
          }

          const exitCode = aborted
            ? 130  // SIGINT convention for user-initiated abort
            : timedOut
              ? 124  // timeout convention
              : killed
                ? 1
                : (code ?? 1);

          if (timedOut) {
            stderr = (stderr ? stderr + '\n' : '') + `Command timed out after ${timeout}ms`;
          }
          if (killed && !timedOut && !aborted) {
            stderr = (stderr ? stderr + '\n' : '') + 'Output truncated: exceeded maximum size';
          }
          if (aborted) {
            stderr = (stderr ? stderr + '\n' : '') + 'Aborted by user';
          }

          resolveExec({ stdout: userStdout, stderr, exitCode });
        });
      });
    },

    getCwd(): string {
      return currentCwd;
    },

    setCwd(newCwd: string): void {
      currentCwd = newCwd;
    },

    getEnv(): Record<string, string> {
      return { ...env };
    },

    getShellMeta(): ShellMeta | null {
      return { path: shell.path, type: shell.type };
    },
  };

  // ---------------------------------------------------------------------------
  // Self-kill protection
  // ---------------------------------------------------------------------------

  const SELF_PID = process.pid;

  /**
   * Detect if a command attempts to kill the current process.
   * Returns a descriptive error message if blocked, null otherwise.
   */
  function detectSelfKill(command: string): string | null {
    // Normalize command for analysis
    const normalized = command.trim().toLowerCase();

    // Skip if no kill-related keywords
    if (!/\b(kill|pkill|killall)\b/.test(normalized)) {
      return null;
    }

    // Check for direct PID reference: kill -9 12345, kill 12345
    const killPidMatch = normalized.match(/\bkill\s+(?:-[a-z0-9]+\s+)?(\d+)/);
    if (killPidMatch && parseInt(killPidMatch[1], 10) === SELF_PID) {
      return `Blocked: Attempting to kill the current process (PID ${SELF_PID}). This would terminate the Vesper runtime.`;
    }

    // Check for pkill/killall with process name patterns that might match lux
    // Common patterns: pkill -f lux, pkill lux, killall lux, pkill node (dangerous)
    const dangerousPatterns = [
      /\bpkill\s+.*(?:lux|node)\b/,
      /\bkillall\s+(?:lux|node)\b/,
      /\bpkill\s+-f\s+.*lux\b/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(normalized)) {
        return `Blocked: Command may terminate the Vesper runtime (PID ${SELF_PID}). Use more specific targeting to avoid self-termination.`;
      }
    }

    return null;
  }

  // ToolExecutor wrapping the native executor
  const toolExecutor: ToolExecutor = async (args) => {
    const command = args.command as string;
    const timeout = args.timeout as number | undefined;
    const cwd = args.cwd as string | undefined;
    const runInBackground = args.run_in_background as boolean | undefined;
    const noKill = args.no_kill as boolean | undefined;
    // Runtime injects __signal for abort-aware execution (not part of the tool schema)
    const signal = args.__signal as AbortSignal | undefined;

    // Self-kill protection
    const selfKillError = detectSelfKill(command);
    if (selfKillError) {
      return { content: selfKillError, isError: true };
    }

    // PathGuard cwd validation
    if (pathGuard && cwd) {
      try {
        pathGuard.safeCwd(cwd);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: `Security: ${msg}`, isError: true };
      }
    }

    try {
      if (runInBackground) {
        // Background commands don't get abort signal — they're fire-and-forget
        nativeExecutor.execute(command, { cwd, timeout }).catch(() => {});
        return { content: 'Command started in background.' };
      }

      const result = await nativeExecutor.execute(command, { cwd, timeout, signal });
      const parts: string[] = [`Exit code: ${result.exitCode}`];
      if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
      if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
      return { content: parts.join('\n') };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: `Shell error: ${msg}`, isError: true };
    }
  };

  return { definition, executor: toolExecutor, shellExecutor: nativeExecutor };
}
