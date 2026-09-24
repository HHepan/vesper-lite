// =============================================================================
// Vesper WebUI — Slash Command Registry (for autocomplete menu)
//
// Single source of truth for Vesper Lite slash commands.
// Used by InputBox to display an autocomplete picker when typing '/'.
// =============================================================================

export interface SlashCommandDef {
  /** Command name without the leading slash (e.g. "save"). */
  name: string;
  /** Short description shown in the autocomplete menu. */
  description: string;
  /** Argument hint shown after the command name (null = no args). */
  argHint: string | null;
}

export const SLASH_COMMANDS: readonly SlashCommandDef[] = [
  // ── 会话与状态管理 ──
  { name: 'clear',    description: '重置/清空画布会话记录',                argHint: null },
  { name: 'save',     description: '保存当前会话快照',                     argHint: '[name]' },
  { name: 'load',     description: '加载已保存的会话快照',                 argHint: '<name>' },
  { name: 'delete',   description: '删除指定的已保存会话',                 argHint: '<name>' },
  { name: 'sessions', description: '列出所有已保存的会话列表',             argHint: null },
  { name: 'export',   description: '导出当前会话为 JSON 文件',             argHint: '<name> [path]' },
  { name: 'import',   description: '从 JSON 文件导入会话',                 argHint: '<path>' },
  { name: 'rollback', description: '回滚到指定检查点 (Checkpoint)',        argHint: '<checkpointId>' },

  // ── 画布与任务 ──
  { name: 'pin',      description: '固定一段重要内容到置顶区 (永不折叠)',    argHint: '<content>' },
  { name: 'canvas',   description: '查看画布块快照状态',                   argHint: null },
  { name: 'task',     description: '查询当前任务跟踪列表 (Tasks)',         argHint: null },

  // ── 技能与环境 ──
  { name: 'skill',    description: '列出/加载/卸载/清空提示词 Skill',      argHint: '[list|load|unload|clear] [<name>]' },
  { name: 'cd',       description: '切换工作区目录',                       argHint: '<path>' },
];

/**
 * Filter commands matching a prefix (without the leading slash).
 * Empty prefix returns all commands.
 */
export function filterCommands(prefix: string): SlashCommandDef[] {
  if (!prefix) return [...SLASH_COMMANDS];
  const lower = prefix.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(lower));
}
