// =============================================================================
// @vesper/bash — Sandbox Enforcement Tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSandbox } from '../src/sandbox.js';
import type { BashConfig } from '../src/types.js';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('createSandbox', () => {
  let tmpDir: string;
  let subDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vesper-sandbox-'));
    subDir = join(tmpDir, 'allowed');
    outsideDir = await mkdtemp(join(tmpdir(), 'vesper-sandbox-outside-'));
    await mkdir(subDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Path checking
  // -------------------------------------------------------------------------

  it('allows read within allowedDirs', () => {
    const sandbox = createSandbox({ cwd: tmpDir, allowedDirs: [tmpDir] });
    // Should not throw
    expect(() => sandbox.checkPath(join(tmpDir, 'somefile.txt'), 'read')).not.toThrow();
  });

  it('blocks read outside allowedDirs', () => {
    const sandbox = createSandbox({ cwd: tmpDir, allowedDirs: [tmpDir] });
    expect(() => sandbox.checkPath(outsideDir, 'read')).toThrow(/Sandbox violation/);
  });

  it('allows write within allowedDirs when readOnly=false', () => {
    const sandbox = createSandbox({ cwd: tmpDir, allowedDirs: [tmpDir], readOnly: false });
    expect(() => sandbox.checkPath(join(tmpDir, 'newfile.txt'), 'write')).not.toThrow();
  });

  it('blocks write when readOnly=true', () => {
    const sandbox = createSandbox({ cwd: tmpDir, allowedDirs: [tmpDir], readOnly: true });
    expect(() => sandbox.checkPath(join(tmpDir, 'newfile.txt'), 'write')).toThrow(/read-only mode/);
  });

  it('blocks denied dirs even within allowed', () => {
    const deniedDir = join(tmpDir, 'secret');
    const sandbox = createSandbox({
      cwd: tmpDir,
      allowedDirs: [tmpDir],
      deniedDirs: [deniedDir],
    });
    // Parent allowed dir is fine
    expect(() => sandbox.checkPath(join(tmpDir, 'other.txt'), 'read')).not.toThrow();
    // Denied subdir throws
    expect(() => sandbox.checkPath(join(deniedDir, 'file.txt'), 'read')).toThrow(/denied directory/);
  });

  it('default config (no allowedDirs) allows cwd', () => {
    const sandbox = createSandbox({ cwd: tmpDir });
    // cwd itself should be allowed
    expect(() => sandbox.checkPath(tmpDir, 'read')).not.toThrow();
    // Files within cwd should be allowed
    expect(() => sandbox.checkPath(join(tmpDir, 'file.txt'), 'read')).not.toThrow();
  });

  it('default config blocks paths outside cwd', () => {
    const sandbox = createSandbox({ cwd: tmpDir });
    expect(() => sandbox.checkPath(outsideDir, 'read')).toThrow(/Sandbox violation/);
  });

  // -------------------------------------------------------------------------
  // Command checking
  // -------------------------------------------------------------------------

  it('command whitelist: allows listed commands', () => {
    const sandbox = createSandbox({
      cwd: tmpDir,
      allowedCommands: ['ls', 'cat'],
    });
    expect(() => sandbox.checkCommand('ls')).not.toThrow();
    expect(() => sandbox.checkCommand('cat')).not.toThrow();
  });

  it('command whitelist: blocks unlisted commands', () => {
    const sandbox = createSandbox({
      cwd: tmpDir,
      allowedCommands: ['ls', 'cat'],
    });
    expect(() => sandbox.checkCommand('rm')).toThrow(/not in the allowed commands list/);
  });

  it('command blacklist: allows non-denied commands', () => {
    const sandbox = createSandbox({
      cwd: tmpDir,
      deniedCommands: ['rm'],
    });
    expect(() => sandbox.checkCommand('ls')).not.toThrow();
  });

  it('command blacklist: blocks denied commands', () => {
    const sandbox = createSandbox({
      cwd: tmpDir,
      deniedCommands: ['rm'],
    });
    expect(() => sandbox.checkCommand('rm')).toThrow(/denied commands list/);
  });

  it('no command lists means all commands allowed', () => {
    const sandbox = createSandbox({ cwd: tmpDir });
    expect(() => sandbox.checkCommand('ls')).not.toThrow();
    expect(() => sandbox.checkCommand('rm')).not.toThrow();
    expect(() => sandbox.checkCommand('anything')).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // isReadOnly
  // -------------------------------------------------------------------------

  it('isReadOnly returns true when readOnly is set', () => {
    const sandbox = createSandbox({ cwd: tmpDir, readOnly: true });
    expect(sandbox.isReadOnly()).toBe(true);
  });

  it('isReadOnly returns false when readOnly is not set', () => {
    const sandbox = createSandbox({ cwd: tmpDir });
    expect(sandbox.isReadOnly()).toBe(false);
  });
});
