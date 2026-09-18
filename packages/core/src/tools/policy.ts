// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Tool Policy Pipeline (§3.5)
// ═══════════════════════════════════════════════════════════════════════════

import type {
  ToolDefinition,
  ToolResult,
  ToolExecutor,
  ToolEntry,
  ToolPermissionRule,
  ToolPolicyConfig,
  BashCommandRule,
} from '@vesper/shared';
import { toolTimeoutError, POLICY_TRUNCATION_SUFFIX } from '../prompts.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function createDefaultPolicyConfig(overrides?: Partial<ToolPolicyConfig>): ToolPolicyConfig {
  return {
    permissions: [
      { pattern: 'bash', action: 'ask' },
      { pattern: 'script', action: 'ask' },
      { pattern: 'lsp_rename_*', action: 'ask' },
      { pattern: '*', action: 'allow' },
    ],
    bashCommandRules: DEFAULT_BASH_COMMAND_RULES,
    defaultTimeout: 120000,
    maxResultLength: 12000,
    sandboxEnabled: false,
    parameterValidation: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Permission Matching
// ---------------------------------------------------------------------------

function matchPattern(pattern: string, name: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return pattern === name;
}

function isAllowed(name: string, rules: ToolPermissionRule[]): boolean {
  // First-match-wins
  for (const rule of rules) {
    if (matchPattern(rule.pattern, name)) {
      return rule.action === 'allow';
    }
  }
  // Default deny if no rule matches
  return false;
}

/**
 * Get the permission action for a tool name. Returns first-match-wins from rules.
 * Defaults to 'deny' if no rule matches.
 */
export function getPermissionAction(
  name: string,
  rules: ToolPermissionRule[],
): 'allow' | 'deny' | 'ask' {
  for (const rule of rules) {
    if (matchPattern(rule.pattern, name)) return rule.action;
  }
  return 'deny';
}

// ---------------------------------------------------------------------------
// Minimal JSON Schema Validator
// ---------------------------------------------------------------------------

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
}

function validateType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    default: return true;
  }
}

