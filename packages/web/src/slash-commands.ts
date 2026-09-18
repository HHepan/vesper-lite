// =============================================================================
// Vesper WebUI — Slash Command Registry (for autocomplete menu)
//
// Single source of truth for all TUI slash commands.
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
  { name: 'save',     description: 'Save session (overwrites if name exists)', argHint: '[name]' },
  { name: 'load',     description: 'Load a session by name (or id)',          argHint: '<name>' },
  { name: 'delete',   description: 'Delete a saved session',                  argHint: '<name>' },
  { name: 'sessions', description: 'List saved sessions',                     argHint: null },
  { name: 'export',   description: 'Export session to JSON file',             argHint: '<name> [path]' },
  { name: 'import',   description: 'Import session from JSON file',           argHint: '<path>' },
  { name: 'compact',  description: 'Intelligently compress canvas',         argHint: '[hint]' },
  { name: 'call_curator', description: 'Run curator directly (no LLM round)', argHint: '[hint]' },
  { name: 'dump',     description: 'Dump prompt JSON to file',              argHint: null },
  { name: 'canvas',   description: 'Browse and manage canvas blocks',       argHint: null },
  { name: 'clear',    description: 'Reset canvas to initial state',        argHint: null },
  { name: 'cd',       description: 'Change working directory',             argHint: '<path>' },
  { name: 'add-dir',  description: 'Allow bash access to a directory',     argHint: '<path>' },
  { name: 'clear-permissions', description: 'Clear all saved permission rules', argHint: null },
  { name: 'toolset', description: 'Switch toolset or list available', argHint: '[list|<name>]' },
  { name: 'skill',   description: 'Load/unload/list skills',               argHint: '[list|load|unload] [<name>]' },
  { name: 'import-skill', description: 'Import skill from ClawHub zip or directory', argHint: '<path>' },
  { name: 'persona', description: 'Switch persona or show current status', argHint: '[<name>|reset]' },
  { name: 'save-persona', description: 'Save current config as a new persona', argHint: '<name> <display_name> <description>' },
  { name: 'delete-persona', description: 'Delete a user persona', argHint: '<name>' },
  { name: 'tool', description: 'Manage tool permission overlay', argHint: '[allow|deny <pattern>]' },
  { name: 'supervise', description: 'Enable supervisor mode (auto-approve with rules)', argHint: '<rules...>' },
  { name: 'unsupervise', description: 'Disable supervisor mode', argHint: null },
  { name: 'provider', description: 'Switch LLM provider profile or show current', argHint: '[<profile>]' },
  { name: 'memory',   description: 'Consolidate & recall cross-session memories', argHint: '[hint]' },
  { name: 'save_dataset', description: 'Save session as dataset (per-ego JSONL)', argHint: '[name]' },
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
