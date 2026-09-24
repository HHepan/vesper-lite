// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — WebSocket Bridge Client
//
// Single WebSocket connection to WsBridge server.
// All messages carry sessionId for multiplexing.
// ═══════════════════════════════════════════════════════════════════════════

import type { ServerCommand, ServerEvent, CoreCommand } from '@vesper/shared';

/** Listener for session events (wire events from vesper-core with sessionId). */
export type SessionEventListener = (sessionId: string, event: ServerEvent) => void;

/** Listener for meta events (service_ready, install_progress, etc.). */
export type MetaEventListener = (event: ServerEvent) => void;

/** Bridge connection state. */
export type BridgeState = 'connecting' | 'connected' | 'disconnected';

/** Wire log entry: raw NDJSON send/recv for debugging. */
export interface WireLogEntry {
  timestamp: number;
  direction: 'send' | 'recv';
  text: string;
}

/** Listener for wire-level log entries (send/recv NDJSON). */
export type WireLogListener = (entry: WireLogEntry) => void;

export interface Bridge {
  /** Current connection state. */
  readonly state: BridgeState;

  /** Connect to the WebSocket server. */
  connect(port: number): void;

  /** Disconnect from the WebSocket server. */
  disconnect(): void;

  /** Create a new vesper-core session. */
  createSession(sessionId: string, config?: Record<string, any>): void;

  /** Destroy a session. */
  destroySession(sessionId: string): void;

  /** Request list of active sessions. */
  listActiveSessions(): void;

  /** Request UI state snapshot for a session (for restore after refresh). */
  restoreSession(sessionId: string): void;

  /** Rename a session on the server. */
  renameSession(sessionId: string, name: string, activeSessionId?: string): void;

  /** List saved sessions (persistent session manager). */
  listSavedSessions(activeSessionId: string): void;

  /** Delete a saved session. */
  deleteSavedSession(sessionId: string, activeSessionId: string): void;

  /** Request effective config from the server. */
  getConfig(sessionId?: string): void;

  /** Read config.json from the server (global=~/.vesper-lite/ or project=.vesper-lite/). */
  readConfigFile(scope?: 'global' | 'project', mergeGlobals?: boolean): void;

  /** Write config.json on the server (global=~/.vesper-lite/ or project=.vesper-lite/). */
  writeConfigFile(content: string, scope?: 'global' | 'project'): void;

  /** Request list of profiles from config.json. */
  listProfiles(): void;

  /** Query available tools + skills for the Settings capabilities tabs. */
  queryCapabilities(sessionId?: string): void;

  /** Send a CoreCommand to a session (sessionId is prepended by the wrapper). */
  sendCommand(sessionId: string, command: CoreCommand): void;

  /** Send a global command (no session required, e.g. cookie management). */
  sendGlobalCommand(command: ServerCommand): void;

  /** Register a listener for session events (events with sessionId). */
  onSessionEvent(listener: SessionEventListener): () => void;

  /** Register a listener for meta events (service_ready, install_progress, etc.). */
  onMetaEvent(listener: MetaEventListener): () => void;

  /** Register a listener for connection state changes. */
  onStateChange(listener: (state: BridgeState) => void): () => void;

  /** Register a listener for raw wire-level log entries (send/recv). */
  onWireLog(listener: WireLogListener): () => void;

  /** Search files/folders in a directory (for @-mention autocomplete). */
  fileSearch(query: string, requestId: string, cwd?: string, limit?: number): void;

  /** Request list of prompt templates from manifest.json. */

  /** Read a specific prompt Markdown file. */

  /** Write a prompt Markdown file. */

  /** Delete a .vesper-lite/prompts/ override, reverting to the built-in default. */

  /** Request a preview of merged prompts for a specific ego/role. */

  /** Switch to a specific persona+role member. */

  // ── TODO Management ──
}