export function validateArgs(args: Record<string, any>, schema: SchemaNode): string | null {
  // Check required fields
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in args) || args[key] === undefined) {
        return `Missing required parameter: ${key}`;
      }
    }
  }

  // Check property types
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in args && args[key] !== undefined && propSchema.type) {
        if (!validateType(args[key], propSchema.type)) {
          return `Parameter "${key}" must be of type ${propSchema.type}, got ${typeof args[key]}`;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Default Bash Command Rules (CC-style per-command granularity)
// ---------------------------------------------------------------------------

export const DEFAULT_BASH_COMMAND_RULES: BashCommandRule[] = [
  // Read-only commands — auto-allow
  { pattern: 'ls *',        action: 'allow' },
  { pattern: 'ls',          action: 'allow' },
  { pattern: 'cat *',       action: 'allow' },
  { pattern: 'head *',      action: 'allow' },
  { pattern: 'tail *',      action: 'allow' },
  { pattern: 'find *',      action: 'allow' },
  { pattern: 'grep *',      action: 'allow' },
  { pattern: 'wc *',        action: 'allow' },
  { pattern: 'echo *',      action: 'allow' },
  { pattern: 'echo',        action: 'allow' },
  { pattern: 'pwd',         action: 'allow' },
  { pattern: 'cd *',        action: 'allow' },
  { pattern: 'cd',          action: 'allow' },
  { pattern: 'which *',     action: 'allow' },
  { pattern: 'type *',      action: 'allow' },
  { pattern: 'stat *',      action: 'allow' },
  { pattern: 'diff *',      action: 'allow' },
  { pattern: 'sort *',      action: 'allow' },
  { pattern: 'sort',        action: 'allow' },
  { pattern: 'uniq *',      action: 'allow' },
  { pattern: 'uniq',        action: 'allow' },
  { pattern: 'dirname *',   action: 'allow' },
  { pattern: 'basename *',  action: 'allow' },
  { pattern: 'realpath *',  action: 'allow' },
  { pattern: 'date *',      action: 'allow' },
  { pattern: 'date',        action: 'allow' },
  { pattern: 'seq *',       action: 'allow' },
  { pattern: 'env',         action: 'allow' },
  { pattern: 'test *',      action: 'allow' },
  { pattern: '[ *',         action: 'allow' },
  { pattern: 'true',        action: 'allow' },
  { pattern: 'false',       action: 'allow' },
  { pattern: 'printf *',    action: 'allow' },
  // Safe git read commands
  { pattern: 'git status*', action: 'allow' },
  { pattern: 'git log*',    action: 'allow' },
  { pattern: 'git diff*',   action: 'allow' },
  { pattern: 'git show*',   action: 'allow' },
  { pattern: 'git branch*', action: 'allow' },
  // Default: ask for anything not matched
  { pattern: '*',           action: 'ask' },
];

// ---------------------------------------------------------------------------
// Bash Command Permission Matching
// ---------------------------------------------------------------------------

/**
 * Extract the command prefix for permission memory (first 1-2 words).
 * Multi-word command tools (git, npm, docker, etc.) use 2-word prefixes.
 */
export function extractCommandPrefix(command: string): string {
  const trimmed = command.trim();
  const words = trimmed.split(/\s+/);
  const multiWordPrefixes = ['git', 'npm', 'npx', 'pnpm', 'yarn', 'docker', 'kubectl', 'cargo'];
  if (words.length >= 2 && multiWordPrefixes.includes(words[0])) {
    return words.slice(0, 2).join(' ');
  }
  return words[0];
}

/**
 * Match a command against a glob-like pattern.
 *  "git *"  matches "git status", "git push -f", etc.
 *  "ls"     matches only "ls" exactly.
 *  "*"      matches everything.
 *  "git status*" matches "git status", "git status -s", etc.
 */
function matchCommandPattern(pattern: string, command: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith(' *')) {
    const prefix = pattern.slice(0, -2);
    return command === prefix || command.startsWith(prefix + ' ');
  }
  if (pattern.endsWith('*')) {
    return command.startsWith(pattern.slice(0, -1));
  }
  return command === pattern;
}

/**
 * Match a single (non-compound) command against BashCommandRule[].
 * First match wins. Returns null if no rules or no match.
 */
function matchSingleCommand(
  command: string,
  rules: BashCommandRule[],
): 'allow' | 'deny' | 'ask' | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  for (const rule of rules) {
    if (matchCommandPattern(rule.pattern, trimmed)) {
      return rule.action;
    }
  }
  return null;
}

/**
 * Split a command at top-level && || ; | boundaries for sub-command analysis.
 * Respects single/double quotes. Returns individual sub-commands.
 */
function splitSubCommands(command: string): string[] {
  const subs: string[] = [];
  const len = command.length;
  let i = 0;
  let start = 0;

  while (i < len) {
    const ch = command[i];

    if (ch === "'") {
      i++;
      while (i < len && command[i] !== "'") i++;
      if (i < len) i++;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < len && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < len) { i += 2; continue; }
        i++;
      }
      if (i < len) i++;
      continue;
    }
    if (ch === '\\' && i + 1 < len) {
      i += 2;
      continue;
    }

    // &&
    if (ch === '&' && i + 1 < len && command[i + 1] === '&') {
      subs.push(command.substring(start, i));
      i += 2;
      start = i;
      continue;
    }
    // ||
    if (ch === '|' && i + 1 < len && command[i + 1] === '|') {
      subs.push(command.substring(start, i));
      i += 2;
      start = i;
      continue;
    }
    // |  (pipe — different command in pipeline)
    if (ch === '|') {
      subs.push(command.substring(start, i));
      i++;
      start = i;
      continue;
    }
    // ;
    if (ch === ';') {
      subs.push(command.substring(start, i));
      i++;
      start = i;
      continue;
    }
    // newline — bash -c treats it as a command separator
    if (ch === '\n' || ch === '\r') {
      subs.push(command.substring(start, i));
      i++;
      start = i;
      continue;
    }
    // bare & — background separator (&& handled above); but >& / <& are fd
    // duplication, not separators.
    if (ch === '&' && i > start && command[i - 1] !== '>' && command[i - 1] !== '<') {
      subs.push(command.substring(start, i));
      i++;
      start = i;
      continue;
    }

    i++;
  }
  subs.push(command.substring(start));

  return subs.map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Scan a command string for dangerous shell constructs that can hide extra
 * commands or file writes from the word-based permission matcher:
 *
 *  - $( ... ) command substitution (outside single quotes)
 *  - ` ... ` backtick command substitution (outside single quotes)
 *  - <(...) / >(...) process substitution
 *  - > / >> output redirection (writes arbitrary files)
 *  - < input redirection, EXCEPT << / <<< here-docs and fd duplication >&N
 *
 * A construct is only "dangerous" when the real shell would act on it, so we
 * skip single-quoted spans (where substitution/redirection is inert). Double
 * quotes do NOT neutralize $( ) or ` `, so they are still flagged there.
 */
