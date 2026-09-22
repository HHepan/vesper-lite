// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Toolset Registry & Conversion (formerly "Tool Profile")
// ═══════════════════════════════════════════════════════════════════════════

import { readFile } from 'node:fs/promises';
import type {
  Toolset,
  ToolPermissionRule,
  ToolPolicyConfig,
  VesperConfig,
} from '@vesper/shared';
import { createDefaultPolicyConfig, DEFAULT_BASH_COMMAND_RULES } from './policy.js';

// ---------------------------------------------------------------------------
// Infrastructure tools — always allowed unless explicitly denied
// ---------------------------------------------------------------------------

const INFRASTRUCTURE_TOOLS = [
  'task_create', 'task_update', 'task_list', 'task_get', 'task_delete',
  'substitution', 'list_personas', 'current_persona', 'save_persona', 'find_personas',
  'link_discover', 'link_peek', 'link_wait', 'link_post',
  'cron_schedule', 'cron_list', 'cron_cancel', 'cron_update', 'cron_freeze', 'cron_unfreeze',
  'session_list', 'session_peek', 'session_post',
  'remember', 'recall', 'inspect', 'graph',
  'ask_user',
  'fetch',
  'web_search',
  // Device tools (Android only — registered when VESPER_DEVICE_SOCKET is present)
  'device_location_get', 'device_location_address',
  'device_sms_send', 'device_sms_list', 'device_sms_search',
  'device_phone_dial', 'device_phone_call', 'device_phone_log',
  'device_calendar_list', 'device_calendar_create', 'device_calendar_delete',
  'device_alarm_set',
  'device_app_launch', 'device_app_list',
  'device_battery_status',
  'device_notification_list', 'device_notification_push', 'device_notification_dismiss',
  'device_contacts_search', 'device_contacts_list',
  // UIA tools (Phase 2 — AccessibilityService)
  // UIA tools temporarily disabled — kept in code for future use
  // 'device_uia_inspect', 'device_uia_tap', 'device_uia_long_press', 'device_uia_input',
  // 'device_uia_swipe', 'device_uia_back', 'device_uia_home', 'device_uia_screenshot',
  // Browser tools (registered when CDP is available — Windows Chrome or Android WebView)
  'browser_open', 'browser_snapshot', 'browser_click', 'browser_fill',
  'browser_type', 'browser_press', 'browser_scroll', 'browser_screenshot',
  'browser_eval', 'browser_back', 'browser_forward', 'browser_close',
  // File delivery
  'send_file',
  // Cookie management
  'cookie_list', 'cookie_add', 'cookie_activate', 'cookie_freeze', 'cookie_delete', 'cookie_export',
  // TODO (read-only for AI)
  'peek_master_todo',
];

// Export for external use (e.g., WebUI toolset viewer)
export { INFRASTRUCTURE_TOOLS };

// ---------------------------------------------------------------------------
// Builtin Toolsets
// ---------------------------------------------------------------------------

const BUILTIN_TOOLSETS: Toolset[] = [
  {
    name: 'minimal',
    description: 'Read-only exploration — only file reading and search',
    allowedTools: ['read', 'glob', 'grep', 'mcp__*'],
    requireApproval: ['mcp__*'],
  },
  {
    name: 'read_only',
    description: 'Deep exploration with shell access (git log, etc.)',
    allowedTools: ['read', 'glob', 'grep', 'bash', 'script', 'lsp_find_*', 'lsp_get_*', 'lsp_prepare_*', 'mcp__*'],
    requireApproval: ['bash', 'script', 'mcp__*'],
    deniedTools: ['lsp_rename_*', 'lsp_restart_*'],
  },
  {
    name: 'coding',
    description: 'Standard development — file read/write/edit + shell with approval',
    allowedTools: ['read', 'write*', 'edit', 'glob', 'grep', 'bash', 'script', 'lsp_*', 'mcp__*'],
    requireApproval: ['bash', 'script', 'lsp_rename_*', 'mcp__*'],
  },
  {
    name: 'guarded',
    description: 'All tools available, but bash, SSH, and MCP require approval',
    allowedTools: ['*'],
    requireApproval: ['bash', 'script', 'ssh_*', 'mcp__*'],
  },
  {
    name: 'full',
    description: 'Unrestricted — all tools allowed without approval',
    allowedTools: ['*'],
  },
  {
    name: 'qqbot',
    description: 'QQ Bot — chat tools + restricted file ops + fetch + memory',
    allowedTools: [
      // QQ Bot specific tools
      'chat', 'pass', 'list_sticker', 'peek_sticker', 'tts',
      // File operations (read-only + limited write)
      'read', 'glob', 'grep', 'fetch',
      // Memory tools
      'memory_save', 'memory_search', 'memory_retrieval', 'memory_update',
      // Skill management
      'list_skills', 'load_skill', 'unload_skill', 'find_skills',
      // Time awareness
      'get_current_time',
    ],
  },
];

