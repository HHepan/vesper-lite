#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// @vesper/bash — CLI Entry Point (vesper-bash binary)
// ═══════════════════════════════════════════════════════════════════════════

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createBashExecutor } from './executor.js';
import type { BashConfig } from './types.js';

// ---------------------------------------------------------------------------
// Argument Parsing
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    'config-file': { type: 'string' },
    c: { type: 'string', short: 'c' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});

// ---------------------------------------------------------------------------
// Help Text
// ---------------------------------------------------------------------------

const HELP_TEXT = `
vesper-bash — Pure Node.js bash emulator with sandbox support

Usage:
  vesper-bash [options]

Options:
  --config <json>         Inline JSON sandbox config
  --config-file <path>    Path to JSON config file
  -c <command>            Execute single command and exit
  --help, -h              Show this help

Config JSON schema:
  {
    "cwd": "/path",                    // Working directory (default: process.cwd())
    "allowedDirs": ["/tmp", "/home"],  // Sandbox boundaries
    "deniedDirs": ["/etc/secret"],     // Denied paths
    "allowedCommands": ["ls", "cat"],  // Command whitelist
    "deniedCommands": ["rm"],          // Command blacklist
    "readOnly": false,                 // Block write operations
    "env": { "KEY": "value" },         // Environment variables
    "maxOutputBytes": 5242880,         // Max output (default: 5MB)
    "timeout": 120000                  // Command timeout (default: 120s)
  }

Examples:
  vesper-bash -c "echo hello"
  vesper-bash --config '{"readOnly":true}' -c "ls -la"
  vesper-bash --config '{"allowedDirs":["/tmp"]}' -c "ls /etc"
  echo "ls -la" | vesper-bash
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (values.help) {
    process.stdout.write(HELP_TEXT + '\n');
    return;
  }

  // Load config
  let config: BashConfig = { cwd: process.cwd() };

  if (values.config) {
    try {
      const parsed = JSON.parse(values.config);
      config = { ...config, ...parsed };
    } catch (e) {
      process.stderr.write(`Error parsing config JSON: ${e instanceof Error ? e.message : e}\n`);
      process.exit(1);
    }
  } else if (values['config-file']) {
    try {
      const content = await readFile(values['config-file'], 'utf-8');
      const parsed = JSON.parse(content);
      config = { ...config, ...parsed };
    } catch (e) {
      process.stderr.write(`Error loading config file: ${e instanceof Error ? e.message : e}\n`);
      process.exit(1);
    }
  }

  // Ensure cwd
  if (!config.cwd) config.cwd = process.cwd();

  const executor = createBashExecutor(config);

  // Mode 1: Single command (-c)
  if (values.c) {
    const result = await executor.execute(values.c);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  }

  // Mode 2: Pipe mode (stdin is not TTY)
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    }
    const lines = input.split('\n').filter((l) => l.trim().length > 0);
    let lastExitCode = 0;
    for (const line of lines) {
      const result = await executor.execute(line);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      lastExitCode = result.exitCode;
    }
    process.exit(lastExitCode);
  }

  // Mode 3: Interactive REPL
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'vesper-bash$ ',
  });

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }

    if (input === 'exit') {
      break;
    }

    const result = await executor.execute(input);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    rl.prompt();
  }

  rl.close();
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