export function containsDangerousConstruct(command: string): boolean {
  const len = command.length;
  let i = 0;

  while (i < len) {
    const ch = command[i];

    // Single quotes neutralize everything — skip the whole span.
    if (ch === "'") {
      i++;
      while (i < len && command[i] !== "'") i++;
      if (i < len) i++;
      continue;
    }
    // Double quotes: skip the span but keep scanning inside for $( and `
    // (both are live inside double quotes). < and > inside quotes are literal.
    if (ch === '"') {
      i++;
      while (i < len && command[i] !== '"') {
        const c = command[i];
        if (c === '\\' && i + 1 < len) { i += 2; continue; }
        if (c === '`') return true;
        if (c === '$' && i + 1 < len && command[i + 1] === '(') return true;
        i++;
      }
      if (i < len) i++;
      continue;
    }
    if (ch === '\\' && i + 1 < len) {
      i += 2;
      continue;
    }

    // Backtick substitution
    if (ch === '`') return true;

    // $( substitution / arithmetic $(( — arithmetic can't run commands but
    // flagging it is harmless (conservative).
    if (ch === '$' && i + 1 < len && command[i + 1] === '(') return true;

    // Redirections
    if (ch === '>' || ch === '<') {
      const next = i + 1 < len ? command[i + 1] : '';
      if (ch === '<' && next === '(') return true; // <( process substitution
      if (ch === '<' && next === '<') {
        // << here-doc / <<< here-string — no file access, skip the '<' run
        i += 2;
        if (i < len && command[i] === '<') i++;
        continue;
      }
      if (ch === '>' && next === '(') return true; // >( process substitution
      if (next === '&') {
        // >&N / <&N fd duplication — no file write, skip the pair
        i += 2;
        continue;
      }
      return true; // plain > >> < redirection
    }

    i++;
  }
  return false;
}

/**
 * Wrappers that re-interpret or re-dispatch their arguments as commands,
 * making first-word rule matching meaningless.
 */
const OPAQUE_WRAPPER_COMMANDS = new Set([
  'sh', 'bash', 'dash', 'zsh', 'ksh', 'fish',
  'eval', 'exec', 'source', '.',
  'xargs',
  'sudo', 'doas', 'su',
  'env', // env with args runs a command; bare `env` is handled by caller
  'timeout', 'nohup', 'nice', 'ionice', 'chrt', 'taskset', 'stdbuf',
  'command', 'builtin',
  'watch',
]);

const ASSIGNMENT_PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Does this sub-command hide what it actually runs — either via a wrapper
 * (sh -c "...", xargs rm, sudo ...) or a leading VAR=value assignment prefix
 * that shifts the real command out of the first-word match position?
 */
export function isOpaqueSubCommand(sub: string): boolean {
  const words = sub.trim().split(/\s+/).filter(w => w.length > 0);
  let idx = 0;

  // Skip leading VAR=value assignment prefixes (but if the whole sub-command
  // is just assignments, it's not opaque).
  while (idx < words.length && ASSIGNMENT_PREFIX_RE.test(words[idx])) idx++;
  if (idx >= words.length) return false;
  const opaqueByAssignment = idx > 0;

  const head = words[idx];
  const base = head.includes('/') ? head.slice(head.lastIndexOf('/') + 1) : head;

  if (OPAQUE_WRAPPER_COMMANDS.has(base)) {
    // `env` alone (no command args) is just listing — not opaque
    if (base === 'env' && idx === words.length - 1) return false;
    return true;
  }
  return opaqueByAssignment;
}

/**
 * Does this command hide executable work from the word-based rule matcher?
 * True when it contains dangerous shell constructs or opaque sub-commands —
 * meaning an 'allow' verdict (from rules or remembered permissions) must not
 * be applied silently.
 */