// ---------------------------------------------------------------------------
// Registry (module-level Map)
// ---------------------------------------------------------------------------

const registry = new Map<string, Toolset>();

export function getToolset(name: string): Toolset | undefined {
  return registry.get(name);
}

export function listAllToolsets(): Toolset[] {
  return [...registry.values()];
}

export function registerToolset(toolset: Toolset): void {
  registry.set(toolset.name, toolset);
}

/**
 * Load toolsets from a VesperConfig object.
 * Later calls override earlier toolsets with the same name.
 */
export function loadToolsets(config: VesperConfig): void {
  if (!config.toolsets) return;
  for (const [name, partial] of Object.entries(config.toolsets)) {
    registry.set(name, { name, ...partial } as Toolset);
  }
}

/**
 * Register the 4 builtin toolsets as fallback defaults.
 * Should be called first — user/project configs override these.
 */
export function initBuiltinToolsets(): void {
  for (const toolset of BUILTIN_TOOLSETS) {
    // Only set if not already registered (later loads take priority)
    if (!registry.has(toolset.name)) {
      registry.set(toolset.name, toolset);
    }
  }
}

/**
 * Load toolsets from a standalone JSON file (e.g. .vesper-lite/toolsets.json).
 * Format: Record<string, Omit<Toolset, 'name'>>
 * File not existing is silently ignored.
 */
export async function loadToolsetsFromFile(filePath: string): Promise<void> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, Omit<Toolset, 'name'>>;
    for (const [name, partial] of Object.entries(data)) {
      registry.set(name, { name, ...partial } as Toolset);
    }
  } catch {
    // File not found or invalid — silently skip
  }
}

/**
 * Clear the registry. Primarily for testing.
 */
export function clearToolsetRegistry(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------
// Toolset → ToolPermissionRule[] conversion
// ---------------------------------------------------------------------------

/**
 * Convert a Toolset into an ordered ToolPermissionRule[] array.
 *
 * Rule generation order (first-match-wins):
 *  1. deniedTools  → { pattern, action: 'deny' }     (highest priority)
 *  2. requireApproval → { pattern, action: 'ask' }
 *  3. INFRASTRUCTURE_TOOLS → { pattern, action: 'allow' }
 *  4. allowedTools → { pattern, action: 'allow' }
 *  5. { pattern: '*', action: 'deny' }               (default deny — allowlist model)
 */
export function toolsetToPermissionRules(toolset: Toolset): ToolPermissionRule[] {
  const rules: ToolPermissionRule[] = [];

  // 1. Denied tools (highest priority)
  if (toolset.deniedTools) {
    for (const pattern of toolset.deniedTools) {
      rules.push({ pattern, action: 'deny' });
    }
  }

  // 2. Require approval
  if (toolset.requireApproval) {
    for (const pattern of toolset.requireApproval) {
      rules.push({ pattern, action: 'ask' });
    }
  }

  // 3. Infrastructure tools — always allow (unless caught by deniedTools above)
  for (const tool of INFRASTRUCTURE_TOOLS) {
    rules.push({ pattern: tool, action: 'allow' });
  }

  // 4. Allowed tools
  for (const pattern of toolset.allowedTools) {
    rules.push({ pattern, action: 'allow' });
  }

  // 5. Default deny (allowlist model)
  rules.push({ pattern: '*', action: 'deny' });

  return rules;
}

// ---------------------------------------------------------------------------
// Toolset → ToolPolicyConfig conversion
// ---------------------------------------------------------------------------

/**
 * Create a ToolPolicyConfig from a Toolset.
 * Inherits non-permission fields from baseConfig (or defaults).
 */
export function createPolicyConfigFromToolset(
  toolset: Toolset,
  baseConfig?: Partial<ToolPolicyConfig>,
): ToolPolicyConfig {
  const rules = toolsetToPermissionRules(toolset);
  return createDefaultPolicyConfig({
    ...baseConfig,
    permissions: rules,
    bashCommandRules: toolset.bashCommandRules ?? DEFAULT_BASH_COMMAND_RULES,
  });
}
