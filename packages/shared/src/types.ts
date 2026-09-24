// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Type Definitions
// Single source of truth for all interfaces and type aliases.
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Tool System
// ---------------------------------------------------------------------------

// Host restart types
export type RestartProgressPhase =
  | 'preparing' | 'caller_saved' | 'shutting_down' | 'starting'
  | 'restoring' | 'completed' | 'failed' | 'cancelled';

export type RestartSessionProgressState = 'waiting' | 'restoring' | 'restored' | 'failed';

export interface RestartSessionProgress {
  id: string;
  name: string;
  state: RestartSessionProgressState;
  reason?: string;
}

export interface RestartProgressStatus {
  version: 1;
  requestId: string;
  phase: RestartProgressPhase;
  message: string;
  active: boolean;
  restored: number;
  total: number;
  sessions: RestartSessionProgress[];
  updatedAt: number;
  expiresAt: number;
  error?: string;
}

/** Result of the host restart coordinator's prepare/preflight request. */
export interface RestartPrepareResult {
  requestId: string;
  accepted: boolean;
  error?: string;
}

/** Injected callback used by restart_host; implemented by the Core↔Server bridge. */
export type RestartPrepareCallback = (reason?: string) => Promise<RestartPrepareResult>;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;   // JSON Schema
  /** This tool must always receive an explicit, one-shot human approval. */
  requiresHumanApproval?: boolean;
}

export type ToolExecutor = (args: Record<string, any>) => Promise<ToolResult>;

export interface ToolExecutorRegistry {
  register(name: string, executor: ToolExecutor): void;
  get(name: string): ToolExecutor | undefined;
  has(name: string): boolean;
  remove(name: string): void;
  names(): string[];
}

export interface ToolEntry {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

export function createToolExecutorRegistry(): ToolExecutorRegistry {
  const map = new Map<string, ToolExecutor>();
  return {
    register(name: string, executor: ToolExecutor): void {
      map.set(name, executor);
    },
    get(name: string): ToolExecutor | undefined {
      return map.get(name);
    },
    has(name: string): boolean {
      return map.has(name);
    },
    remove(name: string): void {
      map.delete(name);
    },
    names(): string[] {
      return [...map.keys()];
    },
  };
}

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
  raw: string;
}

export interface ApiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ImageAttachment {
  type: 'image';
  mimeType: string;       // 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  data: string;           // base64-encoded
  filename: string;
  width?: number;
  height?: number;
  sizeBytes: number;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  meta?: ToolResultMeta;  // TUI-only rendering data — never sent to LLM
  attachments?: ImageAttachment[];
  /**
   * If true, the event loop will terminate the current flow after this tool result.
   * Used by terminal tools like "pass" to force-end the conversation turn.
   * The tool result is still yielded to the LLM, but no further tool calls are processed.
   */
  terminateFlow?: boolean;
}

// ---------------------------------------------------------------------------
// Tool Result Metadata (TUI-only, never enters LLM context)
// ---------------------------------------------------------------------------

export interface DiffHunkLine {
  type: '+' | '-' | ' ';
  content: string;
  highlights?: Array<[number, number]>;  // word-level changed ranges [startIdx, endIdx)
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffHunkLine[];
}

export type ToolResultMeta =
  | { type: 'file_read'; filePath: string; fileContent: string; lineCount: number; startLine: number; endLine: number }
  | { type: 'file_write'; filePath: string; diff: DiffHunk[]; created: boolean; linesAdded: number; linesRemoved: number }
  | { type: 'file_edit'; filePath: string; diff: DiffHunk[]; linesAdded: number; linesRemoved: number }
  | { type: 'file_image'; filePath: string; mimeType: string; width?: number; height?: number; sizeBytes: number }
  | { type: 'file_document'; filePath: string; format: 'pdf' | 'docx' | 'xlsx'; pageCount?: number; lineCount: number; startLine: number; endLine: number }
  | { type: 'file_attachment'; filename: string; mimeType: string; sizeBytes: number; token: string; sourcePath?: string };

// ---------------------------------------------------------------------------
// Ask User Types
// ---------------------------------------------------------------------------

export interface AskUserOption {
  label: string;
  description: string;
  markdown?: string;
}

export interface AskUserQuestion {
  question: string;
  header: string;
  options: AskUserOption[];
  multiSelect?: boolean;
}

export interface AskUserAnswers {
  [header: string]: string | string[];
}

// ---------------------------------------------------------------------------
// Tool Policy Types
// ---------------------------------------------------------------------------

export interface ToolPermissionRule {
  pattern: string;     // glob-like: 'shell', 'read_*', '*'
  action: 'allow' | 'deny' | 'ask';
}

export type PermissionDecision = 'allow_once' | 'allow_always' | 'deny_once' | 'deny_always';

/** Full permission response — carries optional deny reason from user. */
export interface PermissionResponse {
  decision: PermissionDecision;
  denyReason?: string;
}

/** Rule for fine-grained bash command permission matching. */
export interface BashCommandRule {
  /** Glob-like pattern matched against the command string.
   *  Examples: "git *", "ls*", "cat *", "npm install*" */
  pattern: string;
  /** What to do when matched. */
  action: 'allow' | 'deny' | 'ask';
}

export interface ToolPolicyConfig {
  permissions: ToolPermissionRule[];
  bashCommandRules?: BashCommandRule[];
  defaultTimeout: number;            // ms, default 120000
  maxResultLength: number;           // chars, default 20000
  sandboxEnabled: boolean;
  parameterValidation: boolean;
}

// ---------------------------------------------------------------------------
// Canvas Block (§3.2)
// ---------------------------------------------------------------------------

export interface CanvasBlock {
  id: string;
  type: 'think' | 'tool_call' | 'tool_result' | 'pin' | 'text' | 'user_message' | 'conversation_summary';
  content: string;
  tokens: number;
  timestamp: number;
  pinned: boolean;
  folded: boolean;
  foldSummary?: string;
  foldable: boolean;
  /** Name of the persona that generated this block (for text/tool_call) */
  personaName?: string;
  // --- Phase 7: Nested hierarchy ---
  parentId?: string;          // undefined = root-level block
  depth?: number;             // 0 = root, max 3
  originalContent?: string;   // Preserved on fold for expand recovery (manual & drift)
  /** Why this block was folded. Used to enforce folding invariants:
   *  - 'drift': folded by context-drift compression. Permanent fold — originalContent
   *    is stripped on session save. Important content is extracted by Memory Agent.
   *  - 'manual': folded by user action. originalContent is preserved on session save
   *    so the block can be expanded after reload.
   *  - undefined: legacy block (pre-foldReason era) or never folded.
   *  Ego-switch folding is view-only (applied in prompt-builder, never persisted
   *  to state.canvas) and does NOT set foldReason. */
  foldReason?: 'drift' | 'manual';
  // --- API function calling ---
  toolCallId?: string;        // tool result ↔ tool_call association ID (for paired folding)
  evicted?: boolean;          // true = evicted by drift sliding window, skip in serialization
  pinZone?: 'top' | 'bottom'; // top = before conversation (default), bottom = after conversation
  // --- Tool result metadata (diff hunks, file read info) ---
  meta?: ToolResultMeta;      // Persisted for UI restore (diff views after /load or refresh)
  isError?: boolean;          // true = tool returned an error (preserved for LLM error detection)
  // --- Image persistence (vision support across turns) ---
  imageRefs?: string[];       // Absolute file paths to persisted images (user_message blocks only)
  // --- Public mode (never fold on persona switch) ---
  public?: boolean;           // true = visible to all personas, never folded on switch
  // --- Sideband marker (injected context, not real user input) ---
  /** @deprecated Use systemInjected instead. sideband was an old feature for
   *  cross-session message injection. It caused timing-order bugs in data
   *  collection and inconsistent rendering. New code MUST use systemInjected. */
  sideband?: boolean;         // true = sideband-injected message, excluded from datasets
  // --- System-injected marker (QQ, cron, link messages) for data collection role ---
  systemInjected?: boolean;   // true = system-injected message, saved as system role
  // --- Conversation summary metadata ---
  /** For conversation_summary blocks: stats about the folded conversation */
  conversationStats?: {
    personaName: string;      // Which persona this conversation was with
    userMessageCount: number;
    userLineCount: number;
    agentMessageCount: number;
    agentLineCount: number;
    hasToolCalls: boolean;
    blockIds: string[];       // Original block IDs that were folded (for restoration)
  };
}

export interface Canvas {
  blocks: CanvasBlock[];
}

export function createEmptyCanvas(): Canvas {
  return { blocks: [] };
}

// ---------------------------------------------------------------------------
// Canvas Browser Types (interactive TUI canvas inspector)
// ---------------------------------------------------------------------------

export interface CanvasBlockSummary {
  id: string;
  type: CanvasBlock['type'];
  tokens: number;
  pinned: boolean;
  folded: boolean;
  foldable: boolean;
  pinZone?: 'top' | 'bottom';
  parentId?: string;
  preview: string;        // first ~80 chars of content (or foldSummary if folded)
  hasOriginal: boolean;   // true if originalContent exists (can be unfolded)
  foldReason?: 'drift' | 'manual';  // why the block was folded (absent = legacy or view-only ego-switch)
  personaName?: string;
  public?: boolean;
  conversationStats?: CanvasBlock['conversationStats'];
}

export interface CanvasBrowserSnapshot {
  blocks: CanvasBlockSummary[];
  totalTokens: number;
  blockCount: number;
}

// ---------------------------------------------------------------------------
// Context Curator (Phase E)
// ---------------------------------------------------------------------------

