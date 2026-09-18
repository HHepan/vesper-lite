// ═══════════════════════════════════════════════════════════════════════════
// @vesper/bash — Tokenizer + AST Parser
// Pure command-line parser: tokenize → parse → CommandList AST.
// No external dependencies.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  Token,
  TokenType,
  SimpleCommand,
  Redirect,
  Pipeline,
  CommandList,
} from './types.js';

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize a bash command string into a flat token stream.
 *
 * Handles:
 * - Unquoted words with environment variable expansion ($VAR, ${VAR})
 * - Single-quoted strings (literal, no expansion)
 * - Double-quoted strings (with $VAR expansion and backslash escaping)
 * - Operators: | && || ; > >> <
 * - Backslash escaping outside quotes
 * - Comments (# to end of line)
 *
 * Handles arithmetic expansion $((expr)).
 * Throws clear errors for unsupported features: $(), backticks, here-docs,
 * control flow keywords (if/for/while/case), function definitions.
 */
export function tokenize(input: string, env: Record<string, string>): Token[] {
  const tokens: Token[] = [];
  const len = input.length;
  let i = 0;

  while (i < len) {
    const ch = input[i];

    // ── Skip whitespace ────────────────────────────────────────────────
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    // ── Newline ────────────────────────────────────────────────────────
    if (ch === '\n') {
      tokens.push({ type: 'newline', value: '\n' });
      i++;
      continue;
    }

    // ── Comment (# to end of line) ─────────────────────────────────────
    if (ch === '#') {
      while (i < len && input[i] !== '\n') i++;
      continue;
    }

    // ── Two-character operators (must check before single-char) ────────
    if (i + 1 < len) {
      const two = input[i] + input[i + 1];
      if (two === '&&') {
        tokens.push({ type: 'and', value: '&&' });
        i += 2;
        continue;
      }
      if (two === '||') {
        tokens.push({ type: 'or', value: '||' });
        i += 2;
        continue;
      }
      if (two === '>>') {
        tokens.push({ type: 'redirect_append', value: '>>' });
        i += 2;
        continue;
      }
    }

    // ── Single-character operators ─────────────────────────────────────
    if (ch === '|') {
      tokens.push({ type: 'pipe', value: '|' });
      i++;
      continue;
    }
    if (ch === ';') {
      tokens.push({ type: 'semicolon', value: ';' });
      i++;
      continue;
    }
    if (ch === '>') {
      tokens.push({ type: 'redirect_out', value: '>' });
      i++;
      continue;
    }
    if (ch === '<') {
      // ── Heredoc / here-string detection ──────────────────────────
      if (i + 1 < len && input[i + 1] === '<') {
        if (i + 2 < len && input[i + 2] === '<') {
          throw new Error('here-strings (<<<) are not supported. Use echo "content" | command instead.');
        }
        throw new Error('here-docs (<<) are not supported. Use echo "content" | command instead.');
      }
      tokens.push({ type: 'redirect_in', value: '<' });
      i++;
      continue;
    }

    // ── Word (unquoted, single-quoted, double-quoted, or mixed) ───────
    // A "word" accumulates characters until unquoted whitespace or an
    // operator boundary. Quotes may appear mid-word (e.g. he"ll"o → hello).
    // Empty quoted strings ('' or "") produce a valid empty-string word.
    const result = readWord(input, i, env);
    i = result.end;
    if (result.hasContent) {
      tokens.push({ type: 'word', value: result.value });
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Word Reader
// ---------------------------------------------------------------------------

interface WordResult {
  value: string;
  end: number;
  /** True if at least one character or quote was consumed (empty quotes count) */
  hasContent: boolean;
}

/**
 * Read a single word starting at position `start`.
 *
 * Returns the accumulated value, the position after the word, and whether
 * any content was consumed (so empty-quoted strings like '' produce a word).
 */
function readWord(
  input: string,
  start: number,
  env: Record<string, string>,
): WordResult {
  const len = input.length;
  let i = start;
  let word = '';
  let enteredQuote = false;

  while (i < len) {
    const c = input[i];

    // Unquoted whitespace/operator boundary → end of word
    if (c === ' ' || c === '\t' || c === '\n') break;
    if (c === '#') break;
    if (c === ';') break;
    if (c === '|') break;
    if (c === '<') break;
    if (c === '>') break;
    if (c === '&' && i + 1 < len && input[i + 1] === '&') break;

    // ── Single quote: everything literal until closing ' ─────────────
    if (c === "'") {
      enteredQuote = true;
      i++; // skip opening '
      while (i < len && input[i] !== "'") {
        word += input[i];
        i++;
      }
      if (i < len) i++; // skip closing '
      continue;
    }

    // ── Double quote: expansion + escaping until closing " ──────────
    if (c === '"') {
      enteredQuote = true;
      i++; // skip opening "
      while (i < len && input[i] !== '"') {
        // Backslash escapes inside double quotes
        if (input[i] === '\\' && i + 1 < len) {
          const next = input[i + 1];
          // POSIX: only these are special inside double quotes
          if (next === '"' || next === '\\' || next === '$' || next === '`' || next === '\n') {
            word += next;
            i += 2;
            continue;
          }
          // Backslash is literal for other characters
          word += '\\';
          i++;
          continue;
        }
        // Variable expansion
        if (input[i] === '$') {
          const expanded = expandVariable(input, i, env);
          word += expanded.value;
          i = expanded.end;
          continue;
        }
        word += input[i];
        i++;
      }
      if (i < len) i++; // skip closing "
      continue;
    }

    // ── Backslash escape (unquoted context) ─────────────────────────
    if (c === '\\' && i + 1 < len) {
      word += input[i + 1];
      i += 2;
      continue;
    }

    // ── Variable expansion (unquoted context) ───────────────────────
    if (c === '$') {
      const expanded = expandVariable(input, i, env);
      word += expanded.value;
      i = expanded.end;
      continue;
    }

    // ── Backtick command substitution — not supported ─────────────
    if (c === '`') {
      throw new Error(
        'backtick command substitution is not supported. ' +
        'Run the inner command separately and use its output in the next command.',
      );
    }

    // ── Regular character ───────────────────────────────────────────
    word += c;
    i++;
  }

  return {
    value: word,
    end: i,
    hasContent: word.length > 0 || enteredQuote,
  };
}

// ---------------------------------------------------------------------------
// Variable Expansion
// ---------------------------------------------------------------------------

/**
 * Expand $VAR or ${VAR} starting at position `pos` in `input`.
 * Returns the expanded value and the position after the variable reference.
 *
 * Supported forms:
 * - `$((expr))` — arithmetic expansion
 * - `$(cmd)`    — command substitution (throws — not supported)
 * - `$VAR`      — simple variable (alphanumeric + underscore)
 * - `${VAR}`    — braced variable
 * - `$?`        — last exit code
 * - `$0`-`$9`   — positional parameters
 * - Bare `$` followed by non-variable char → literal '$'
 */
function expandVariable(
  input: string,
  pos: number,
  env: Record<string, string>,
): { value: string; end: number } {
  const len = input.length;

  // pos points at '$'
  if (pos + 1 >= len) {
    return { value: '$', end: pos + 1 };
  }

  const next = input[pos + 1];

  // ── ${VAR} form ──────────────────────────────────────────────────────
  if (next === '{') {
    const closeIdx = input.indexOf('}', pos + 2);
    if (closeIdx === -1) {
      // Unclosed brace — treat as literal '${' and continue
      return { value: '${', end: pos + 2 };
    }
    const varName = input.substring(pos + 2, closeIdx);
    const value = env[varName] ?? '';
    return { value, end: closeIdx + 1 };
  }

  // ── $((expr)) arithmetic expansion ───────────────────────────────────
  if (next === '(' && pos + 2 < len && input[pos + 2] === '(') {
    return expandArithmetic(input, pos, env);
  }

  // ── $(command) — not supported ───────────────────────────────────────
  if (next === '(') {
    let depth = 1;
    let j = pos + 2;
    while (j < len && depth > 0) {
      if (input[j] === '(') depth++;
      else if (input[j] === ')') depth--;
      j++;
    }
    if (depth === 0) {
      const inner = input.substring(pos + 2, j - 1);
      throw new Error(
        `command substitution $(${inner}) is not supported. ` +
        `Run the inner command separately and use its output in the next command.`,
      );
    }
    return { value: '$', end: pos + 1 };
  }

  // ── $? special variable ──────────────────────────────────────────────
  if (next === '?') {
    const value = env['?'] ?? '0';
    return { value, end: pos + 2 };
  }

  // ── $0-$9 positional parameters ──────────────────────────────────────
  if (next >= '0' && next <= '9') {
    const value = env[next] ?? '';
    return { value, end: pos + 2 };
  }

  // ── $VAR form (alphanumeric + underscore) ────────────────────────────
  if (isVarStartChar(next)) {
    let end = pos + 2;
    while (end < len && isVarChar(input[end])) {
      end++;
    }
    const varName = input.substring(pos + 1, end);
    const value = env[varName] ?? '';
    return { value, end };
  }

  // ── Bare $ not followed by a valid variable char → literal ───────────
  return { value: '$', end: pos + 1 };
}

// ---------------------------------------------------------------------------
// Arithmetic Expansion — $((expr))
// ---------------------------------------------------------------------------

/**
 * Expand $((expr)) starting at position `pos` in `input`.
 * `pos` points at the `$` character.
 * Returns the evaluated integer result and the position after `))`.
 */
function expandArithmetic(
  input: string,
  pos: number,
  env: Record<string, string>,
): { value: string; end: number } {
  // pos+0='$', pos+1='(', pos+2='('
  const exprStart = pos + 3;
  const len = input.length;

  // Find matching ))
  let depth = 1;
  let i = exprStart;
  while (i < len && depth > 0) {
    if (i + 1 < len && input[i] === ')' && input[i + 1] === ')') {
      depth--;
      if (depth === 0) break;
      i += 2;
    } else if (i + 1 < len && input[i] === '$' && input[i + 1] === '(') {
      // Nested $(( — skip ahead
      if (i + 2 < len && input[i + 2] === '(') {
        depth++;
        i += 3;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  if (depth !== 0) {
    throw new Error('unterminated arithmetic expansion: missing ))');
  }

  const expr = input.substring(exprStart, i);
  const parser = new ArithmeticParser(expr, env);
  const result = parser.parse();
  return { value: String(result), end: i + 2 }; // skip past ))
}

/**
 * Recursive-descent arithmetic evaluator for bash $((expr)).
 *
 * Grammar (by precedence, lowest to highest):
 *   expr     → addSub
 *   addSub   → mulDiv (('+' | '-') mulDiv)*
 *   mulDiv   → power (('*' | '/' | '%') power)*
 *   power    → unary ('**' unary)*               (right-associative)
 *   unary    → ('-' | '+') unary | primary
 *   primary  → '(' expr ')' | NUMBER | VARIABLE
 *
 * Variables: bare `count`, `$count`, `${count}` — resolved from env, default 0.
 * Integer division truncates toward zero (like bash).
 */
class ArithmeticParser {
  private readonly src: string;
  private readonly env: Record<string, string>;
  private pos = 0;

  constructor(src: string, env: Record<string, string>) {
    this.src = src;
    this.env = env;
  }

  parse(): number {
    const result = this.parseAddSub();
    this.skipWs();
    if (this.pos < this.src.length) {
      throw new Error(`unexpected character '${this.src[this.pos]}' in arithmetic expression`);
    }
    return result;
  }

  private skipWs(): void {
    while (this.pos < this.src.length && (this.src[this.pos] === ' ' || this.src[this.pos] === '\t')) {
      this.pos++;
    }
  }

  private parseAddSub(): number {
    let left = this.parseMulDiv();
    this.skipWs();
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '+' || ch === '-') {
        // Make sure it's not '**'
        if (ch === '+') { /* just + */ }
        this.pos++;
        const right = this.parseMulDiv();
        left = ch === '+' ? left + right : left - right;
        this.skipWs();
      } else {
        break;
      }
    }
    return left;
  }

  private parseMulDiv(): number {
    let left = this.parsePower();
    this.skipWs();
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '*' && this.pos + 1 < this.src.length && this.src[this.pos + 1] === '*') {
        break; // ** is power, handled by parsePower
      }
      if (ch === '*' || ch === '/' || ch === '%') {
        this.pos++;
        const right = this.parsePower();
        if (ch === '*') {
          left = left * right;
        } else if (ch === '/') {
          if (right === 0) throw new Error('division by zero');
          left = Math.trunc(left / right);
        } else {
          if (right === 0) throw new Error('division by zero');
          left = left % right;
        }
        this.skipWs();
      } else {
        break;
      }
    }
    return left;
  }

  private parsePower(): number {
    const base = this.parseUnary();
    this.skipWs();
    if (this.pos + 1 < this.src.length &&
        this.src[this.pos] === '*' && this.src[this.pos + 1] === '*') {
      this.pos += 2;
      const exp = this.parsePower(); // right-associative
      return Math.trunc(base ** exp);
    }
    return base;
  }

  private parseUnary(): number {
    this.skipWs();
    if (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '-') {
        this.pos++;
        return -this.parseUnary();
      }
      if (ch === '+') {
        this.pos++;
        return this.parseUnary();
      }
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWs();
    if (this.pos >= this.src.length) {
      throw new Error('unexpected end of arithmetic expression');
    }

    const ch = this.src[this.pos];

    // Parenthesized sub-expression
    if (ch === '(') {
      this.pos++;
      const val = this.parseAddSub();
      this.skipWs();
      if (this.pos >= this.src.length || this.src[this.pos] !== ')') {
        throw new Error('missing ) in arithmetic expression');
      }
      this.pos++;
      return val;
    }

    // Number literal
    if (ch >= '0' && ch <= '9') {
      let numStr = '';
      while (this.pos < this.src.length && this.src[this.pos] >= '0' && this.src[this.pos] <= '9') {
        numStr += this.src[this.pos];
        this.pos++;
      }
      return parseInt(numStr, 10);
    }

    // Variable reference: $VAR, ${VAR}, or bare VAR
    if (ch === '$') {
      this.pos++;
      if (this.pos < this.src.length && this.src[this.pos] === '{') {
        // ${VAR}
        this.pos++;
        let name = '';
        while (this.pos < this.src.length && this.src[this.pos] !== '}') {
          name += this.src[this.pos];
          this.pos++;
        }
        if (this.pos < this.src.length) this.pos++; // skip }
        const val = this.env[name] ?? '0';
        return parseInt(val, 10) || 0;
      }
      // $VAR
      let name = '';
      while (this.pos < this.src.length && isVarChar(this.src[this.pos])) {
        name += this.src[this.pos];
        this.pos++;
      }
      if (name.length === 0) {
        throw new Error("expected variable name after '$' in arithmetic expression");
      }
      const val = this.env[name] ?? '0';
      return parseInt(val, 10) || 0;
    }

    // Bare variable name (no $)
    if (isVarStartChar(ch)) {
      let name = '';
      while (this.pos < this.src.length && isVarChar(this.src[this.pos])) {
        name += this.src[this.pos];
        this.pos++;
      }
      const val = this.env[name] ?? '0';
      return parseInt(val, 10) || 0;
    }

    throw new Error(`unexpected character '${ch}' in arithmetic expression`);
  }
}

// ---------------------------------------------------------------------------
// Character Classification
// ---------------------------------------------------------------------------

function isVarStartChar(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') ||
         (ch >= 'A' && ch <= 'Z') ||
         ch === '_';
}

function isVarChar(ch: string): boolean {
  return isVarStartChar(ch) || (ch >= '0' && ch <= '9');
}

// ---------------------------------------------------------------------------
// AST Parser
// ---------------------------------------------------------------------------

/**
 * Parse a bash command string into a CommandList AST.
 *
 * Performs tokenization with env variable expansion, then parses the token
 * stream into a tree of: CommandList → Pipeline[] → SimpleCommand[].
 *
 * Handles:
 * - Simple commands:       `cmd arg1 arg2`
 * - Pipelines:             `cmd1 | cmd2 | cmd3`
 * - Command lists:         `cmd1 && cmd2 || cmd3 ; cmd4`
 * - Redirections:          `cmd > file`, `cmd >> file`, `cmd < file`
 * - Env prefix assignments: `VAR=val cmd args...`
 * - Bare assignments:      `FOO=bar` (no command, sets env)
 */
export function parseCommand(
  input: string,
  env: Record<string, string>,
): CommandList {
  const tokens = tokenize(input, env);
  const parser = new TokenParser(tokens);
  return parser.parseList();
}

// ---------------------------------------------------------------------------
// Token Stream Parser
// ---------------------------------------------------------------------------

const CONTROL_FLOW_ERRORS: Record<string, string> = {
  if:       'control flow (if/then/fi) is not supported. Use && and || for conditional execution.',
  then:     'control flow (if/then/fi) is not supported. Use && and || for conditional execution.',
  else:     'control flow (if/then/fi) is not supported. Use && and || for conditional execution.',
  elif:     'control flow (if/then/fi) is not supported. Use && and || for conditional execution.',
  fi:       'control flow (if/then/fi) is not supported. Use && and || for conditional execution.',
  for:      'control flow (for/do/done) is not supported. Use xargs or separate commands.',
  do:       'control flow (for/do/done) is not supported. Use xargs or separate commands.',
  done:     'control flow (for/do/done) is not supported. Use xargs or separate commands.',
  while:    'control flow (while/do/done) is not supported. Use separate commands.',
  until:    'control flow (until/do/done) is not supported. Use separate commands.',
  case:     'control flow (case/esac) is not supported. Use && and || for conditional execution.',
  esac:     'control flow (case/esac) is not supported. Use && and || for conditional execution.',
  select:   'control flow (select) is not supported.',
  function: 'function definitions are not supported. Use separate commands.',
};

class TokenParser {
  private readonly tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // ── Stream helpers ─────────────────────────────────────────────────────

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private isAtEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private skipNewlines(): void {
    while (!this.isAtEnd() && this.peek()!.type === 'newline') {
      this.advance();
    }
  }

  private isListSeparator(t: Token): boolean {
    return t.type === 'and' ||
           t.type === 'or' ||
           t.type === 'semicolon' ||
           t.type === 'newline';
  }

  // ── CommandList ────────────────────────────────────────────────────────
  //
  // Grammar:
  //   list      → pipeline (list_op pipeline)* list_op?
  //   list_op   → '&&' | '||' | ';' | '\n'
  //
  // The `operator` field on each entry describes the connector that
  // PRECEDES it. The first entry always gets ';' (unconditional run).
  // A single-pipeline command gets 'end'.

  parseList(): CommandList {
    const entries: CommandList['entries'] = [];
    this.skipNewlines();

    // Empty input
    if (this.isAtEnd()) {
      return {
        type: 'list',
        entries: [{
          pipeline: { type: 'pipeline', commands: [emptyCommand()] },
          operator: 'end',
        }],
      };
    }

    // First pipeline
    const firstPipeline = this.parsePipeline();

    // No list operators follow → single pipeline
    if (this.isAtEnd() || !this.isListSeparator(this.peek()!)) {
      entries.push({ pipeline: firstPipeline, operator: 'end' });
      return { type: 'list', entries };
    }

    // Multiple pipelines connected by list operators.
    // First entry's operator is ';' (unconditional).
    entries.push({ pipeline: firstPipeline, operator: ';' });

    while (!this.isAtEnd()) {
      const sep = this.peek();
      if (!sep || !this.isListSeparator(sep)) break;

      const operator = this.consumeListOperator();
      this.skipNewlines();

      // Trailing separator without another command → ignore
      if (this.isAtEnd()) break;

      const pipeline = this.parsePipeline();
      entries.push({ pipeline, operator });
    }

    return { type: 'list', entries };
  }

  private consumeListOperator(): '&&' | '||' | ';' {
    const tok = this.advance();
    switch (tok.type) {
      case 'and':       return '&&';
      case 'or':        return '||';
      case 'semicolon': return ';';
      case 'newline':   return ';';
      default:
        throw new Error(`Unexpected token '${tok.value}' where list operator expected`);
    }
  }

  // ── Pipeline ───────────────────────────────────────────────────────────
  //
  // Grammar:
  //   pipeline → command ('|' command)*

  private parsePipeline(): Pipeline {
    const commands: SimpleCommand[] = [];
    commands.push(this.parseSimpleCommand());

    while (!this.isAtEnd() && this.peek()!.type === 'pipe') {
      this.advance(); // consume '|'
      this.skipNewlines();
      commands.push(this.parseSimpleCommand());
    }

    return { type: 'pipeline', commands };
  }

  // ── SimpleCommand ──────────────────────────────────────────────────────
  //
  // Grammar:
  //   command → assignment* word word* redirection*
  //   assignment → NAME '=' VALUE  (embedded in a single word token)
  //   redirection → ('>' | '>>' | '<') word
  //
  // Redirections can appear anywhere in the command (before, between,
  // or after arguments) — they are collected and attached to the command.

  private parseSimpleCommand(): SimpleCommand {
    const words: string[] = [];
    const redirects: Redirect[] = [];
    const envAssignments: Record<string, string> = {};
    let doneWithAssignments = false;

    while (!this.isAtEnd()) {
      const tok = this.peek()!;

      // Stop at operators belonging to the pipeline/list level
      if (tok.type === 'pipe' ||
          tok.type === 'and' ||
          tok.type === 'or' ||
          tok.type === 'semicolon' ||
          tok.type === 'newline') {
        break;
      }

      // ── Redirections ──────────────────────────────────────────────
      if (tok.type === 'redirect_out' ||
          tok.type === 'redirect_append' ||
          tok.type === 'redirect_in') {
        this.advance(); // consume the redirect operator
        const target = this.expectWord('redirect target');
        const redirType: Redirect['type'] =
          tok.type === 'redirect_out'    ? 'out' :
          tok.type === 'redirect_append' ? 'append' :
                                           'in';
        redirects.push({ type: redirType, target });
        continue;
      }

      // ── Word ──────────────────────────────────────────────────────
      if (tok.type === 'word') {
        this.advance();

        // VAR=value assignment prefix (only before the first non-assignment word)
        if (!doneWithAssignments && isAssignment(tok.value)) {
          const eqIdx = tok.value.indexOf('=');
          envAssignments[tok.value.substring(0, eqIdx)] = tok.value.substring(eqIdx + 1);
          continue;
        }

        // Once we see a non-assignment word, everything else is a regular arg
        doneWithAssignments = true;
        // Check for control flow keywords as command name
        if (words.length === 0) {
          const cfError = CONTROL_FLOW_ERRORS[tok.value];
          if (cfError) throw new Error(cfError);
        }
        words.push(tok.value);
        continue;
      }

      // Unrecognized token type in command position → stop
      break;
    }

    // Build the SimpleCommand node
    if (words.length === 0) {
      // Bare assignment (e.g. `FOO=bar`) or empty command
      const hasEnv = Object.keys(envAssignments).length > 0;
      return {
        type: 'simple',
        name: '',
        args: [],
        redirects,
        ...(hasEnv ? { env: envAssignments } : {}),
      };
    }

    const [name, ...args] = words;
    const hasEnv = Object.keys(envAssignments).length > 0;
    return {
      type: 'simple',
      name,
      args,
      redirects,
      ...(hasEnv ? { env: envAssignments } : {}),
    };
  }

  // ── Expect helpers ─────────────────────────────────────────────────────

  private expectWord(context: string): string {
    if (this.isAtEnd()) {
      throw new Error(`Expected ${context} but reached end of input`);
    }
    const tok = this.peek()!;
    if (tok.type !== 'word') {
      throw new Error(`Expected ${context} but got '${tok.value}'`);
    }
    this.advance();
    return tok.value;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a word token represents a VAR=value assignment.
 *
 * Valid: `FOO=bar`, `_x=1`, `PATH=/usr/bin`, `A=`
 * Invalid: `=bar` (no name), `1FOO=bar` (starts with digit)
 */
function isAssignment(word: string): boolean {
  const eqIdx = word.indexOf('=');
  if (eqIdx <= 0) return false;

  const name = word.substring(0, eqIdx);
  if (!isVarStartChar(name[0])) return false;
  for (let i = 1; i < name.length; i++) {
    if (!isVarChar(name[i])) return false;
  }
  return true;
}

function emptyCommand(): SimpleCommand {
  return { type: 'simple', name: '', args: [], redirects: [] };
}
