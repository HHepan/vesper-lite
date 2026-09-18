// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Lightweight HTTP/WebSocket Server
// Pure Node.js & TypeScript — 100% Zero Native C++ Compilation Dependencies!
// ═══════════════════════════════════════════════════════════════════════════

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentEventLoop } from '@vesper/core';
import type { Canvas, ProviderConfig } from '@vesper/shared';

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
  canvas: Canvas;
  createdAt: number;
}

export class LiteServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private sessions: Map<string, SessionRecord> = new Map();
  private providerConfig: ProviderConfig;
  private cwd: string;

  constructor(options: LiteServerOptions = {}) {
    const port = options.port ?? 18760;
    const host = options.host ?? '0.0.0.0';
    this.cwd = options.cwd ?? process.cwd();
    this.providerConfig = options.providerConfig ?? {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    };

    // Create default session
    const defaultSession: SessionRecord = {
      id: 'default',
      name: 'Default Session',
      canvas: { blocks: [] },
      createdAt: Date.now(),
    };
    this.sessions.set('default', defaultSession);

    // 1. Static HTTP Server
    this.server = http.createServer((req, res) => {
      const url = req.url?.split('?')[0] || '/';
      let filePath = path.join(options.staticDir || path.resolve(this.cwd, 'dist/web'), url === '/' ? 'index.html' : url);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(options.staticDir || path.resolve(this.cwd, 'dist/web'), 'index.html');
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
        res.end('Vesper Lite Server Running');
      }
    });

    // 2. WebSocket Server (Isolated Sessions API)
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket) => {
      let activeSessionId = 'default';

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          // Session list
          if (msg.cmd === 'session_list') {
            const list = Array.from(this.sessions.values()).map(s => ({
              id: s.id,
              name: s.name,
              createdAt: s.createdAt,
            }));
            ws.send(JSON.stringify({ type: 'session_list', sessions: list }));
            return;
          }

          // Session create (Isolated)
          if (msg.cmd === 'session_create') {
            const id = 's_' + Math.random().toString(36).slice(2, 9);
            const name = msg.name || ('Session ' + (this.sessions.size + 1));
            const newSession: SessionRecord = {
              id,
              name,
              canvas: { blocks: [] },
              createdAt: Date.now(),
            };
            this.sessions.set(id, newSession);
            ws.send(JSON.stringify({ type: 'session_created', session: { id, name } }));
            return;
          }

          // Session switch
          if (msg.cmd === 'session_switch') {
            if (this.sessions.has(msg.sessionId)) {
              activeSessionId = msg.sessionId;
              const s = this.sessions.get(activeSessionId)!;
              ws.send(JSON.stringify({ type: 'session_switched', sessionId: activeSessionId, canvas: s.canvas }));
            }
            return;
          }

          // User message execution
          if (msg.cmd === 'user_input') {
            const session = this.sessions.get(activeSessionId) || this.sessions.get('default')!;
            
            
            const loop = new AgentEventLoop({
              model: (this.providerConfig as any).model || 'gpt-4o',
              baseURL: this.providerConfig.baseURL,
              apiKey: this.providerConfig.apiKey,
              maxIterations: 25,
              maxCanvasTokens: 100000,
            });
            loop.on((event: any) => {
              ws.send(JSON.stringify({ type: 'stream_event', sessionId: activeSessionId, event }));
            });
            await loop.run(msg.text);
            ws.send(JSON.stringify({ type: 'flow_done', sessionId: activeSessionId }));
            return;
ws.send(JSON.stringify({ type: 'flow_done', sessionId: activeSessionId, canvas: session.canvas }));
            return;
          }
        } catch (err: any) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
      });
    });
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
