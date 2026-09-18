// =============================================================================
// @vesper/bash — Executor Integration Tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBashExecutor } from '../src/executor.js';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('BashExecutor', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vesper-bash-exec-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('executes echo and returns stdout', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo hello');
    expect(result.stdout).toBe('hello\n');
    expect(result.exitCode).toBe(0);
  });

  it('executes a pipe: echo | wc -c', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo hello | wc -c');
    // "hello\n" = 6 characters
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toContain('6');
  });

  it('executes && (short-circuit on success)', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('true && echo yes');
    expect(result.stdout).toBe('yes\n');
    expect(result.exitCode).toBe(0);
  });

  it('&& skips second command on failure', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('false && echo nope');
    // false has exitCode=1, so echo is skipped
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(1);
  });

  it('executes || (short-circuit on failure)', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('false || echo fallback');
    expect(result.stdout).toBe('fallback\n');
    expect(result.exitCode).toBe(0);
  });

  it('|| skips second command on success', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('true || echo nope');
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('executes semicolons (sequential)', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    // With semicolons, the executor returns the result of the *last* pipeline.
    // So we check the last command's output.
    const result = await exec.execute('echo a; echo b');
    expect(result.stdout).toBe('b\n');
    expect(result.exitCode).toBe(0);
  });

  it('handles export and variable expansion across calls', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await exec.execute('export FOO=bar');
    const result = await exec.execute('echo $FOO');
    expect(result.stdout).toBe('bar\n');
    expect(result.exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Deferred variable expansion (Fix 1: export FOO=bar && echo $FOO)
  // -------------------------------------------------------------------------

  it('deferred expansion: export FOO=bar && echo $FOO outputs bar', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('export FOO=bar && echo $FOO');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('bar\n');
  });

  it('deferred expansion: chained exports with semicolons', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('export A=1; export B=2; echo $A $B');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('1 2\n');
  });

  it('deferred expansion: || short-circuit still works', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('export X=hello || echo should_not_run');
    expect(result.exitCode).toBe(0);
    // export succeeds, so || skips the echo
    const env = exec.getEnv();
    expect(env['X']).toBe('hello');
  });

  it('deferred expansion: mixed operators with variable visibility', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('export VAL=42 && echo "val=$VAL" && echo done');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('done\n');
    // The echo "val=$VAL" runs but we get the result of the LAST command (echo done).
    // Let's test that the env is properly set.
    const env = exec.getEnv();
    expect(env['VAL']).toBe('42');
  });

  it('deferred expansion: quotes are respected in split', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    // The && inside quotes should NOT be treated as a separator
    const result = await exec.execute('echo "a && b"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('a && b\n');
  });

  it('cd changes working directory', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await mkdir(join(tmpDir, 'sub'));
    const cdResult = await exec.execute('cd sub');
    expect(cdResult.exitCode).toBe(0);
    const expected = join(tmpDir, 'sub');
    // executor's cwd should be updated
    expect(exec.getCwd()).toBe(expected);
    // Now pwd should reflect the new cwd
    const pwdResult = await exec.execute('pwd');
    expect(pwdResult.stdout.trim()).toBe(expected);
  });

  it('cd && pwd propagates cwd within a single execute call', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await mkdir(join(tmpDir, 'sub'));
    const result = await exec.execute('cd sub && pwd');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(join(tmpDir, 'sub'));
  });

  it('cd && head reads file from new cwd', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await mkdir(join(tmpDir, 'sub'));
    await writeFile(join(tmpDir, 'sub', 'hello.txt'), 'line1\nline2\nline3\n');
    const result = await exec.execute('cd sub && head -n 1 hello.txt');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('line1');
  });

  it('mkdir -p creates nested directories', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('mkdir -p a/b/c');
    expect(result.exitCode).toBe(0);
    // Verify the directory was created by listing it
    const verify = await exec.execute('ls a/b');
    expect(verify.stdout.trim()).toBe('c');
  });

  it('readOnly blocks write operations (touch)', async () => {
    const exec = createBashExecutor({ cwd: tmpDir, readOnly: true });
    const result = await exec.execute('touch newfile');
    expect(result.exitCode).not.toBe(0);
  });

  it('readOnly blocks write operations (mkdir)', async () => {
    const exec = createBashExecutor({ cwd: tmpDir, readOnly: true });
    const result = await exec.execute('mkdir testdir');
    expect(result.exitCode).not.toBe(0);
  });

  it('command not found returns exitCode 127', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('nonexistent_command');
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('command not found');
  });

  it('getCwd returns the current working directory', () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    expect(exec.getCwd()).toBe(tmpDir);
  });

  it('getEnv returns environment variables including defaults', () => {
    const exec = createBashExecutor({ cwd: tmpDir, env: { MY_VAR: 'test' } });
    const env = exec.getEnv();
    expect(env['MY_VAR']).toBe('test');
    expect(env['PWD']).toBe(tmpDir);
  });

  it('output redirection writes to file', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo hello > out.txt');
    expect(result.exitCode).toBe(0);
    // stdout should be empty because output went to file
    expect(result.stdout).toBe('');
    // Verify the file was written
    const content = await readFile(join(tmpDir, 'out.txt'), 'utf-8');
    expect(content).toBe('hello\n');
  });

  it('append redirection appends to file', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await writeFile(join(tmpDir, 'log.txt'), 'first\n');
    const result = await exec.execute('echo second >> log.txt');
    expect(result.exitCode).toBe(0);
    const content = await readFile(join(tmpDir, 'log.txt'), 'utf-8');
    expect(content).toBe('first\nsecond\n');
  });

  it('input redirection reads from file', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await writeFile(join(tmpDir, 'data.txt'), 'banana\napple\ncherry\n');
    const result = await exec.execute('sort < data.txt');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('apple\nbanana\ncherry\n');
  });

  it('pipe chains multiple commands', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo -n "hello world" | wc -w');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toContain('2');
  });

  // -------------------------------------------------------------------------
  // /dev/null support
  // -------------------------------------------------------------------------

  it('echo > /dev/null discards output', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo hello > /dev/null');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('cat < /dev/null produces empty output', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('cat < /dev/null');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('echo >> /dev/null discards output (append mode)', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo hello >> /dev/null');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  // -------------------------------------------------------------------------
  // External command execution
  // -------------------------------------------------------------------------

  it('external command: node -e executes when allowExternalCommands is true', async () => {
    const exec = createBashExecutor({ cwd: tmpDir, allowExternalCommands: true });
    const result = await exec.execute('node -e "console.log(42)"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('42');
  });

  it('external command: respects cwd', async () => {
    const exec = createBashExecutor({ cwd: tmpDir, allowExternalCommands: true });
    await mkdir(join(tmpDir, 'sub'));
    await writeFile(join(tmpDir, 'sub', 'test.txt'), 'hello');
    // Use a simple script that works across platforms (no quote escaping issues with shell: true)
    await writeFile(join(tmpDir, 'sub', 'reader.js'), 'console.log(require("fs").readFileSync("test.txt","utf-8").trim())');
    const result = await exec.execute('cd sub && node reader.js');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('external command: deniedCommands blocks external commands', async () => {
    const exec = createBashExecutor({ cwd: tmpDir, allowExternalCommands: true, deniedCommands: ['node'] });
    const result = await exec.execute('node -e "console.log(1)"');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBeTruthy();
  });

  it('external command: ENOENT returns exit code 127', async () => {
    const exec = createBashExecutor({ cwd: tmpDir, allowExternalCommands: true });
    const result = await exec.execute('totally_nonexistent_binary_xyz');
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('command not found');
  });

  it('external command: default (false) still returns 127 for unknown commands', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('node -e "console.log(1)"');
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('command not found');
  });

  // Fix 2: Windows .cmd/.bat support — npm is available as npm.cmd on Windows
  it('external command: npm --version works on Windows (shell: true)', async () => {
    const exec = createBashExecutor({ cwd: tmpDir, allowExternalCommands: true });
    const result = await exec.execute('npm --version');
    expect(result.exitCode).toBe(0);
    // npm --version outputs a semver string like "10.2.0"
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  // -------------------------------------------------------------------------
  // Arithmetic expansion
  // -------------------------------------------------------------------------

  it('$((10 * 5)) → 50 (no glob expansion)', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo $((10 * 5))');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('50');
  });

  it('$((x + 1)) with exported variable', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await exec.execute('export x=10');
    const result = await exec.execute('echo $(($x + 1))');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('11');
  });

  // -------------------------------------------------------------------------
  // Unsupported feature errors (executor integration)
  // -------------------------------------------------------------------------

  it('echo $(ls) → clear error, not silent', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo $(ls)');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('not supported');
    expect(result.stderr).toContain('separately');
  });

  it('if/then/fi → clear error', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('if [ -f x ]; then echo yes; fi');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('not supported');
    expect(result.stderr).toContain('&&');
  });

  it('for/do/done → clear error', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('for f in *.txt; do echo $f; done');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('not supported');
  });

  it('cat << EOF → clear error', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('cat << EOF');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('not supported');
  });

  it('cat <<< "hello" → clear error', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('cat <<< "hello"');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('not supported');
  });

  it('echo `date` → clear error', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo `date`');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('not supported');
  });

  // -------------------------------------------------------------------------
  // xargs re-dispatch via executeCommand
  // -------------------------------------------------------------------------

  it('xargs re-dispatches to builtin commands', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await writeFile(join(tmpDir, 'a.txt'), 'hello');
    // echo "a.txt" | xargs cat → should read the file
    const result = await exec.execute('echo -n a.txt | xargs cat');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
  });

  it('xargs -I {} replaces placeholder per line', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await writeFile(join(tmpDir, 'x.txt'), 'content_x');
    await writeFile(join(tmpDir, 'y.txt'), 'content_y');
    const result = await exec.execute('echo "x.txt\ny.txt" | xargs -I {} cat {}');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('content_x');
    expect(result.stdout).toContain('content_y');
  });

  // -------------------------------------------------------------------------
  // New commands integration (through executor pipeline)
  // -------------------------------------------------------------------------

  it('printf formats output', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('printf "%s=%d" key 42');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('key=42');
  });

  it('seq generates number sequences', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('seq 3');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('1\n2\n3\n');
  });

  it('sed substitution through pipe', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo hello | sed s/hello/world/');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('world');
  });

  it('awk field extraction through pipe', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    // Use single quotes to prevent $2 from being expanded by the parser
    const result = await exec.execute("echo 'a b c' | awk '{print $2}'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('b');
  });

  it('tr translates characters through pipe', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo -n hello | tr a-z A-Z');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('HELLO');
  });

  it('cut extracts fields through pipe', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo -n "a:b:c" | cut -d : -f 2');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('b');
  });

  it('base64 encodes through pipe', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo -n hello | base64');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('aGVsbG8=');
  });

  it('date outputs current year', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('date +%Y');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d{4}$/);
  });

  it('diff compares files', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await writeFile(join(tmpDir, 'a.txt'), 'line1\nline2\n');
    await writeFile(join(tmpDir, 'b.txt'), 'line1\nchanged\n');
    const result = await exec.execute('diff a.txt b.txt');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('--- a.txt');
    expect(result.stdout).toContain('+++ b.txt');
    // Should contain both added and removed lines
    const lines = result.stdout.split('\n');
    const hasRemoved = lines.some(l => l.startsWith('-') && !l.startsWith('---'));
    const hasAdded = lines.some(l => l.startsWith('+') && !l.startsWith('+++'));
    expect(hasRemoved).toBe(true);
    expect(hasAdded).toBe(true);
  });

  it('stat displays file info', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await writeFile(join(tmpDir, 'info.txt'), 'hello');
    const result = await exec.execute('stat info.txt');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('File: info.txt');
    expect(result.stdout).toContain('Size: 5');
  });

  it('md5sum computes hash through pipe', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    const result = await exec.execute('echo -n hello | md5sum');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('5d41402abc4b2a76b9719d911017c592');
  });

  it('chmod sets permissions', async () => {
    const exec = createBashExecutor({ cwd: tmpDir });
    await writeFile(join(tmpDir, 'script.sh'), '#!/bin/bash\n');
    const result = await exec.execute('chmod 755 script.sh');
    expect(result.exitCode).toBe(0);
  });
});