export function createBridge(): Bridge {
  let ws: WebSocket | null = null;
  let state: BridgeState = 'disconnected';
  let port = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const sessionListeners = new Set<SessionEventListener>();
  const metaListeners = new Set<MetaEventListener>();
  const stateListeners = new Set<(state: BridgeState) => void>();
  const wireLogListeners = new Set<WireLogListener>();

  function emitWireLog(direction: 'send' | 'recv', text: string): void {
    if (wireLogListeners.size === 0) return;
    const entry: WireLogEntry = { timestamp: Date.now(), direction, text };
    for (const fn of wireLogListeners) fn(entry);
  }

  function setState(newState: BridgeState): void {
    if (state === newState) return;
    state = newState;
    for (const fn of stateListeners) fn(state);
  }

  function send(data: ServerCommand): void {
    if (ws?.readyState === WebSocket.OPEN) {
      const json = JSON.stringify(data);
      emitWireLog('send', json);
      ws.send(json);
    } else {
      // Log dropped messages for debugging — this helps diagnose issues where
      // config saves or other commands silently fail during WS reconnection.
      console.warn(`[bridge] Dropped message (ws state: ${ws?.readyState}): ${'cmd' in data ? data.cmd : 'unknown'}`);
    }
  }

  function handleMessage(data: string): void {
    emitWireLog('recv', data);
    try {
      const msg = JSON.parse(data) as ServerEvent;

      const sessionId = 'sessionId' in msg ? msg.sessionId : undefined;
      if (sessionId) {
        // Session event — dispatch to session listeners
        for (const fn of sessionListeners) fn(sessionId, msg);
      } else {
        // Meta event (service_ready, install_progress, session_created, etc.)
        for (const fn of metaListeners) fn(msg);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  function connect(p: number): void {
    port = p;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null;
      ws.close();
    }

    setState('connecting');

    // Use the same hostname as the current page (supports remote access via IP)
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const socket = new WebSocket(`ws://${host}:${port}/ws`);

    socket.onopen = () => {
      setState('connected');
    };

    socket.onmessage = (event) => {
      handleMessage(event.data);
    };

    socket.onclose = () => {
      setState('disconnected');
      ws = null;
      // Auto-reconnect after 1 second
      reconnectTimer = setTimeout(() => connect(port), 1000);
    };

    socket.onerror = () => {
      // onclose will fire after onerror
    };

    ws = socket;
  }

  function disconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
    setState('disconnected');
  }

  return {
    get state() { return state; },

    connect,
    disconnect,

    createSession(sessionId: string, config: Record<string, any> = {}) {
      const { name, ...rest } = config;
      send({ cmd: 'session_create', sessionId, name, config: rest });
    },

    destroySession(sessionId: string) {
      send({ cmd: 'session_destroy', sessionId });
    },

    listActiveSessions() {
      send({ cmd: 'session_list_active' });
    },

    restoreSession(sessionId: string) {
      send({ cmd: 'session_restore', sessionId });
    },

    renameSession(sessionId: string, name: string, activeSessionId?: string) {
      send({ cmd: 'session_rename', sessionId, name, activeSessionId });
    },

    listSavedSessions(activeSessionId: string) {
      send({ cmd: 'session_list', activeSessionId });
    },

    deleteSavedSession(sessionId: string, activeSessionId: string) {
      send({ cmd: 'session_delete', sessionId, activeSessionId });
    },

    getConfig(sessionId?: string) {
      send({ cmd: 'get_config', ...(sessionId ? { sessionId } : {}) });
    },

    readConfigFile(scope?: 'global' | 'project', mergeGlobals?: boolean): void {
      send({ cmd: 'read_config_file', scope: scope ?? 'global', ...(mergeGlobals === false ? { mergeGlobals: false } : {}) });
    },

    writeConfigFile(content: string, scope?: 'global' | 'project') {
      send({ cmd: 'write_config_file', content, scope: scope ?? 'global' });
    },

    listProfiles() {
      send({ cmd: 'list_profiles' });
    },

    queryCapabilities(sessionId?: string) {
      send({ cmd: 'query_capabilities', ...(sessionId ? { sessionId } : {}) } as ServerCommand);
    },

    sendCommand(sessionId: string, command: CoreCommand) {
      send({ ...command, sessionId } as ServerCommand);
    },

    fileSearch(query: string, requestId: string, cwd?: string, limit?: number) {
      send({ cmd: 'file_search', query, requestId, ...(cwd ? { cwd } : {}), ...(limit ? { limit } : {}) });
    },


    /** Send a global command (no session required, e.g. cookie management). */
    sendGlobalCommand(command: ServerCommand): void {
      send(command);
    },

    onSessionEvent(listener: SessionEventListener) {
      sessionListeners.add(listener);
      return () => { sessionListeners.delete(listener); };
    },

    onMetaEvent(listener: MetaEventListener) {
      metaListeners.add(listener);
      return () => { metaListeners.delete(listener); };
    },

    onStateChange(listener: (state: BridgeState) => void) {
      stateListeners.add(listener);
      return () => { stateListeners.delete(listener); };
    },

    onWireLog(listener: WireLogListener) {
      wireLogListeners.add(listener);
      return () => { wireLogListeners.delete(listener); };
    },
  };
}
