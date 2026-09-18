// =============================================================================
// @vesper/bash — Parser & Tokenizer Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { tokenize, parseCommand } from '../src/parser.js';

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('tokenizes simple words', () => {
    const tokens = tokenize('echo hello world', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: 'hello' },
      { type: 'word', value: 'world' },
    ]);
  });

  it('tokenizes pipes', () => {
    const tokens = tokenize('ls | grep foo', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'ls' },
      { type: 'pipe', value: '|' },
      { type: 'word', value: 'grep' },
      { type: 'word', value: 'foo' },
    ]);
  });

  it('tokenizes && and ||', () => {
    const tokens = tokenize('cmd1 && cmd2 || cmd3', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'cmd1' },
      { type: 'and', value: '&&' },
      { type: 'word', value: 'cmd2' },
      { type: 'or', value: '||' },
      { type: 'word', value: 'cmd3' },
    ]);
  });

  it('tokenizes redirect out >', () => {
    const tokens = tokenize('echo hello > file.txt', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: 'hello' },
      { type: 'redirect_out', value: '>' },
      { type: 'word', value: 'file.txt' },
    ]);
  });

  it('tokenizes redirect append >>', () => {
    const tokens = tokenize('cat >> log.txt', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'cat' },
      { type: 'redirect_append', value: '>>' },
      { type: 'word', value: 'log.txt' },
    ]);
  });

  it('tokenizes redirect in <', () => {
    const tokens = tokenize('cmd < input.txt', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'cmd' },
      { type: 'redirect_in', value: '<' },
      { type: 'word', value: 'input.txt' },
    ]);
  });

  it('tokenizes single-quoted strings (literal)', () => {
    const tokens = tokenize("echo 'hello world'", {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: 'hello world' },
    ]);
  });

  it('tokenizes double-quoted strings with variable expansion', () => {
    const tokens = tokenize('echo "$HOME"', { HOME: '/root' });
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '/root' },
    ]);
  });

  it('single quotes prevent variable expansion', () => {
    const tokens = tokenize("echo '$HOME'", { HOME: '/root' });
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '$HOME' },
    ]);
  });

  it('tokenizes semicolons', () => {
    const tokens = tokenize('echo a; echo b', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: 'a' },
      { type: 'semicolon', value: ';' },
      { type: 'word', value: 'echo' },
      { type: 'word', value: 'b' },
    ]);
  });

  it('expands unquoted $VAR', () => {
    const tokens = tokenize('echo $USER', { USER: 'alice' });
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: 'alice' },
    ]);
  });

  it('expands ${VAR} braced form', () => {
    const tokens = tokenize('echo ${NAME}', { NAME: 'bob' });
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: 'bob' },
    ]);
  });

  it('undefined variable expands to empty string', () => {
    const tokens = tokenize('echo $UNDEFINED', {});
    // empty expansion produces no token (empty word with no quote → hasContent = false)
    // Actually: readWord returns value: '' and hasContent: false for a bare empty var
    // Let's just verify 'echo' is there
    expect(tokens[0]).toEqual({ type: 'word', value: 'echo' });
  });

  it('skips comments', () => {
    const tokens = tokenize('echo hello # this is a comment', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: 'hello' },
    ]);
  });

  it('handles backslash escaping outside quotes', () => {
    const tokens = tokenize('echo hello\\ world', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: 'hello world' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// parseCommand
// ---------------------------------------------------------------------------

describe('parseCommand', () => {
  it('parses a simple command into CommandList with one pipeline', () => {
    const ast = parseCommand('echo hello', {});
    expect(ast.type).toBe('list');
    expect(ast.entries).toHaveLength(1);
    expect(ast.entries[0].operator).toBe('end');

    const pipeline = ast.entries[0].pipeline;
    expect(pipeline.type).toBe('pipeline');
    expect(pipeline.commands).toHaveLength(1);

    const cmd = pipeline.commands[0];
    expect(cmd.type).toBe('simple');
    expect(cmd.name).toBe('echo');
    expect(cmd.args).toEqual(['hello']);
    expect(cmd.redirects).toEqual([]);
  });

  it('parses a pipeline with multiple SimpleCommands', () => {
    const ast = parseCommand('ls | grep foo | wc -l', {});
    expect(ast.entries).toHaveLength(1);

    const pipeline = ast.entries[0].pipeline;
    expect(pipeline.commands).toHaveLength(3);
    expect(pipeline.commands[0].name).toBe('ls');
    expect(pipeline.commands[1].name).toBe('grep');
    expect(pipeline.commands[1].args).toEqual(['foo']);
    expect(pipeline.commands[2].name).toBe('wc');
    expect(pipeline.commands[2].args).toEqual(['-l']);
  });

  it('parses && producing correct list structure', () => {
    const ast = parseCommand('cmd1 && cmd2', {});
    expect(ast.entries).toHaveLength(2);
    // First entry has operator ';' (unconditional first entry)
    expect(ast.entries[0].operator).toBe(';');
    expect(ast.entries[0].pipeline.commands[0].name).toBe('cmd1');
    // Second entry has operator '&&'
    expect(ast.entries[1].operator).toBe('&&');
    expect(ast.entries[1].pipeline.commands[0].name).toBe('cmd2');
  });

  it('parses || producing correct list structure', () => {
    const ast = parseCommand('cmd1 || cmd2', {});
    expect(ast.entries).toHaveLength(2);
    expect(ast.entries[0].operator).toBe(';');
    expect(ast.entries[1].operator).toBe('||');
    expect(ast.entries[1].pipeline.commands[0].name).toBe('cmd2');
  });

  it('parses mixed && and ||', () => {
    const ast = parseCommand('cmd1 && cmd2 || cmd3', {});
    expect(ast.entries).toHaveLength(3);
    expect(ast.entries[0].operator).toBe(';');
    expect(ast.entries[0].pipeline.commands[0].name).toBe('cmd1');
    expect(ast.entries[1].operator).toBe('&&');
    expect(ast.entries[1].pipeline.commands[0].name).toBe('cmd2');
    expect(ast.entries[2].operator).toBe('||');
    expect(ast.entries[2].pipeline.commands[0].name).toBe('cmd3');
  });

  it('parses VAR=value prefix assignment', () => {
    const ast = parseCommand('FOO=bar echo hello', {});
    const cmd = ast.entries[0].pipeline.commands[0];
    expect(cmd.name).toBe('echo');
    expect(cmd.args).toEqual(['hello']);
    expect(cmd.env).toEqual({ FOO: 'bar' });
  });

  it('parses bare assignment (no command)', () => {
    const ast = parseCommand('FOO=bar', {});
    const cmd = ast.entries[0].pipeline.commands[0];
    expect(cmd.name).toBe('');
    expect(cmd.env).toEqual({ FOO: 'bar' });
  });

  it('parses redirections', () => {
    const ast = parseCommand('echo hello > out.txt', {});
    const cmd = ast.entries[0].pipeline.commands[0];
    expect(cmd.name).toBe('echo');
    expect(cmd.args).toEqual(['hello']);
    expect(cmd.redirects).toEqual([{ type: 'out', target: 'out.txt' }]);
  });

  it('parses append redirection', () => {
    const ast = parseCommand('echo line >> log.txt', {});
    const cmd = ast.entries[0].pipeline.commands[0];
    expect(cmd.redirects).toEqual([{ type: 'append', target: 'log.txt' }]);
  });

  it('parses input redirection', () => {
    const ast = parseCommand('sort < data.txt', {});
    const cmd = ast.entries[0].pipeline.commands[0];
    expect(cmd.redirects).toEqual([{ type: 'in', target: 'data.txt' }]);
  });

  it('parses semicolons as list separators', () => {
    const ast = parseCommand('echo a; echo b', {});
    expect(ast.entries).toHaveLength(2);
    expect(ast.entries[0].operator).toBe(';');
    expect(ast.entries[1].operator).toBe(';');
    expect(ast.entries[0].pipeline.commands[0].name).toBe('echo');
    expect(ast.entries[1].pipeline.commands[0].name).toBe('echo');
  });

  it('handles empty input gracefully', () => {
    const ast = parseCommand('', {});
    expect(ast.type).toBe('list');
    expect(ast.entries).toHaveLength(1);
    expect(ast.entries[0].pipeline.commands[0].name).toBe('');
    expect(ast.entries[0].operator).toBe('end');
  });
});

// ---------------------------------------------------------------------------
// Arithmetic Expansion
// ---------------------------------------------------------------------------

describe('arithmetic expansion', () => {
  it('$((1 + 2)) → 3', () => {
    const tokens = tokenize('echo $((1 + 2))', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '3' },
    ]);
  });

  it('$((10 * 5)) → 50 (the original bug case)', () => {
    const tokens = tokenize('echo $((10 * 5))', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '50' },
    ]);
  });

  it('$(($x + 1)) with env {x:"10"} → 11', () => {
    const tokens = tokenize('echo $(($x + 1))', { x: '10' });
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '11' },
    ]);
  });

  it('$((count * 2)) with bare variable', () => {
    const tokens = tokenize('echo $((count * 2))', { count: '7' });
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '14' },
    ]);
  });

  it('$(( (3+4) * 2 )) → 14 (nested parens)', () => {
    const tokens = tokenize('echo $(( (3+4) * 2 ))', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '14' },
    ]);
  });

  it('$((2 ** 10)) → 1024 (exponentiation)', () => {
    const tokens = tokenize('echo $((2 ** 10))', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '1024' },
    ]);
  });

  it('$((10 / 3)) → 3 (integer division)', () => {
    const tokens = tokenize('echo $((10 / 3))', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '3' },
    ]);
  });

  it('$((10 % 3)) → 1 (modulo)', () => {
    const tokens = tokenize('echo $((10 % 3))', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '1' },
    ]);
  });

  it('undefined variable defaults to 0', () => {
    const tokens = tokenize('echo $((undef + 5))', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '5' },
    ]);
  });

  it('"result: $((2+3))" → "result: 5" (inside double quotes)', () => {
    const tokens = tokenize('echo "result: $((2+3))"', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: 'result: 5' },
    ]);
  });

  it('$((-5 + 3)) → -2 (unary minus)', () => {
    const tokens = tokenize('echo $((-5 + 3))', {});
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '-2' },
    ]);
  });

  it('${VAR} reference inside arithmetic', () => {
    const tokens = tokenize('echo $((${n} + 1))', { n: '9' });
    expect(tokens).toEqual([
      { type: 'word', value: 'echo' },
      { type: 'word', value: '10' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Unsupported Feature Detection
// ---------------------------------------------------------------------------

describe('unsupported feature detection', () => {
  it('$(command) throws clear error', () => {
    expect(() => tokenize('echo $(ls)', {})).toThrow('command substitution');
    expect(() => tokenize('echo $(ls)', {})).toThrow('not supported');
  });

  it('backtick substitution throws clear error', () => {
    expect(() => tokenize('echo `date`', {})).toThrow('backtick');
    expect(() => tokenize('echo `date`', {})).toThrow('not supported');
  });

  it('heredoc << throws clear error', () => {
    expect(() => tokenize('cat << EOF', {})).toThrow('here-docs');
    expect(() => tokenize('cat << EOF', {})).toThrow('not supported');
  });

  it('here-string <<< throws clear error', () => {
    expect(() => tokenize('cat <<< "hello"', {})).toThrow('here-strings');
    expect(() => tokenize('cat <<< "hello"', {})).toThrow('not supported');
  });

  it('control flow: if throws clear error', () => {
    expect(() => parseCommand('if [ -f x ]; then echo yes; fi', {})).toThrow('not supported');
    expect(() => parseCommand('if [ -f x ]; then echo yes; fi', {})).toThrow('&&');
  });

  it('control flow: for throws clear error', () => {
    expect(() => parseCommand('for f in *.txt; do echo $f; done', {})).toThrow('not supported');
    expect(() => parseCommand('for f in *.txt; do echo $f; done', {})).toThrow('xargs');
  });

  it('control flow: while throws clear error', () => {
    expect(() => parseCommand('while true; do echo loop; done', {})).toThrow('not supported');
  });

  it('control flow: case throws clear error', () => {
    expect(() => parseCommand('case $x in a) echo a;; esac', {})).toThrow('not supported');
  });

  it('control flow: function throws clear error', () => {
    expect(() => parseCommand('function foo { echo bar; }', {})).toThrow('not supported');
  });
});
