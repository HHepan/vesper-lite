// ============================================================================
// @vesper/bash — Pure Node.js bash emulator types
// Zero external dependencies
// ============================================================================

/**
 * Configuration for the bash emulator sandbox and execution environment.
 */
export interface BashConfig {
  /** Working directory for command execution */
  cwd: string;
  /** Sandbox boundary directories (default: [cwd]) */
  allowedDirs?: string[];
  /** Directories explicitly denied even if within allowedDirs */
  deniedDirs?: string[];
  /** Command whitelist — if set, ONLY these commands are permitted (undefined = all allowed) */
  allowedCommands?: string[];
  /** Command blacklist — these commands are always blocked */
  deniedCommands?: string[];
  /** Block all write operations (file creation, deletion, modification) */
  readOnly?: boolean;
  /** Initial environment variables */
  env?: Record<string, string>;
  /** Maximum output size in bytes (default: 5MB = 5_242_880) */
  maxOutputBytes?: number;
  /** Execution timeout in milliseconds (default: 120_000) */
  timeout?: number;
  /** When true, unknown commands are spawned via child_process. Default: false. */
  allowExternalCommands?: boolean;
}

/**
 * Result of executing a command or pipeline.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Top-level executor interface for running bash commands.
 */
export interface BashExecutor {
  execute(command: string, options?: { cwd?: string; timeout?: number }): Promise<ExecResult>;
  getCwd(): string;
  setCwd(newCwd: string): void;
  getEnv(): Record<string, string>;
  addAllowedDir(dir: string): void;
}

// ---------------------------------------------------------------------------
// Tokenizer types
// ---------------------------------------------------------------------------

export type TokenType =
  | 'word'            // regular word / argument
  | 'pipe'            // |
  | 'and'             // &&
  | 'or'              // ||
  | 'semicolon'       // ;
  | 'redirect_out'    // >
  | 'redirect_append' // >>
  | 'redirect_in'     // <
  | 'newline';

export interface Token {
  type: TokenType;
  value: string;
}

// ---------------------------------------------------------------------------
// AST node types
// ---------------------------------------------------------------------------

/**
 * A single command with its arguments, redirects, and optional env prefix assignments.
 *
 * Example: `FOO=bar ls -la > out.txt`
 *   name: 'ls', args: ['-la'], env: { FOO: 'bar' }, redirects: [{ type: 'out', target: 'out.txt' }]
 */
export interface SimpleCommand {
  type: 'simple';
  name: string;
  args: string[];
  redirects: Redirect[];
  /** VAR=val prefix assignments that apply to this command only */
  env?: Record<string, string>;
}

export interface Redirect {
  type: 'out' | 'append' | 'in';
  target: string;
}

/**
 * A pipeline of one or more simple commands connected by `|`.
 */
export interface Pipeline {
  type: 'pipeline';
  commands: SimpleCommand[];
}

/**
 * A list of pipelines connected by `&&`, `||`, `;`, or implicit end.
 *
 * Execution semantics:
 *   - `&&` — run next only if previous succeeded (exit code 0)
 *   - `||` — run next only if previous failed (exit code != 0)
 *   - `;`  — always run next regardless of previous exit code
 *   - `end` — terminal sentinel; no further pipelines
 */
export type CommandList = {
  type: 'list';
  entries: { pipeline: Pipeline; operator: '&&' | '||' | ';' | 'end' }[];
};

// ---------------------------------------------------------------------------
// Builtin command types
// ---------------------------------------------------------------------------

/**
 * Signature for builtin command implementations.
 *
 * Builtins receive parsed arguments and a context object providing cwd, env,
 * piped stdin content, and sandbox access.
 */
export type BuiltinFn = (args: string[], ctx: CommandContext) => Promise<ExecResult>;

/**
 * Execution context passed to builtin commands and external command wrappers.
 */
export interface CommandContext {
  /** Current working directory at the time of execution */
  cwd: string;
  /** Environment variables visible to this command */
  env: Record<string, string>;
  /** Content piped from a previous command's stdout (empty string if none) */
  stdin: string;
  /** Sandbox checker for permission enforcement */
  sandbox: SandboxChecker;
  /** Execute a command string through the executor (for xargs re-dispatch etc.) */
  executeCommand?: (command: string) => Promise<ExecResult>;
}

// ---------------------------------------------------------------------------
// Sandbox types
// ---------------------------------------------------------------------------

/**
 * Interface for sandbox permission enforcement.
 *
 * All checking methods throw an Error with a descriptive message on violation.
 */
export interface SandboxChecker {
  /**
   * Verify that `path` (absolute or relative-to-cwd) is accessible for the
   * given operation. Throws on violation.
   */
  checkPath(path: string, operation: 'read' | 'write'): void;
  /**
   * Verify that the named command is allowed to execute. Throws on violation.
   */
  checkCommand(name: string): void;
  /** Whether the sandbox is in read-only mode */
  isReadOnly(): boolean;
  /** Dynamically add a directory to the allowed list (e.g. after /cd) */
  addAllowedDir(dir: string): void;
}
