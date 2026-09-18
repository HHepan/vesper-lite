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

/** Listener for terminal events (term_output, term_exited, etc.). */
export type TerminalEventListener = (event: ServerEvent) => void;

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

  /** Read config.json from the server (global=~/.vesper/ or project=.vesper/). */
  readConfigFile(scope?: 'global' | 'project', mergeGlobals?: boolean): void;

  /** Write config.json on the server (global=~/.vesper/ or project=.vesper/). */
  writeConfigFile(content: string, scope?: 'global' | 'project'): void;

  /** Request list of profiles from config.json. */
  listProfiles(): void;

  /** Connect as relay host (server generates roomId + joinToken + e2eSecret). */
  remoteHost(relayUrl?: string): void;

  /** Connect as relay client with token-based credentials. */
  remoteClient(url: string, roomId: string, joinToken: string, e2eSecret: string): void;

  /** Disconnect relay. */
  remoteDisconnect(): void;

  /** Request relay connection status. */
  remoteStatus(): void;

  /** Start embedded LAN relay on the same port. */
  lanHost(): void;

  /** Stop embedded LAN relay. */
  lanStop(): void;

  /** Request LAN relay status. */
  lanStatus(): void;

  /** Send a CoreCommand to a session (sessionId is prepended by the wrapper). */
  sendCommand(sessionId: string, command: CoreCommand): void;

  /** Create a PTY terminal. */
  createTerminal(termId: string, cols?: number, rows?: number): void;

  /** Send input to a terminal. */
  sendTerminalInput(termId: string, data: string): void;

  /** Resize a terminal. */
  resizeTerminal(termId: string, cols: number, rows: number): void;

  /** Destroy a terminal. */
  destroyTerminal(termId: string): void;

  /** Request list of active terminal IDs. */
  listTerminals(): void;

  /** Send a global command (no session required, e.g. cookie management). */
  sendGlobalCommand(command: ServerCommand): void;

  /** Register a listener for session events (events with sessionId). */
  onSessionEvent(listener: SessionEventListener): () => void;

  /** Register a listener for meta events (service_ready, install_progress, etc.). */
  onMetaEvent(listener: MetaEventListener): () => void;

  /** Register a listener for terminal events. */
  onTerminalEvent(listener: TerminalEventListener): () => void;

  /** Register a listener for connection state changes. */
  onStateChange(listener: (state: BridgeState) => void): () => void;

  /** Register a listener for raw wire-level log entries (send/recv). */
  onWireLog(listener: WireLogListener): () => void;

  /** Search files/folders in a directory (for @-mention autocomplete). */
  fileSearch(query: string, requestId: string, cwd?: string, limit?: number): void;

  /** Request the full ontology knowledge graph (nodes/edges/notes) for an Ego. */
  requestOntologyGraph(egoName: string, personas: Array<{ name: string; role: string; color?: string }>, sessionId?: string): void;

  // ── Ontology memory management (Knowledge panel sidebar) ──
  ontologyUpdateNode(scopedId: string, fields: Record<string, any>, sessionId?: string): void;
  ontologyUpdateEdge(scopedId: string, fields: Record<string, any>, sessionId?: string): void;
  ontologyUpdateNote(scopedId: string, fields: Record<string, any>, sessionId?: string): void;
  ontologyDelete(scopedId: string, sessionId?: string): void;
  ontologyAdd(dbName: string, entry: Record<string, any>, sessionId?: string): void;
  ontologyImport(egoName: string, data: string, sessionId?: string): void;
  ontologyExport(egoName: string, sessionId?: string): void;

  /** Request list of prompt templates from manifest.json. */
  listPrompts(): void;

  /** Read a specific prompt Markdown file. */
  readPrompt(filename: string): void;

  /** Write a prompt Markdown file. */
  writePrompt(filename: string, content: string): void;

  /** Delete a .vesper/prompts/ override, reverting to the built-in default. */
  deletePromptOverride(filename: string): void;

  /** Request a preview of merged prompts for a specific ego/role. */
  readPromptPreview(ego: any, roleName: string, customPrompt?: string, supervisorRules?: string, prependSystemToEgo?: boolean): void;

  /** Switch to a specific persona+role member. */
  switchMember(sessionId: string, personaName: string, roleName: string): void;
  setMultiChatMode(sessionId: string, enabled: boolean, members: string[]): void;

  // ── Scene Management ──
  requestSceneList(): void;
  requestSceneLoad(name: string): void;
  requestSceneSave(name: string, description?: string, sessionId?: string): void;
  requestSceneCreate(name: string, description?: string): void;
  requestSceneDelete(name: string): void;
  requestSceneQuery(): void;
  sendSceneCommand(sessionId: string, sceneCmd: CoreCommand): void;
  sendSessionCommand(sessionId: string, cmd: CoreCommand): void;

  // ── QQ Bot Management ──
  qqBotStart(): void;
  qqBotStop(): void;
  qqBotStatus(): void;
  qqBotUpdateConfig(config: Record<string, any>): void;
  qqBotStickerList(): void;
  qqBotStickerUpload(filename: string, data: string, description?: string): void;
  qqBotStickerUpdateMeta(id: number, description: string): void;
  qqBotStickerDelete(id: number): void;
  qqBotStickerScan(): void;
  qqBotStickerPreview(filename: string): void;
  qqBotLastPrompt(): void;
  qqBotSaveSession(): void;
  qqBotResetSession(): void;

  // ── TODO Management ──
  todoList(): void;
  todoAdd(text: string): void;
  todoUpdate(id: string, updates: { text?: string; done?: boolean }): void;
  todoDelete(id: string): void;
}