export function hidesExecutableWork(command: string): boolean {
  return containsDangerousConstruct(command)
    || splitSubCommands(command).some(isOpaqueSubCommand);
}

/**
 * Match a bash command string against BashCommandRule[].
 *
 * For compound commands (containing &&, ||, ;, |, newline, &), checks EACH
 * sub-command. If ANY sub-command is 'deny', the whole command is denied.
 * If ANY sub-command is 'ask', the whole command needs asking.
 * Only if ALL are 'allow' is the whole thing auto-allowed.
 *
 * Security: a result of 'allow' is additionally downgraded to 'ask' when the
 * command contains dangerous shell constructs (command substitution, output
 * redirection, process substitution) or opaque wrappers (sh -c, eval, xargs,
 * sudo, env cmd, VAR=x cmd) — these can smuggle commands or file writes past
 * the word-based rule matcher, so they must never be silently allowed.
 * 'deny' results are never softened.
 *
 * First match wins per sub-command.
 */
export function matchBashCommandRules(
  command: string,
  rules?: BashCommandRule[],
): 'allow' | 'deny' | 'ask' | null {
  if (!rules || rules.length === 0) return null;

  const subCommands = splitSubCommands(command);
  if (subCommands.length === 0) return null;

  let worstAction: 'allow' | 'deny' | 'ask' | null = null;

  for (const sub of subCommands) {
    const action = matchSingleCommand(sub, rules);
    if (action === 'deny') return 'deny';
    if (action === 'ask') worstAction = 'ask';
    if (worstAction === null) worstAction = action;
  }

  if (worstAction === 'allow') {
    // Everything matched an allow rule — but don't let dangerous constructs
    // or opaque wrappers ride that allow through silently.
    if (hidesExecutableWork(command)) {
      return 'ask';
    }
  }

  return worstAction;
}

// ---------------------------------------------------------------------------
// Pipeline Application
// ---------------------------------------------------------------------------

/**
 * Apply the 8-stage policy pipeline to a set of tool entries.
 *
 * Stages:
 *  1. Permission check — filter tools by allow/deny rules
 *  2. Loop detection — no-op (handled in runtime.ts)
 *  3. Parameter validation — wrap executor with schema validation
 *  4. Sandbox wrapping — Phase 2: timeout constraint only
 *  5. Timeout control — Promise.race with timeout
 *  6. Execution — original executor (wrapped by stages above)
 *  7. Result truncation — enforce maxResultLength
 *  8. Recording — no-op (handled in runtime.ts)
 */
export function applyPipeline(
  entries: ToolEntry[],
  config: ToolPolicyConfig,
): ToolEntry[] {
  // Stage 1: Permission filter — remove 'deny' tools, keep 'allow' and 'ask'
  const allowed = entries.filter((e) => {
    const action = getPermissionAction(e.definition.name, config.permissions);
    return action !== 'deny';
  });

  return allowed.map((entry) => {
    const originalExecutor = entry.executor;
    const definition = entry.definition;

    const wrappedExecutor: ToolExecutor = async (args: Record<string, any>): Promise<ToolResult> => {
      // Stage 3: Parameter validation
      if (config.parameterValidation) {
        const error = validateArgs(args, definition.parameters as SchemaNode);
        if (error) {
          return { content: `Validation error: ${error}`, isError: true };
        }
      }

      // Stage 5: Timeout control
      const timeoutMs = config.defaultTimeout;
      const abortController = new AbortController();
      const argsWithSignal = { ...args, __signal: abortController.signal };
      const execute = originalExecutor(argsWithSignal);

      const timeoutPromise = new Promise<ToolResult>((resolve) => {
        setTimeout(() => {
          abortController.abort();
          resolve({ content: toolTimeoutError(definition.name, timeoutMs), isError: true });
        }, timeoutMs);
      });

      const result = await Promise.race([execute, timeoutPromise]);

      // If the actual execution finished first (before timeout), no need to abort
      // but abort anyway to clean up the timer reference — this is a no-op if already aborted
      abortController.abort();

      // Stage 7: Result truncation
      if (result.content.length > config.maxResultLength) {
        return {
          ...result,
          content: result.content.substring(0, config.maxResultLength) + POLICY_TRUNCATION_SUFFIX,
        };
      }

      return result;
    };

    return { definition, executor: wrappedExecutor };
  });
}
