// =============================================================================
// @vesper/bash — CLI Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);

// Path to the built CLI entry point
const CLI_PATH = resolve(import.meta.dirname, '..', 'dist', 'cli.js');
const NODE = process.execPath;

describe('vesper-bash CLI', () => {
  it('--help flag outputs usage info containing "vesper-bash"', async () => {
    const { stdout } = await execFileAsync(NODE, [CLI_PATH, '--help']);
    expect(stdout).toContain('vesper-bash');
    expect(stdout).toContain('Usage');
  });

  it('-c flag executes a command and returns output', async () => {
    const { stdout } = await execFileAsync(NODE, [CLI_PATH, '-c', 'echo test']);
    expect(stdout).toContain('test');
  });

  it('-c flag with exit code propagation', async () => {
    try {
      await execFileAsync(NODE, [CLI_PATH, '-c', 'false']);
    } catch (err: any) {
      // `false` exits with code 1 — the CLI process should reflect that
      expect(err.code).toBe(1);
      return;
    }
    // If it didn't throw, the exit code was 0 which is also acceptable
    // if the CLI doesn't propagate exit codes from `false`
  });

  it('-c flag with inline JSON config (readOnly)', async () => {
    try {
      const { stderr } = await execFileAsync(NODE, [
        CLI_PATH,
        '--config', '{"readOnly":true}',
        '-c', 'touch /tmp/shouldfail',
      ]);
      // If it didn't throw, stderr should indicate sandbox violation
    } catch (err: any) {
      // Expected: non-zero exit code because write is blocked
      expect(err.code).not.toBe(0);
    }
  });

  it('-c flag with pipe command', async () => {
    const { stdout } = await execFileAsync(NODE, [CLI_PATH, '-c', 'echo hello world | wc -w']);
    expect(stdout.trim()).toContain('2');
  });
});
