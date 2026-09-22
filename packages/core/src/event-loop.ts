// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Agent Event Loop
// Orchestrates user input → runFlow → canvas updates
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type {
  AgentState,
  AgentEvent,
  StreamEvent,
  CanvasBlock,
  SessionManifest,
  SessionCheckpointEntry,
  TaskItem,
  CanvasBrowserSnapshot,
  PermissionDecision,
  AskUserAnswers,
} from '@vesper/shared';
import { createDefaultAgentState, createEmptyCanvas } from '@vesper/shared';
import {
  createBlock,
  appendBlock,
  addPin,
  createBrowserSnapshot as buildCanvasSnapshot,
  deleteBlock,
  editBlockContent,
  manualFoldBlock,
  expandBlock,
  findBlock,
  rollbackLastUserTurn,
  searchCanvas,
  restoreLegacyFoldedBlocks,
  canvasTokenCount,
} from './canvas.js';
import { runFlow } from './runtime.js';
import { createSessionManager, type SessionManager } from './session.js';
import { cloneState } from './clone.js';
import { loadPermissions, clearPermissions, persistPermissionDecision } from './permission-store.js';
import { createTaskTools, type TaskStateAccessor } from './tools/task-tools.js';
import { createAskUserTools } from './tools/ask-user-tools.js';
import { listAllToolsets, getToolset, createPolicyConfigFromToolset } from './tools/toolset.js';
import { applyPipeline } from './tools/policy.js';
import { buildSystemPrompt } from './prompt-builder.js';
import { countTokens } from './tokenizer/index.js';
import { createToolExecutorRegistry } from '@vesper/shared';
import { readTool, writeTool, writeMdTool, editTool, globTool, grepTool } from './tools/index.js';
import { createNativeShellToolEntry } from './tools/bash-bridge.js';
import { createScriptToolEntry } from './tools/script.js';
import { createFetchToolEntry } from './tools/fetch.js';
import { createWebSearchToolEntry } from './tools/search.js';
import { timeTool } from './tools/time-tool.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventLoopConfig {
  model: string;
  apiKey: string;
  baseURL: string;
  maxIterations: number;
  maxCanvasTokens: number;
  sessionName?: string;
  sessionId?: string;
  proxy?: string;
  toolset?: string;
  noTools?: boolean;
}

export interface EventLoopResult {
  success: boolean;
  error?: string;
}

type EventHandler = (event: any) => void;

// ---------------------------------------------------------------------------
// AgentEventLoop — Main orchestrator
// ---------------------------------------------------------------------------

export class AgentEventLoop {
  private state: AgentState;
  private config: EventLoopConfig;
  private sessionMgr: SessionManager;
  private permissionMemory: Map<string, 'allow' | 'deny'>;
  private abortController: AbortController | null = null;
  private running = false;
  private eventHandlers: EventHandler[] = [];
  private pendingPermissions: Map<string, { resolve: (v: any) => void; reject: (e: any) => void }> = new Map();
  private pendingAskUser: Map<string, { resolve: (v: AskUserAnswers) => void; reject: (e: any) => void }> = new Map();

