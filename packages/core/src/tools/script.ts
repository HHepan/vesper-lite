// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Script Tool (Node.js script execution)
//
// Provides a `script` tool that runs a Node.js script inline via
// child_process.fork / spawn. Designed for programmatic computation —
// data transformations, JSON manipulation, regex extraction, math,
// API calls, etc. — without the overhead of `bash node -e "..."`.
// ═══════════════════════════════════════════════════════════════════════════

import type { ToolDefinition, ToolResult, ToolExecutor, ToolEntry } from '@vesper/shared';
import { spawn } from 'node:child_process';
import { TOOL_DESC } from '../prompts.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ScriptToolConfig {
  cwd: string;
  timeout?: number;         // default 30_000ms (scripts should be fast)
  maxOutputBytes?: number;  // default 2MB
  /**
   * Enable Node.js Permission Model (--permission) to sandbox the script.
   * When enabled:
   *  - fs read/write restricted to `allowedRoots` (defaults to [cwd])
   *  - child_process, worker_threads, native addons all blocked
   *  - network access remains unrestricted (Node.js has no --allow-net yet)
   * Requires Node.js >= 20. Default: false.
   */
  sandboxed?: boolean;
  /** Roots for fs access when sandboxed. Defaults to [cwd]. */
  allowedRoots?: string[];
  /** Allow fs write in sandbox (default: false — read-only). */
  allowWrite?: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the `script` tool entry. Executes Node.js scripts with `node --input-type=module`
 * piped via stdin, capturing stdout/stderr.
 */
export function createScriptToolEntry(config: ScriptToolConfig): ToolEntry {
  const defaultTimeout = config.timeout ?? 30_000;
  const maxOutputBytes = config.maxOutputBytes ?? 2_097_152;

  const definition: ToolDefinition = {
    name: 'script',
    description: TOOL_DESC.script,
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: TOOL_DESC.script_code },
        timeout: { type: 'number', description: TOOL_DESC.script_timeout },
      },
      required: ['code'],
    },
  };

  const executor: ToolExecutor = async (args) => {
    const code = args.code as string;
    const timeout = (args.timeout as number | undefined) ?? defaultTimeout;
    const signal = args.__signal as AbortSignal | undefined;

    if (!code.trim()) {
      return { content: 'Error: empty script.', isError: true };
    }

    // Already aborted?
    if (signal?.aborted) {
      return { content: 'Aborted', isError: true };
    }

    return new Promise<ToolResult>((resolve) => {
      // Build node args — optionally enable Permission Model sandbox
      const nodeArgs = ['--input-type=module'];
      if (config.sandboxed) {
        const roots = config.allowedRoots ?? [config.cwd];
        const rootList = roots.join(',');
        nodeArgs.push('--permission', `--allow-fs-read=${rootList}`);
        if (config.allowWrite) {
          nodeArgs.push(`--allow-fs-write=${rootList}`);
        }
        // child_process, worker_threads, native addons: implicitly denied
      }

      // Run node with ESM input via stdin, inheriting cwd
      const child = spawn(process.execPath, nodeArgs, {
        cwd: config.cwd,
        timeout,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      });

      let stdout = '';
      let stderr = '';
      let killed = false;
      let aborted = false;

      // Abort handling
      const onAbort = () => {
        if (!killed && !aborted) {
          aborted = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* already dead */ }
          }, 2000);
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout!.on('data', (chunk: Buffer) => {
        if (killed) return;
        stdout += chunk.toString();
        if (stdout.length > maxOutputBytes) {
          killed = true;
          child.kill('SIGTERM');
        }
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        if (killed) return;
        stderr += chunk.toString();
        if (stderr.length > maxOutputBytes) {
          killed = true;
          child.kill('SIGTERM');
        }
      });

      // Write script to stdin and close
      child.stdin!.write(code);
      child.stdin!.end();

      child.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        resolve({ content: `Script error: ${err.message}`, isError: true });
      });

      child.on('close', (exitCode, closeSignal) => {
        signal?.removeEventListener('abort', onAbort);

        const code = aborted
          ? 130
          : killed
            ? 1
            : closeSignal === 'SIGTERM'
              ? 124
              : (exitCode ?? 1);

        if (killed && !aborted) {
          stderr = (stderr ? stderr + '\n' : '') + 'Output truncated: exceeded maximum size';
        }
        if (aborted) {
          stderr = (stderr ? stderr + '\n' : '') + 'Aborted by user';
        }

        const parts: string[] = [];
        if (code !== 0) parts.push(`Exit code: ${code}`);
        if (stdout) parts.push(stdout);
        if (stderr) parts.push(`stderr:\n${stderr}`);

        if (parts.length === 0) parts.push('(no output)');

        resolve({
          content: parts.join('\n'),
          isError: code !== 0,
        });
      });
    });
  };

  return { definition, executor };
}