export interface CuratorDecision {
  blockId: string;
  action: 'fold' | 'unfold' | 'keep';
  reason: string;
}

export interface CuratorConfig {
  enabled: boolean;
  /** Max tokens the curator child flow can use for its own canvas */
  curatorBudgetTokens: number;
  /** Max tool-call iterations for the curator sub-agent */
  curatorMaxIterations: number;
}

export function createDefaultCuratorConfig(
  overrides?: Partial<CuratorConfig>,
): CuratorConfig {
  return {
    enabled: true,
    curatorBudgetTokens: 8192,
    curatorMaxIterations: -1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Supervisor Configuration
// ---------------------------------------------------------------------------

export interface SupervisorConfig {
  /** Max tool-call iterations for the supervisor sub-agent (default 12). */
  supervisorMaxIterations: number;
  /** Token budget for the supervisor sub-agent canvas (default 8192). */
  supervisorBudgetTokens: number;
}

export function createDefaultSupervisorConfig(
  overrides?: Partial<SupervisorConfig>,
): SupervisorConfig {
  return {
    supervisorMaxIterations: 12,
    supervisorBudgetTokens: 8192,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Canvas Configuration (§3.2)
// ---------------------------------------------------------------------------

export interface CanvasConfig {
  maxCanvasTokens: number;          // 200000 (fits 256k context with room for system prompt + output)
  activeWindowSize: number;         // DEPRECATED: kept for curator overview display only. No longer used for mechanical folding.
  foldSummaryMaxTokens: number;     // 50
  tokensPerChar: number;            // 0.25
  foldStrategy: 'truncate' | 'summarize';
  maxPinnedTokens: number;          // 40000
  maxPinnedBlocks: number;          // 50
  driftThreshold: number;           // maxCanvasTokens * 0.9 — trigger point
  driftTarget: number;              // maxCanvasTokens * 0.5 — curator compression target
  curator: CuratorConfig;
}

export function createDefaultCanvasConfig(overrides?: Partial<CanvasConfig>): CanvasConfig {
  const maxCanvasTokens = overrides?.maxCanvasTokens ?? 200000;
  const defaults: CanvasConfig = {
    maxCanvasTokens,
    activeWindowSize: 10,
    foldSummaryMaxTokens: 50,
    tokensPerChar: 0.25,
    foldStrategy: 'truncate',
    maxPinnedTokens: 40000,
    maxPinnedBlocks: 50,
    driftThreshold: Math.floor(maxCanvasTokens * 0.9),
    driftTarget: Math.floor(maxCanvasTokens * 0.5),
    curator: createDefaultCuratorConfig(overrides?.curator),
  };
  return { ...defaults, ...overrides, maxCanvasTokens, curator: createDefaultCuratorConfig(overrides?.curator) };
}

// ---------------------------------------------------------------------------
// Task Item
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface TaskItem {
  id: string;
  subject: string;
  status: TaskStatus;
  description?: string;
  createdAt: number;
  updatedAt: number;
  blockedBy?: string[];              // IDs that must complete first
  blocks?: string[];                 // derived: IDs this item blocks
  owner?: string;                    // e.g. subagent taskName
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ephemeral Reminder
// ---------------------------------------------------------------------------

export interface EphemeralReminder {
  id: string;
  content: string;
  placement: 'tail';
  maxDistance: number;
  autoRemoveOn: 'acknowledged' | 'distance';
  source: 'runtime' | 'user' | 'loop_detection' | 'error_recovery';
  createdAtStep: number;
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Thinking / Reasoning Config
// ---------------------------------------------------------------------------

export const THINKING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingEffort = typeof THINKING_EFFORT_LEVELS[number];

export interface ThinkingConfig {
  /** Whether to enable thinking (pass thinking parameters in API request). Default false. */
  enabled?: boolean;
  /** Whether to echo reasoning content back to the model in multi-turn. Default false. */
  echo?: boolean;
  /**
   * Field name to use when echoing reasoning back (OpenAI-compatible only).
   * E.g. DeepSeek uses "reasoning_content", some providers use "reasoning_details".
   * Anthropic uses native thinking blocks — this field is ignored for providerType='anthropic'.
   * Default "reasoning_content".
   */
  echoField?: string;
  /** Whether to persist thinking content to canvas as think blocks. Default false. */
  persist?: boolean;
  /** Whether to inject DeepSeek stylized thought prompt at the beginning of system prompt. Default false. */
  deepseekStylized?: boolean;
  /**
   * Reasoning effort level for OpenAI o-series models (gpt-5, o3, o4-mini, etc.).
   * Valid values: "low", "medium", "high", "xhigh", "max". Default "medium".
   * Provider support varies; OpenAI-compatible requests pass the selected value through unchanged.
   * Ignored by DeepSeek and Anthropic.
   */
  effort?: ThinkingEffort;
}

// ---------------------------------------------------------------------------
// Provider Config (OpenAI-compatible API only)
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  extraInstructions?: string;
  fallbackModel?: string;
  providerType?: 'openai' | 'anthropic';
  thinking?: ThinkingConfig;
  /** OpenRouter provider slug for forced routing (e.g. "anthropic", "fireworks"). */
  specificProvider?: string;
}

export function createDefaultProviderConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Loop Detection (§3.4)
// ---------------------------------------------------------------------------

export interface LoopHistoryEntry {
  toolName: string;
  argsHash: string;
  resultHash?: string;
  timestamp: number;
  canvasOffset: number;
}

export interface LoopConfig {
  enabled: boolean;
  historySize: number;
  warningThreshold: number;
  criticalThreshold: number;
  globalCircuitBreakerThreshold: number;
}

export function createDefaultLoopConfig(overrides?: Partial<LoopConfig>): LoopConfig {
  return {
    enabled: true,
    historySize: 20,
    warningThreshold: 5,
    criticalThreshold: 10,
    globalCircuitBreakerThreshold: 15,
    ...overrides,
  };
}

export interface LoopState {
  history: LoopHistoryEntry[];
  config: LoopConfig;
}

export function createDefaultLoopState(overrides?: Partial<LoopState>): LoopState {
  return {
    history: [],
    config: createDefaultLoopConfig(overrides?.config),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

export interface PromptSection {
  id: string;
  content: string;
  priority: 'normal' | 'critical';
  repeatCount?: number;
}

export interface SystemPromptSection {
  name: string;
  content: string;
  /** When true, Anthropic cache_control breakpoint placed after this section. */
  cacheBreakpoint?: boolean;
}

// ---------------------------------------------------------------------------
// Prompt Options (§3.1)
// ---------------------------------------------------------------------------

export interface PromptOptions {
  env?: Record<string, string>;
  userInstructions?: string;
  userName?: string;
  skillCatalog?: Array<{ name: string; description: string; loaded: boolean }>;
  skillTotalCount?: number;
  loadedSkillNames?: string[];
  toolsetCatalog?: Array<{ name: string; description: string; isActive: boolean }>;
  toolsetTotalCount?: number;
  currentToolsetName?: string;
  personaCatalog?: Array<{ name: string; displayName: string; description: string; isActive: boolean }>;
  personaTotalCount?: number;
  currentPersonaName?: string;
  reminders?: EphemeralReminder[];
  /** Knowledge hints for cross-session recall (injected as <knowledge> section) */
  knowledgeHints?: KnowledgeHint[];
  /** @deprecated Legacy memory hints — use knowledgeHints instead */
  memoryHints?: MemoryHint[];
  /** Roles definition (keyed by role name). */
  roles?: Record<string, Role>;
  /** Active role assignments. */
  assignments?: RoleAssignment[];
  /** Active multi-chat members (persona-role keys). When present, multi-chat is active. */
  multiChatMembers?: string[];
  /** QQ Bot mode: inject QQ Bot prompt sections into system prompt. */
  qqBotMode?: boolean;
  /** QQ Bot ego name. */
  qqBotEgo?: string;
  /** QQ Bot max chat messages per scan cycle. Default: 5. */
  qqBotChatLimit?: number;
  /** QQ Bot: whether the model supports vision (affects sticker tool availability). */
  qqBotSupportsVision?: boolean;
  /** QQ Bot master's info (e.g. "主人 (QQ123456)"). Used in guidelines prompt. */
  qqBotMasterInfo?: string;
  /** QQ Bot's own identity (e.g. "琉璃 (QQ987654)"). Used in guidelines prompt. */
  qqBotMyInfo?: string;
  /** QQ Bot workspace directory path. Used in tool instructions prompt. */
  qqBotWorkSpace?: string;
  /** QQ Bot private members list (generated from privateIds + privateLabels). Used in guidelines prompt. */
  qqBotPrivateMembers?: string;
  /** QQ Bot monitored group list (generated from groupIds + groupLabels). Used in guidelines prompt. */
  qqBotGroupList?: string;
  /** Whether to prepend SYSTEM prompt before ego identity. Default: false. */
  prependSystemToEgo?: boolean;
  /** Whether to inject FOLDED canvas history into system prompt. Default: false.
   *  When false (default), only active (unfolded) blocks are injected — folded/compressed
   *  history is excluded to save context space. When true, all blocks including
   *  folded summaries are injected. The current session's active conversation
   *  is ALWAYS visible regardless of this setting.
   */
  injectCanvasHistory?: boolean;
  /** Whether to save curator (context curation agent) history data when drift occurs.
   *  When true, curator's system prompt, tool calls, and decisions are saved as
   *  alpha-format dataset for analysis. Default: false.
   */
  saveCuratorHistory?: boolean;
}

/** Core base roles that must always exist in a team. */
export const CORE_ROLES = ['planner', 'architect', 'developer', 'reviewer', 'overseer'] as const;
export type CoreRole = typeof CORE_ROLES[number];

// ---------------------------------------------------------------------------
// Runtime Configuration (§3.3)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Provider Request Controller Handle (opaque, avoids circular dep)
// ---------------------------------------------------------------------------

export interface ProviderRequestControllerHandle {
  createControlled(model: string, factory: (controllerSignal: AbortSignal, getRetrySignal: () => AbortSignal) => Promise<{ stream: AsyncGenerator<any>; abort: () => void }>): { stream: AsyncGenerator<any>; requestId: string };
  pause(requestId: string): boolean;
  resume(requestId: string): boolean;
  retry(requestId: string): boolean;
  abortRequest(requestId: string): boolean;
  getAll(): ProviderRequestInfo[];
  /** Update retry status fields on an active request (called by streamWithRetry during auto-retry). */
  updateRetryStatus(requestId: string, info: {
    status: 'waiting_retry' | 'retrying' | 'waiting_extended_retry';
    attempt: number;
    maxRetries: number;
    retryReason: RetryReason;
    retryDelayMs: number;
    error: string;
    extendedRetry?: boolean;
    extendedRetryCount?: number;
  }): void;
}

// ---------------------------------------------------------------------------
// Hook System Types
// ---------------------------------------------------------------------------

export type HookEvent = 'prompt_build' | 'before_tool' | 'after_tool';

export interface HookHandler<T = any> {
  name: string;
  priority?: number;          // lower = earlier, default 100
  handler: (ctx: T) => Promise<T | void>;
}

export interface HookRegistry {
  register<T>(event: HookEvent, handler: HookHandler<T>): void;
  unregister(event: HookEvent, handlerName: string): void;
  run<T>(event: HookEvent, ctx: T): Promise<T>;
}

// ---------------------------------------------------------------------------
// MCP Types
// ---------------------------------------------------------------------------

interface McpServerConfigBase {
  name: string;
  essentialTools?: string[];  // Tools rendered in system prompt; others are lazy-loaded via search_tools. Supports wildcards: "maps_*"
  excludeTools?: string[];    // Tools matching these patterns are completely hidden (not registered at all). Supports wildcards: "maps_direction_*"
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  type?: 'stdio';       // optional — inferred if command present
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerConfig extends McpServerConfigBase {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface McpSseServerConfig extends McpServerConfigBase {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSseServerConfig;

/** Infer transport type from config shape. */
export function getMcpTransportType(config: McpServerConfig): 'stdio' | 'http' | 'sse' {
  if (config.type === 'http') return 'http';
  if (config.type === 'sse') return 'sse';
  if ('command' in config && config.command) return 'stdio';
  if ('url' in config && (config as any).url) return 'http';
  return 'stdio';
}

/** Convert Claude Code-compatible dict format to array format. */
export function normalizeMcpServers(
  dict: Record<string, Omit<McpServerConfig, 'name'>>,
): McpServerConfig[] {
  return Object.entries(dict).map(([name, config]) => ({
    ...config,
    name,
  } as McpServerConfig));
}

export interface McpToolMeta {
  serverName: string;
  originalName: string;
}

// ---------------------------------------------------------------------------
// Session Management Types
// ---------------------------------------------------------------------------

export interface SessionManifest {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  checkpointCount: number;
  description?: string;
  /** Name of the scene active when this session was saved. */
  sceneName?: string;
}

export interface SessionCheckpointEntry {
  id: string;
  step: number;
  timestamp: number;
  description?: string;
  filename: string;  // "state-003.json"
}

// ---------------------------------------------------------------------------
// Session Export Format (portable JSON)
// ---------------------------------------------------------------------------

export interface SessionExportData {
  /** Format version for future compatibility. */
  version: 1;
  /** Export timestamp. */
  exportedAt: number;
  /** Session metadata. */
  session: {
    name: string;
    model: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
  };
  /** The agent state snapshot (latest checkpoint). */
  state: AgentState;
}

// ---------------------------------------------------------------------------
// Checkpoint Types
// ---------------------------------------------------------------------------

export interface Checkpoint {
  id: string;
  timestamp: number;
  state: AgentState;
  step: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Replay / Recording Types
// ---------------------------------------------------------------------------

export interface RecordedEvent {
  timestamp: number;
  event: StreamEvent;
}

export interface FlowRecording {
  id: string;
  startTime: number;
  events: RecordedEvent[];
  finalState?: AgentState;
}

// ---------------------------------------------------------------------------
// Diagnostics Types
// ---------------------------------------------------------------------------

export interface TokenBudgetSnapshot {
  pinnedTokens: number;
  foldedTokens: number;
  activeTokens: number;
  reminderTokens: number;
  /** Total tokens — prefers realPromptTokens (from API) when available, falls back to estimation. */
  totalTokens: number;
  budgetTokens: number;
  utilizationPercent: number;
  /** Whole-prompt token count from provider API (authoritative source). */
  realPromptTokens?: number;
  /** Source of totalTokens: 'provider' = from API usage, 'estimated' = local text estimation. */
  source?: 'provider' | 'estimated';
  /** Total conversation footprint across all drifts (SSG feature). */
  cumulativeTokens?: number;
}

export interface DiagnosticsReport {
  modelName: string;
  totalToolCalls: number;
  averageResponseTokens: number;
  canvasDriftCount: number;
  toolCallDistribution: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Provider Request Control (user-visible request lifecycle)
// ---------------------------------------------------------------------------

export type ProviderRequestStatus =
  | 'connecting'              // fetch initiated, waiting for response headers
  | 'streaming'               // SSE body streaming in progress
  | 'paused'                  // user paused — stream buffered, agent sees slow network
  | 'completed'               // finished successfully
  | 'retrying'                // user-initiated or auto retry in progress
  | 'waiting_retry'           // auto-retry delay countdown (streamWithRetry backoff)
  | 'waiting_extended_retry'  // extended retry: long interval (10min+), infinite, user-cancellable
  | 'failed';                 // terminal failure

export type RetryReason = 'rate_limit' | 'client_error' | 'server_error' | 'network_error' | 'context_overflow' | 'timeout' | 'unknown';

export interface ProviderRequestInfo {
  requestId: string;
  status: ProviderRequestStatus;
  model: string;
  startedAt: number;           // Date.now()
  elapsedMs: number;
  attempt: number;             // 1-based
  error?: string;              // last error message if failed/retrying
  promptTokens?: number;       // from usage event if available
  completionTokens?: number;
  // --- Auto-retry fields (populated during streamWithRetry backoff) ---
  retryReason?: RetryReason;   // classified error type that triggered retry
  retryDelayMs?: number;       // total delay for this retry wait
  retryStartedAt?: number;     // timestamp when the delay countdown started
  maxRetries?: number;         // total max attempts (e.g. 3), Infinity for extended retry
  extendedRetry?: boolean;     // true when in extended (long-interval, infinite) retry mode
  extendedRetryCount?: number; // how many extended retry attempts have been made
}

// ---------------------------------------------------------------------------
// Sub-flow tag — attached to events from supervisor/curator sub-agents
// ---------------------------------------------------------------------------

export interface SubflowTag {
  kind: 'supervisor' | 'curator' | 'memory';
  label: string;
}

// ---------------------------------------------------------------------------
// Streaming Events
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cron Entry Wire Format (shared between core, server, and webui)
// ---------------------------------------------------------------------------

export interface CronEntryWire {
  id: string;
  creatorSession: string;
  target?: string;
  tag?: string;
  description?: string;
  message: string;
  nextRun: number;
  repeatMs?: number;
  createdAt: number;
  frozen?: boolean;
}

export type StreamEvent =
  | { type: 'text'; value: string; _subflow?: SubflowTag }
  | { type: 'thinking'; value: string; _subflow?: SubflowTag }
  | { type: 'tool_call'; call: ToolCall; _subflow?: SubflowTag }
  | { type: 'tool_result'; result: ToolResult; call: ToolCall; _subflow?: SubflowTag }
  | { type: 'tool_call_progress'; index: number; name?: string; argumentsPartial?: string; _subflow?: SubflowTag }
  | { type: 'done'; _subflow?: SubflowTag }
  | { type: 'error'; error: Error; _subflow?: SubflowTag }
  | { type: 'canvas_drift'; before: number; after: number; _subflow?: SubflowTag }
  | { type: 'reminder_injected'; reminder: EphemeralReminder; _subflow?: SubflowTag }
  | { type: 'loop_warning'; detector: string; count: number; _subflow?: SubflowTag }
  | { type: 'token_budget'; snapshot: TokenBudgetSnapshot; _subflow?: SubflowTag }
  | { type: 'checkpoint_created'; checkpoint: Checkpoint; _subflow?: SubflowTag }
  | { type: 'diagnostics_update'; report: DiagnosticsReport; _subflow?: SubflowTag }
  | { type: 'sideband_injected'; message: string; _subflow?: SubflowTag }
  | { type: 'sideband_consumed'; message: string; _subflow?: SubflowTag }
  | { type: 'permission_request'; requestId: string; toolName: string;
      args: Record<string, any>; argsPreview: string;
      requiresHumanApproval?: boolean;
      /** Preview metadata for file write/edit operations (diff preview before approval) */
      previewMeta?: ToolResultMeta;
      _subflow?: SubflowTag }
  | { type: 'ask_user_request'; requestId: string; questions: AskUserQuestion[]; _subflow?: SubflowTag }
  | { type: 'permission_resolved'; requestId: string; _subflow?: SubflowTag }
  | { type: 'ask_user_resolved'; requestId: string; _subflow?: SubflowTag }
  | { type: 'restart_prepare'; requestId: string; reason?: string; _subflow?: SubflowTag }
  | { type: 'restart_caller_committed'; requestId: string; sessionId: string; _subflow?: SubflowTag }
  | { type: 'restart_cancelled'; requestId: string; reason: string; _subflow?: SubflowTag }
  | { type: 'subagent_spawned'; taskId: string; prompt: string; _subflow?: SubflowTag }
  | { type: 'subagent_complete'; taskId: string; result: string; error?: string;
      tokenUsage?: { promptTokens: number; completionTokens: number }; _subflow?: SubflowTag }
  | { type: 'subagent_consumed'; taskId: string; _subflow?: SubflowTag }
  | { type: 'subagent_status'; taskId: string; verb: string;
      toolName?: string; tokenUsage?: { promptTokens: number; completionTokens: number };
      _subflow?: SubflowTag }
  | { type: 'curator_run'; decisions: CuratorDecision[]; foldCount: number; unfoldCount: number; fellBackToDrift: boolean; _subflow?: SubflowTag }
  | { type: 'curator_done'; decisions: CuratorDecision[]; foldCount: number; unfoldCount: number; fellBackToDrift: boolean }
  | { type: 'provider_usage'; promptTokens: number; completionTokens: number;
      cachedTokens?: number; cost?: number; _subflow?: SubflowTag }
  | { type: 'task_snapshot'; tasks: TaskItem[]; _subflow?: SubflowTag }
  // === Provider Request Control ===
  | { type: 'provider_request_start'; request: ProviderRequestInfo; _subflow?: SubflowTag }
  | { type: 'provider_request_update'; request: ProviderRequestInfo; _subflow?: SubflowTag }
  | { type: 'provider_request_end'; requestId: string; status: 'completed' | 'failed'; error?: string; _subflow?: SubflowTag }
  // === Supervisor Mode ===
  | { type: 'supervisor_state'; active: boolean; rules?: string; _subflow?: SubflowTag }
  | { type: 'supervisor_decision'; requestType: 'permission' | 'ask_user';
      decision: 'approve' | 'deny' | 'escalate'; reason?: string; _subflow?: SubflowTag }
  // === Scene Management ===
  | { type: 'scene_state'; scenes: Array<{ name: string; description?: string; isActive: boolean }>; activeScene?: string; _subflow?: SubflowTag }
  | { type: 'scene_loaded'; scene: Scene; _subflow?: SubflowTag }
  | { type: 'scene_saved'; name: string; _subflow?: SubflowTag }
  | { type: 'scene_deleted'; name: string; _subflow?: SubflowTag }
  // === Dataset Export ===
  | { type: 'dataset_saved'; name: string; path: string; egoCount: number; _subflow?: SubflowTag }
  | { type: 'dataset_overwrite_request'; requestId: string; name: string; path: string; _subflow?: SubflowTag }
  // === Config Updated ===
  | { type: 'config_updated'; _subflow?: SubflowTag }
  // === Retry Status (mid-stream extended retry) ===
  | { type: 'retry_status'; attempt: number; maxRetries: number;
      status: 'waiting_retry' | 'retrying' | 'waiting_extended_retry';
      retryReason: RetryReason; retryDelayMs: number; error: string;
      extendedRetry?: boolean; extendedRetryCount?: number; _subflow?: SubflowTag }
  // === Internal (not forwarded to UI) ===
  | { type: 'cron_snapshot'; entries: CronEntryWire[] }
  | { type: 'cron_run_status'; active: boolean; description?: string }
  | { type: 'permission_batch_hint';
      items: Array<{ toolName: string; args: Record<string, any>; argsPreview: string }>; _subflow?: SubflowTag };

// ---------------------------------------------------------------------------
// Agent Event Loop Events (§11.1)
// ---------------------------------------------------------------------------

export type AgentEvent =
  // === User interaction ===
  | { type: 'user_query'; id: string; prompt: string; images?: ImageAttachment[]; regenerate?: boolean }
  | { type: 'sideband'; message: string }
  | { type: 'link_inject'; from: string; mode: string; message: string; saveDataDir?: string }
  | { type: 'pin_request'; content: string }
  // === Permission (Phase C placeholder) ===
  | { type: 'permission_response'; requestId: string;
      decision: PermissionDecision; denyReason?: string }
  // === Ask User ===
  | { type: 'ask_user_response'; requestId: string; answers: AskUserAnswers }
  // === Subagent (Phase D) ===
  | { type: 'subagent_complete'; taskId: string; result: string; error?: string }
  // === Control ===
  | { type: 'abort'; flowId?: string }
  | { type: 'shutdown' }
  // === Timer ===
  | { type: 'timer'; name: string; payload?: unknown }
  // === Session ===
  | { type: 'session_save'; name?: string; description?: string }
  | { type: 'session_load'; sessionId: string; checkpointId?: string }
  | { type: 'session_rollback'; checkpointId: string }
  | { type: 'session_list' }
  | { type: 'session_delete'; sessionId: string }
  | { type: 'session_export'; sessionIdOrName: string; outputPath?: string }
  | { type: 'session_import'; filePath: string }
  | { type: 'session_rename'; sessionId: string; newName: string }
  // === Context Curator ===
  | { type: 'compact'; message?: string }
  | { type: 'call_curator'; message?: string }
  // === Task Query ===
  | { type: 'task_query' }
  // === Dump ===
  | { type: 'dump' }
  // === Clear (reset canvas) ===
  | { type: 'clear' }
  // === Clear Permissions ===
  | { type: 'clear_permissions' }
  // === Canvas Browser ===
  | { type: 'canvas_browse' }
  | { type: 'canvas_op'; op: 'fold' | 'unfold' | 'delete'; blockId: string }
  | { type: 'canvas_inspect'; blockId: string }
  | { type: 'canvas_edit'; blockId: string; content: string }
  // === Toolset/Skill Management ===
  | { type: 'switch_toolset'; name: string }
  | { type: 'load_skill'; name: string }
  | { type: 'unload_skill'; name: string }
  | { type: 'query_toolset_skill' }
  // === Tool Permission Overlay ===
  | { type: 'tool_allow'; pattern: string }
  | { type: 'tool_deny'; pattern: string }
  | { type: 'query_tool_permissions' }
  // === Persona Management ===
  | { type: 'switch_persona'; name: string }
  | { type: 'save_persona'; name: string; displayName?: string; description?: string }
  | { type: 'delete_persona'; name: string }
  | { type: 'query_persona' }
  | { type: 'reset_persona' }
  // === Supervisor Mode ===
  | { type: 'supervisor_set'; rules: string }
  | { type: 'supervisor_clear' }
  // === Permission Mode ===
  | { type: 'set_permission_mode'; mode: 'manual' | 'auto' | 'supervisor' }
  // === Provider Request Control ===
  | { type: 'provider_request_pause'; requestId: string }
  | { type: 'provider_request_resume'; requestId: string }
  | { type: 'provider_request_retry'; requestId: string }
  | { type: 'provider_request_abort'; requestId: string }
  | { type: 'provider_request_query' }
  // === Dynamic Provider Switch ===
  | { type: 'switch_provider'; profile?: string; model?: string; baseURL?: string; apiKey?: string }
  | { type: 'query_provider' }
  // === Scene Management ===
  | { type: 'scene_list' }
  | { type: 'scene_load'; name: string }
  | { type: 'scene_save'; scene?: Partial<Scene> }
  | { type: 'scene_create'; name: string; description?: string }
  | { type: 'scene_delete'; name: string }
  | { type: 'scene_query' }
  // === Member Switch (persona + role) ===
  | { type: 'switch_member'; personaName: string; roleName: string }
  // === Multi-chat Mode ===
  | { type: 'multi_chat_mode'; enabled: boolean; members?: string[] }
  // === Memory System ===
  | { type: 'memory_refresh'; hint?: string }
  | { type: 'memory_consolidate'; hint?: string }
  // === Skill Import ===
  | { type: 'import_skill'; sourcePath: string }
  // === History Preview (for WebUI HistoryView) ===
  | { type: 'history_preview'; personaName?: string }
  // === Public Mode Toggle ===
  | { type: 'toggle_public_mode' }
  | { type: 'permission_mode_changed'; mode: 'manual' | 'auto' | 'supervisor' }
  // === Cron Management ===
  | { type: 'cron_query' }
  | { type: 'cron_snapshot'; entries: CronEntryWire[] }
  | { type: 'cron_add'; entry: Omit<CronEntryWire, 'id' | 'createdAt' | 'nextRun'> }
  | { type: 'cron_update'; id: string; updates: Partial<CronEntryWire> }
  | { type: 'cron_delete'; id: string }
  | { type: 'cron_freeze'; id: string }
  | { type: 'cron_unfreeze'; id: string }
  | { type: 'cron_set_data_collection'; enabled: boolean; path?: string }
  | { type: 'cron_run_status'; active: boolean; description?: string }
  // === Config Hot-Reload ===
  | { type: 'reload_config'; scope?: 'global' | 'project' | 'all' }
  // === Dataset Export ===
  | { type: 'save_dataset'; name?: string }
  | { type: 'save_dataset_customized'; name?: string }
  | { type: 'dataset_overwrite_response'; requestId: string; decision: 'overwrite' | 'cancel' }
  | { type: 'dataset_customize_response'; requestId: string; selectedSections?: string[] };

// ---------------------------------------------------------------------------
// Core Agent State
// ---------------------------------------------------------------------------

export interface AgentState {
  systemPrompt: string;
  userMessage: string;
  canvas: Canvas;
  artifacts: Record<string, any>;
  toolDefinitions: ToolDefinition[];
  canvasConfig: CanvasConfig;
  reminders: EphemeralReminder[];
  loopState: LoopState;
  provider: ProviderConfig;
  metadata: Record<string, any>;
  maxIterations: number;
  tasks: TaskItem[];
  toolsetName?: string;
  /** Token count of the current system prompt (identity + protocol sections + workspace context, etc).
   *  Updated after each system prompt rebuild. Used by shouldDrift() to calculate total context size. */
  systemPromptTokens?: number;
  /** Real prompt token count from the last provider API response.
   *  Used as the authoritative totalTokens in token budget calculations
   *  instead of character-based estimation. Updated after each LLM call.
   *  Cleared after drift to force re-estimation until next API call. */
  lastRealPromptTokens?: number;
  /** Prompt token count at the start of the current conversation segment
   *  (after the last drift). Used to calculate incremental tokens for
   *  cumulative display. Set after each drift completes. */
  beginWithPromptTokens?: number;
  /** Cumulative prompt tokens across all drifts in this session.
   *  Incremented by (lastRealPromptTokens - beginWithPromptTokens) before each drift.
   *  Used for "nk总计" display to show total conversation footprint. */
  cumulativePromptTokens?: number;
  /** When true, forces drift to trigger at the start of the next turn
   *  regardless of token count. Cleared after drift executes. Used by /compact. */
  forceDrift?: boolean;
  /** Optional hint from the user when manually triggering /compact.
   *  Passed to the curator sub-agent as a high-priority curation directive. */
  curatorHint?: string;
  /** When true, runFlow exits immediately after drift (no LLM call).
   *  Used by /compact to prevent the agent from treating the command as a prompt. */
  compactOnly?: boolean;

  // ── Supervisor mode ─────────────────────────────────────────────────
  /** When set, supervisor mode is active. Contains the user-provided rules
   *  that the supervisor LLM uses to auto-judge permission/ask_user requests. */
  supervisorRules?: string;

  // ── Permission mode ──────────────────────────────────────────────────
  /** How to handle 'ask'-level tool permission requests.
   *  'manual' = prompt user (default), 'auto' = auto-approve, 'supervisor' = AI review.
   *  Only affects tools whose policy action is 'ask'; 'allow' and 'deny' are unchanged. */
  permissionMode?: 'manual' | 'auto' | 'supervisor';

  // ── Public mode ────────────────────────────────────────────────────
  /** When true, all new canvas blocks are created with `public: true`,
   *  making them visible to ALL personas (never folded on persona switch).
   *  This is the "meeting mode" toggle — everyone sees everything. */
  publicMode?: boolean;

  // ── Persona state ──────────────────────────────────────────────────
  /** Current active persona name. Always has a value (default: 'default'). */
  personaName: string;
  /** Current active role name (e.g. "architect", "reviewer"). Undefined means pure ego mode. */
  activeRoleName?: string;
  /** Overlay modifications on top of the base persona. */
  personaModifications?: PersonaModifications;

  // ── Profile persistence ─────────────────────────────────────────
  /** The profile name that was in effect when this session was last saved.
   *  Used to restore the correct profile label on session load.
   *  This is set by both user-initiated profile switches and persona-based profile resolution. */
  currentProfileName?: string;
  /** How the current profile was chosen: 'user' = manual selection, 'persona' = persona-specified,
   *  'default' = global default. Preserved across session save/load so that
   *  applyPersonaProfile can respect user's manual choice after restore. */
  currentProfileSource?: 'user' | 'persona' | 'default';

  // ── Cron data collection ──────────────────────────────────────────
  /** When true, this runFlow was triggered by a cron injection.
   *  Set by the event-loop when a cron message is delivered via sideband. */
  isCronRun?: boolean;
  /** Description of the cron entry that triggered this run (for data file naming). */
  cronDescription?: string;

  // ── Multi-chat mode ─────────────────────────────────────────────
  /** When true, multi-chat mode is active: multiple personas rotate automatically. */
  multiChatMode?: boolean;
  /** List of selected member keys (e.g. "Liuli-architect", "Jinxi") for multi-chat rotation. */
  multiChatMembers?: string[];
  /** Counter: how many consecutive turns since the owner last spoke (in multi-chat mode). */
  multiChatOwnerAbsentTurns?: number;
  /** Counter: total consecutive non-owner turns in the current multi-chat session. */
  multiChatTotalTurns?: number;

  // ── Loaded Skills ────────────────────────────────────────────────
  /** Names of currently loaded prompt skills. Rendered into the system prompt. */
  loadedSkills?: string[];
  /** Directory where skills are discovered (default: <cwd>/.vesper-lite/skills). */
  skillDir?: string;
}

export function createDefaultAgentState(overrides?: Partial<AgentState>): AgentState {
  return {
    systemPrompt: '',
    userMessage: '',
    canvas: createEmptyCanvas(),
    artifacts: {},
    toolDefinitions: [],
    canvasConfig: createDefaultCanvasConfig(overrides?.canvasConfig),
    reminders: [],
    loopState: createDefaultLoopState(overrides?.loopState),
    provider: createDefaultProviderConfig(overrides?.provider),
    maxIterations: -1,
    metadata: {},
    tasks: [],
    personaName: 'default',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Combinator Type
// ---------------------------------------------------------------------------

export type AgentFn<S extends AgentState = AgentState> =
  (state: S) => AsyncGenerator<StreamEvent, S>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class LoopCircuitBreakerError extends Error {
  public readonly detector: string;
  public readonly count: number;

  constructor(detector: string, count: number, message: string) {
    super(message);
    this.name = 'LoopCircuitBreakerError';
    this.detector = detector;
    this.count = count;
  }
}

// ---------------------------------------------------------------------------
// Global Config File Types
// ---------------------------------------------------------------------------

export interface VesperProfileConfig {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  proxy?: string;
  maxIterations?: number;
  /** @deprecated Use maxCanvasTokens instead. Kept for backward compat. */
  maxTokens?: number;
  /** Context capacity (max canvas tokens) for this profile. Overrides the global default. */
  maxCanvasTokens?: number;
  providerType?: 'openai' | 'anthropic';
  thinking?: ThinkingConfig;
  /** Maximum concurrent subagent tasks for this profile (default: 2). */
  maxConcurrentSubagents?: number;
  /** Whether the model supports image/vision input (default: true). */
  supportsVision?: boolean;
  /** Whether the model supports audio input (default: true). */
  supportsAudio?: boolean;
  supportsGif?: boolean;
  /**
   * OpenRouter provider routing — specify the provider slug to force-route to
   * (e.g. "anthropic", "deepinfra", "fireworks").
   * Sent as `provider: { order: [value], allow_fallbacks: false }` in the request body.
   * Only effective when using OpenRouter as the base URL.
   */
  specificProvider?: string;
  /** Whether to inject system-originated messages (sidebands, reminders) as user role
   *  instead of system role in the LLM message array. Default: true.
   *  When true (default), sideband messages are sent as `role: user` — compatible with
   *  all models but technically misrepresents the source. When false, sideband messages
   *  are sent as `role: system` — more semantically correct but only works with models
   *  that support mid-conversation system messages (e.g. OpenAI Chat Completions).
   *  Data collection (alpha format) always records these as `role: system` regardless.
   */
  injectAsUser?: boolean;
}

export interface VesperConfig {
  defaultProfile?: string;
  profiles?: Record<string, VesperProfileConfig>;
  user_name?: string;
  dataset_dir?: string;
  /** Alias for dataset_dir (camelCase, used by ConfigPanel). Resolved with snake_case taking priority. */
  datasetDir?: string;
  /** Auto-save dataset when session closes. */
  autoSaveOnClose?: boolean;
  /** Auto-save dataset every N turns (0 or undefined = disabled). */
  autoSavePerTurns?: boolean;
  /** Number of turns between auto-saves (default: 5). */
  autoSaveTurnInterval?: number;
  /** Directory for auto-saved datasets (falls back to dataset_dir, then ~/.vesper/data_collection). */
  autoSaveDir?: string;
  proxy?: string;
  maxIterations?: number;
  maxTokens?: number;
  providerType?: 'openai' | 'anthropic';
  mcp?: McpServerConfig[];                                     // legacy array format
  mcpServers?: Record<string, Omit<McpServerConfig, 'name'>>;  // CC-compatible dict format
  prompts?: string;
  toolsets?: Record<string, Omit<Toolset, 'name'>>;
  defaultToolset?: string;
  /** Roles definition (keyed by role name). */
  roles?: Record<string, Role>;
  /** Active role assignments. */
  assignments?: RoleAssignment[];
  /** Maximum concurrent subagents (default: 8). */
  maxConcurrentSubagents?: number;
  /** Context Curator config overrides. */
  curator?: Partial<CuratorConfig>;
  /** Supervisor sub-agent config overrides. */
  supervisor?: Partial<SupervisorConfig>;
  /** Subagent ego assignments — maps built-in subagents to personas for ego prompt injection. */
  subagentAssignments?: SubagentAssignment[];
  /** MCP tool definition cache settings. */
  mcpCache?: {
    /** Disable caching entirely (fall back to blocking init). */
    disabled?: boolean;
    /** Max age in ms before a cache entry is considered stale (default: 24h). */
    maxAge?: number;
  };
  /** Additional directories to scan for skill .md files. */
  skillPaths?: string[];
  /** Default persona to use on startup. */
  defaultPersona?: string;
  /** User-defined personas (name → partial Persona without 'name' and 'source'). */
  personas?: Record<string, Omit<Persona, 'name' | 'source'>>;
  /** Saved scenes (self-contained configurations). */
  scenes?: Record<string, Omit<Scene, 'name'>>;
  /** Currently active scene name. */
  activeScene?: string;
  /** LSP servers keyed by name (merged: global + project, project wins). */
  lspServers?: Record<string, LspServerConfig>;
  /** Whether the model supports vision/image input. Default: true. */
  supportsVision?: boolean;
  /** Whether the model supports audio input. Default: true. */
  supportsAudio?: boolean;
  supportsGif?: boolean;
  /** Global thinking/reasoning config defaults. */
  thinking?: ThinkingConfig;
  /** Default supervisor rules loaded when `/supervise` is invoked without arguments. */
  defaultSupervisorRules?: string;
  /** Cross-session link configuration. */
  link?: {
    /** Vesper Server WebSocket URL for link tools. Default: ws://localhost:18767/ws */
    serverUrl?: string;
  };
  /** Whether to prepend the SYSTEM prompt before ego identity. Default: false. */
  prependSystemToEgo?: boolean;
  /** Whether to inject FOLDED canvas history into system prompt. Default: false.
   *  When false (default), only active (unfolded) blocks are injected — folded/compressed
   *  history is excluded to save context space. When true, all blocks including
   *  folded summaries are injected. The current session's active conversation
   *  is ALWAYS visible regardless of this setting.
   */
  injectCanvasHistory?: boolean;
  /** Whether to save curator history data. Default: false. */
  saveCuratorHistory?: boolean;
  /** Interval for time refresh injection. Agent sees current time prepended to messages. Default: '1h'. */
  timeRefreshInterval?: string;
  /** Cron data collection settings (persisted in project config). */
  cronDataCollection?: {
    enabled: boolean;
    path?: string;
  };
  /** QQBot integration settings (persisted in project config). */
  qqbot?: {
    /** Persona ego to use for QQBot responses. */
    ego?: string;
    /** Whether QQBot integration is enabled. */
    enabled?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Scene System
// ---------------------------------------------------------------------------

/** A provider profile within a scene. */
export interface SceneProfile {
  name: string;
  model: string;
  baseURL: string;
  apiKey?: string;
  proxy?: string;
  maxIterations?: number;
  maxTokens?: number;
  providerType?: 'openai' | 'anthropic';
  thinking?: ThinkingConfig;
  specificProvider?: string;
  maxConcurrentSubagents?: number;
  supportsVision?: boolean;
  supportsAudio?: boolean;
  supportsGif?: boolean;
  /** Whether to inject system-originated messages as user role instead of system role. */
  injectAsUser?: boolean;
}

/** A persona entry within a scene — includes the full ego prompt. */
export interface ScenePersona {
  name: string;
  displayName: string;
  description: string;
  ego: string;
  toolset: string;
  skills: string[];
  allowTools?: string[];
  denyTools?: string[];
  level?: number;
  /** Maps to a profile name within this scene. */
  profile?: string;
  /** Optional model override for this persona. */
  model?: string;
  /** Optional provider override for this persona. */
  provider?: Partial<ProviderConfig>;
  /** Private workspace configuration for this persona. */
  privateWorkspace?: {
    path: string;
    maxSizeMB: number;
  };
  /** Whether to save model thinking chains to dataset. */
  saveThinkingToDataset?: boolean;
  /** 'user' = user-defined ego persona, 'builtin' = built-in role persona. */
  source?: 'user' | 'builtin';
}

/** Cron entry snapshot for scene persistence. */
export interface SceneCronEntry {
  target?: string;
  tag?: string;
  description?: string;
  message: string;
  repeatMs?: number;
  frozen?: boolean;
}

/** Scene — a self-contained: Personas/Egos + Team Roles + Model Profiles + Assignments + Cron */
export interface Scene {
  name: string;
  description?: string;
  /** Provider profiles (config schemes). */
  profiles: SceneProfile[];
  /** Which profile is the default. */
  defaultProfile: string;
  /** Default supervisor rules. */
  defaultSupervisorRules?: string;
  /** Persona definitions with ego prompts. */
  personas: ScenePersona[];
  /** Role definitions. */
  roles: Record<string, Role>;
  /** Active role assignments. */
  assignments: RoleAssignment[];
  /** Subagent ego assignments (curator, memory_agent, supervisor). */
  subagentAssignments?: SubagentAssignment[];
  /** Cron scheduled tasks (snapshotted for scene). */
  cronEntries?: SceneCronEntry[];
  /** Whether to prepend the SYSTEM prompt before ego identity. Default: false. */
  prependSystemToEgo?: boolean;
  /** Whether to inject FOLDED canvas history into system prompt. Default: false.
   *  See PromptOptions.injectCanvasHistory for full documentation.
   */
  injectCanvasHistory?: boolean;
  /** Whether to save curator history data. Default: false. */
  saveCuratorHistory?: boolean;
  /** When created/modified. */
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// LSP Server Config
// ---------------------------------------------------------------------------

export interface LspServerConfig {
  /** File extensions this server handles (e.g. ["ts", "tsx", "js"]). */
  extensions: string[];
  /** Spawn command + args (e.g. ["npx", "--", "typescript-language-server", "--stdio"]). */
  command: string[];
  /** Workspace root directory for this server. Defaults to cwd. */
  rootDir?: string;
  /** Auto-restart interval in minutes (0 = disabled). */
  restartInterval?: number;
  /** LSP initialization options passed to the server. */
  initializationOptions?: unknown;
}

// ---------------------------------------------------------------------------
// Subagent Types
// ---------------------------------------------------------------------------

export type SubagentStatus = 'running' | 'completed' | 'failed' | 'aborted';

export interface SubagentTask {
  name: string;
  prompt: string;
  status: SubagentStatus;
  result?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

/** Interface for SubagentManager handle used in RuntimeConfig (avoids circular dep) */
/** Unified result shape returned by both wait() and peek(). */
export interface SubagentResult {
  status: SubagentStatus;
  result?: string;
  error?: string;
  __subagentError?: boolean;
}

export interface SubagentManagerHandle {
  spawn(taskId: string, prompt: string, personaName?: string): { taskId: string; status: SubagentStatus };
  wait(taskId: string): Promise<SubagentResult>;
  peek(taskId: string, options?: { block?: boolean; timeout?: number }): SubagentResult | Promise<SubagentResult>;
  abort(taskId: string): { success: boolean };
  list(): SubagentTask[];
  drainPendingResults(): Array<{ taskId: string; result: string; error?: string }>;
  abortAll(): void;
}

// ---------------------------------------------------------------------------
// Link Client Handle (opaque interface, avoids circular dep)
// ---------------------------------------------------------------------------

/** Interface for WsLinkClient used in RuntimeConfig (avoids circular dep). */
export interface LinkClientHandle {
  /** Whether the WS connection is active. */
  readonly connected: boolean;
  /** Connect to the Vesper Server WebSocket. */
  connect(): Promise<void>;
  /** Explicitly disconnect and disable auto-reconnect (lets the process exit). */
  disconnect?(): void;
  /** Execute a link operation (peek/wait/post). Returns formatted result string. */
  execute(op: { __linkOp: string; [key: string]: any }, saveDataDir?: string): Promise<string>;
  /** Execute a cron operation (schedule/list/cancel/update/freeze/unfreeze). Uses the link client's session name. */
  executeCron?(op: { __cronOp: string; [key: string]: any }): string;
  /** Get all cron entries from the scheduler. */
  getCronEntries?(): CronEntryWire[];
  /** Directly add a cron entry to the scheduler. Returns the entry. */
  addCronEntry?(entry: { delay: string; message: string; repeat?: string; target?: string; tag?: string; description?: string; creatorSession: string; creatorSessionId?: string }): CronEntryWire | null;
  /** Directly update a cron entry. Returns success boolean. */
  updateCronEntry?(id: string, updates: Partial<CronEntryWire>): boolean;
  /** Delete a cron entry by id. Returns success boolean. */
  deleteCronEntry?(id: string): boolean;
  /** Set frozen state of a cron entry. Returns success boolean. */
  setFrozenCronEntry?(id: string, frozen: boolean): boolean;
}

// ---------------------------------------------------------------------------
// Skill System Types
// ---------------------------------------------------------------------------

export interface SkillEntry {
  name: string;
  description: string;
  /** Optional Chinese description for UI display (WebUI). Falls back to `description` if absent. */
  descriptionZh?: string;
  promptContent: string;
  filePath: string;
  /** Assets directory — same-name sibling directory of the .md file (e.g. `coding/` for `coding.md`). */
  assetsDir?: string;
  /** Environment variable that must exist for this skill to load. If absent, load() silently skips. */
  requires?: string;
}

export interface SkillManagerHandle {
  listAvailable(): Array<{ name: string; description: string; loaded: boolean }>;
  load(name: string): { success: boolean; error?: string };
  unload(name: string): { success: boolean; error?: string };
  getLoadedPrompts(): Record<string, string>;
  getCatalog(maxEntries?: number): Array<{ name: string; description: string; loaded: boolean }>;
  findSkills(keyword: string): Array<{ name: string; description: string; loaded: boolean }>;
  readonly totalCount: number;
}

// ---------------------------------------------------------------------------
// Toolset Types (formerly "Tool Profile")
// ---------------------------------------------------------------------------

export interface Toolset {
  name: string;
  description: string;
  allowedTools: string[];            // glob patterns, allowlist model
  deniedTools?: string[];            // explicit deny (highest priority)
  requireApproval?: string[];        // tools requiring user confirmation → 'ask'
  bashCommandRules?: BashCommandRule[];  // per-command permission rules for bash
  canvasConfig?: Partial<CanvasConfig>; // per-profile override
}

// ---------------------------------------------------------------------------
// Persona Types
// ---------------------------------------------------------------------------

export interface Persona {
  /** Internal identifier */
  name: string;                      // 'reviewer', 'architect', 'quick-fix'
  /** Human-readable display name */
  displayName: string;               // '代码审查员', '架构师', '快速修复'
  /** Detailed description */
  description: string;
  /** Static role card / self-identity prompt */
  ego?: string;
  /** Optional hash of the ego prompt, used for memory partitioning. */
  egoHash?: string;
  /** Source */
  source: 'builtin' | 'user';
  /** Creation time (user personas only) */
  createdAt?: number;
  /** Which persona this was derived from (user personas only) */
  derivedFrom?: string;

  // ── Core composition ───────────────────────────────────────────────
  /** Referenced Toolset name (permission base) */
  toolset: string;                   // 'minimal', 'coding', 'full', or custom
  /** Extra allowed tools on top of toolset (supports wildcards) */
  allowTools?: string[];             // ['mcp__browser-tools__*']
  /** Extra denied tools on top of toolset (supports wildcards) */
  denyTools?: string[];              // ['bash']
  /** Auto-loaded Skill list */
  skills: string[];                  // ['coding', 'typescript', 'concise']
  /** Permission level (higher = more powerful). Agent auto-switch to higher level requires user approval. */
  level?: number;                    // 1=read-only, 2=coding, 3=full
  /** Optional model override for this persona */
  model?: string;
  /** Optional provider override for this persona */
  provider?: Partial<ProviderConfig>;
  /** Optional profile reference for this persona */
  profile?: string;
  /** Private workspace configuration for this persona */
  privateWorkspace?: {
    /** Directory path for the private workspace */
    path: string;
    /** Maximum allowed space in MB */
    maxSizeMB: number;
  };
  /** Whether to save model thinking chains to dataset. Default false. */
  saveThinkingToDataset?: boolean;
}

// ---------------------------------------------------------------------------
// Role & Assignment Types
// ---------------------------------------------------------------------------

/** A role definition, linking a name to a toolset and default description. */
export interface Role {
  name: string;          // e.g., 'architect'
  displayName: string;   // e.g., '架构师'
  description: string;   // e.g., 'Responsible for system design...'
  toolset: string;       // The toolset bound to this role
  level?: number;        // Permission level (optional)
}

/** An assignment of a specific Persona to a Role. */
export interface RoleAssignment {
  roleName: string;      // Must match a Role.name
  personaName: string;   // Must match a Persona.name
  isActive: boolean;     // Whether this role is currently active in the team
  customDescription?: string; // User-written context: "She is the eldest..."
  customPrompt?: string;      // Role-specific system instructions
}

/** Built-in subagent names that can have ego assignments. */
export const BUILTIN_SUBAGENT_NAMES = ['curator', 'memory_agent', 'supervisor'] as const;
export type BuiltinSubagentName = typeof BUILTIN_SUBAGENT_NAMES[number];

export interface SubagentAssignment {
  subagentName: string;    // 'curator' | 'memory_agent' | 'supervisor'
  personaName?: string;    // Assigned persona name; empty/undefined = no ego injection
}

export interface PersonaModifications {
  addedSkills: string[];
  removedSkills: string[];
  addedTools: string[];
  removedTools: string[];
}

export function createEmptyPersonaModifications(): PersonaModifications {
  return { addedSkills: [], removedSkills: [], addedTools: [], removedTools: [] };
}

export function isPersonaModified(mods?: PersonaModifications): boolean {
  if (!mods) return false;
  return mods.addedSkills.length > 0
    || mods.removedSkills.length > 0
    || mods.addedTools.length > 0
    || mods.removedTools.length > 0;
}

export interface PersonaManagerHandle {
  getPersona(name: string): Persona | undefined;
  listAvailable(): Array<{ name: string; displayName: string; description: string; source: string; isActive: boolean }>;
  switchPersona(name: string): { success: boolean; error?: string; newState?: AgentState };
  getCurrentPersona(): Persona | undefined;
  getPersonaState(): { personaName: string; modifications?: PersonaModifications };
  saveAsPersona(name: string, displayName: string, description: string): { success: boolean; error?: string; persona?: Persona };
  deletePersona(name: string): { success: boolean; error?: string };
  findPersonas(keyword: string): Array<{ name: string; displayName: string; description: string; source: string; isActive: boolean }>;
  resetModifications(): void;
  getCatalog(maxEntries?: number): Array<{ name: string; displayName: string; description: string; isActive: boolean }>;
  readonly totalCount: number;
}

// ---------------------------------------------------------------------------
// Ontology System Types — Three Primitives: Node, Edge, Note
// ---------------------------------------------------------------------------

/** Node — an entity in the world (person, project, pet, place, concept…) */
export interface OntologyNode {
  /** Short id, e.g. "n_a3f1b2" */
  id: string;
  /** Flexible type: person, project, pet, place, concept, tool, org, thing… */
  type: string;
  /** Primary name */
  name: string;
  /** Alternative names for disambiguation, e.g. ["小薄荷", "mint"] */
  aliases: string[];
  /** Open property bag (schema-less JSON) */
  props: Record<string, any>;
  /** One-line summary for prompt injection */
  summary: string;
  createdAt: number;
  updatedAt: number;
  accessedAt: number;
  accessCount: number;
}

/** Edge — a directed relationship between two Nodes */
export interface OntologyEdge {
  /** Short id, e.g. "e_7c2d4e" */
  id: string;
  /** Source node id */
  src: string;
  /** Destination node id */
  dst: string;
  /** Relationship type: keeps, works_on, knows, prefers… */
  type: string;
  /** Open property bag for relationship attributes */
  props: Record<string, any>;
  /** One-line summary */
  summary: string;
  /** Strength/confidence 0.0–1.0 */
  weight: number;
  /** Valid-from timestamp (null = unknown) */
  validFrom: number | null;
  /** Valid-to timestamp (null = still active) */
  validTo: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Note kind */
export type NoteKind = 'episode' | 'lesson' | 'decision' | 'observation';

/** Note — a narrative fragment (event, lesson, decision, observation) */
export interface OntologyNote {
  /** Short id, e.g. "t_f9e1a0" */
  id: string;
  /** Narrative kind */
  kind: NoteKind;
  /** Original narrative text */
  content: string;
  /** One-line summary (= prompt hint) */
  summary: string;
  /** Retrieval tags */
  tags: string[];
  /** Optional anchor to a node */
  anchorNode: string | null;
  /** Optional anchor to an edge */
  anchorEdge: string | null;
  /** Source session name */
  sessionName: string;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
}

/** Unified hint for prompt injection (replaces MemoryHint) */
export interface KnowledgeHint {
  id: string;
  category: 'node' | 'edge' | 'note';
  summary: string;
}

/**
 * Opaque handle to the ontology store.
 * Declared in @vesper/shared so RuntimeConfig can reference it without
 * depending on @vesper/core's concrete implementation.
 */
export interface OntologyStoreHandle {
  // ── Node CRUD ──
  saveNode(entry: { type: string; name: string; aliases?: string[]; props?: Record<string, any>; summary?: string }): OntologyNode;
  updateNode(id: string, fields: Partial<Pick<OntologyNode, 'type' | 'name' | 'aliases' | 'props' | 'summary'>>): OntologyNode | null;
  deleteNode(id: string): boolean;
  getNode(id: string): OntologyNode | null;
  searchNodes(opts: { query?: string; type?: string; limit?: number }): OntologyNode[];
  mergeNodes(keepId: string, mergeId: string): OntologyNode | null;

  // ── Edge CRUD ──
  saveEdge(entry: { src: string; dst: string; type: string; props?: Record<string, any>; summary?: string; weight?: number; validFrom?: number; validTo?: number }): OntologyEdge;
  updateEdge(id: string, fields: Partial<Pick<OntologyEdge, 'props' | 'summary' | 'weight' | 'validFrom' | 'validTo'>>): OntologyEdge | null;
  deleteEdge(id: string): boolean;
  getEdges(nodeId: string, opts?: { direction?: 'out' | 'in' | 'both'; type?: string }): OntologyEdge[];

  // ── Note CRUD ──
  saveNote(entry: { kind: NoteKind; content: string; summary?: string; tags?: string[]; anchorNode?: string; anchorEdge?: string; sessionName?: string }): OntologyNote;
  updateNote(id: string, fields: Partial<Pick<OntologyNote, 'content' | 'summary' | 'tags' | 'kind' | 'anchorNode' | 'anchorEdge'>>): OntologyNote | null;
  deleteNote(id: string): boolean;
  getNotesForNode(nodeId: string, limit?: number): OntologyNote[];
  getPendingNotes(limit?: number): OntologyNote[];

  // ── Unified operations ──
  inspect(id: string): (OntologyNode | OntologyEdge | OntologyNote) | null;
  search(query: string, opts?: { category?: 'node' | 'edge' | 'note'; limit?: number }): KnowledgeHint[];
  getKnowledgeHints(maxCount?: number): KnowledgeHint[];
  getNeighbors(nodeId: string, depth?: number, edgeType?: string): { nodes: OntologyNode[]; edges: OntologyEdge[] };

  // ── Stats & Lifecycle ──
  count(): { nodes: number; edges: number; notes: number };
  close(): void;
}

// ---------------------------------------------------------------------------
// Runtime Internals — EventLoop→Runtime 依赖注入契约
// ---------------------------------------------------------------------------

/**
 * Internal handles injected into {@link RuntimeConfig} by the event loop and
 * core-server so that runtime.ts can reach session-scoped infrastructure
 * without importing the concrete classes (avoids circular deps).
 *
 * Grouped under `internals` to keep the flat config surface clean — new
 * injected dependencies go here, not as loose `_xxx` fields.
 */
export interface RuntimeInternals {
  /** Session-level permission memory (allow/deny). Managed by EventLoop, persisted to .vesper/permissions.json. */
  permissionMemory?: Map<string, 'allow' | 'deny'>;
  /** Base delay (ms) for empty response retries. Default 1000. Tests can set to 0. */
  emptyRetryBaseMs?: number;
  /** Base delay (ms) for HTTP error retries (429/500/network). Default 1000. Tests can set to 0. */
  httpRetryBaseMs?: number;
  /** Interval (ms) between extended retry attempts. Default 30000 (30s). */
  extendedRetryIntervalMs?: number;
  /** PathGuard interface for path-level permission checks (opaque to avoid circular dep). */
  pathGuard?: { isAllowed(path: string, mode: 'read' | 'write'): boolean };
  /** Subagent manager, injected by EventLoop. */
  subagentManager?: SubagentManagerHandle;
  /** Link client for cross-session coordination, injected by EventLoop. */
  linkClient?: LinkClientHandle;
  /** Cron scheduler for timed tasks, injected by EventLoop. Always available. */
  cronScheduler?: { execute(op: any, sessionName: string, sessionId?: string): string; getEntries(): any[] };
  /** Session post handler for local cross-session messaging, injected by core-server. */
  sessionPostHandler?: (op: any) => Promise<string>;
  /** Get the current active save directory for correlated data collection. Injected by EventLoop. */
  getActiveSaveDir?: () => string | null;
  /** Skill manager, injected by EventLoop. */
  skillManager?: SkillManagerHandle;
  /** Persona manager, injected by EventLoop. */
  personaManager?: PersonaManagerHandle;
  /** Provider request controller handle (injected by EventLoop). */
  requestController?: ProviderRequestControllerHandle;
  /** Ontology store handle (injected by EventLoop). Used by runtime.ts drift + consolidation agent. */
  ontologyStore?: OntologyStoreHandle;
  /** Ego-partitioned ontology stores for multi-persona memory routing. Key = egoLabel. */
  egoStores?: Map<string, any>;
  /** Get or create an ego store by label. Used by Memory Agent for ego-routed memory writes. */
  getEgoStore?: (egoLabel: string) => any;
  /** @deprecated Legacy memory store handle — use ontologyStore instead */
  memoryStore?: MemoryStoreHandle;
  /** Current session name (for memory snapshot creation). */
  sessionName?: string;
  /** Current session ID (e.g. "s30") for stable cron entry binding across renames. */
  sessionId?: string;
  /** Cookie store instance for fetch tool cookie injection. Injected by core-server. */
  cookieStore?: any; // CookieStore — typed as any to avoid circular dep
  /** Host restart preflight callback. Missing means restart_host is unavailable. */
  prepareRestart?: RestartPrepareCallback;
  /** Run-local notification when an accepted restart tool result is observed. */
  onRestartPrepared?: (requestId: string) => void;
  /** Run-local notification after accepted restart call/result is fully recorded. */
  onRestartFlowReady?: (requestId: string) => void;
  /** Internal fault injection hook for restart commit barrier tests. */
  restartFaultInjector?: (stage: 'after_result_yield' | 'after_round_push' | 'before_flush') => void;
}

// ---------------------------------------------------------------------------
// Runtime Configuration (§3.3)
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
  maxIterations: number;
  canvas: CanvasConfig;
  provider: ProviderConfig;
  model: string;
  executors: ToolExecutorRegistry;
  maxOutputTokens?: number;
  fallbackModel?: string;
  foldOnSubstitution?: boolean;
  interrupt?: {
    checkSideband(): string | null;
    /** Drain link messages injected by an external Link Broker (via synthetic tool call). */
    checkLinkMessages?(): Array<{ from: string; mode: string; message: string }>;
    waitForPermission?(requestId: string): Promise<PermissionResponse>;
    waitForAskUser?(requestId: string): Promise<AskUserAnswers>;
    /**
     * Check if the LLM provider was dynamically switched mid-flow.
     * Returns the new model + provider config if changed, or null if unchanged.
     * Called at the top of each inner-loop iteration in runFlow so the next
     * LLM request uses the updated provider.
     */
    checkProviderUpdate?(): { model: string; provider: ProviderConfig; proxy?: string } | null;
    /**
     * Read the latest supervisor rules from event-loop state.
     * Runtime calls this instead of reading currentState.supervisorRules so
     * mid-flow /supervise and /unsupervise take effect immediately.
     */
    getSupervisorRules?(): string | undefined;
  };
  signal?: AbortSignal;
  policyConfig?: ToolPolicyConfig;
  /**
   * Internal dependencies injected by EventLoop / core-server.
   * Grouped to keep the flat config surface clean — see {@link RuntimeInternals}.
   */
  internals?: RuntimeInternals;
  /** Supervisor sub-agent config (defaults applied if omitted). */
  supervisor?: SupervisorConfig;
  /** Maximum concurrent subagents (default: 8). */
  maxConcurrentSubagents?: number;
  promptOptions?: PromptOptions;
  hooks?: HookRegistry;
  enableDiagnostics?: boolean;
  enableCheckpoints?: boolean;
  enableRecording?: boolean;
  mcpServers?: McpServerConfig[];
  proxy?: string;
  /** Enable verbose debug logging to stderr. */
  debug?: boolean;
  /** Whether the model supports vision/image input. Default: true. */
  supportsVision?: boolean;
  /** Whether the model supports audio input. Default: true. */
  supportsAudio?: boolean;
  /** Whether the model supports GIF image input. Default: false.
   *  GIFs are large and most vision models don't handle them well.
   *  When false, GIFs are represented as [GIF动图] text instead of base64. */
  supportsGif?: boolean;
  /** Original unfiltered tool entries (before policy pipeline). Used for profile switch rebuild. */
  originalToolEntries?: ToolEntry[];
  /** When true, all new canvas blocks are created with `public: true`.
   *  This is the runtime mirror of AgentState.publicMode — the EventLoop
   *  syncs it whenever the toggle changes. */
  publicMode?: boolean;
  /** Directory for cron data collection output. When set + isCronRun, events are
   *  collected during runFlow and written to JSONL on completion. */
  cronDataDir?: string;
  /** Whether to inject sideband/system-originated messages as user role (default: true). */
  injectAsUser?: boolean;
  /** Directory for dataset output (manual /save_dataset). Falls back to autoSaveDir, then ~/.vesper/datasets. */
  dataset_dir?: string;
  /** Directory for auto-saved datasets (on close, curator, etc.). Falls back to dataset_dir, then ~/.vesper/data_collection_auto_save. */
  autoSaveDir?: string;
  /** Cookie store instance for fetch tool cookie injection. Injected by core-server. */
  _cookieStore?: any; // CookieStore — typed as any to avoid circular dep
  /** Subagent ego assignments from config — used by runtime to inject ego into subagents. */
  subagentAssignments?: SubagentAssignment[];
  /** Whether to save curator history data when drift occurs. Default: false. */
  saveCuratorHistory?: boolean;
  /** Host restart preflight callback. Missing means restart_host is unavailable. */
  _prepareRestart?: RestartPrepareCallback;
  /** Run-local notification when an accepted restart tool result is observed. */
  _onRestartPrepared?: (requestId: string) => void;
  /** Run-local notification after accepted restart call/result is fully recorded. */
  _onRestartFlowReady?: (requestId: string) => void;
  /** Internal fault injection hook for restart commit barrier tests. */
  _restartFaultInjector?: (stage: 'after_result_yield' | 'after_round_push' | 'before_flush') => void;
}

// ---------------------------------------------------------------------------
// Legacy Memory Types (deprecated — kept for migration compatibility)
// ---------------------------------------------------------------------------

/** @deprecated Use OntologyNote instead */
export interface MemoryEntry {
  id: string;
  kind: 'semantic' | 'episodic';
  subject: string;
  predicate: string;
  object: string;
  hint: string;
  source: {
    snapshotId: string;
    timestamp: number;
    context?: string;
  };
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessedAt: number;
  accessCount: number;
}

/** @deprecated Snapshots replaced by note.sessionName */
export interface MemorySnapshot {
  id: string;
  sessionName: string;
  createdAt: number;
  canvasSummary: string;
}

/** @deprecated Use KnowledgeHint instead */
export interface MemoryHint {
  id: string;
  kind: 'semantic' | 'episodic';
  hint: string;
}

/** @deprecated Use OntologyStoreHandle instead */
export interface MemoryStoreHandle {
  createSnapshot(sessionName: string, canvasSummary: string): MemorySnapshot;
  getAllHints(maxCount?: number): MemoryHint[];
  count(): number;
  save(entry: {
    kind: 'semantic' | 'episodic';
    subject: string; predicate: string; object: string;
    hint: string; tags: string[];
    context?: string; snapshotId: string;
  }): MemoryEntry;
  update(id: string, fields: {
    subject?: string; predicate?: string; object?: string;
    hint?: string; tags?: string[]; context?: string;
  }): MemoryEntry | null;
  delete(id: string): boolean;
  inspect(id: string): (MemoryEntry & { snapshot?: MemorySnapshot }) | null;
  search(opts: {
    query?: string; kind?: 'semantic' | 'episodic';
    tag?: string; limit?: number;
  }): MemoryEntry[];
  close(): void;
}

// Backward-compatible type aliases
export type LuxConfig = VesperConfig;
export type LuxProfileConfig = VesperProfileConfig;
