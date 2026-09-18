// ═══════════════════════════════════════════════════════════════════════════
// Vesper Lite — Server ↔ WebUI WebSocket Protocol
// Stripped to the open-source subset: session management, canvas, config.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  SessionManifest,
  TaskItem,
  ProviderRequestInfo,
  TokenBudgetSnapshot,
  DiagnosticsReport,
  AskUserQuestion,
  CanvasBrowserSnapshot,
  CanvasBlock,
  ToolResultMeta,
} from './types.js';
import type { CoreCommand, WireEvent } from './protocol.js';

// ---------------------------------------------------------------------------
// Server-local commands (handled inside server.ts handleWsMessage)
// ---------------------------------------------------------------------------

export type ServerLocalCommand =
  // ── Session lifecycle (server-side session manager) ──
  | { cmd: 'session_create'; sessionId: string; name?: string; config?: Record<string, any> }
  | { cmd: 'session_destroy'; sessionId: string }
  | { cmd: 'session_list_active' }
  | { cmd: 'session_restore'; sessionId: string }
  | { cmd: 'session_rename'; sessionId: string; name: string; newName?: string; activeSessionId?: string; id?: string }
  | { cmd: 'session_list'; activeSessionId?: string; id?: string; sessionId?: string }
  | { cmd: 'session_delete'; sessionId: string; activeSessionId?: string; id?: string }
  // ── Config / profiles ──
  | { cmd: 'get_config'; sessionId?: string }
  | { cmd: 'read_config_file'; scope?: 'global' | 'project'; mergeGlobals?: boolean }
  | { cmd: 'write_config_file'; content: string; scope?: 'global' | 'project' }
  | { cmd: 'list_profiles' }
  | { cmd: 'get_toolsets' }
  | { cmd: 'get_skills' }
  // ── Misc server services ──
  | { cmd: 'file_search'; query: string; requestId: string; cwd?: string; limit?: number }
  // ── Prompts management ──
  | { cmd: 'prompts_list' }
  | { cmd: 'prompt_read'; filename: string }
  | { cmd: 'prompt_write'; filename: string; content: string }
  | { cmd: 'prompt_delete_override'; filename: string };

// ---------------------------------------------------------------------------
// Core-passthrough commands (WebUI → Server default case → core stdin)
// ---------------------------------------------------------------------------

type CollidingCmds =
  | 'session_rename' | 'session_list' | 'session_delete';

export type CorePassthroughCommand =
  Exclude<CoreCommand, { cmd: CollidingCmds }> & { sessionId: string };

// ---------------------------------------------------------------------------
// ServerCommand — everything the WS endpoint can receive
// ---------------------------------------------------------------------------

export type ServerCommand = ServerLocalCommand | CorePassthroughCommand;

// ---------------------------------------------------------------------------
// Server → WebUI events
// ---------------------------------------------------------------------------

/** Session-scoped event: a WireEvent payload re-broadcast with sessionId. */
export type ServerSessionEvent = WireEvent & { sessionId: string };

export type ServerEvent =
  // ── Connection / lifecycle meta ──
  | { type: 'service_ready' }
  | { type: 'restart_progress'; status: any }
  | { type: 'restart_session_restored'; sessionId: string; requestId: string }
  | { type: 'restart_cancelled'; sessionId: string; requestId: string; reason: string }
  | { type: 'host_restart_shutdown_requested'; requestId: string; exitCode: number }
  // ── Session management results ──
  | { type: 'session_created'; sessionId: string; success: boolean; error?: string }
  | { type: 'session_destroyed'; sessionId: string }
  | { type: 'session_list'; sessions: any[] }
  | { type: 'session_state'; sessionId: string; state: any; name?: string }
  | { type: 'session_renamed'; sessionId: string; name: string }
  | { type: 'session_rename_failed'; sessionId: string; error?: string }
  // ── Config / profiles ──
  | { type: 'effective_config'; config: Record<string, any> | null }
  | { type: 'config_file_content'; content: string | null; path?: string; scope: string; error?: string }
  | { type: 'config_file_saved'; success: boolean; error?: string; scope: string }
  | { type: 'profile_list'; profiles: any[]; defaultProfile?: string }
  | { type: 'toolsets_info'; toolsets: any[]; infrastructureTools: string[]; curatorTools: string[] }
  | { type: 'skills_info'; skills: Array<{ name: string; description: string; requires?: string }> }
  // ── File search ──
  | { type: 'file_search_result'; requestId: string; results: any[]; cwd: string }
  // ── Prompts ──
  | { type: 'prompts_list'; prompts?: any[]; manifest?: any; error?: string }
  | { type: 'prompt_content'; filename: string; content?: string; overridden?: boolean; error?: string }
  | { type: 'prompt_saved'; filename: string; success: boolean; overridden?: boolean; error?: string }
  | { type: 'prompt_override_deleted'; filename: string; success: boolean; error?: string }
  // ── Web-specific session-scoped events ──
  | { type: 'stderr'; sessionId?: string; data?: string }
  | { type: 'process_exited'; sessionId?: string; code?: number | null }
  | { type: 'permission_mode_changed'; sessionId?: string; mode?: 'manual' | 'auto' }
  // ── Fallback for session events covered by ServerSessionEvent ──
  | ServerSessionEvent;