export function createBridge(): Bridge {
  let ws: WebSocket | null = null;
  let state: BridgeState = 'disconnected';
  let port = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const sessionListeners = new Set<SessionEventListener>();
  const metaListeners = new Set<MetaEventListener>();
  const terminalListeners = new Set<TerminalEventListener>();
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

      // Terminal events (have termId, no sessionId) or term_list response
      if ('termId' in msg || false) {
        for (const fn of terminalListeners) fn(msg);
        return;
      }

      // Messages with a 'type' field starting with 'qq_bot_' are meta events
      // that may incidentally carry a sessionId (the bot's session ID),
      // but should be routed to meta listeners, not session listeners.
      const msgType: string | undefined = msg.type;
      if (msgType && msgType.startsWith('qq_bot_')) {
        for (const fn of metaListeners) fn(msg);
        return;
      }

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

    remoteHost(relayUrl?: string) {
      send({ cmd: 'remote_host', ...(relayUrl ? { url: relayUrl } : {}) });
    },

    remoteClient(url: string, roomId: string, joinToken: string, e2eSecret: string) {
      send({ cmd: 'remote_client', url, roomId, joinToken, e2eSecret });
    },

    remoteDisconnect() {
      send({ cmd: 'remote_disconnect' });
    },

    remoteStatus() {
      send({ cmd: 'remote_status' });
    },

    lanHost() {
      send({ cmd: 'lan_host' });
    },

    lanStop() {
      send({ cmd: 'lan_stop' });
    },

    lanStatus() {
      send({ cmd: 'lan_status' });
    },

    sendCommand(sessionId: string, command: CoreCommand) {
      send({ ...command, sessionId } as ServerCommand);
    },

    createTerminal(termId: string, cols?: number, rows?: number) {
      send({ cmd: 'term_create', termId, cols, rows });
    },

    sendTerminalInput(termId: string, data: string) {
      send({ cmd: 'term_input', termId, data });
    },

    resizeTerminal(termId: string, cols: number, rows: number) {
      send({ cmd: 'term_resize', termId, cols, rows });
    },

    destroyTerminal(termId: string) {
      send({ cmd: 'term_destroy', termId });
    },

    listTerminals() {
      send({ cmd: 'term_list' });
    },

    fileSearch(query: string, requestId: string, cwd?: string, limit?: number) {
      send({ cmd: 'file_search', query, requestId, ...(cwd ? { cwd } : {}), ...(limit ? { limit } : {}) });
    },

    requestOntologyGraph(egoName: string, personas: Array<{ name: string; role: string; color?: string }>, sessionId?: string) {
      send({ cmd: 'ontology_graph', egoName, personas, ...(sessionId ? { sessionId } : {}) });
    },

    ontologyUpdateNode(scopedId: string, fields: Record<string, any>, sessionId?: string) {
      send({ cmd: 'ontology_update_node', scopedId, fields, ...(sessionId ? { sessionId } : {}) });
    },
    ontologyUpdateEdge(scopedId: string, fields: Record<string, any>, sessionId?: string) {
      send({ cmd: 'ontology_update_edge', scopedId, fields, ...(sessionId ? { sessionId } : {}) });
    },
    ontologyUpdateNote(scopedId: string, fields: Record<string, any>, sessionId?: string) {
      send({ cmd: 'ontology_update_note', scopedId, fields, ...(sessionId ? { sessionId } : {}) });
    },
    ontologyDelete(scopedId: string, sessionId?: string) {
      send({ cmd: 'ontology_delete', scopedId, ...(sessionId ? { sessionId } : {}) });
    },
    ontologyAdd(dbName: string, entry: Record<string, any>, sessionId?: string) {
      send({ cmd: 'ontology_add', dbName, entry: entry as any, ...(sessionId ? { sessionId } : {}) });
    },
    ontologyImport(egoName: string, data: string, sessionId?: string) {
      send({ cmd: 'ontology_import', egoName, data, ...(sessionId ? { sessionId } : {}) });
    },
    ontologyExport(egoName: string, sessionId?: string) {
      send({ cmd: 'ontology_export', egoName, ...(sessionId ? { sessionId } : {}) });
    },

    listPrompts() {
      send({ cmd: 'prompts_list' });
    },

    readPrompt(filename: string) {
      send({ cmd: 'prompt_read', filename });
    },

    writePrompt(filename: string, content: string) {
      send({ cmd: 'prompt_write', filename, content });
    },

    deletePromptOverride(filename: string) {
      send({ cmd: 'prompt_delete_override', filename });
    },

    readPromptPreview(ego: any, roleName: string, customPrompt?: string, supervisorRules?: string, prependSystemToEgo?: boolean) {
      send({ cmd: 'prompt_preview', ego, roleName, customPrompt, supervisorRules, prependSystemToEgo });
    },

    switchMember(sessionId: string, personaName: string, roleName: string) {
      send({ cmd: 'switch_member', sessionId, personaName, roleName });
    },

    setMultiChatMode(sessionId: string, enabled: boolean, members: string[]) {
      send({ cmd: 'multi_chat_mode', sessionId, enabled, members });
    },

    // ── Scene Management ──
    requestSceneList() {
      send({ cmd: 'scene_list', id: `scene-list-${Date.now()}` });
    },
    requestSceneLoad(name: string) {
      send({ cmd: 'scene_load', id: `scene-load-${Date.now()}`, name });
    },
    requestSceneSave(name: string, description?: string, sessionId?: string) {
      send({ cmd: 'scene_save', id: `scene-save-${Date.now()}`, name, description, sessionId });
    },
    requestSceneCreate(name: string, description?: string) {
      send({ cmd: 'scene_create', id: `scene-create-${Date.now()}`, name, description });
    },
    requestSceneDelete(name: string) {
      send({ cmd: 'scene_delete', id: `scene-delete-${Date.now()}`, name });
    },
    requestSceneQuery() {
      send({ cmd: 'scene_query', id: `scene-query-${Date.now()}` });
    },
    sendSceneCommand(sessionId: string, sceneCmd: CoreCommand) {
      send({ ...sceneCmd, sessionId } as ServerCommand);
    },
    sendSessionCommand(sessionId: string, cmd: CoreCommand) {
      send({ ...cmd, sessionId } as ServerCommand);
    },

    // ── QQ Bot ──
    qqBotStart() {
      send({ cmd: 'qq_bot_start' });
    },
    qqBotStop() {
      send({ cmd: 'qq_bot_stop' });
    },
    qqBotStatus() {
      send({ cmd: 'qq_bot_status' });
    },
    qqBotUpdateConfig(config: Record<string, any>) {
      send({ cmd: 'qq_bot_update_config', config });
    },
    qqBotStickerList() {
      send({ cmd: 'qq_bot_sticker_list' });
    },
    qqBotStickerUpload(filename: string, data: string, description?: string) {
      send({ cmd: 'qq_bot_sticker_upload', filename, data, description: description || '' });
    },
    qqBotStickerUpdateMeta(id: number, description: string) {
      send({ cmd: 'qq_bot_sticker_update_meta', id, description });
    },
    qqBotStickerDelete(id: number) {
      send({ cmd: 'qq_bot_sticker_delete', id });
    },
    qqBotStickerScan() {
      send({ cmd: 'qq_bot_sticker_scan' });
    },
    qqBotStickerPreview(filename: string) {
      send({ cmd: 'qq_bot_sticker_preview', filename });
    },
    qqBotLastPrompt() {
      send({ cmd: 'qq_bot_last_prompt' });
    },
    qqBotSaveSession() {
      send({ cmd: 'qq_bot_save_session' });
    },
    qqBotResetSession() {
      send({ cmd: 'qq_bot_reset_session' });
    },

    todoList() {
      send({ cmd: 'todo_list' });
    },
    todoAdd(text: string) {
      send({ cmd: 'todo_add', text });
    },
    todoUpdate(id: string, updates: { text?: string; done?: boolean }) {
      send({ cmd: 'todo_update', id, ...updates });
    },
    todoDelete(id: string) {
      send({ cmd: 'todo_delete', id });
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

    onTerminalEvent(listener: TerminalEventListener) {
      terminalListeners.add(listener);
      return () => { terminalListeners.delete(listener); };
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