  constructor(config: EventLoopConfig) {
    this.config = config;
    this.state = createDefaultAgentState();
    this.state.canvasConfig.maxCanvasTokens = config.maxCanvasTokens;
    this.state.provider = {
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    };
    this.state.maxIterations = config.maxIterations;

    // Initialize session manager
    const sessionsDir = join(homedir(), '.vesper-lite', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    this.sessionMgr = createSessionManager(join(sessionsDir, 'sessions.db'));

    // Load persisted permissions
    this.permissionMemory = new Map();
    loadPermissions(process.cwd()).then(map => {
      this.permissionMemory = map;
    }).catch(() => {});
  }

  // ── Event subscription ──

  on(handler: EventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private emit(event: any): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('Event handler error:', err);
      }
    }
  }

  // ── Main entry: process a user query ──

  async run(input: string, images?: any[], regenerate?: boolean): Promise<EventLoopResult> {
    if (this.running) {
      return { success: false, error: 'Another flow is already running' };
    }

    this.running = true;
    this.abortController = new AbortController();

    try {
      // Handle regenerate: rollback to before last user message
      if (regenerate) {
        this.state = {
          ...this.state,
          canvas: rollbackLastUserTurn(this.state.canvas),
        };
      }

      // Append user message to canvas
      const userBlock = createBlock('user_message', input, {
        imageRefs: images?.length ? images.map((_: any, i: number) => `img-${i}`) : undefined,
      });
      this.state = {
        ...this.state,
        userMessage: input,
        canvas: appendBlock(this.state.canvas, userBlock),
      };

      // Build runtime config
      const runtimeConfig: import('@vesper/shared').RuntimeConfig = {
        maxIterations: this.state.maxIterations,
        canvas: this.state.canvasConfig,
        provider: this.state.provider,
        model: this.config.model,
        executors: this.buildExecutorRegistry(),
        signal: this.abortController.signal,
        policyConfig: this.buildPolicyConfig(),
        promptOptions: {
          env: this.buildEnvVars(),
          userInstructions: this.state.systemPrompt,
          userName: undefined,
          reminders: this.state.reminders,
          injectCanvasHistory: false,
        },
        internals: {
          permissionMemory: this.permissionMemory,
          sessionName: this.config.sessionName,
          sessionId: this.config.sessionId,
        },
        proxy: this.config.proxy,
        supportsVision: true,
        injectAsUser: true,
      };

      // Run the flow
      const flow = runFlow(this.state, runtimeConfig);
      let result: IteratorResult<StreamEvent, AgentState>;

      while (!(result = await flow.next()).done) {
        const event = result.value;
        this.emit(event);

        // Handle special events that need event-loop response
        if (event.type === 'permission_request') {
          const response = await this.waitForPermission(event.requestId);
          this.emit({ type: 'permission_resolved', requestId: event.requestId });
        } else if (event.type === 'ask_user_request') {
          const answers = await this.waitForAskUser(event.requestId);
          this.emit({ type: 'ask_user_resolved', requestId: event.requestId });
        }
      }

      // Update state from flow result
      this.state = result.value;

      this.emit({ type: 'run_complete' });
      return { success: true };
    } catch (err: any) {
      this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) });
      return { success: false, error: err.message || String(err) };
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  // ── Abort ──

  abort(): void {
    this.abortController?.abort();
  }

  // ── Sideband injection ──

  injectSideband(message: string): void {
    this.emit({ type: 'sideband_injected', message });
  }

  // ── Permission responses ──

  respondPermission(requestId: string, decision: PermissionDecision, denyReason?: string): void {
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      pending.resolve({ decision, denyReason });
      this.pendingPermissions.delete(requestId);
    }
  }

  respondAskUser(requestId: string, answers: AskUserAnswers): void {
    const pending = this.pendingAskUser.get(requestId);
    if (pending) {
      pending.resolve(answers);
      this.pendingAskUser.delete(requestId);
    }
  }

  private waitForPermission(requestId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.pendingPermissions.set(requestId, { resolve, reject });
      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pendingPermissions.has(requestId)) {
          this.pendingPermissions.delete(requestId);
          reject(new Error('Permission request timed out'));
        }
      }, 300_000);
    });
  }

  private waitForAskUser(requestId: string): Promise<AskUserAnswers> {
    return new Promise((resolve, reject) => {
      this.pendingAskUser.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingAskUser.has(requestId)) {
          this.pendingAskUser.delete(requestId);
          reject(new Error('Ask user request timed out'));
        }
      }, 300_000);
    });
  }

  // ── Canvas operations ──

  getCanvasSnapshot(): CanvasBrowserSnapshot {
    return buildCanvasSnapshot(this.state.canvas);
  }

  canvasOp(op: 'fold' | 'unfold' | 'delete', blockId: string): { success: boolean; message: string } {
    const block = findBlock(this.state.canvas, blockId);
    if (!block) {
      return { success: false, message: `Block not found: ${blockId}` };
    }

    switch (op) {
      case 'fold':
        if (block.pinned) return { success: false, message: 'Cannot fold pinned block' };
        if (block.folded) return { success: false, message: 'Block already folded' };
        this.state = {
          ...this.state,
          canvas: manualFoldBlock(this.state.canvas, blockId, this.state.canvasConfig),
        };
        return { success: true, message: 'Block folded' };
      case 'unfold':
        if (!block.folded) return { success: false, message: 'Block not folded' };
        this.state = {
          ...this.state,
          canvas: expandBlock(this.state.canvas, blockId, this.state.canvasConfig),
        };
        return { success: true, message: 'Block unfolded' };
      case 'delete':
        this.state = {
          ...this.state,
          canvas: deleteBlock(this.state.canvas, blockId),
        };
        return { success: true, message: 'Block deleted' };
      default:
        return { success: false, message: `Unknown op: ${op}` };
    }
  }

  canvasInspect(blockId: string): { content: string; blockType: string; tokens: number; folded: boolean } | null {
    const block = findBlock(this.state.canvas, blockId);
    if (!block) return null;
    return {
      content: block.folded ? (block.originalContent ?? block.content) : block.content,
      blockType: block.type,
      tokens: block.tokens,
      folded: block.folded,
    };
  }

  canvasEdit(blockId: string, content: string): { success: boolean; message: string } {
    this.state = {
      ...this.state,
      canvas: editBlockContent(this.state.canvas, blockId, content, this.state.canvasConfig),
    };
    return { success: true, message: 'Block updated' };
  }

  pinBlock(content: string): void {
    this.state = addPin(this.state, content);
  }

  clearCanvas(): void {
    this.state = {
      ...this.state,
      canvas: createEmptyCanvas(),
      reminders: [],
    };
    this.emit({ id: '', type: 'canvas_cleared' });
  }

  // ── Session management ──

  sessionSave(name?: string, description?: string): SessionManifest {
    const manifest = this.sessionMgr.save(this.state, {
      name: name ?? this.config.sessionName,
      description,
      model: this.config.model,
      currentSessionId: this.config.sessionId,
    });
    this.emit({ type: 'session_saved', sessionId: manifest.id, name: manifest.name });
    return manifest;
  }

  sessionLoad(sessionId: string, checkpointId?: string): AgentState {
    const loaded = this.sessionMgr.load(sessionId, checkpointId);
    this.state = {
      ...loaded,
      canvas: restoreLegacyFoldedBlocks(loaded.canvas),
    };
    this.emit({ type: 'session_loaded', sessionId, checkpointId, canvasBlocks: this.state.canvas.blocks });
    return this.state;
  }

  sessionList(): SessionManifest[] {
    const sessions = this.sessionMgr.list();
    this.emit({ type: 'session_list_result', sessions });
    return sessions;
  }

  sessionDelete(sessionId: string): boolean {
    const result = this.sessionMgr.delete(sessionId);
    if (result) {
      this.emit({ type: 'session_deleted', sessionId, name: sessionId });
    }
    return result;
  }

  sessionRename(sessionId: string, newName: string): SessionManifest | null {
    const manifest = this.sessionMgr.rename(sessionId, newName);
    if (manifest) {
      this.emit({ type: 'session_renamed', sessionId, name: newName });
    }
    return manifest;
  }

  sessionExport(sessionIdOrName: string, outputPath?: string): { filePath: string; name: string } {
    const result = this.sessionMgr.exportSession(sessionIdOrName, outputPath);
    this.emit({ type: 'session_exported', name: result.name, filePath: result.filePath });
    return result;
  }

  sessionImport(filePath: string): SessionManifest {
    const manifest = this.sessionMgr.importSession(filePath);
    this.emit({ type: 'session_imported', name: manifest.name, sessionId: manifest.id });
    return manifest;
  }

  sessionRollback(checkpointId: string): AgentState {
    const state = this.sessionMgr.rollback(this.config.sessionId ?? '', checkpointId);
    this.state = {
      ...state,
      canvas: restoreLegacyFoldedBlocks(state.canvas),
    };
    this.emit({ type: 'session_rollback_result', checkpointId, step: 0 });
    return this.state;
  }

  // ── Task management ──

  taskQuery(): TaskItem[] {
    this.emit({ type: 'task_snapshot', tasks: this.state.tasks });
    return this.state.tasks;
  }

  // ── Getters ──

  getState(): AgentState {
    return cloneState(this.state);
  }

  getCanvasTokenCount(): number {
    return canvasTokenCount(this.state.canvas);
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Private helpers ──

  private buildExecutorRegistry(): import('@vesper/shared').ToolExecutorRegistry {
    const registry = createToolExecutorRegistry();

    const tools = [
      readTool, writeTool, writeMdTool, editTool, globTool, grepTool,
      createNativeShellToolEntry({ cwd: process.cwd() }),
      createScriptToolEntry({ cwd: process.cwd() }),
      createFetchToolEntry(this.config.proxy),
      createWebSearchToolEntry(this.config.proxy),
      timeTool,
      ...createAskUserTools(),
      ...createTaskTools(this.taskAccessor()),
    ];

    for (const tool of tools) {
      registry.register(tool.definition.name, tool.executor);
    }

    return registry;
  }

  private buildPolicyConfig(): import('@vesper/shared').ToolPolicyConfig | undefined {
    if (!this.config.toolset) return undefined;
    const toolset = getToolset(this.config.toolset);
    if (!toolset) return undefined;
    return createPolicyConfigFromToolset(toolset);
  }

  private buildEnvVars(): Record<string, string> {
    return {
      cwd: process.cwd(),
      os: process.platform,
      shell: process.env.SHELL ?? '/bin/bash',
    };
  }

  private taskAccessor(): TaskStateAccessor {
    return {
      getState: () => this.state,
      setState: (state: AgentState) => {
        this.state = state;
        this.emit({ type: 'task_snapshot', tasks: state.tasks });
      },
    };
  }
}
