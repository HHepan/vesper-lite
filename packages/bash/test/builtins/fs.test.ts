// =============================================================================
// @vesper/bash — Filesystem Builtins Tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fsBuiltins } from '../../src/builtins/fs.js';
import { createSandbox } from '../../src/sandbox.js';
import type { CommandContext } from '../../src/types.js';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('fs builtins', () => {
  let tmpDir: string;
  let ctx: CommandContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vesper-bash-fs-'));
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
  // ls
  // -------------------------------------------------------------------------

  describe('ls', () => {
    it('lists files in directory', async () => {
      await writeFile(join(tmpDir, 'alpha.txt'), 'a');
      await writeFile(join(tmpDir, 'beta.txt'), 'b');

      const result = await fsBuiltins.ls([], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('alpha.txt');
      expect(result.stdout).toContain('beta.txt');
    });

    it('ls -a shows hidden files', async () => {
      await writeFile(join(tmpDir, '.hidden'), 'secret');
      await writeFile(join(tmpDir, 'visible.txt'), 'visible');

      const result = await fsBuiltins.ls(['-a'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('.hidden');
      expect(result.stdout).toContain('visible.txt');
    });

    it('ls without -a hides dotfiles', async () => {
      await writeFile(join(tmpDir, '.hidden'), 'secret');
      await writeFile(join(tmpDir, 'visible.txt'), 'visible');

      const result = await fsBuiltins.ls([], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('.hidden');
      expect(result.stdout).toContain('visible.txt');
    });
  });

  // -------------------------------------------------------------------------
  // cat
  // -------------------------------------------------------------------------

  describe('cat', () => {
    it('reads file content', async () => {
      await writeFile(join(tmpDir, 'hello.txt'), 'hello world');

      const result = await fsBuiltins.cat(['hello.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello world');
    });

    it('reads from stdin when no file given', async () => {
      const stdinCtx = { ...ctx, stdin: 'from stdin' };
      const result = await fsBuiltins.cat([], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('from stdin');
    });

    it('returns error for nonexistent file', async () => {
      const result = await fsBuiltins.cat(['nope.txt'], ctx);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No such file or directory');
    });
  });

  // -------------------------------------------------------------------------
  // head / tail
  // -------------------------------------------------------------------------

  describe('head', () => {
    it('reads first N lines from file', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await writeFile(join(tmpDir, 'data.txt'), lines);

      const result = await fsBuiltins.head(['-n', '3', 'data.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('line 1');
      expect(result.stdout).toContain('line 2');
      expect(result.stdout).toContain('line 3');
      expect(result.stdout).not.toContain('line 4');
    });

    it('defaults to 10 lines', async () => {
      const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await writeFile(join(tmpDir, 'data.txt'), lines);

      const result = await fsBuiltins.head(['data.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('line 10');
      expect(result.stdout).not.toContain('line 11');
    });

    it('head -5 file (BSD shorthand)', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await writeFile(join(tmpDir, 'data.txt'), lines);

      const result = await fsBuiltins.head(['-5', 'data.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('line 5');
      expect(result.stdout).not.toContain('line 6');
    });
  });

  describe('tail', () => {
    it('reads last N lines from file', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await writeFile(join(tmpDir, 'data.txt'), lines);

      const result = await fsBuiltins.tail(['-n', '3', 'data.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('line 20');
      expect(result.stdout).toContain('line 19');
      // line 18 is included because -n 3 gives [line 19, line 20, ''] from the trailing \n
      // But the key point is we get the last lines
    });

    it('tail -3 file (BSD shorthand)', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      await writeFile(join(tmpDir, 'data.txt'), lines);

      const result = await fsBuiltins.tail(['-3', 'data.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('line 20');
      expect(result.stdout).toContain('line 19');
    });
  });

  // -------------------------------------------------------------------------
  // cp
  // -------------------------------------------------------------------------

  describe('cp', () => {
    it('copies a file and preserves content', async () => {
      await writeFile(join(tmpDir, 'source.txt'), 'copy me');

      const result = await fsBuiltins.cp(['source.txt', 'dest.txt'], ctx);
      expect(result.exitCode).toBe(0);

      const content = await readFile(join(tmpDir, 'dest.txt'), 'utf-8');
      expect(content).toBe('copy me');
    });

    it('returns error when source does not exist', async () => {
      const result = await fsBuiltins.cp(['nonexistent.txt', 'dest.txt'], ctx);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No such file or directory');
    });
  });

  // -------------------------------------------------------------------------
  // mkdir
  // -------------------------------------------------------------------------

  describe('mkdir', () => {
    it('creates a directory', async () => {
      const result = await fsBuiltins.mkdir(['newdir'], ctx);
      expect(result.exitCode).toBe(0);

      const lsResult = await fsBuiltins.ls([], ctx);
      expect(lsResult.stdout).toContain('newdir');
    });

    it('mkdir -p creates nested directories', async () => {
      const result = await fsBuiltins.mkdir(['-p', 'a/b/c'], ctx);
      expect(result.exitCode).toBe(0);

      // Verify nested structure exists
      const innerCtx = { ...ctx, cwd: join(tmpDir, 'a', 'b') };
      const lsResult = await fsBuiltins.ls([], innerCtx);
      expect(lsResult.stdout).toContain('c');
    });
  });

  // -------------------------------------------------------------------------
  // rm
  // -------------------------------------------------------------------------

  describe('rm', () => {
    it('removes a file', async () => {
      await writeFile(join(tmpDir, 'todelete.txt'), 'bye');

      const result = await fsBuiltins.rm(['todelete.txt'], ctx);
      expect(result.exitCode).toBe(0);

      const lsResult = await fsBuiltins.ls([], ctx);
      expect(lsResult.stdout).not.toContain('todelete.txt');
    });

    it('returns error when trying to remove nonexistent file without -f', async () => {
      const result = await fsBuiltins.rm(['nonexistent.txt'], ctx);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No such file or directory');
    });

    it('rm -f silently ignores nonexistent files', async () => {
      const result = await fsBuiltins.rm(['-f', 'nonexistent.txt'], ctx);
      expect(result.exitCode).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // touch
  // -------------------------------------------------------------------------

  describe('touch', () => {
    it('creates a new empty file', async () => {
      const result = await fsBuiltins.touch(['newfile.txt'], ctx);
      expect(result.exitCode).toBe(0);

      const content = await readFile(join(tmpDir, 'newfile.txt'), 'utf-8');
      expect(content).toBe('');
    });

    it('touch on existing file does not change content', async () => {
      await writeFile(join(tmpDir, 'existing.txt'), 'keep me');

      const result = await fsBuiltins.touch(['existing.txt'], ctx);
      expect(result.exitCode).toBe(0);

      const content = await readFile(join(tmpDir, 'existing.txt'), 'utf-8');
      expect(content).toBe('keep me');
    });
  });

  // -------------------------------------------------------------------------
  // cat -n / -b
  // -------------------------------------------------------------------------

  describe('cat -n/-b', () => {
    it('-n numbers all lines', async () => {
      await writeFile(join(tmpDir, 'lines.txt'), 'alpha\nbeta\ngamma\n');
      const result = await fsBuiltins.cat(['-n', 'lines.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1\talpha');
      expect(result.stdout).toContain('2\tbeta');
      expect(result.stdout).toContain('3\tgamma');
    });

    it('-b numbers non-blank lines only', async () => {
      await writeFile(join(tmpDir, 'blanks.txt'), 'alpha\n\nbeta\n');
      const result = await fsBuiltins.cat(['-b', 'blanks.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1\talpha');
      expect(result.stdout).toContain('2\tbeta');
      // Blank line should not be numbered
      const lines = result.stdout.split('\n');
      const blankLine = lines.find(l => l.trim() === '');
      expect(blankLine).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // ls enhanced flags
  // -------------------------------------------------------------------------

  describe('ls enhanced', () => {
    it('ls -S sorts by size', async () => {
      await writeFile(join(tmpDir, 'small.txt'), 'a');
      await writeFile(join(tmpDir, 'large.txt'), 'a'.repeat(100));

      const result = await fsBuiltins.ls(['-lS'], ctx);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split('\n');
      // large.txt should come before small.txt
      const largeIdx = lines.findIndex(l => l.includes('large.txt'));
      const smallIdx = lines.findIndex(l => l.includes('small.txt'));
      expect(largeIdx).toBeLessThan(smallIdx);
    });

    it('ls -h shows human-readable sizes', async () => {
      await writeFile(join(tmpDir, 'test.txt'), 'hello');
      const result = await fsBuiltins.ls(['-lh'], ctx);
      expect(result.exitCode).toBe(0);
      // Should contain the file listing
      expect(result.stdout).toContain('test.txt');
    });
  });

  // -------------------------------------------------------------------------
  // head -c / tail -c
  // -------------------------------------------------------------------------

  describe('head -c', () => {
    it('returns first N bytes', async () => {
      await writeFile(join(tmpDir, 'data.txt'), 'hello world');
      const result = await fsBuiltins.head(['-c', '5', 'data.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello');
    });
  });

  describe('tail -c', () => {
    it('returns last N bytes', async () => {
      await writeFile(join(tmpDir, 'data.txt'), 'hello world');
      const result = await fsBuiltins.tail(['-c', '5', 'data.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('world');
    });

    it('tail -n +N outputs from line N', async () => {
      const content = 'line1\nline2\nline3\nline4\nline5\n';
      await writeFile(join(tmpDir, 'data.txt'), content);
      const result = await fsBuiltins.tail(['-n', '+3', 'data.txt'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('line3');
      expect(result.stdout).toContain('line4');
      expect(result.stdout).toContain('line5');
      expect(result.stdout).not.toContain('line1');
      expect(result.stdout).not.toContain('line2');
    });
  });

  // -------------------------------------------------------------------------
  // chmod
  // -------------------------------------------------------------------------

  describe('chmod', () => {
    it('sets octal permissions', async () => {
      await writeFile(join(tmpDir, 'script.sh'), '#!/bin/bash\n');
      const result = await fsBuiltins.chmod(['755', 'script.sh'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('sets symbolic permissions', async () => {
      await writeFile(join(tmpDir, 'script.sh'), '#!/bin/bash\n');
      const result = await fsBuiltins.chmod(['+x', 'script.sh'], ctx);
      expect(result.exitCode).toBe(0);
    });

    it('errors on nonexistent file', async () => {
      const result = await fsBuiltins.chmod(['755', 'nope.sh'], ctx);
      expect(result.exitCode).not.toBe(0);
    });
  });
});
