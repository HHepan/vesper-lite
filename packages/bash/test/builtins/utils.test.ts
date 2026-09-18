// =============================================================================
// @vesper/bash — Utility Builtins Tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { utilsBuiltins } from '../../src/builtins/utils.js';
import { createSandbox } from '../../src/sandbox.js';
import type { CommandContext } from '../../src/types.js';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('utils builtins', () => {
  let tmpDir: string;
  let ctx: CommandContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vesper-bash-utils-'));
    ctx = {
      cwd: tmpDir,
      env: {},
      stdin: '',
      sandbox: createSandbox({ cwd: tmpDir }),
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // printf
  // -------------------------------------------------------------------------

  describe('printf', () => {
    it('formats string with %s', async () => {
      const result = await utilsBuiltins.printf(['%s=%d\\n', 'key', '42'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('key=42\n');
    });

    it('handles %% literal', async () => {
      const result = await utilsBuiltins.printf(['100%%'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('100%');
    });

    it('formats float with %f', async () => {
      const result = await utilsBuiltins.printf(['%.2f', '3.14159'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('3.14');
    });

    it('formats hex with %x', async () => {
      const result = await utilsBuiltins.printf(['%x', '255'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('ff');
    });

    it('returns empty for no args', async () => {
      const result = await utilsBuiltins.printf([], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // sleep
  // -------------------------------------------------------------------------

  describe('sleep', () => {
    it('sleeps for a short duration', async () => {
      const start = Date.now();
      const result = await utilsBuiltins.sleep(['0.05'], ctx);
      const elapsed = Date.now() - start;
      expect(result.exitCode).toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it('errors on missing operand', async () => {
      const result = await utilsBuiltins.sleep([], ctx);
      expect(result.exitCode).not.toBe(0);
    });

    it('errors on invalid number', async () => {
      const result = await utilsBuiltins.sleep(['abc'], ctx);
      expect(result.exitCode).not.toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // date
  // -------------------------------------------------------------------------

  describe('date', () => {
    it('outputs current date with format', async () => {
      const result = await utilsBuiltins.date(['+%Y'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d{4}$/);
    });

    it('formats %F as YYYY-MM-DD', async () => {
      const result = await utilsBuiltins.date(['+%F'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('outputs epoch with %s', async () => {
      const result = await utilsBuiltins.date(['+%s'], ctx);
      expect(result.exitCode).toBe(0);
      const epoch = parseInt(result.stdout.trim(), 10);
      expect(epoch).toBeGreaterThan(1700000000);
    });

    it('supports -Iseconds for ISO format', async () => {
      const result = await utilsBuiltins.date(['-Iseconds'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // -------------------------------------------------------------------------
  // seq
  // -------------------------------------------------------------------------

  describe('seq', () => {
    it('generates sequence 1 to 5', async () => {
      const result = await utilsBuiltins.seq(['5'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('1\n2\n3\n4\n5\n');
    });

    it('generates sequence 3 to 7', async () => {
      const result = await utilsBuiltins.seq(['3', '7'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('3\n4\n5\n6\n7\n');
    });

    it('generates sequence with increment', async () => {
      const result = await utilsBuiltins.seq(['1', '2', '9'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('1\n3\n5\n7\n9\n');
    });

    it('supports -s separator', async () => {
      const result = await utilsBuiltins.seq(['-s', ',', '3'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('1,2,3\n');
    });

    it('supports -w equal width', async () => {
      const result = await utilsBuiltins.seq(['-w', '8', '11'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('08\n09\n10\n11\n');
    });
  });

  // -------------------------------------------------------------------------
  // mktemp
  // -------------------------------------------------------------------------

  describe('mktemp', () => {
    it('creates a temporary file', async () => {
      const tmpCtx = { ...ctx, sandbox: createSandbox({ cwd: tmpDir, allowedDirs: [tmpDir, tmpdir()] }) };
      const result = await utilsBuiltins.mktemp([], tmpCtx);
      expect(result.exitCode).toBe(0);
      const path = result.stdout.trim();
      expect(path.length).toBeGreaterThan(0);
    });

    it('creates a temporary directory with -d', async () => {
      const result = await utilsBuiltins.mktemp(['-d', '-p', tmpDir], ctx);
      expect(result.exitCode).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // stat
  // -------------------------------------------------------------------------

  describe('stat', () => {
    it('displays file info', async () => {
      await writeFile(join(tmpDir, 'test.txt'), 'hello');
      const result = await utilsBuiltins.stat(['test.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('File: test.txt');
      expect(result.stdout).toContain('Size: 5');
    });

    it('supports -c format', async () => {
      await writeFile(join(tmpDir, 'test.txt'), 'hello');
      const result = await utilsBuiltins.stat(['-c', '%s', 'test.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('5');
    });

    it('errors on nonexistent file', async () => {
      const result = await utilsBuiltins.stat(['nope.txt'], ctx);
      expect(result.exitCode).not.toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // diff
  // -------------------------------------------------------------------------

  describe('diff', () => {
    it('reports no difference for identical files', async () => {
      await writeFile(join(tmpDir, 'a.txt'), 'hello\n');
      await writeFile(join(tmpDir, 'b.txt'), 'hello\n');
      const result = await utilsBuiltins.diff(['a.txt', 'b.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
    });

    it('shows unified diff for different files', async () => {
      await writeFile(join(tmpDir, 'a.txt'), 'line1\nline2\nline3\n');
      await writeFile(join(tmpDir, 'b.txt'), 'line1\nmodified\nline3\n');
      const result = await utilsBuiltins.diff(['a.txt', 'b.txt'], ctx);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('--- a.txt');
      expect(result.stdout).toContain('+++ b.txt');
      expect(result.stdout).toContain('@@');
      // Diff must show both removed and added lines
      const lines = result.stdout.split('\n');
      const hasRemoved = lines.some(l => l.startsWith('-') && !l.startsWith('---'));
      const hasAdded = lines.some(l => l.startsWith('+') && !l.startsWith('+++'));
      expect(hasRemoved).toBe(true);
      expect(hasAdded).toBe(true);
    });

    it('supports -q quiet mode', async () => {
      await writeFile(join(tmpDir, 'a.txt'), 'aaa\n');
      await writeFile(join(tmpDir, 'b.txt'), 'bbb\n');
      const result = await utilsBuiltins.diff(['-q', 'a.txt', 'b.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('differ');
    });
  });

  // -------------------------------------------------------------------------
  // tr
  // -------------------------------------------------------------------------

  describe('tr', () => {
    it('translates lowercase to uppercase', async () => {
      const trCtx = { ...ctx, stdin: 'hello world' };
      const result = await utilsBuiltins.tr(['a-z', 'A-Z'], trCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('HELLO WORLD');
    });

    it('deletes characters with -d', async () => {
      const trCtx = { ...ctx, stdin: 'hello 123 world' };
      const result = await utilsBuiltins.tr(['-d', '0-9'], trCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello  world');
    });

    it('squeezes repeated characters with -s', async () => {
      const trCtx = { ...ctx, stdin: 'aabbbcccc' };
      const result = await utilsBuiltins.tr(['-s', 'a-z'], trCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('abc');
    });

    it('supports character classes', async () => {
      const trCtx = { ...ctx, stdin: 'Hello World' };
      const result = await utilsBuiltins.tr(['[:upper:]', '[:lower:]'], trCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello world');
    });
  });

  // -------------------------------------------------------------------------
  // cut
  // -------------------------------------------------------------------------

  describe('cut', () => {
    it('cuts fields with delimiter', async () => {
      const cutCtx = { ...ctx, stdin: 'a:b:c\n' };
      const result = await utilsBuiltins.cut(['-d', ':', '-f', '2'], cutCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('b');
    });

    it('cuts multiple fields', async () => {
      const cutCtx = { ...ctx, stdin: 'a:b:c:d\n' };
      const result = await utilsBuiltins.cut(['-d', ':', '-f', '1,3'], cutCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('a:c');
    });

    it('cuts character positions', async () => {
      const cutCtx = { ...ctx, stdin: 'abcdef\n' };
      const result = await utilsBuiltins.cut(['-c', '2-4'], cutCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('bcd');
    });

    it('reads from file', async () => {
      await writeFile(join(tmpDir, 'data.csv'), 'a,b,c\nd,e,f\n');
      const result = await utilsBuiltins.cut(['-d', ',', '-f', '2', 'data.csv'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('b\ne\n');
    });
  });

  // -------------------------------------------------------------------------
  // base64
  // -------------------------------------------------------------------------

  describe('base64', () => {
    it('encodes string to base64', async () => {
      const b64Ctx = { ...ctx, stdin: 'hello' };
      const result = await utilsBuiltins.base64([], b64Ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('aGVsbG8=');
    });

    it('decodes base64 string', async () => {
      const b64Ctx = { ...ctx, stdin: 'aGVsbG8=' };
      const result = await utilsBuiltins.base64(['-d'], b64Ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello');
    });
  });

  // -------------------------------------------------------------------------
  // md5sum / sha256sum
  // -------------------------------------------------------------------------

  describe('md5sum', () => {
    it('computes md5 hash of stdin', async () => {
      const hashCtx = { ...ctx, stdin: 'hello' };
      const result = await utilsBuiltins.md5sum([], hashCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('5d41402abc4b2a76b9719d911017c592');
    });

    it('computes md5 hash of file', async () => {
      await writeFile(join(tmpDir, 'test.txt'), 'hello');
      const result = await utilsBuiltins.md5sum(['test.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('5d41402abc4b2a76b9719d911017c592');
      expect(result.stdout).toContain('test.txt');
    });
  });

  describe('sha256sum', () => {
    it('computes sha256 hash of stdin', async () => {
      const hashCtx = { ...ctx, stdin: 'hello' };
      const result = await utilsBuiltins.sha256sum([], hashCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });
  });
});
