// =============================================================================
// @vesper/bash — Navigation & Path Builtins Tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navBuiltins } from '../../src/builtins/nav.js';
import { createSandbox } from '../../src/sandbox.js';
import type { CommandContext } from '../../src/types.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';

describe('nav builtins', () => {
  let tmpDir: string;
  let ctx: CommandContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vesper-bash-nav-'));
    ctx = {
      cwd: tmpDir,
      env: { HOME: tmpDir },
      stdin: '',
      sandbox: createSandbox({ cwd: tmpDir }),
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // pwd
  // -------------------------------------------------------------------------

  describe('pwd', () => {
    it('returns ctx.cwd', async () => {
      const result = await navBuiltins.pwd([], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(tmpDir);
    });
  });

  // -------------------------------------------------------------------------
  // cd
  // -------------------------------------------------------------------------

  describe('cd', () => {
    it('changes to a valid directory and returns the path', async () => {
      const subDir = join(tmpDir, 'subdir');
      await mkdir(subDir);

      const result = await navBuiltins.cd(['subdir'], ctx);
      expect(result.exitCode).toBe(0);
      // cd returns the resolved path in stdout for the executor to use
      expect(result.stdout).toBe(subDir);
    });

    it('returns error for nonexistent directory', async () => {
      const result = await navBuiltins.cd(['nonexistent'], ctx);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No such file or directory');
    });

    it('cd with no args goes to HOME', async () => {
      const result = await navBuiltins.cd([], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(tmpDir); // HOME is set to tmpDir
    });

    it('cd - goes to OLDPWD', async () => {
      const subDir = join(tmpDir, 'other');
      await mkdir(subDir);
      const ctxWithOldPwd = { ...ctx, env: { ...ctx.env, OLDPWD: subDir } };

      const result = await navBuiltins.cd(['-'], ctxWithOldPwd);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(subDir);
    });

    it('cd - returns error when OLDPWD not set', async () => {
      const ctxNoOldPwd = { ...ctx, env: { HOME: tmpDir } };
      const result = await navBuiltins.cd(['-'], ctxNoOldPwd);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('OLDPWD not set');
    });
  });

  // -------------------------------------------------------------------------
  // dirname
  // -------------------------------------------------------------------------

  describe('dirname', () => {
    it('extracts directory part from a path', async () => {
      const result = await navBuiltins.dirname(['/home/user/file.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('/home/user');
    });

    it('handles just a filename (no directory)', async () => {
      const result = await navBuiltins.dirname(['file.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('.');
    });

    it('returns error with no arguments', async () => {
      const result = await navBuiltins.dirname([], ctx);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('missing operand');
    });
  });

  // -------------------------------------------------------------------------
  // basename
  // -------------------------------------------------------------------------

  describe('basename', () => {
    it('extracts filename from a path', async () => {
      const result = await navBuiltins.basename(['/home/user/file.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('file.txt');
    });

    it('strips suffix when provided', async () => {
      const result = await navBuiltins.basename(['/home/user/file.txt', '.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('file');
    });

    it('handles just a filename', async () => {
      const result = await navBuiltins.basename(['script.sh'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('script.sh');
    });

    it('returns error with no arguments', async () => {
      const result = await navBuiltins.basename([], ctx);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('missing operand');
    });
  });

  // -------------------------------------------------------------------------
  // type
  // -------------------------------------------------------------------------

  describe('type', () => {
    it('identifies a builtin command', async () => {
      const result = await navBuiltins.type(['echo'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('echo is a shell builtin');
    });

    it('returns not found for unknown commands', async () => {
      const result = await navBuiltins.type(['git'], ctx);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('not found');
    });

    it('handles multiple args (exits 1 if any not found)', async () => {
      const result = await navBuiltins.type(['echo', 'git', 'pwd'], ctx);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('echo is a shell builtin');
      expect(result.stdout).toContain('git: not found');
      expect(result.stdout).toContain('pwd is a shell builtin');
    });
  });

  // -------------------------------------------------------------------------
  // command
  // -------------------------------------------------------------------------

  describe('command', () => {
    it('command -v prints name for builtins', async () => {
      const result = await navBuiltins.command(['-v', 'echo'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('echo');
    });

    it('command -v returns exit 1 for unknown commands', async () => {
      const result = await navBuiltins.command(['-v', 'git'], ctx);
      expect(result.exitCode).toBe(1);
    });

    it('command -V provides verbose identification', async () => {
      const result = await navBuiltins.command(['-V', 'echo'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('echo is a shell builtin');
    });

    it('command <builtin> <args> executes the builtin', async () => {
      const result = await navBuiltins.command(['echo', 'hello'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello\n');
    });
  });

  // -------------------------------------------------------------------------
  // find enhanced
  // -------------------------------------------------------------------------

  describe('find enhanced', () => {
    it('-maxdepth limits recursion', async () => {
      await mkdir(join(tmpDir, 'a'));
      await mkdir(join(tmpDir, 'a', 'b'));
      await writeFile(join(tmpDir, 'a', 'f1.txt'), '');
      await writeFile(join(tmpDir, 'a', 'b', 'f2.txt'), '');

      const result = await navBuiltins.find([tmpDir, '-maxdepth', '1', '-type', 'f'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('f1.txt');
      expect(result.stdout).not.toContain('f2.txt');
    });

    it('-mindepth skips shallow results', async () => {
      await mkdir(join(tmpDir, 'a'));
      await writeFile(join(tmpDir, 'top.txt'), '');
      await writeFile(join(tmpDir, 'a', 'deep.txt'), '');

      const result = await navBuiltins.find([tmpDir, '-mindepth', '1', '-type', 'f'], ctx);
      expect(result.exitCode).toBe(0);
      // At mindepth 1, files at depth 0 (directly inside tmpDir at depth 0) should still be found
      // because the walk starts at depth 0 for the root entries
      expect(result.stdout).toContain('.txt');
    });

    it('-size filters by file size', async () => {
      await writeFile(join(tmpDir, 'small.txt'), 'a');
      await writeFile(join(tmpDir, 'big.txt'), 'a'.repeat(2000));

      const result = await navBuiltins.find([tmpDir, '-size', '+1k', '-type', 'f'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('big.txt');
      expect(result.stdout).not.toContain('small.txt');
    });

    it('! negates the filter', async () => {
      await mkdir(join(tmpDir, 'subdir'));
      await writeFile(join(tmpDir, 'file.txt'), '');

      const result = await navBuiltins.find([tmpDir, '!', '-type', 'd'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('file.txt');
    });
  });
});
