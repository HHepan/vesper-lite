// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Lightweight HTTP/WebSocket Server
// Implements full WebUI WS protocol with 100% pure TypeScript (zero native C++)
// ═══════════════════════════════════════════════════════════════════════════

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentEventLoop, loadGlobalConfig, resolveEffectiveConfig } from '@vesper/core';
import type { Canvas, ProviderConfig } from '@vesper/shared';
import { SessionUIStateAccumulator } from './ui-state.js';

export interface LiteServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  providerConfig?: ProviderConfig;
  cwd?: string;
}

interface SessionRecord {
  id: string;
  name: string;
  loop?: AgentEventLoop;
  createdAt: number;
  /** Server-side mirror of UI state — powers snapshot restore after refresh. */
  uiState: SessionUIStateAccumulator;
}

export class LiteServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private sessions: Map<string, SessionRecord> = new Map();
  private providerConfig: ProviderConfig;
  private cwd: string;
  private clients: Set<WebSocket> = new Set();

  constructor(options: LiteServerOptions = {}) {
    const port = options.port ?? 18760;
    const host = options.host ?? '0.0.0.0';
    this.cwd = options.cwd ?? process.cwd();
    this.providerConfig = options.providerConfig ?? {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    };

    // Ensure .vesper directory exists
    const vesperHome = path.join(homedir(), '.vesper');
    fs.mkdirSync(vesperHome, { recursive: true });

    // Initialize default session
    this.sessions.set('s1', {
      id: 's1',
      name: 'Session 1',
      createdAt: Date.now(),
      uiState: new SessionUIStateAccumulator(),
    });

    // 1. Static HTTP Server
    this.server = http.createServer((req, res) => {
      const url = req.url?.split('?')[0] || '/';
      const rootDir = options.staticDir || path.resolve(this.cwd, 'dist/web');
      let filePath = path.join(rootDir, url === '/' ? 'index.html' : url);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(rootDir, 'index.html');
      }

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ico': 'image/x-icon',
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Vesper Lite WebUI not compiled. Run pnpm run build first.');
      }
    });

    // 2. WebSocket Server
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);

      // WebUI expects service_ready immediately upon connection!
      ws.send(JSON.stringify({ type: 'service_ready' }));

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleMessage(ws, msg);
        } catch (err: any) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
      });
    });
  }

  private broadcast(event: any) {
    const json = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  private async loadMergedConfig(): Promise<Record<string, any>> {
    const globalCfg = await loadGlobalConfig();
    const projectPath = path.resolve(this.cwd, '.vesper-lite', 'config.json');
    let projectCfg: any = {};
    try {
      if (fs.existsSync(projectPath)) {
        projectCfg = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
      }
    } catch {}
    // 合并 profiles：项目级覆盖全局
    return {
      ...globalCfg,
      ...projectCfg,
      profiles: {
        ...(globalCfg?.profiles ?? {}),
        ...(projectCfg?.profiles ?? {}),
      },
      defaultProfile: projectCfg?.defaultProfile ?? globalCfg?.defaultProfile,
    };
  }

  /**
   * 转发某个 session 的 loop 事件给所有已连接的客户端。
   * 不绑定到创建时的单个 ws —— 否则页面刷新（新连接）后就收不到事件流。
   */
  private forwardSessionEvent(sid: string, event: any): void {
    // Feed the server-side UI state accumulator so refresh can restore canvas.
    const session = this.sessions.get(sid);
    if (session) {
      session.uiState.processEvent(event);
      if (event.type === 'run_started' && event.prompt) {
        session.uiState.pushInputHistory(event.prompt);
      }
    }

    let payload: any;
    // 如果是 Error 实例，JSON.stringify(Error) 会序列化为 {}，导致前端显示 Unknown error
    if (event.type === 'error' && event.error instanceof Error) {
      payload = {
        ...event,
        error: {
          message: event.error.message,
          name: event.error.name,
          stack: event.error.stack,
          cause: event.error.cause
            ? (event.error.cause instanceof Error
                ? { message: event.error.cause.message, name: event.error.cause.name, code: (event.error.cause as any).code }
                : String(event.error.cause))
            : undefined,
        },
        sessionId: sid,
      };
    } else {
      payload = { ...event, sessionId: sid };
    }
    const json = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  private async handleMessage(ws: WebSocket, msg: any) {
    const { cmd } = msg;

    // ── Session list active ──
    if (cmd === 'session_list_active') {
      const list = Array.from(this.sessions.values()).map(s => ({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
      }));
      ws.send(JSON.stringify({ type: 'session_list', sessions: list }));
      return;
    }

    // ── Session create ──
    if (cmd === 'session_create') {
      const id = msg.sessionId || ('s' + (this.sessions.size + 1));
      const name = msg.name || ('Session ' + (this.sessions.size + 1));
      this.sessions.set(id, {
        id,
        name,
        createdAt: Date.now(),
        uiState: new SessionUIStateAccumulator(),
      });
      ws.send(JSON.stringify({ type: 'session_created', sessionId: id, name, success: true }));
      // 必须立刻给当前连接发 ready 事件，否则 WebUI 的 store.ready 为 false，输入框会被 disabled 禁用
      ws.send(JSON.stringify({ type: 'ready', sessionId: id }));

      // 给前端发送 provider 状态与初始 token 预算
      try {
        const mergedCfg = await this.loadMergedConfig();
        const profilesMap = mergedCfg?.profiles ?? {};
        const availableProfiles = Object.entries(profilesMap).map(([name, p]: [string, any]) => ({
          name,
          model: p?.model,
          baseURL: p?.baseURL,
        }));
        const targetProfile = msg.config?.profile || (mergedCfg as any)?.defaultProfile;
        const targetProfileCfg = targetProfile ? profilesMap[targetProfile] : undefined;
        const effective = resolveEffectiveConfig({}, {}, mergedCfg || {});
        const resolvedModel = targetProfileCfg?.model || effective.model || 'gpt-4o';
        const resolvedBaseURL = targetProfileCfg?.baseURL || effective.baseURL || this.providerConfig.baseURL;
        const resolvedProviderType = targetProfileCfg?.providerType || effective.providerType || 'openai';
        const budgetTokens = targetProfileCfg?.maxCanvasTokens || effective.maxTokens || 200000;

        ws.send(JSON.stringify({
          type: 'token_budget',
          sessionId: id,
          snapshot: {
            pinnedTokens: 0,
            foldedTokens: 0,
            activeTokens: 0,
            reminderTokens: 0,
            totalTokens: 0,
            budgetTokens,
            utilizationPercent: 0,
            source: 'estimated',
            cumulativeTokens: 0,
          },
        }));

        ws.send(JSON.stringify({
          type: 'provider_state',
          sessionId: id,
          model: resolvedModel,
          baseURL: resolvedBaseURL,
          providerType: resolvedProviderType,
          currentProfile: targetProfile,
          availableProfiles,
        }));
      } catch {}
      
      this.broadcast({ type: 'session_list', sessions: Array.from(this.sessions.values()) });
      return;
    }

    // ── Session destroy ──
    if (cmd === 'session_destroy') {
      this.sessions.delete(msg.sessionId);
      ws.send(JSON.stringify({ type: 'session_destroyed', sessionId: msg.sessionId }));
      return;
    }

    // ── Session restore ──
    if (cmd === 'session_restore') {
      const s = this.sessions.get(msg.sessionId);
      ws.send(JSON.stringify({
        type: 'session_state',
        sessionId: msg.sessionId,
        // Return the accumulated UI snapshot (turns/timeline) so the WebUI
        // restores the full canvas after a page refresh. Falls back to an
        // empty object for a fresh session with no conversation yet.
        state: s?.uiState ? s.uiState.getSnapshot() : {},
        name: s?.name ?? msg.sessionId,
      }));
      
      // 恢复会话时同样下发 provider_state
      try {
        const mergedCfg = await this.loadMergedConfig();
        const profilesMap = mergedCfg?.profiles ?? {};
        const availableProfiles = Object.entries(profilesMap).map(([name, p]: [string, any]) => ({
          name,
          model: p?.model,
          baseURL: p?.baseURL,
        }));
        const targetProfile = (mergedCfg as any)?.defaultProfile;
        const targetProfileCfg = targetProfile ? profilesMap[targetProfile] : undefined;
        const effective = resolveEffectiveConfig({}, {}, mergedCfg || {});
        const resolvedModel = targetProfileCfg?.model || effective.model || 'gpt-4o';
        const resolvedBaseURL = targetProfileCfg?.baseURL || effective.baseURL || this.providerConfig.baseURL;
        const resolvedProviderType = targetProfileCfg?.providerType || effective.providerType || 'openai';
        ws.send(JSON.stringify({
          type: 'provider_state',
          sessionId: msg.sessionId,
          model: resolvedModel,
          baseURL: resolvedBaseURL,
          providerType: resolvedProviderType,
          currentProfile: targetProfile,
          availableProfiles,
        }));
      } catch {}
      return;
    }

    // ── Session rename ──
    if (cmd === 'session_rename') {
      const s = this.sessions.get(msg.sessionId);
      if (s) {
        s.name = msg.name;
        this.broadcast({ type: 'session_renamed', sessionId: msg.sessionId, name: msg.name });
      }
      return;
    }

    // ── Get Config ──
    if (cmd === 'get_config') {
      try {
        const globalCfg = await loadGlobalConfig();
        const effective = resolveEffectiveConfig({}, {}, globalCfg || {});
        ws.send(JSON.stringify({ type: 'effective_config', config: effective }));
      } catch {
        ws.send(JSON.stringify({ type: 'effective_config', config: {} }));
      }
      return;
    }

    // ── Read Config File ──
    if (cmd === 'read_config_file') {
      const scope = msg.scope ?? 'global';
      const configPath = scope === 'project'
        ? path.resolve(this.cwd, '.vesper-lite', 'config.json')
        : path.join(homedir(), '.vesper-lite', 'config.json');

      try {
        const content = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '{}';
        ws.send(JSON.stringify({
          type: 'config_file_content',
          content,
          path: configPath,
          scope,
        }));
      } catch (err: any) {
        ws.send(JSON.stringify({
          type: 'config_file_content',
          content: '{}',
          path: configPath,
          scope,
          error: err.message,
        }));
      }
      return;
    }

    // ── Write Config File ──
    if (cmd === 'write_config_file') {
      const scope = msg.scope ?? 'global';
      const configPath = scope === 'project'
        ? path.resolve(this.cwd, '.vesper-lite', 'config.json')
        : path.join(homedir(), '.vesper-lite', 'config.json');

      try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, msg.content, 'utf8');
        ws.send(JSON.stringify({ type: 'config_file_saved', scope, success: true }));
        this.broadcast({ type: 'config_updated' });
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'config_file_saved', scope, success: false, error: err.message }));
      }
      return;
    }

    // ── List Profiles ──
    if (cmd === 'list_profiles') {
      try {
        const mergedCfg = await this.loadMergedConfig();
        const profilesMap = mergedCfg?.profiles ?? {};
        const profileObjects = Object.entries(profilesMap).map(([name, p]: [string, any]) => ({
          name,
          model: p?.model,
          baseURL: p?.baseURL,
        }));
        const profileNames = Object.keys(profilesMap);
        // WebUI: SessionCreateDialog expects `profile_list` with [{name, model, baseURL}]
        ws.send(JSON.stringify({
          type: 'profile_list',
          profiles: profileObjects,
          defaultProfile: mergedCfg?.defaultProfile,
        }));
        // WebUI: ConfigPanel expects `profiles_list` with string[]
        ws.send(JSON.stringify({
          type: 'profiles_list',
          profiles: profileNames,
          defaultProfile: mergedCfg?.defaultProfile,
        }));
      } catch {
        ws.send(JSON.stringify({ type: 'profile_list', profiles: [], defaultProfile: undefined }));
        ws.send(JSON.stringify({ type: 'profiles_list', profiles: [], defaultProfile: undefined }));
      }
      return;
    }

    // ── File search (@-mention) ──
    if (cmd === 'file_search') {
      ws.send(JSON.stringify({ type: 'file_search_result', requestId: msg.requestId, results: [] }));
      return;
    }

    // ── Provider Switch ──
    if (cmd === 'provider_switch' || cmd === 'switch_provider') {
      const sid = msg.sessionId;
      const profileName = msg.profile || msg.profileName;
      try {
        const mergedCfg = await this.loadMergedConfig();
        const profilesMap = mergedCfg?.profiles ?? {};
        const p = profilesMap[profileName];
        const s = this.sessions.get(sid);
        if (p && s) {
          // 重新创建 loop 以应用新 provider 配置
          if (s.loop) {
            try { s.loop.abort(); } catch {}
          }
          const effective = resolveEffectiveConfig({}, {}, mergedCfg || {});
          s.loop = new AgentEventLoop({
            model: p.model || effective.model || 'gpt-4o',
            baseURL: p.baseURL || effective.baseURL || this.providerConfig.baseURL,
            apiKey: p.apiKey || effective.apiKey || this.providerConfig.apiKey,
            maxIterations: (mergedCfg.maxIterations && mergedCfg.maxIterations > 0) ? mergedCfg.maxIterations : 25,
            maxCanvasTokens: p.maxCanvasTokens || effective.maxTokens || 200000,
          });
          s.loop.on((event: any) => {
            this.forwardSessionEvent(sid, event);
          });
        }
        ws.send(JSON.stringify({
          type: 'provider_switched',
          sessionId: sid,
          model: p?.model,
          baseURL: p?.baseURL,
          providerType: p?.providerType,
          profile: profileName,
        }));
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'error', sessionId: sid, error: { message: err.message } }));
      }
      return;
    }

    // ── Diagnostics: test network from inside this process ──
    if (cmd === 'diag_fetch') {
      try {
        const { lookup } = await import('node:dns/promises');
        const target = msg.url || 'api.deepseek.com';
        // 1. DNS
        let addrs: any = [];
        try {
          addrs = await lookup(target, { all: true });
        } catch (e: any) {
          addrs = [{ error: e.message }];
        }
        // 2. Fetch
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const start = Date.now();
        let fetchResult: any = {};
        try {
          const res = await fetch(`https://${target}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${msg.apiKey || ''}`,
            },
            body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }),
            signal: controller.signal,
          });
          const text = await res.text().catch(() => '');
          fetchResult = { status: res.status, timeMs: Date.now() - start, body: text.slice(0, 200) };
        } catch (e: any) {
          fetchResult = {
            error: e.message,
            name: e.name,
            code: (e as any).code,
            cause: e.cause ? (e.cause.message || String(e.cause)) : undefined,
            causeCode: e.cause?.code,
            timeMs: Date.now() - start,
          };
        }
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'diag_result', dns: addrs, fetch: fetchResult }));
      } catch (e: any) {
        ws.send(JSON.stringify({ type: 'diag_result', error: e.message }));
      }
      return;
    }

    // ── Execution commands (run, slash, etc.) ──
    if (cmd === 'run' || cmd === 'slash') {
      const sid = msg.sessionId || 's1';
      const promptText = msg.input || msg.text || '';
      let session = this.sessions.get(sid);
      if (!session) {
        session = { id: sid, name: 'Session', createdAt: Date.now(), uiState: new SessionUIStateAccumulator() };
        this.sessions.set(sid, session);
      }

      if (!session.loop) {
        // Read latest merged config
        let cfg: any = {};
        try {
          const merged = await this.loadMergedConfig();
          cfg = resolveEffectiveConfig({}, {}, merged || {});
        } catch {}

        session.loop = new AgentEventLoop({
          model: cfg.model || (this.providerConfig as any).model || 'gpt-4o',
          baseURL: cfg.baseURL || this.providerConfig.baseURL,
          apiKey: cfg.apiKey || this.providerConfig.apiKey,
          maxIterations: (cfg.maxIterations && cfg.maxIterations > 0) ? cfg.maxIterations : 25,
          maxCanvasTokens: cfg.maxTokens || 200000,
        });

        session.loop.on((event: any) => {
          this.forwardSessionEvent(sid, event);
        });
      }

      // ── Slash commands: dispatch to the appropriate AgentEventLoop method ──
      if (cmd === 'slash') {
        const input = promptText.trim();
        const parts = input.split(/\s+/);
        const name = parts[0]?.slice(1) ?? '';   // strip leading '/'
        const arg = parts.slice(1).join(' ');

        try {
          switch (name) {
            case 'clear':
              session.loop.clearCanvas();
              ws.send(JSON.stringify({ type: 'status', sessionId: sid, id: msg.id, message: 'Canvas cleared.' }));
              break;
            case 'save':
              session.loop.sessionSave(arg || undefined);
              break;
            case 'load':
              if (arg) session.loop.sessionLoad(arg);
              else session.loop.sessionList();
              break;
            case 'delete':
              if (arg) session.loop.sessionDelete(arg);
              break;
            case 'sessions':
              session.loop.sessionList();
              break;
            case 'export':
              if (arg) session.loop.sessionExport(arg);
              else ws.send(JSON.stringify({ type: 'error', sessionId: sid, id: msg.id, error: { message: 'Usage: /export <name> [path]' } }));
              break;
            case 'import':
              if (arg) session.loop.sessionImport(arg);
              else ws.send(JSON.stringify({ type: 'error', sessionId: sid, id: msg.id, error: { message: 'Usage: /import <path>' } }));
              break;
            case 'pin':
              if (arg) session.loop.pinBlock(arg);
              break;
            case 'canvas':
              ws.send(JSON.stringify({ type: 'canvas_browser_snapshot', sessionId: sid, id: msg.id, snapshot: session.loop.getCanvasSnapshot() }));
              break;
            case 'rollback':
              if (arg) session.loop.sessionRollback(arg);
              break;
            case 'task':
              session.loop.taskQuery();
              break;
            case 'skill': {
              const sub = parts[1] ?? 'list';
              const arg2 = parts.slice(2).join(' ');
              if (sub === 'list' || sub === 'ls') {
                const skills = session.loop.skillList();
                if (skills.length === 0) {
                  ws.send(JSON.stringify({ type: 'status', sessionId: sid, id: msg.id, message: 'No skills found. Place markdown files in .vesper-lite/skills/' }));
                } else {
                  const loaded = session.loop.getLoadedSkillNames();
                  const lines = skills.map((s: any) => {
                    const tag = loaded.includes(s.name) ? '✓ ' : '  ';
                    return tag + s.name + (s.description ? ' - ' + s.description : '');
                  });
                  ws.send(JSON.stringify({ type: 'status', sessionId: sid, id: msg.id, message: lines.join('\n') }));
                }
              } else if (sub === 'load' || sub === 'import') {
                if (!arg2) {
                  ws.send(JSON.stringify({ type: 'error', sessionId: sid, id: msg.id, error: { message: 'Usage: /skill load <name>' } }));
                } else {
                  const res = session.loop.skillLoad(arg2);
                  ws.send(JSON.stringify({ type: res.success ? 'status' : 'error', sessionId: sid, id: msg.id, message: res.message, error: res.success ? undefined : { message: res.message } }));
                }
              } else if (sub === 'unload') {
                if (!arg2) {
                  ws.send(JSON.stringify({ type: 'error', sessionId: sid, id: msg.id, error: { message: 'Usage: /skill unload <name>' } }));
                } else {
                  const res = session.loop.skillUnload(arg2);
                  ws.send(JSON.stringify({ type: res.success ? 'status' : 'error', sessionId: sid, id: msg.id, message: res.message, error: res.success ? undefined : { message: res.message } }));
                }
              } else if (sub === 'clear') {
                const res = session.loop.skillClear();
                ws.send(JSON.stringify({ type: 'status', sessionId: sid, id: msg.id, message: res.message }));
              } else {
                ws.send(JSON.stringify({ type: 'error', sessionId: sid, id: msg.id, error: { message: 'Unknown skill subcommand' } }));
              }
              break;
            }
            case 'cd':
              if (arg) {
                try {
                  process.chdir(arg);
                  ws.send(JSON.stringify({ type: 'status', sessionId: sid, id: msg.id, message: `Changed directory to ${arg}` }));
                } catch (e: any) {
                  ws.send(JSON.stringify({ type: 'error', sessionId: sid, id: msg.id, error: { message: e.message } }));
                }
              }
              break;
            default:
              ws.send(JSON.stringify({ type: 'status', sessionId: sid, id: msg.id, message: `Unknown slash command: ${input}` }));
          }
          ws.send(JSON.stringify({ type: 'run_complete', sessionId: sid, id: msg.id }));
        } catch (err: any) {
          ws.send(JSON.stringify({ type: 'error', sessionId: sid, id: msg.id, error: { message: err.message } }));
        }
        return;
      }

      try {
        const images = msg.images;
        const regenerate = msg.regenerate;
        ws.send(JSON.stringify({ type: 'run_started', sessionId: sid, id: msg.id, prompt: promptText, ...(images?.length ? { images } : {}) }));
        // Feed run_started into the UI state accumulator too (it carries the
        // prompt that the reducer needs to track the current turn).
        session.uiState.processEvent({ type: 'run_started', prompt: promptText, ...(images?.length ? { images } : {}) });
        session.uiState.pushInputHistory(promptText);
        await session.loop.run(promptText, images, regenerate);
        ws.send(JSON.stringify({ type: 'run_complete', sessionId: sid, id: msg.id }));
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'error', sessionId: sid, id: msg.id, error: { message: err.message } }));
      }
      return;
    }

    // Fallback passthrough for any other command
    if (msg.sessionId) {
      const s = this.sessions.get(msg.sessionId);
      if (s?.loop) {
        // handle loop ops if needed
      }
    }
  }

  async listen(port?: number, host?: string): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port || 18760, host || '0.0.0.0', () => {
        resolve();
      });
    });
  }

  close(): void {
    this.wss.close();
    this.server.close();
  }
}

export default LiteServer;