// =============================================================================
// @vesper/bash — Text Processing Builtins Tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { textBuiltins } from '../../src/builtins/text.js';
import { createSandbox } from '../../src/sandbox.js';
import type { CommandContext } from '../../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('text builtins', () => {
  let tmpDir: string;
  let ctx: CommandContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vesper-bash-text-'));
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
  // echo
  // -------------------------------------------------------------------------

  describe('echo', () => {
    it('outputs text with trailing newline', async () => {
      const result = await textBuiltins.echo(['hello', 'world'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello world\n');
    });

    it('-n flag suppresses trailing newline', async () => {
      const result = await textBuiltins.echo(['-n', 'hello'], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello');
    });

    it('outputs empty line with no args', async () => {
      const result = await textBuiltins.echo([], ctx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('\n');
    });
  });

  // -------------------------------------------------------------------------
  // grep
  // -------------------------------------------------------------------------

  describe('grep', () => {
    it('matches pattern in stdin', async () => {
      const stdinCtx = { ...ctx, stdin: 'apple\nbanana\ncherry\napricot\n' };
      const result = await textBuiltins.grep(['ap', ], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('apple');
      expect(result.stdout).toContain('apricot');
      expect(result.stdout).not.toContain('banana');
    });

    it('-i flag for case-insensitive matching', async () => {
      const stdinCtx = { ...ctx, stdin: 'Hello\nworld\nHELLO\n' };
      const result = await textBuiltins.grep(['-i', 'hello'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello');
      expect(result.stdout).toContain('HELLO');
      expect(result.stdout).not.toContain('world');
    });

    it('-v flag for inverted matching', async () => {
      const stdinCtx = { ...ctx, stdin: 'apple\nbanana\ncherry\n' };
      const result = await textBuiltins.grep(['-v', 'banana'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('apple');
      expect(result.stdout).toContain('cherry');
      expect(result.stdout).not.toContain('banana');
    });

    it('returns exitCode 1 when no match found', async () => {
      const stdinCtx = { ...ctx, stdin: 'apple\nbanana\n' };
      const result = await textBuiltins.grep(['xyz'], stdinCtx);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
    });

    it('returns error when pattern is missing', async () => {
      const result = await textBuiltins.grep([], ctx);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('missing pattern');
    });
  });

  // -------------------------------------------------------------------------
  // wc
  // -------------------------------------------------------------------------

  describe('wc', () => {
    it('-l counts lines from stdin', async () => {
      const stdinCtx = { ...ctx, stdin: 'line1\nline2\nline3\n' };
      const result = await textBuiltins.wc(['-l'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toContain('3');
    });

    it('-w counts words from stdin', async () => {
      const stdinCtx = { ...ctx, stdin: 'one two three\nfour five\n' };
      const result = await textBuiltins.wc(['-w'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toContain('5');
    });

    it('-c counts characters from stdin', async () => {
      const stdinCtx = { ...ctx, stdin: 'hello\n' };
      const result = await textBuiltins.wc(['-c'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toContain('6');
    });

    it('shows all counts when no flags given', async () => {
      const stdinCtx = { ...ctx, stdin: 'hello world\n' };
      const result = await textBuiltins.wc([], stdinCtx);
      expect(result.exitCode).toBe(0);
      // Should contain line count (1), word count (2), char count (12)
      expect(result.stdout).toContain('1');
      expect(result.stdout).toContain('2');
      expect(result.stdout).toContain('12');
    });
  });

  // -------------------------------------------------------------------------
  // sort
  // -------------------------------------------------------------------------

  describe('sort', () => {
    it('sorts lines from stdin alphabetically', async () => {
      const stdinCtx = { ...ctx, stdin: 'banana\napple\ncherry\n' };
      const result = await textBuiltins.sort([], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('apple\nbanana\ncherry\n');
    });

    it('-r flag reverses sort order', async () => {
      const stdinCtx = { ...ctx, stdin: 'banana\napple\ncherry\n' };
      const result = await textBuiltins.sort(['-r'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('cherry\nbanana\napple\n');
    });

    it('-n flag sorts numerically', async () => {
      const stdinCtx = { ...ctx, stdin: '10\n2\n30\n1\n' };
      const result = await textBuiltins.sort(['-n'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('1\n2\n10\n30\n');
    });

    it('-u flag removes duplicates', async () => {
      const stdinCtx = { ...ctx, stdin: 'banana\napple\nbanana\napple\n' };
      const result = await textBuiltins.sort(['-u'], stdinCtx);
      expect(result.exitCode).toBe(0);
      // After sort: apple, apple, banana, banana -> unique: apple, banana
      expect(result.stdout).toBe('apple\nbanana\n');
    });
  });

  // -------------------------------------------------------------------------
  // uniq
  // -------------------------------------------------------------------------

  describe('uniq', () => {
    it('removes consecutive duplicate lines from stdin', async () => {
      const stdinCtx = { ...ctx, stdin: 'apple\napple\nbanana\nbanana\ncherry\n' };
      const result = await textBuiltins.uniq([], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('apple\nbanana\ncherry\n');
    });

    it('preserves non-consecutive duplicates', async () => {
      const stdinCtx = { ...ctx, stdin: 'apple\nbanana\napple\n' };
      const result = await textBuiltins.uniq([], stdinCtx);
      expect(result.exitCode).toBe(0);
      // uniq only removes consecutive dupes, so apple appears twice
      expect(result.stdout).toBe('apple\nbanana\napple\n');
    });

    it('-c flag shows counts', async () => {
      const stdinCtx = { ...ctx, stdin: 'apple\napple\nbanana\n' };
      const result = await textBuiltins.uniq(['-c'], stdinCtx);
      expect(result.exitCode).toBe(0);
      // Count format: "      2 apple" and "      1 banana"
      expect(result.stdout).toContain('2 apple');
      expect(result.stdout).toContain('1 banana');
    });

    it('-d flag shows only duplicated lines', async () => {
      const stdinCtx = { ...ctx, stdin: 'apple\napple\nbanana\n' };
      const result = await textBuiltins.uniq(['-d'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('apple');
      expect(result.stdout).not.toContain('banana');
    });
  });

  // -------------------------------------------------------------------------
  // grep enhanced flags
  // -------------------------------------------------------------------------

  describe('grep enhanced', () => {
    it('-c counts matching lines', async () => {
      const stdinCtx = { ...ctx, stdin: 'apple\napricot\nbanana\n' };
      const result = await textBuiltins.grep(['-c', 'ap'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('2');
    });

    it('-w matches whole words only', async () => {
      const stdinCtx = { ...ctx, stdin: 'foo\nfoobar\nbar foo baz\n' };
      const result = await textBuiltins.grep(['-w', 'foo'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('foo');
      expect(result.stdout).toContain('bar foo baz');
      // foobar should NOT match with -w
      const lines = result.stdout.trim().split('\n');
      expect(lines.every(l => !l.match(/^foobar$/))).toBe(true);
    });

    it('-o prints only matching portions', async () => {
      const stdinCtx = { ...ctx, stdin: 'apple pie\nbanana split\napricot jam\n' };
      const result = await textBuiltins.grep(['-o', 'ap\\w*'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('apple');
      expect(result.stdout).toContain('apricot');
      expect(result.stdout).not.toContain('pie');
    });

    it('-F uses fixed string matching', async () => {
      const stdinCtx = { ...ctx, stdin: 'a.b\na*b\naxb\n' };
      const result = await textBuiltins.grep(['-F', 'a.b'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('a.b');
    });

    it('-m limits matches', async () => {
      const stdinCtx = { ...ctx, stdin: 'a\na\na\na\n' };
      const result = await textBuiltins.grep(['-m', '2', 'a'], stdinCtx);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines.length).toBe(2);
    });

    it('-A shows after-context lines', async () => {
      const stdinCtx = { ...ctx, stdin: 'one\ntwo\nthree\nfour\nfive\n' };
      const result = await textBuiltins.grep(['-A', '1', 'three'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('three');
      expect(result.stdout).toContain('four');
    });

    it('-B shows before-context lines', async () => {
      const stdinCtx = { ...ctx, stdin: 'one\ntwo\nthree\nfour\nfive\n' };
      const result = await textBuiltins.grep(['-B', '1', 'three'], stdinCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('two');
      expect(result.stdout).toContain('three');
    });
  });

  // -------------------------------------------------------------------------
  // sort enhanced
  // -------------------------------------------------------------------------

  describe('sort enhanced', () => {
    it('-k sorts by key field', async () => {
      const stdinCtx = { ...ctx, stdin: 'b 2\na 3\nc 1\n' };
      const result = await textBuiltins.sort(['-k', '2', '-n'], stdinCtx);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines[0]).toContain('1');
      expect(lines[1]).toContain('2');
      expect(lines[2]).toContain('3');
    });

    it('-t sets field separator', async () => {
      const stdinCtx = { ...ctx, stdin: 'b:2\na:3\nc:1\n' };
      const result = await textBuiltins.sort(['-t', ':', '-k', '2', '-n'], stdinCtx);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines[0]).toBe('c:1');
      expect(lines[1]).toBe('b:2');
      expect(lines[2]).toBe('a:3');
    });

    it('-f sorts case-insensitively', async () => {
      const stdinCtx = { ...ctx, stdin: 'Banana\napple\nCherry\n' };
      const result = await textBuiltins.sort(['-f'], stdinCtx);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines[0]).toBe('apple');
    });
  });

  // -------------------------------------------------------------------------
  // xargs enhanced
  // -------------------------------------------------------------------------

  describe('xargs enhanced', () => {
    it('default uses echo', async () => {
      const xCtx = { ...ctx, stdin: 'a b c' };
      const result = await textBuiltins.xargs([], xCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('a b c');
    });

    it('uses executeCommand for non-echo commands', async () => {
      let capturedCmd = '';
      const xCtx = {
        ...ctx,
        stdin: 'a b c',
        executeCommand: async (cmd: string) => {
          capturedCmd = cmd;
          return { stdout: 'ok\n', stderr: '', exitCode: 0 };
        },
      };
      const result = await textBuiltins.xargs(['rm'], xCtx);
      expect(result.exitCode).toBe(0);
      expect(capturedCmd).toBe('rm a b c');
    });

    it('-I replaces placeholder', async () => {
      const xCtx = {
        ...ctx,
        stdin: 'a\nb\n',
        executeCommand: async (cmd: string) => {
          return { stdout: cmd + '\n', stderr: '', exitCode: 0 };
        },
      };
      const result = await textBuiltins.xargs(['-I', '{}', 'echo', '{}'], xCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('echo a');
      expect(result.stdout).toContain('echo b');
    });

    it('-n limits args per invocation', async () => {
      const calls: string[] = [];
      const xCtx = {
        ...ctx,
        stdin: 'a b c d',
        executeCommand: async (cmd: string) => {
          calls.push(cmd);
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      };
      await textBuiltins.xargs(['-n', '2', 'echo'], xCtx);
      // Should not use executeCommand for echo, but batch
      // Actually echo is handled inline. Let's test with non-echo:
      const calls2: string[] = [];
      const xCtx2 = {
        ...ctx,
        stdin: 'a b c d',
        executeCommand: async (cmd: string) => {
          calls2.push(cmd);
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      };
      await textBuiltins.xargs(['-n', '2', 'rm'], xCtx2);
      expect(calls2.length).toBe(2);
      expect(calls2[0]).toBe('rm a b');
      expect(calls2[1]).toBe('rm c d');
    });
  });

  // -------------------------------------------------------------------------
  // sed
  // -------------------------------------------------------------------------

  describe('sed', () => {
    it('substitutes first occurrence', async () => {
      const sCtx = { ...ctx, stdin: 'hello world\n' };
      const result = await textBuiltins.sed(['s/hello/goodbye/'], sCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('goodbye world');
    });

    it('substitutes all occurrences with /g', async () => {
      const sCtx = { ...ctx, stdin: 'aaa\n' };
      const result = await textBuiltins.sed(['s/a/b/g'], sCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('bbb');
    });

    it('deletes lines matching pattern', async () => {
      const sCtx = { ...ctx, stdin: 'keep\nremove\nkeep\n' };
      const result = await textBuiltins.sed(['/remove/d'], sCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('remove');
      expect(result.stdout).toContain('keep');
    });

    it('prints specific line with -n Np', async () => {
      const sCtx = { ...ctx, stdin: 'line1\nline2\nline3\n' };
      const result = await textBuiltins.sed(['-n', '2p'], sCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('line2');
    });

    it('deletes specific line number', async () => {
      const sCtx = { ...ctx, stdin: 'line1\nline2\nline3\n' };
      const result = await textBuiltins.sed(['2d'], sCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('line1');
      expect(result.stdout).not.toContain('line2');
      expect(result.stdout).toContain('line3');
    });

    it('supports -i for in-place editing', async () => {
      await writeFile(join(tmpDir, 'edit.txt'), 'hello world\n');
      const result = await textBuiltins.sed(['-i', 's/hello/goodbye/g', 'edit.txt'], ctx);
      expect(result.exitCode).toBe(0);

      const { readFile: rf } = await import('node:fs/promises');
      const content = await rf(join(tmpDir, 'edit.txt'), 'utf-8');
      expect(content).toContain('goodbye world');
    });

    it('supports -e for multiple expressions', async () => {
      const sCtx = { ...ctx, stdin: 'hello world\n' };
      const result = await textBuiltins.sed(['-e', 's/hello/goodbye/', '-e', 's/world/earth/'], sCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('goodbye earth');
    });
  });

  // -------------------------------------------------------------------------
  // awk
  // -------------------------------------------------------------------------

  describe('awk', () => {
    it('prints a specific field', async () => {
      const aCtx = { ...ctx, stdin: 'hello world\nfoo bar\n' };
      const result = await textBuiltins.awk(['{print $2}'], aCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('world');
      expect(result.stdout).toContain('bar');
    });

    it('supports -F for custom separator', async () => {
      const aCtx = { ...ctx, stdin: 'a:b:c\n' };
      const result = await textBuiltins.awk(['-F:', '{print $2}'], aCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('b');
    });

    it('prints NR with $0', async () => {
      const aCtx = { ...ctx, stdin: 'a\nb\nc\n' };
      const result = await textBuiltins.awk(['{print NR, $0}'], aCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1 a');
      expect(result.stdout).toContain('2 b');
      expect(result.stdout).toContain('3 c');
    });

    it('filters by regex pattern', async () => {
      const aCtx = { ...ctx, stdin: 'apple\nbanana\napricot\n' };
      const result = await textBuiltins.awk(['/ap/ {print}'], aCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('apple');
      expect(result.stdout).toContain('apricot');
      expect(result.stdout).not.toContain('banana');
    });

    it('handles NR== for specific line', async () => {
      const aCtx = { ...ctx, stdin: 'a\nb\nc\n' };
      const result = await textBuiltins.awk(['NR==2 {print}'], aCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('b');
    });

    it('handles END with accumulator', async () => {
      const aCtx = { ...ctx, stdin: '10\n20\n30\n' };
      const result = await textBuiltins.awk(['{sum+=$1} END {print sum}'], aCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('60');
    });

    it('counts lines with END NR', async () => {
      const aCtx = { ...ctx, stdin: 'a\nb\nc\n' };
      const result = await textBuiltins.awk(['END {print NR}'], aCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('3');
    });

    it('supports -v for variable injection', async () => {
      const aCtx = { ...ctx, stdin: 'hello\n' };
      const result = await textBuiltins.awk(['-v', 'x=42', '{print $1, x}'], aCtx);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello');
      expect(result.stdout).toContain('42');
    });
  });
});
