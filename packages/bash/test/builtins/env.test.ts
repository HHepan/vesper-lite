// =============================================================================
// @vesper/bash — Environment & Control-Flow Builtins Tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { envBuiltins } from '../../src/builtins/env.js';
import { createSandbox } from '../../src/sandbox.js';
import type { CommandContext } from '../../src/types.js';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('env builtins', () => {
  let tmpDir: string;
  let ctx: CommandContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vesper-bash-env-'));
    ctx = {
      cwd: tmpDir,
      env: { HOME: tmpDir, PATH: '/usr/bin' },
      stdin: '',
      sandbox: createSandbox({ cwd: tmpDir }),
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // env
  // -------------------------------------------------------------------------

  describe('env', () => {
    it('prints all environment variables', async () => {
      const result = await envBuiltins.env([], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('HOME=');
      expect(result.stdout).toContain('PATH=');
    });
  });

  // -------------------------------------------------------------------------
  // export
  // -------------------------------------------------------------------------

  describe('export', () => {
    it('sets an environment variable', async () => {
      const result = await envBuiltins.export(['FOO=bar'], ctx);
      expect(result.exitCode).toBe(0);
      expect(ctx.env['FOO']).toBe('bar');
    });

    it('prints all exported vars with no args', async () => {
      const result = await envBuiltins.export([], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('declare -x HOME=');
    });

    it('rejects invalid identifier', async () => {
      const result = await envBuiltins.export(['123=bad'], ctx);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('not a valid identifier');
    });
  });

  // -------------------------------------------------------------------------
  // unset
  // -------------------------------------------------------------------------

  describe('unset', () => {
    it('removes a variable', async () => {
      ctx.env['FOO'] = 'bar';
      const result = await envBuiltins.unset(['FOO'], ctx);
      expect(result.exitCode).toBe(0);
      expect(ctx.env['FOO']).toBeUndefined();
    });

    it('errors with no args', async () => {
      const result = await envBuiltins.unset([], ctx);
      expect(result.exitCode).not.toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // true / false / exit
  // -------------------------------------------------------------------------

  describe('true', () => {
    it('returns exitCode 0', async () => {
      const result = await envBuiltins.true([], ctx);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('false', () => {
    it('returns exitCode 1', async () => {
      const result = await envBuiltins.false([], ctx);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('exit', () => {
    it('returns exit code 0 by default', async () => {
      const result = await envBuiltins.exit([], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('returns specified exit code', async () => {
      const result = await envBuiltins.exit(['42'], ctx);
      expect(result.exitCode).toBe(42);
    });

    it('errors on non-numeric', async () => {
      const result = await envBuiltins.exit(['abc'], ctx);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('numeric argument required');
    });
  });

  // -------------------------------------------------------------------------
  // test / [
  // -------------------------------------------------------------------------

  describe('test', () => {
    it('-f detects regular file', async () => {
      await writeFile(join(tmpDir, 'file.txt'), 'hello');
      const result = await envBuiltins.test(['-f', 'file.txt'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('-f returns 1 for directory', async () => {
      await mkdir(join(tmpDir, 'subdir'));
      const result = await envBuiltins.test(['-f', 'subdir'], ctx);
      expect(result.exitCode).toBe(1);
    });

    it('-d detects directory', async () => {
      await mkdir(join(tmpDir, 'subdir'));
      const result = await envBuiltins.test(['-d', 'subdir'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('-e detects existence', async () => {
      await writeFile(join(tmpDir, 'exists.txt'), '');
      const result = await envBuiltins.test(['-e', 'exists.txt'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('-e returns 1 for nonexistent', async () => {
      const result = await envBuiltins.test(['-e', 'nope.txt'], ctx);
      expect(result.exitCode).toBe(1);
    });

    it('-z tests empty string', async () => {
      const result = await envBuiltins.test(['-z', ''], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('-z returns 1 for non-empty', async () => {
      const result = await envBuiltins.test(['-z', 'something'], ctx);
      expect(result.exitCode).toBe(1);
    });

    it('-n tests non-empty string', async () => {
      const result = await envBuiltins.test(['-n', 'hello'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('string equality', async () => {
      const result = await envBuiltins.test(['abc', '=', 'abc'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('string inequality', async () => {
      const result = await envBuiltins.test(['abc', '!=', 'xyz'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('! negates expression', async () => {
      const result = await envBuiltins.test(['!', '-e', 'nonexistent'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('integer comparison -eq', async () => {
      const result = await envBuiltins.test(['5', '-eq', '5'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('integer comparison -gt', async () => {
      const result = await envBuiltins.test(['10', '-gt', '5'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('integer comparison -lt', async () => {
      const result = await envBuiltins.test(['3', '-lt', '7'], ctx);
      expect(result.exitCode).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // test enhanced operators: -s, -r, -w, -x, -L, -h, -a, -o
  // -------------------------------------------------------------------------

  describe('test enhanced operators', () => {
    it('-s detects non-empty file', async () => {
      await writeFile(join(tmpDir, 'nonempty.txt'), 'content');
      const result = await envBuiltins.test(['-s', 'nonempty.txt'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('-s returns 1 for empty file', async () => {
      await writeFile(join(tmpDir, 'empty.txt'), '');
      const result = await envBuiltins.test(['-s', 'empty.txt'], ctx);
      expect(result.exitCode).toBe(1);
    });

    it('-s returns 1 for nonexistent file', async () => {
      const result = await envBuiltins.test(['-s', 'nope.txt'], ctx);
      expect(result.exitCode).toBe(1);
    });

    it('-r detects readable file', async () => {
      await writeFile(join(tmpDir, 'readable.txt'), 'data');
      const result = await envBuiltins.test(['-r', 'readable.txt'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('-w detects writable file', async () => {
      await writeFile(join(tmpDir, 'writable.txt'), 'data');
      const result = await envBuiltins.test(['-w', 'writable.txt'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('-L returns 1 for regular file (not symlink)', async () => {
      await writeFile(join(tmpDir, 'regular.txt'), 'data');
      const result = await envBuiltins.test(['-L', 'regular.txt'], ctx);
      expect(result.exitCode).toBe(1);
    });

    it('-h returns 1 for regular file (not symlink)', async () => {
      await writeFile(join(tmpDir, 'regular2.txt'), 'data');
      const result = await envBuiltins.test(['-h', 'regular2.txt'], ctx);
      expect(result.exitCode).toBe(1);
    });

    it('-a logical AND (both true)', async () => {
      await writeFile(join(tmpDir, 'a.txt'), 'aa');
      await writeFile(join(tmpDir, 'b.txt'), 'bb');
      const result = await envBuiltins.test(['-f', 'a.txt', '-a', '-f', 'b.txt'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('-a logical AND (one false)', async () => {
      await writeFile(join(tmpDir, 'a.txt'), 'aa');
      const result = await envBuiltins.test(['-f', 'a.txt', '-a', '-f', 'nope.txt'], ctx);
      expect(result.exitCode).toBe(1);
    });

    it('-o logical OR (one true)', async () => {
      await writeFile(join(tmpDir, 'a.txt'), 'aa');
      const result = await envBuiltins.test(['-f', 'nope.txt', '-o', '-f', 'a.txt'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('-o logical OR (both false)', async () => {
      const result = await envBuiltins.test(['-f', 'nope1.txt', '-o', '-f', 'nope2.txt'], ctx);
      expect(result.exitCode).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // [ (bracket) builtin
  // -------------------------------------------------------------------------

  describe('[', () => {
    it('works with closing ]', async () => {
      await writeFile(join(tmpDir, 'file.txt'), 'hi');
      const result = await envBuiltins['['](['-f', 'file.txt', ']'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('errors without closing ]', async () => {
      const result = await envBuiltins['['](['-f', 'file.txt'], ctx);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('missing closing ]');
    });
  });
});
