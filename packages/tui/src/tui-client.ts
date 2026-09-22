#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — TUI Client (vesper-tui binary)
// Spawns vesper-core as child process and renders events via Ink.
// ═══════════════════════════════════════════════════════════════════════════

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, openSync, statSync, writeFileSync, readFileSync, type WriteStream } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import {
  createNdjsonReader,
  createNdjsonWriter,
  deserializeEvent,
  type CoreCommand,
  type WireConfig,
  type WireEvent,
  type NdjsonWriter,
} from '@vesper/shared';
import { createTuiStore } from './store.js';
import { App } from './ink-app.js';
import type { CanvasBrowserAction } from './components/CanvasBrowser.js';
import type { SessionBrowserAction } from './components/SessionBrowser.js';

// ---------------------------------------------------------------------------
// Debug logging → lux.log file (append mode, no terminal interference)
// ---------------------------------------------------------------------------

const luxDir = join(homedir(), '.vesper');
try { mkdirSync(luxDir, { recursive: true }); } catch {}
const logFilePath = join(luxDir, 'lux.log');

// Rotate: if log exceeds 10 MB, keep only the last 2 MB
const LOG_MAX_BYTES = 10 * 1024 * 1024;
const LOG_KEEP_BYTES = 2 * 1024 * 1024;
try {
  const st = statSync(logFilePath);
  if (st.size > LOG_MAX_BYTES) {
    const buf = readFileSync(logFilePath);
    const tail = buf.subarray(buf.length - LOG_KEEP_BYTES);
    // Find first newline to avoid a partial leading line
    const nlIdx = tail.indexOf(0x0a);
    writeFileSync(logFilePath, nlIdx >= 0 ? tail.subarray(nlIdx + 1) : tail);
  }
} catch {}

// fd for spawn stdio (child process stderr → file)
const logFd: number = openSync(logFilePath, 'a');
// WriteStream for TUI's own log() calls
const logStream: WriteStream = createWriteStream(logFilePath, { flags: 'a' });

