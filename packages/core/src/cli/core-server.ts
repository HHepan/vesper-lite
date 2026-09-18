#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Headless Core Server (vesper-core binary)
// NDJSON stdio protocol adapter for AgentEventLoop
// ═══════════════════════════════════════════════════════════════════════════

import { readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir, type as osType, release as osRelease, arch as osArch } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createDefaultAgentState,
  createDefaultCanvasConfig,
  createToolExecutorRegistry,
} from '@vesper/shared';
import type {
  AgentState,
  RuntimeConfig,
  PromptOptions,
  ToolEntry,
  ToolDefinition,
  ToolExecutorRegistry,
  VesperConfig,
  CoreCommand,
  WireConfig,
  WireEvent,
} from '@vesper/shared';
import { serializeEvent } from '@vesper/shared';
import { createNativeShellToolEntry, createScriptToolEntry, createAskUserTools, createTaskTools, createFetchToolEntry, createWebSearchToolEntry, timeTool } from '../tools/index.js';
import { readTool, writeTool, writeMdTool, editTool, globTool, grepTool } from '../tools/index.js';
import { PathGuard } from '../path-guard.js';
import { applyPipeline, createDefaultPolicyConfig } from '../tools/policy.js';
import { createHookRegistry } from '../hooks.js';
import { loadPrompts } from '../prompt-store.js';
import { createSessionManager } from '../session.js';
import { loadGlobalConfig, resolveEffectiveConfig, type CliArgs, type EnvVars } from '../config.js';
import {
  initBuiltinToolsets,
  getToolset,
  createPolicyConfigFromToolset,
} from '../tools/toolset.js';
import { AgentEventLoop } from '../event-loop.js';
import { countTokens } from '../tokenizer/index.js';
import { restoreLegacyFoldedBlocks } from '../canvas.js';

// ---------------------------------------------------------------------------
// Workspace Context Discovery
// ---------------------------------------------------------------------------