function log(tag: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  logStream.write(`${ts} [${tag}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Argument Parsing
// ---------------------------------------------------------------------------

interface TuiArgs {
  model: string | null;
  apiKey: string | null;
  baseURL: string | null;
  maxIterations: number | null;
  maxTokens: number | null;
  noTools: boolean;
  help: boolean;
  prompt: string | null;
  mcp: string | null;
  prompts: string | null;
  corePath: string | null;
  profile: string | null;
  proxy: string | null;
  toolset: string | null;
}

function parseArgs(argv: string[]): TuiArgs {
  const args: TuiArgs = {
    model: null,
    apiKey: null,
    baseURL: null,
    maxIterations: null,
    maxTokens: null,
    noTools: false,
    help: false,
    prompt: null,
    mcp: null,
    prompts: null,
    corePath: null,
    profile: null,
    proxy: null,
    toolset: null,
  };

  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--model' && argv[i + 1]) {
      args.model = argv[++i];
    } else if (arg === '--api-key' && argv[i + 1]) {
      args.apiKey = argv[++i];
    } else if (arg === '--base-url' && argv[i + 1]) {
      args.baseURL = argv[++i];
    } else if (arg === '--max-iterations' && argv[i + 1]) {
      args.maxIterations = parseInt(argv[++i], 10);
    } else if (arg === '--max-tokens' && argv[i + 1]) {
      args.maxTokens = parseInt(argv[++i], 10);
    } else if (arg === '--no-tools') {
      args.noTools = true;
    } else if (arg === '--mcp' && argv[i + 1]) {
      args.mcp = argv[++i];
    } else if (arg === '--prompts' && argv[i + 1]) {
      args.prompts = argv[++i];
    } else if (arg === '--core-path' && argv[i + 1]) {
      args.corePath = argv[++i];
    } else if (arg === '--profile' && argv[i + 1]) {
      args.profile = argv[++i];
    } else if (arg === '--proxy' && argv[i + 1]) {
      args.proxy = argv[++i];
    } else if (arg === '--toolset' && argv[i + 1]) {
      args.toolset = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
    i++;
  }

  if (positional.length > 0) {
    args.prompt = positional.join(' ');
  }

  return args;
}

// ---------------------------------------------------------------------------
// Help Text
// ---------------------------------------------------------------------------

const HELP_TEXT = `
Vesper TUI — Ink-based terminal client for vesper-core

Usage:
  vesper-tui [options] [prompt]

Options:
  --model <name>          Model name (env: VESPER_MODEL, default: qwen3-235b-a22b)
  --api-key <key>         API key (env: VESPER_API_KEY)
  --base-url <url>        Base URL (env: VESPER_BASE_URL)
  --max-iterations <n>    Max flow iterations (default: 100)
  --max-tokens <n>        Max canvas tokens (default: 80000)
  --no-tools              Disable all tools
  --mcp <json>            MCP server config JSON (McpServerConfig[])
  --prompts <path>        Path to prompt overrides folder or JSON file
  --core-path <path>      Path to vesper-core binary (auto-detected if omitted)
  --profile <name>        Use a named profile from ~/.vesper/config.json
  --toolset <name>        Use a named toolset (minimal/read_only/coding/full)
  --proxy <url>           HTTP(S) proxy URL
  --help, -h              Show this help

REPL Commands:
  /exit                   Exit the REPL
  /pin <content>          Add a persistent instruction
  /save [name]            Save session (overwrites if name exists)
  /load <name>            Load a session by name (or id)
  /delete <name>          Delete a saved session
  /sessions               List saved sessions
  /rollback <cp-id>       Rollback to a checkpoint
  /export <name> [path]   Export session to JSON file
  /import <path>          Import session from JSON file
  /push                   Save current canvas to stack
  /pop                    Restore canvas from stack
  /compact                Intelligently compress canvas (LLM-powered)
  /memory [hint]          Consolidate & recall cross-session memories
  /import-skill <path>    Import skill from ClawHub zip or directory
  /canvas                 Browse and manage canvas blocks interactively
  /task                   Show current task list
`;

// ---------------------------------------------------------------------------
// Core Process Management
// ---------------------------------------------------------------------------

function spawnCore(corePath: string | null): ChildProcess {
  const resolved = corePath
    ? resolve(corePath)
    : resolve(dirname(fileURLToPath(import.meta.url)), 'vesper-core.mjs');
  log('tui', `Spawning core: ${resolved}`);
  return spawn(process.execPath, [resolved], {
    stdio: ['pipe', 'pipe', logFd], // stderr → lux.log (fd, no terminal interference)
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  const cliArgs = parseArgs(process.argv.slice(2));

  if (cliArgs.help) {
    process.stdout.write(HELP_TEXT + '\n');
    return;
  }

  // Spawn core process
  const core = spawnCore(cliArgs.corePath);

  if (!core.stdin || !core.stdout) {
    process.stderr.write('Failed to spawn vesper-core process.\n');
    process.exit(1);
  }

  // Swallow EPIPE errors when core process exits before we finish writing
  core.stdin.on('error', (err) => {
    log('tui', `core.stdin error: ${err.message}`);
  });
  process.stdout.on('error', (err) => {
    log('tui', `process.stdout error: ${err.message}`);
  });

  const coreWriter = createNdjsonWriter(core.stdin);

  let requestCounter = 0;
  function nextId(): string {
    return `req-${++requestCounter}`;
  }

  // Set up event reader from core stdout.
  // IMPORTANT: We must never use `for await...of` on this generator and then `break`,
  // because `break` calls generator.return() which permanently closes the generator.
  // Instead we call .next() manually so the generator stays alive across multiple
  // consume sessions (sendAndWait, runFlow, waitForResponse).
  const eventReader = createNdjsonReader(core.stdout);

  /** Read next event from core. Returns null if stream is closed. */
  async function nextEvent(): Promise<WireEvent | null> {
    const result = await eventReader.next();
    if (result.done) return null;
    return result.value as WireEvent;
  }

  // Helper: send command and wait for specific response (pre-Ink init)
  async function sendAndWait(
    cmd: CoreCommand,
    endType: string,
    id: string,
  ): Promise<boolean> {
    log('tui', `Sending command: ${JSON.stringify(cmd).slice(0, 200)}`);
    coreWriter.write(cmd);
    while (true) {
      const wire = await nextEvent();
      if (!wire) {
        log('tui', 'Event stream closed during sendAndWait');
        return false;
      }
      log('tui', `Received event: type=${wire.type} id=${wire.id}`);
      if (wire.id !== id) continue;

      if (wire.type === endType) return true;

      if (wire.type === 'init_error') {
        log('tui', `Init error: ${(wire as any).message}`);
        return false;
      }

      if (wire.type === 'error') {
        log('tui', `Error: ${JSON.stringify((wire as any).error)}`);
        return false;
      }
    }
  }

  // 1. Initialize core
  const initId = nextId();
  const wireConfig: WireConfig = {
    model: cliArgs.model ?? '',
    apiKey: cliArgs.apiKey ?? '',
    baseURL: cliArgs.baseURL ?? '',
    maxIterations: cliArgs.maxIterations ?? 0,
    maxCanvasTokens: cliArgs.maxTokens ?? 0,
    noTools: cliArgs.noTools,
        prompts: cliArgs.prompts ?? undefined,
    proxy: cliArgs.proxy ?? undefined,
    profile: cliArgs.profile ?? undefined,
    toolset: cliArgs.toolset ?? undefined,
  };

  const initOk = await sendAndWait(
    { cmd: 'init', id: initId, config: wireConfig },
    'ready',
    initId,
  );

  if (!initOk) {
    log('tui', 'Core initialization failed, exiting.');
    core.kill();
    process.exit(1);
  }

  log('tui', 'Core initialized successfully.');

  // Determine model name to display in StatusBar
  const displayModel = cliArgs.model
    || wireConfig.model
    || process.env['VESPER_MODEL']
    || '';

  // Track core process exit
  let coreExited = false;
  let coreExitCode = 0;
  const coreExitPromise = new Promise<number>((resolve) => {
    core.on('exit', (code) => {
      coreExited = true;
      coreExitCode = code ?? 0;
      log('tui', `Core process exited with code ${code}`);
      resolve(coreExitCode);
    });
  });

  // 2. Create store and helpers
  const store = createTuiStore();
  if (displayModel) {
    store.setModelName(displayModel);
  }

  // Register permission responder — sends decisions back to core
  store.setPermissionResponder((requestId, decision, denyReason) => {
    coreWriter.write({
      cmd: 'permission_respond',
      id: nextId(),
      requestId,
      decision,
      ...(denyReason ? { denyReason } : {}),
    });
  });

  // Register ask_user responder — sends answers back to core
  store.setAskUserResponder((requestId, answers) => {
    coreWriter.write({
      cmd: 'ask_user_respond',
      id: nextId(),
      requestId,
      answers,
    });
  });

  // Last known active flow id (set by run_started, cleared by run_complete/error).
  // Used only for Ctrl+C abort targeting — not for any queue logic.
  let lastActiveFlowId: string | null = null;
  let lastInterruptTime = 0;
  const DOUBLE_INTERRUPT_WINDOW_MS = 2000;

  // ---------------------------------------------------------------------------
  // Event Pump — the ONLY consumer of wire events after init.
  // Runs as a background async loop. All state transitions are driven by
  // events from core. TUI never makes assumptions about core's state.
  // ---------------------------------------------------------------------------

  let singleShotDone: (() => void) | null = null;

  async function eventPump(): Promise<void> {
    while (true) {
      const wire = await nextEvent();
      if (!wire) {
        log('tui', 'Core stream closed');
        break;
      }

      // Log significant events
      switch (wire.type) {
        case 'run_started':
          log('tui', `run_started: id=${wire.id} prompt="${(wire as any).prompt?.slice(0, 80)}"`);
          break;
        case 'run_complete':
          log('tui', `run_complete: id=${wire.id}`);
          break;
        case 'tool_call':
          log('tui', `tool_call: ${(wire as any).call?.name}`);
          break;
        case 'tool_result':
          log('tui', `tool_result: ${(wire as any).call?.name} err=${(wire as any).result?.isError}`);
          break;
        case 'error':
          log('tui', `error: ${(wire as any).error?.message?.slice(0, 120)}`);
          break;
        case 'canvas_drift':
          log('tui', `canvas_drift: ${(wire as any).before} → ${(wire as any).after}`);
          break;
      }

      // --- Meta-events that drive TUI state transitions ---

      if (wire.type === 'run_started') {
        // Core is starting to process a flow — archive current turn, prepare new one
        const prompt = (wire as any).prompt as string;
        lastActiveFlowId = wire.id;
        lastInterruptTime = 0;
        // Remove from pending area (was shown while queued)
        store.removePending(prompt);
        store.startNewTurn(prompt);
        continue;
      }

      if (wire.type === 'run_complete') {
        lastActiveFlowId = null;
        store.markIdle();
        singleShotDone?.();
        continue;
      }

      if (wire.type === 'error' && wire.id === lastActiveFlowId) {
        // Flow-level error — feed to store, then mark idle
        const event = deserializeEvent(wire);
        if (event) store.handleEvent(event);
        lastActiveFlowId = null;
        store.markIdle();
        singleShotDone?.();
        continue;
      }

      // --- Session response events → system messages ---

      if (wire.type === 'session_saved') {
        store.addSystemMessage(`Session saved: "${(wire as any).name}" (${(wire as any).sessionId})`);
        continue;
      }
      if (wire.type === 'session_loaded') {
        const w = wire as any;
        store.addSystemMessage(`Session loaded: ${w.sessionId}${w.checkpointId ? ` (checkpoint: ${w.checkpointId})` : ''}`);
        continue;
      }
      if (wire.type === 'session_list_result') {
        const sessions = (wire as any).sessions as any[];
        if (sessions.length === 0) {
          store.addSystemMessage('No saved sessions.');
        } else {
          // Open interactive session browser
          store.openSessionBrowser(sessions);
        }
        continue;
      }
      if (wire.type === 'session_deleted') {
        const w = wire as any;
        store.addSystemMessage(`Session deleted: "${w.name ?? w.sessionId}" (${w.sessionId})`);
        continue;
      }
      if (wire.type === 'session_renamed') {
        const w = wire as any;
        store.addSystemMessage(`Session renamed to: "${w.name}" (${w.sessionId})`);
        continue;
      }
      if (wire.type === 'session_rollback_result') {
        const w = wire as any;
        store.addSystemMessage(`Rolled back to checkpoint ${w.checkpointId} (step ${w.step})`);
        continue;
      }
      if (wire.type === 'session_exported') {
        const w = wire as any;
        store.addSystemMessage(`Session "${w.name}" exported to: ${w.filePath}`);
        continue;
      }
      if (wire.type === 'session_imported') {
        const w = wire as any;
        store.addSystemMessage(`Session "${w.name}" imported (id: ${w.sessionId}). Use /load ${w.name} to load it.`);
        continue;
      }

      if (wire.type === 'canvas_cleared') {
        // Archive current turn content, then reset streaming state.
        // Static zone items already written to stdout persist visually
        // (terminal limitation), but core canvas is now empty.
        store.startNewTurn('[clear]');
        store.markIdle();
        store.addSystemMessage('Canvas cleared — reset to initial state.');
        continue;
      }

      // --- Curator / compact events ---

      if (wire.type === 'compact_complete') {
        const w = wire as any;
        store.addSystemMessage(`Canvas compacted: ${w.foldCount} folded, ${w.unfoldCount} unfolded`);
        continue;
      }

      if (wire.type === 'curator_run') {
        const w = wire as any;
        if (w.fellBackToDrift) {
          log('tui', `curator_run: fell back to mechanical drift (${w.foldCount} folded, ${w.unfoldCount} unfolded)`);
        }
        // Silent in TUI unless fallback occurred
        continue;
      }

      // --- Dump complete → system message ---
      if (wire.type === 'dump_complete') {
        const fp = (wire as any).filePath as string;
        store.addSystemMessage(`Prompt dumped to: ${fp}`);
        continue;
      }

      // --- Status events → system messages ---
      if (wire.type === 'status') {
        store.addSystemMessage((wire as any).message as string);
        continue;
      }

      // --- Task snapshot → persistent task panel ---
      if (wire.type === 'task_snapshot') {
        const tasks = (wire as any).tasks ?? [];
        store.setTasks(tasks);
        continue;
      }

      // --- Canvas browser events ---
      if (wire.type === 'canvas_browse_result') {
        store.openCanvasBrowser((wire as any).snapshot);
        continue;
      }
      if (wire.type === 'canvas_op_result') {
        const w = wire as any;
        if (w.success) {
          store.updateCanvasBrowser(w.snapshot);
        }
        continue;
      }
      if (wire.type === 'canvas_inspect_result') {
        const w = wire as any;
        store.canvasBrowserSetInspect(w.blockId, w.content);
        continue;
      }
      if (wire.type === 'canvas_edit_result') {
        const w = wire as any;
        if (w.success) {
          store.updateCanvasBrowser(w.snapshot);
          store.canvasBrowserBackToList();
        }
        continue;
      }

      // --- Events that deserializeEvent returns null for but TUI store needs ---
      if ((wire as any).type === 'toolset_skill_state'
       || wire.type === 'provider_switched'
       || wire.type === 'provider_state'
       || wire.type === 'provider_request_snapshot') {
        store.handleEvent(wire as any);
        continue;
      }

      // --- Stream events → store ---
      const event = deserializeEvent(wire);
      if (event) {
        store.handleEvent(event);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // REPL commands — fire-and-forget (event pump handles responses)
  // ---------------------------------------------------------------------------

  function handleReplCommand(input: string): boolean {
    if (input.startsWith('/save')) {
      const name = input.slice(5).trim() || undefined;
      coreWriter.write({ cmd: 'session_save', id: nextId(), name } as CoreCommand);
      return false;
    }

    if (input.startsWith('/load ')) {
      const sessionId = input.slice(6).trim();
      if (sessionId) {
        coreWriter.write({ cmd: 'session_load', id: nextId(), sessionId } as CoreCommand);
      }
      return false;
    }

    if (input.startsWith('/delete ')) {
      const sessionId = input.slice(8).trim();
      if (sessionId) {
        coreWriter.write({ cmd: 'session_delete', id: nextId(), sessionId } as CoreCommand);
      }
      return false;
    }

    if (input === '/sessions') {
      coreWriter.write({ cmd: 'session_list', id: nextId() } as CoreCommand);
      return false;
    }

    if (input.startsWith('/export ')) {
      const args = input.slice(8).trim().split(/\s+/);
      const sessionIdOrName = args[0];
      const outputPath = args[1] || undefined;
      if (sessionIdOrName) {
        coreWriter.write({ cmd: 'session_export', id: nextId(), sessionIdOrName, outputPath } as CoreCommand);
      }
      return false;
    }

    if (input.startsWith('/import ')) {
      const filePath = input.slice(8).trim();
      if (filePath) {
        coreWriter.write({ cmd: 'session_import', id: nextId(), filePath } as CoreCommand);
      }
      return false;
    }

    if (input === '/compact' || input.startsWith('/compact ')) {
      const hint = input.startsWith('/compact ') ? input.slice('/compact '.length).trim() : undefined;
      coreWriter.write({ cmd: 'compact', id: nextId(), message: hint } as CoreCommand);
      return false;
    }

    if (input === '/dump') {
      coreWriter.write({ cmd: 'dump', id: nextId() } as CoreCommand);
      return false;
    }

    if (input === '/clear') {
      coreWriter.write({ cmd: 'clear', id: nextId() } as CoreCommand);
      return false;
    }

    if (input === '/clear-permissions') {
      coreWriter.write({ cmd: 'slash', id: nextId(), input: '/clear-permissions' } as CoreCommand);
      return false;
    }

    if (input === '/canvas') {
      if (lastActiveFlowId) {
        store.addSystemMessage('Cannot browse canvas during active flow.');
      } else {
        coreWriter.write({ cmd: 'canvas_browse', id: nextId() } as CoreCommand);
      }
      return false;
    }

    if (input.startsWith('/persona')) {
      const arg = input.slice(8).trim();
      coreWriter.write({ cmd: 'slash', id: nextId(), input: `/persona${arg ? ' ' + arg : ''}` } as CoreCommand);
      return false;
    }

    if (input.startsWith('/save-persona')) {
      const arg = input.slice(13).trim();
      coreWriter.write({ cmd: 'slash', id: nextId(), input: `/save-persona ${arg}` } as CoreCommand);
      return false;
    }

    if (input.startsWith('/delete-persona')) {
      const arg = input.slice(15).trim();
      coreWriter.write({ cmd: 'slash', id: nextId(), input: `/delete-persona ${arg}` } as CoreCommand);
      return false;
    }

    if (input.startsWith('/tool ') || input === '/tool') {
      const arg = input.slice(5).trim();
      coreWriter.write({ cmd: 'slash', id: nextId(), input: `/tool${arg ? ' ' + arg : ''}` } as CoreCommand);
      return false;
    }

    if (input.startsWith('/toolset')) {
      const arg = input.slice(8).trim();
      coreWriter.write({ cmd: 'slash', id: nextId(), input: `/toolset${arg ? ' ' + arg : ''}` } as CoreCommand);
      return false;
    }

    if (input.startsWith('/skill')) {
      const arg = input.slice(6).trim();
      coreWriter.write({ cmd: 'slash', id: nextId(), input: `/skill${arg ? ' ' + arg : ''}` } as CoreCommand);
      return false;
    }

    if (input.startsWith('/import-skill ')) {
      const arg = input.slice(14).trim();
      if (arg) {
        coreWriter.write({ cmd: 'slash', id: nextId(), input: `/import-skill ${arg}` } as CoreCommand);
      }
      return false;
    }

    if (input.startsWith('/supervise')) {
      const arg = input.slice(10).trim();
      coreWriter.write({ cmd: 'slash', id: nextId(), input: `/supervise${arg ? ' ' + arg : ''}` } as CoreCommand);
      return false;
    }

    if (input === '/unsupervise') {
      coreWriter.write({ cmd: 'slash', id: nextId(), input: '/unsupervise' } as CoreCommand);
      return false;
    }

    if (input.startsWith('/provider')) {
      const arg = input.slice(9).trim();
      coreWriter.write({ cmd: 'slash', id: nextId(), input: `/provider${arg ? ' ' + arg : ''}` } as CoreCommand);
      return false;
    }

    if (input === '/memory' || input.startsWith('/memory ')) {
      const arg = input.startsWith('/memory ') ? input.slice(8).trim() : '';
      coreWriter.write({ cmd: 'slash', id: nextId(), input: `/memory${arg ? ' ' + arg : ''}` } as CoreCommand);
      return false;
    }

    if (input.startsWith('/cd ')) {
      const arg = input.slice(4).trim();
      if (arg) {
        coreWriter.write({ cmd: 'slash', id: nextId(), input: `/cd ${arg}` } as CoreCommand);
      }
      return false;
    }

    if (input.startsWith('/add-dir ')) {
      const arg = input.slice(9).trim();
      if (arg) {
        coreWriter.write({ cmd: 'slash', id: nextId(), input: `/add-dir ${arg}` } as CoreCommand);
      }
      return false;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Escape / interrupt handler
  // ---------------------------------------------------------------------------

  function handleInterrupt(): void {
    const now = Date.now();
    const isDouble = (now - lastInterruptTime) < DOUBLE_INTERRUPT_WINDOW_MS;
    lastInterruptTime = now;
    log('tui', `interrupt isDouble=${isDouble}, lastActiveFlowId=${lastActiveFlowId}`);

    if (!lastActiveFlowId) {
      // Idle state — double press exits, single press is a no-op hint
      if (isDouble) {
        log('tui', 'Double interrupt while idle — shutting down');
        coreWriter.write({ cmd: 'shutdown' } as CoreCommand);
        unmountFn?.();
        setTimeout(() => {
          core.kill('SIGKILL');
          process.exit(1);
        }, 2000);
      } else {
        log('tui', 'First interrupt while idle — press again to exit');
      }
      return;
    }

    if (!isDouble) {
      log('tui', 'Aborting current flow');
      coreWriter.write({ cmd: 'abort', id: lastActiveFlowId } as CoreCommand);
    } else {
      log('tui', 'Double interrupt — shutting down');
      coreWriter.write({ cmd: 'shutdown' } as CoreCommand);
      unmountFn?.();
      setTimeout(() => {
        core.kill('SIGKILL');
        process.exit(1);
      }, 2000);
    }
  }

  // SIGINT (Ctrl+C) as safety net — always works even if Ink is unresponsive
  process.on('SIGINT', handleInterrupt);

  // ---------------------------------------------------------------------------
  // Canvas browser action handler — sends wire commands to core
  // ---------------------------------------------------------------------------

  function handleCanvasBrowserAction(action: CanvasBrowserAction): void {
    switch (action.type) {
      case 'fold':
      case 'unfold':
      case 'delete':
        coreWriter.write({ cmd: 'canvas_op', id: nextId(), op: action.type, blockId: action.blockId } as CoreCommand);
        break;
      case 'inspect':
        coreWriter.write({ cmd: 'canvas_inspect', id: nextId(), blockId: action.blockId } as CoreCommand);
        break;
      case 'edit_submit':
        coreWriter.write({ cmd: 'canvas_edit', id: nextId(), blockId: action.blockId, content: action.content } as CoreCommand);
        break;
      // close, navigate, back, start_edit, edit_change are TUI-local (handled in ink-app.tsx)
    }
  }

  // ---------------------------------------------------------------------------
  // Session browser action handler — sends wire commands to core
  // ---------------------------------------------------------------------------

  function handleSessionBrowserAction(action: SessionBrowserAction): void {
    switch (action.type) {
      case 'load':
        store.closeSessionBrowser();
        coreWriter.write({ cmd: 'session_load', id: nextId(), sessionId: action.sessionName } as CoreCommand);
        break;
      case 'delete':
        coreWriter.write({ cmd: 'session_delete', id: nextId(), sessionId: action.sessionName } as CoreCommand);
        break;
      // close, navigate, navigate_top, navigate_bottom are TUI-local (handled in ink-app.tsx)
    }
  }

  // ---------------------------------------------------------------------------
  // Hotkey handlers — quick-switch via Ctrl+P/R/S (read store state, send wire)
  // ---------------------------------------------------------------------------

  function handleCycleProvider(): void {
    const snap = store.getSnapshot();
    const profiles = snap.availableProfiles;
    if (profiles.length < 2) {
      log('tui', 'cycleProvider: not enough profiles to cycle');
      return;
    }
    const currentProfile = snap.currentProvider?.profile ?? '';
    const currentIdx = profiles.indexOf(currentProfile);
    const nextIdx = (currentIdx + 1) % profiles.length;
    const nextProfile = profiles[nextIdx]!;
    log('tui', `cycleProvider: ${currentProfile || '(none)'} → ${nextProfile}`);
    coreWriter.write({ cmd: 'slash', id: nextId(), input: `/provider ${nextProfile}` } as CoreCommand);
  }

  function handleCyclePersona(): void {
    const snap = store.getSnapshot();
    const personas = snap.availablePersonas;
    if (personas.length < 2) {
      log('tui', 'cyclePersona: not enough personas to cycle');
      return;
    }
    const currentName = snap.currentPersona ?? 'default';
    const currentIdx = personas.findIndex(p => p.name === currentName);
    const nextIdx = (currentIdx + 1) % personas.length;
    const nextPersona = personas[nextIdx]!;
    log('tui', `cyclePersona: ${currentName} → ${nextPersona.name}`);
    coreWriter.write({ cmd: 'slash', id: nextId(), input: `/persona ${nextPersona.name}` } as CoreCommand);
  }

  function handleToggleSupervisor(): void {
    const snap = store.getSnapshot();
    if (snap.supervisorMode) {
      log('tui', 'toggleSupervisor: disabling');
      coreWriter.write({ cmd: 'slash', id: nextId(), input: '/unsupervise' } as CoreCommand);
    } else {
      // Enable with default rules (or previously stored rules)
      const rules = snap.supervisorRules || 'approve all safe operations';
      log('tui', `toggleSupervisor: enabling with rules="${rules.slice(0, 60)}"`);
      coreWriter.write({ cmd: 'slash', id: nextId(), input: `/supervise ${rules}` } as CoreCommand);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Single-shot mode
  // ---------------------------------------------------------------------------

  let unmountFn: (() => void) | null = null;

  if (cliArgs.prompt) {
    log('tui', `Single-shot mode: "${cliArgs.prompt.slice(0, 80)}"`);
    const { unmount, waitUntilExit } = render(
      React.createElement(App, {
        store,
        onSubmit: () => {},
        onExit: () => {},
        onEscape: handleInterrupt,
        onCanvasBrowserAction: handleCanvasBrowserAction,
        onSessionBrowserAction: handleSessionBrowserAction,
        onCycleProvider: handleCycleProvider,
        onCyclePersona: handleCyclePersona,
        onToggleSupervisor: handleToggleSupervisor,
        singleShot: true,
      }),
      { exitOnCtrlC: false },
    );
    unmountFn = unmount;

    // Start event pump, send run command, wait for completion
    const donePromise = new Promise<void>((resolve) => { singleShotDone = resolve; });
    eventPump().catch((err) => log('tui', `Event pump error: ${err}`));

    const runId = nextId();
    log('tui', `Sending run command: id=${runId}`);
    coreWriter.write({ cmd: 'run', id: runId, input: cliArgs.prompt } as CoreCommand);

    await donePromise;

    // Give Ink a moment to render the final state
    await new Promise((resolve) => setTimeout(resolve, 200));
    unmount();

    if (!coreExited) {
      coreWriter.write({ cmd: 'shutdown' } as CoreCommand);
      await coreExitPromise;
    }
    process.exit(coreExitCode);
  }

  // ---------------------------------------------------------------------------
  // 4. REPL mode
  // ---------------------------------------------------------------------------

  let shouldExit = false;

  const onSubmit = (input: string): void => {
    log('tui', `onSubmit called: "${input.slice(0, 80)}"`);
    store.pushInputHistory(input);

    if (input.startsWith('/')) {
      const exit = handleReplCommand(input);
      if (exit) {
        shouldExit = true;
        unmountFn?.();
      }
      return;
    }

    // Fire and forget — send run command to core.
    // Core's EventLoop queues it. When core starts processing,
    // it sends run_started → event pump removes from pending.
    const id = nextId();
    log('tui', `Sending run command: id=${id} input="${input.slice(0, 80)}"`);

    // If a flow is active, show this message in the pending area so the
    // user knows it's queued (removed when run_started arrives).
    if (lastActiveFlowId) {
      store.addPending(input);
    }

    coreWriter.write({ cmd: 'run', id, input } as CoreCommand);
  };

  const onExit = (): void => {
    log('tui', 'onExit called');
    coreWriter.write({ cmd: 'shutdown' } as CoreCommand);
  };

  log('tui', 'Starting REPL mode');

  // Start the event pump (runs forever in background)
  eventPump().catch((err) => log('tui', `Event pump error: ${err}`));

  const { unmount, waitUntilExit } = render(
    React.createElement(App, {
      store,
      onSubmit,
      onExit,
      onEscape: handleInterrupt,
      onCanvasBrowserAction: handleCanvasBrowserAction,
      onSessionBrowserAction: handleSessionBrowserAction,
      onCycleProvider: handleCycleProvider,
      onCyclePersona: handleCyclePersona,
      onToggleSupervisor: handleToggleSupervisor,
    }),
    { exitOnCtrlC: false },
  );
  unmountFn = unmount;

  await waitUntilExit();

  log('tui', 'Ink exited');

  if (!coreExited) {
    if (!shouldExit) {
      coreWriter.write({ cmd: 'shutdown' } as CoreCommand);
    }
    await coreExitPromise;
  }
  process.exit(coreExitCode);
}

// Auto-run when executed directly
main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