async function loadWorkspaceContext(cwd: string): Promise<string | undefined> {
  const candidates = ['VESPER.md', 'LUX.md', 'AGENTS.md'];
  const MAX_PARENT_SEARCH = 10;

  const layers: Array<{ path: string; content: string }> = [];

  let dir = resolve(cwd);
  for (let depth = 0; depth <= MAX_PARENT_SEARCH; depth++) {
    for (const name of candidates) {
      const filePath = resolve(dir, name);
      try {
        const content = await readFile(filePath, 'utf-8');
        layers.push({ path: filePath, content });
        break;
      } catch {
        // Not found
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const globalDir = resolve(homedir(), '.vesper');
  for (const name of candidates) {
    const filePath = resolve(globalDir, name);
    if (layers.some(l => l.path === filePath)) break;
    try {
      const content = await readFile(filePath, 'utf-8');
      layers.push({ path: filePath, content });
      break;
    } catch {
      // Not found
    }
  }

  if (layers.length === 0) return undefined;
  layers.reverse();
  if (layers.length === 1) return layers[0].content;
  return layers.map(l => `<!-- from: ${l.path} -->\n${l.content}`).join('\n\n');
}

function buildEnvInfo(): Record<string, string> {
  const info: Record<string, string> = {};
  info.cwd = process.cwd();
  info.agent_framework = 'Vesper Lite v0.1.0';
  info.platform = process.platform;
  info.os = `${osType()} ${osRelease()} (${osArch()})`;
  info.shell = process.env.SHELL ?? 'none';
  return info;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function registerEntries(
  entries: ToolEntry[],
  executors: ToolExecutorRegistry,
): ToolDefinition[] {
  const definitions: ToolDefinition[] = [];
  for (const { definition, executor } of entries) {
    definitions.push(definition);
    executors.register(definition.name, executor);
  }
  return definitions;
}

// ---------------------------------------------------------------------------
// NDJSON Protocol
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeLine(stream: NodeJS.WritableStream, obj: unknown): void {
  stream.write(encoder.encode(JSON.stringify(obj) + '\n'));
}

function readLines(
  stream: NodeJS.ReadableStream,
  handler: (obj: Record<string, unknown>) => void,
  onError?: (err: Error) => void,
): void {
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        handler(JSON.parse(line) as Record<string, unknown>);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
  stream.on('error', (err) => {
    onError?.(err);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const stderr = process.stderr;

  const writeEvent = (event: WireEvent) => writeLine(stdout, event);
  const writeError = (id: string, err: Error) => {
    writeEvent({
      id,
      type: 'error',
      error: { name: err.name, message: err.message, stack: err.stack },
    });
  };

  let eventLoop: AgentEventLoop | null = null;
  let sessionMgr: ReturnType<typeof createSessionManager> | null = null;
  let initialized = false;

  const cleanup = () => {
    sessionMgr?.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  readLines(stdin, async (cmd) => {
    const { cmd: cmdName, id } = cmd as { cmd: string; id: string };

    try {
      switch (cmdName) {
        case 'init': {
          const config = cmd.config as WireConfig;

          // Initialize session manager
          const sessionsDir = resolve(homedir(), '.vesper', 'sessions');
          mkdirSync(sessionsDir, { recursive: true });
          sessionMgr = createSessionManager(resolve(sessionsDir, 'sessions.db'));

          // Load global config for profiles/toolsets
          const globalConfig = await loadGlobalConfig();

          // Resolve effective config
          const cliArgs: CliArgs = {
            model: config.model,
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            maxIterations: config.maxIterations,
            maxTokens: config.maxCanvasTokens,
            proxy: config.proxy,
            profile: config.profile,
            toolset: config.toolset,
          };
          const envVars: EnvVars = {};
          const resolved = resolveEffectiveConfig(cliArgs, envVars, globalConfig);

          // Load prompts if specified
          if (config.prompts) {
            await loadPrompts(config.prompts);
          }

          // Initialize toolsets
          initBuiltinToolsets();

          // Create event loop
          eventLoop = new AgentEventLoop({
            model: resolved.model,
            apiKey: resolved.apiKey,
            baseURL: resolved.baseURL,
            maxIterations: resolved.maxIterations,
            maxCanvasTokens: resolved.maxTokens,
            sessionName: config.sessionName,
            sessionId: config.sessionId,
            proxy: resolved.proxy,
            toolset: resolved.toolset,
            noTools: config.noTools,
          });

          // Wire up event forwarding
          eventLoop.on((event) => {
            writeEvent(serializeEvent(id, event));
          });

          initialized = true;
          writeEvent({ id, type: 'ready' });
          break;
        }

        case 'run': {
          if (!initialized || !eventLoop) {
            writeError(id, new Error('Not initialized'));
            break;
          }
          const input = cmd.input as string;
          const images = cmd.images as any[] | undefined;
          const regenerate = cmd.regenerate as boolean | undefined;

          writeEvent({ id, type: 'run_started', prompt: input });
          const result = await eventLoop.run(input, images, regenerate);
          if (!result.success) {
            writeError(id, new Error(result.error ?? 'Unknown error'));
          } else {
            writeEvent({ id, type: 'run_complete' });
          }
          break;
        }

        case 'abort': {
          eventLoop?.abort();
          break;
        }

        case 'pin': {
          if (!eventLoop) break;
          eventLoop.pinBlock(cmd.content as string);
          writeEvent({ id, type: 'status', message: 'Pinned' });
          break;
        }

        case 'session_save': {
          if (!eventLoop) break;
          const manifest = eventLoop.sessionSave(
            cmd.name as string | undefined,
            cmd.description as string | undefined,
          );
          writeEvent({ id, type: 'session_saved', sessionId: manifest.id, name: manifest.name });
          break;
        }

        case 'session_load': {
          if (!eventLoop) break;
          eventLoop.sessionLoad(cmd.sessionId as string, cmd.checkpointId as string | undefined);
          break;
        }

        case 'session_list': {
          if (!eventLoop) break;
          eventLoop.sessionList();
          break;
        }

        case 'session_delete': {
          if (!eventLoop) break;
          eventLoop.sessionDelete(cmd.sessionId as string);
          break;
        }

        case 'session_rename': {
          if (!eventLoop) break;
          eventLoop.sessionRename(cmd.sessionId as string, cmd.newName as string);
          break;
        }

        case 'session_export': {
          if (!eventLoop) break;
          eventLoop.sessionExport(cmd.sessionIdOrName as string, cmd.outputPath as string | undefined);
          break;
        }

        case 'session_import': {
          if (!eventLoop) break;
          eventLoop.sessionImport(cmd.filePath as string);
          break;
        }

        case 'session_rollback': {
          if (!eventLoop) break;
          eventLoop.sessionRollback(cmd.checkpointId as string);
          break;
        }

        case 'permission_respond': {
          eventLoop?.respondPermission(
            cmd.requestId as string,
            cmd.decision as any,
            cmd.denyReason as string | undefined,
          );
          break;
        }

        case 'ask_user_respond': {
          eventLoop?.respondAskUser(cmd.requestId as string, cmd.answers as any);
          break;
        }

        case 'canvas_browse': {
          if (!eventLoop) break;
          const snapshot = eventLoop.getCanvasSnapshot();
          writeEvent({ id, type: 'canvas_browse_result', snapshot });
          break;
        }

        case 'canvas_op': {
          if (!eventLoop) break;
          const result = eventLoop.canvasOp(cmd.op as any, cmd.blockId as string);
          const snapshot = eventLoop.getCanvasSnapshot();
          writeEvent({ id, type: 'canvas_op_result', success: result.success, message: result.message, snapshot });
          break;
        }

        case 'canvas_inspect': {
          if (!eventLoop) break;
          const result = eventLoop.canvasInspect(cmd.blockId as string);
          if (result) {
            writeEvent({ id, type: 'canvas_inspect_result', blockId: cmd.blockId as string, content: result.content, blockType: result.blockType as import('@vesper/shared').CanvasBlock['type'], tokens: result.tokens, folded: result.folded });
          }
          break;
        }

        case 'canvas_edit': {
          if (!eventLoop) break;
          const result = eventLoop.canvasEdit(cmd.blockId as string, cmd.content as string);
          const snapshot = eventLoop.getCanvasSnapshot();
          writeEvent({ id, type: 'canvas_edit_result', success: result.success, message: result.message, snapshot });
          break;
        }

        case 'task_query': {
          if (!eventLoop) break;
          eventLoop.taskQuery();
          break;
        }

        case 'compact':
        case 'call_curator': {
          // Curator is handled inside runFlow via drift detection
          writeEvent({ id, type: 'status', message: 'Curator run triggered via next drift' });
          break;
        }

        case 'clear': {
          if (!eventLoop) break;
          eventLoop.clearCanvas();
          break;
        }

        case 'dump': {
          // Write state dump to file
          if (!eventLoop) break;
          const state = eventLoop.getState();
          const dumpPath = resolve(tmpdir(), `vesper-dump-${Date.now()}.json`);
          writeFileSync(dumpPath, JSON.stringify(state, null, 2));
          writeEvent({ id, type: 'dump_complete', filePath: dumpPath });
          break;
        }

        case 'toggle_public_mode': {
          if (!eventLoop) break;
          const state = eventLoop.getState();
          // Toggle public mode on state
          writeEvent({ id, type: 'status', message: `Public mode: ${!state.publicMode}` });
          break;
        }

        case 'set_permission_mode': {
          if (!eventLoop) break;
          writeEvent({ id, type: 'status', message: `Permission mode changed to ${cmd.mode}` });
          break;
        }

        case 'reload_config': {
          writeEvent({ id, type: 'config_updated' });
          break;
        }

        case 'shutdown': {
          cleanup();
          break;
        }

        case 'slash': {
          // Handle slash commands (e.g. /cd, /save, /load)
          const input = cmd.input as string;
          if (input.startsWith('/cd ')) {
            const dir = input.slice(4).trim();
            try {
              process.chdir(dir);
              writeEvent({ id, type: 'status', message: `Changed directory to ${dir}` });
            } catch (err: any) {
              writeError(id, err);
            }
          } else {
            writeEvent({ id, type: 'status', message: `Unknown slash command: ${input}` });
          }
          break;
        }

        default:
          writeEvent({ id, type: 'status', message: `Unknown command: ${cmdName}` });
      }
    } catch (err) {
      writeError(id, err instanceof Error ? err : new Error(String(err)));
    }
  });
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message || String(err)}\n`);
  process.exit(1);
});
