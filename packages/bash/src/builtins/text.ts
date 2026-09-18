// ============================================================================
// @vesper/bash — Text Processing Builtin Commands
// grep, wc, echo, sort, uniq, tee, xargs
// ============================================================================

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { BuiltinFn, CommandContext, ExecResult } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(stdout = ''): ExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string, code = 1): ExecResult {
  return { stdout: '', stderr, exitCode: code };
}

function resolve(cwd: string, p: string): string {
  return path.resolve(cwd, p);
}

/** Parse short boolean flags and collect remaining positional args. */
function parseFlags(
  args: string[],
  known: Set<string>,
): { flags: Set<string>; rest: string[] } {
  const flags = new Set<string>();
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === '--') {
      rest.push(...args.slice(args.indexOf(arg) + 1));
      break;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (const ch of arg.slice(1)) {
        if (known.has(ch)) flags.add(ch);
      }
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

/**
 * Read content from a file path (with sandbox check) or return undefined if
 * the file doesn't exist / can't be read.
 */
async function readFile(
  filePath: string,
  cwd: string,
  ctx: CommandContext,
): Promise<{ content: string } | { error: string }> {
  const resolved = resolve(cwd, filePath);
  try {
    ctx.sandbox.checkPath(resolved, 'read');
  } catch (e: unknown) {
    return { error: (e as Error).message };
  }
  try {
    const content = await fs.readFile(resolved, 'utf-8');
    return { content };
  } catch {
    return { error: `${filePath}: No such file or directory` };
  }
}

/**
 * Collect text content from file arguments or stdin.
 * Returns per-source entries (filename + content) for commands that need to
 * distinguish between files (like grep -l) or a single merged result.
 */
async function collectInputs(
  files: string[],
  ctx: CommandContext,
): Promise<
  | { ok: true; inputs: { name: string; content: string }[] }
  | { ok: false; error: ExecResult }
> {
  if (files.length === 0) {
    return { ok: true, inputs: [{ name: '(stdin)', content: ctx.stdin }] };
  }
  const inputs: { name: string; content: string }[] = [];
  for (const f of files) {
    const result = await readFile(f, ctx.cwd, ctx);
    if ('error' in result) {
      return { ok: false, error: err(result.error) };
    }
    inputs.push({ name: f, content: result.content });
  }
  return { ok: true, inputs };
}

/**
 * Recursively collect files under a directory for grep -r.
 */
async function collectFilesRecursive(
  dir: string,
  ctx: CommandContext,
): Promise<string[]> {
  const resolved = resolve(ctx.cwd, dir);
  ctx.sandbox.checkPath(resolved, 'read');
  const results: string[] = [];

  let entries;
  try {
    entries = await fs.readdir(resolved, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(resolved, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await collectFilesRecursive(fullPath, ctx);
      results.push(...subFiles);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------

/**
 * Simple glob match for --include/--exclude patterns.
 */
function grepGlobMatch(pattern: string, name: string): boolean {
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if ('.+^${}()|[]\\'.includes(ch)) re += '\\' + ch;
    else re += ch;
  }
  return new RegExp(`^${re}$`).test(name);
}

const grep: BuiltinFn = async (args, ctx) => {
  try {
    // Advanced argument parsing for grep — handles both short flags and valued flags
    let caseInsensitive = false;
    let showLineNumbers = false;
    let recursive = false;
    let filesOnly = false;
    let invert = false;
    let countOnly = false;
    let wholeWord = false;
    let onlyMatching = false;
    let fixedString = false;
    let afterCtx = 0, beforeCtx = 0;
    let maxCount = 0;
    let includeGlob: string | null = null;
    let excludeGlob: string | null = null;
    const positional: string[] = [];

    let i = 0;
    while (i < args.length) {
      const a = args[i];
      if (a === '--') { positional.push(...args.slice(i + 1)); break; }
      if (a.startsWith('--include=')) { includeGlob = a.slice('--include='.length); i++; continue; }
      if (a.startsWith('--exclude=')) { excludeGlob = a.slice('--exclude='.length); i++; continue; }
      if (a === '-A' && i + 1 < args.length) { afterCtx = parseInt(args[++i], 10) || 0; i++; continue; }
      if (a === '-B' && i + 1 < args.length) { beforeCtx = parseInt(args[++i], 10) || 0; i++; continue; }
      if (a === '-C' && i + 1 < args.length) { const n = parseInt(args[++i], 10) || 0; afterCtx = n; beforeCtx = n; i++; continue; }
      if (a === '-m' && i + 1 < args.length) { maxCount = parseInt(args[++i], 10) || 0; i++; continue; }
      if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) {
        for (const ch of a.slice(1)) {
          switch (ch) {
            case 'i': caseInsensitive = true; break;
            case 'n': showLineNumbers = true; break;
            case 'r': case 'R': recursive = true; break;
            case 'l': filesOnly = true; break;
            case 'v': invert = true; break;
            case 'c': countOnly = true; break;
            case 'w': wholeWord = true; break;
            case 'o': onlyMatching = true; break;
            case 'E': break; // extended regex is default
            case 'F': fixedString = true; break;
          }
        }
        i++; continue;
      }
      positional.push(a);
      i++;
    }

    if (positional.length === 0) return err('grep: missing pattern');

    let patternStr = positional[0];
    const fileArgs = positional.slice(1);

    // Fixed string mode: escape regex specials
    if (fixedString) {
      patternStr = patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    // Whole word match
    if (wholeWord) {
      patternStr = `\\b${patternStr}\\b`;
    }

    let regex: RegExp;
    try {
      regex = new RegExp(patternStr, caseInsensitive ? 'gi' : 'g');
    } catch {
      return err(`grep: invalid regular expression '${positional[0]}'`);
    }

    // Collect files to search
    let searchFiles: { name: string; content: string }[] = [];

    if (fileArgs.length === 0 && !recursive) {
      searchFiles = [{ name: '(stdin)', content: ctx.stdin }];
    } else if (recursive) {
      const dirs = fileArgs.length > 0 ? fileArgs : ['.'];
      const allPaths: string[] = [];
      for (const dir of dirs) {
        const resolvedDir = resolve(ctx.cwd, dir);
        let stat;
        try { stat = await fs.stat(resolvedDir); } catch { return err(`grep: ${dir}: No such file or directory`); }
        if (stat.isDirectory()) {
          const files = await collectFilesRecursive(dir, ctx);
          allPaths.push(...files);
        } else {
          allPaths.push(resolvedDir);
        }
      }
      for (const fp of allPaths) {
        const baseName = path.basename(fp);
        if (includeGlob && !grepGlobMatch(includeGlob, baseName)) continue;
        if (excludeGlob && grepGlobMatch(excludeGlob, baseName)) continue;
        ctx.sandbox.checkPath(fp, 'read');
        try {
          const content = await fs.readFile(fp, 'utf-8');
          searchFiles.push({ name: path.relative(ctx.cwd, fp), content });
        } catch { /* skip unreadable */ }
      }
    } else {
      for (const f of fileArgs) {
        const result = await readFile(f, ctx.cwd, ctx);
        if ('error' in result) return err(`grep: ${result.error}`);
        searchFiles.push({ name: f, content: result.content });
      }
    }

    const multiFile = searchFiles.length > 1;
    const outputLines: string[] = [];
    let anyMatch = false;
    const hasContext = afterCtx > 0 || beforeCtx > 0;

    for (const { name, content } of searchFiles) {
      const lines = content.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

      let fileMatchCount = 0;

      if (countOnly) {
        let count = 0;
        for (const line of lines) {
          regex.lastIndex = 0;
          const matches = regex.test(line);
          if (invert ? !matches : matches) {
            count++;
            if (maxCount > 0 && count >= maxCount) break;
          }
        }
        const prefix = multiFile ? `${name}:` : '';
        outputLines.push(`${prefix}${count}`);
        if (count > 0) anyMatch = true;
        continue;
      }

      if (hasContext) {
        // Context mode: track before-context window and after-context remaining
        const beforeBuf: string[] = [];
        let afterRemaining = 0;
        let lastPrintedIdx = -1;

        for (let li = 0; li < lines.length; li++) {
          regex.lastIndex = 0;
          const matches = regex.test(line(li));
          const include = invert ? !matches : matches;

          if (include) {
            anyMatch = true;
            fileMatchCount++;
            if (filesOnly) { outputLines.push(name); break; }

            // Print separator if there's a gap
            if (lastPrintedIdx >= 0 && li - lastPrintedIdx > 1 && beforeBuf.length < li - lastPrintedIdx - 1) {
              outputLines.push('--');
            }
            // Flush before-context
            for (let bi = 0; bi < beforeBuf.length; bi++) {
              const bIdx = li - beforeBuf.length + bi;
              if (bIdx > lastPrintedIdx) {
                outputLines.push(fmtLine(name, bIdx, lines[bIdx], '-', multiFile, showLineNumbers));
                lastPrintedIdx = bIdx;
              }
            }
            beforeBuf.length = 0;
            // Print match line
            if (onlyMatching) {
              regex.lastIndex = 0;
              let m;
              while ((m = regex.exec(lines[li])) !== null) {
                const prefix = (multiFile ? `${name}:` : '') + (showLineNumbers ? `${li + 1}:` : '');
                outputLines.push(`${prefix}${m[0]}`);
              }
            } else {
              outputLines.push(fmtLine(name, li, lines[li], ':', multiFile, showLineNumbers));
            }
            lastPrintedIdx = li;
            afterRemaining = afterCtx;

            if (maxCount > 0 && fileMatchCount >= maxCount) break;
          } else if (afterRemaining > 0) {
            outputLines.push(fmtLine(name, li, lines[li], '-', multiFile, showLineNumbers));
            lastPrintedIdx = li;
            afterRemaining--;
          } else {
            beforeBuf.push(lines[li]);
            if (beforeBuf.length > beforeCtx) beforeBuf.shift();
          }
        }
      } else {
        // Simple mode (no context)
        for (let li = 0; li < lines.length; li++) {
          regex.lastIndex = 0;
          const matches = regex.test(lines[li]);
          const include = invert ? !matches : matches;

          if (include) {
            anyMatch = true;
            fileMatchCount++;
            if (filesOnly) { outputLines.push(name); break; }

            if (onlyMatching) {
              regex.lastIndex = 0;
              let m;
              while ((m = regex.exec(lines[li])) !== null) {
                const prefix = (multiFile ? `${name}:` : '') + (showLineNumbers ? `${li + 1}:` : '');
                outputLines.push(`${prefix}${m[0]}`);
              }
            } else {
              let prefix = '';
              if (multiFile) prefix += `${name}:`;
              if (showLineNumbers) prefix += `${li + 1}:`;
              outputLines.push(`${prefix}${lines[li]}`);
            }
            if (maxCount > 0 && fileMatchCount >= maxCount) break;
          }
        }
      }

      void fileMatchCount;

      // Helper to access lines (avoids closure issues with context mode)
      function line(idx: number) { return lines[idx]; }
    }

    if (!anyMatch) return { stdout: '', stderr: '', exitCode: 1 };
    return ok(outputLines.join('\n') + '\n');
  } catch (e: unknown) {
    return err(`grep: ${(e as Error).message}`);
  }
};

function fmtLine(name: string, idx: number, line: string, sep: string, multi: boolean, lineNum: boolean): string {
  let prefix = '';
  if (multi) prefix += `${name}${sep}`;
  if (lineNum) prefix += `${idx + 1}${sep}`;
  return `${prefix}${line}`;
}

// ---------------------------------------------------------------------------
// wc
// ---------------------------------------------------------------------------

const wc: BuiltinFn = async (args, ctx) => {
  try {
    const { flags, rest } = parseFlags(args, new Set(['l', 'w', 'c']));
    const countLines = flags.has('l');
    const countWords = flags.has('w');
    const countChars = flags.has('c');
    // If no specific flag, show all three
    const showAll = !countLines && !countWords && !countChars;

    const inputs = await collectInputs(rest, ctx);
    if (!inputs.ok) return inputs.error;

    const outputLines: string[] = [];
    let totalLines = 0;
    let totalWords = 0;
    let totalChars = 0;

    for (const { name, content } of inputs.inputs) {
      const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
      const words = content.trim().length === 0
        ? 0
        : content.trim().split(/\s+/).length;
      const chars = content.length;

      totalLines += lines;
      totalWords += words;
      totalChars += chars;

      const parts: string[] = [];
      if (showAll || countLines) parts.push(String(lines).padStart(8));
      if (showAll || countWords) parts.push(String(words).padStart(8));
      if (showAll || countChars) parts.push(String(chars).padStart(8));

      const label = inputs.inputs.length === 1 && name === '(stdin)' ? '' : ` ${name}`;
      outputLines.push(parts.join('') + label);
    }

    // Show totals if multiple files
    if (inputs.inputs.length > 1) {
      const parts: string[] = [];
      if (showAll || countLines) parts.push(String(totalLines).padStart(8));
      if (showAll || countWords) parts.push(String(totalWords).padStart(8));
      if (showAll || countChars) parts.push(String(totalChars).padStart(8));
      outputLines.push(parts.join('') + ' total');
    }

    return ok(outputLines.join('\n') + '\n');
  } catch (e: unknown) {
    return err(`wc: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// echo
// ---------------------------------------------------------------------------

const echo: BuiltinFn = async (args, _ctx) => {
  // Check for -n flag (no trailing newline)
  let noNewline = false;
  let startIdx = 0;
  if (args.length > 0 && args[0] === '-n') {
    noNewline = true;
    startIdx = 1;
  }

  const text = args.slice(startIdx).join(' ');
  return ok(noNewline ? text : text + '\n');
};

// ---------------------------------------------------------------------------
// sort
// ---------------------------------------------------------------------------

const sort: BuiltinFn = async (args, ctx) => {
  try {
    let reverse = false, numeric = false, unique = false, foldCase = false, stable = false;
    let keyDef: string | null = null;
    let fieldSep: string | null = null;
    const fileArgs: string[] = [];

    let i = 0;
    while (i < args.length) {
      const a = args[i];
      if (a === '-k' && i + 1 < args.length) { keyDef = args[++i]; i++; continue; }
      if (a === '-t' && i + 1 < args.length) { fieldSep = args[++i]; i++; continue; }
      if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) {
        for (const ch of a.slice(1)) {
          switch (ch) {
            case 'r': reverse = true; break;
            case 'n': numeric = true; break;
            case 'u': unique = true; break;
            case 'f': foldCase = true; break;
            case 's': stable = true; break;
          }
        }
        i++; continue;
      }
      fileArgs.push(a);
      i++;
    }

    const inputs = await collectInputs(fileArgs, ctx);
    if (!inputs.ok) return inputs.error;

    const allContent = inputs.inputs.map((inp) => inp.content).join('');
    const lines = allContent.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    // Key extraction helper
    const getKey = (line: string): string => {
      if (!keyDef) return line;
      // Parse key like "2" or "2,2" — only use start field for simplicity
      const parts = keyDef.split(',');
      const fieldNum = parseInt(parts[0], 10);
      if (isNaN(fieldNum) || fieldNum < 1) return line;
      const sep = fieldSep ?? /\s+/;
      const fields = line.split(sep);
      if (parts.length === 2) {
        const endField = parseInt(parts[1], 10);
        return fields.slice(fieldNum - 1, endField).join(typeof sep === 'string' ? sep : ' ');
      }
      return fields[fieldNum - 1] ?? '';
    };

    // Stable sort: preserve original indices
    const indexed = lines.map((line, idx) => ({ line, idx }));

    indexed.sort((a, b) => {
      let ka = getKey(a.line);
      let kb = getKey(b.line);
      if (foldCase) { ka = ka.toLowerCase(); kb = kb.toLowerCase(); }

      let cmp: number;
      if (numeric) {
        cmp = (parseFloat(ka) || 0) - (parseFloat(kb) || 0);
      } else {
        cmp = ka.localeCompare(kb);
      }
      if (cmp === 0 && stable) return a.idx - b.idx;
      return cmp;
    });

    let result = indexed.map((x) => x.line);
    if (reverse) result.reverse();
    if (unique) result = [...new Set(result)];

    if (result.length === 0) return ok('');
    return ok(result.join('\n') + '\n');
  } catch (e: unknown) {
    return err(`sort: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// uniq
// ---------------------------------------------------------------------------

const uniq: BuiltinFn = async (args, ctx) => {
  try {
    const { flags, rest } = parseFlags(args, new Set(['c', 'd', 'u']));
    const showCount = flags.has('c');
    const onlyDuplicates = flags.has('d');
    const onlyUnique = flags.has('u');

    const inputs = await collectInputs(rest, ctx);
    if (!inputs.ok) return inputs.error;

    const allContent = inputs.inputs.map((i) => i.content).join('');
    const lines = allContent.split('\n');

    // Remove trailing empty element
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (lines.length === 0) return ok('');

    // Group consecutive duplicates
    const groups: { line: string; count: number }[] = [];
    let currentLine = lines[0];
    let currentCount = 1;

    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === currentLine) {
        currentCount++;
      } else {
        groups.push({ line: currentLine, count: currentCount });
        currentLine = lines[i];
        currentCount = 1;
      }
    }
    groups.push({ line: currentLine, count: currentCount });

    // Filter based on flags
    let filtered = groups;
    if (onlyDuplicates) {
      filtered = groups.filter((g) => g.count > 1);
    } else if (onlyUnique) {
      filtered = groups.filter((g) => g.count === 1);
    }

    const outputLines = filtered.map((g) => {
      if (showCount) {
        return `${String(g.count).padStart(7)} ${g.line}`;
      }
      return g.line;
    });

    if (outputLines.length === 0) return ok('');
    return ok(outputLines.join('\n') + '\n');
  } catch (e: unknown) {
    return err(`uniq: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// tee
// ---------------------------------------------------------------------------

const tee: BuiltinFn = async (args, ctx) => {
  try {
    const { flags, rest } = parseFlags(args, new Set(['a']));
    const append = flags.has('a');

    const content = ctx.stdin;

    // Write to each file
    for (const file of rest) {
      const resolved = resolve(ctx.cwd, file);
      ctx.sandbox.checkPath(resolved, 'write');

      try {
        if (append) {
          await fs.appendFile(resolved, content, 'utf-8');
        } else {
          await fs.writeFile(resolved, content, 'utf-8');
        }
      } catch (e: unknown) {
        return err(`tee: ${file}: ${(e as Error).message}`);
      }
    }

    // tee also passes stdin through to stdout
    return ok(content);
  } catch (e: unknown) {
    return err(`tee: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// xargs
// ---------------------------------------------------------------------------

const xargs: BuiltinFn = async (args, ctx) => {
  try {
    let replaceStr: string | null = null;
    let maxArgs = 0;
    let delimiter: string | null = null;
    const cmdParts: string[] = [];

    let i = 0;
    while (i < args.length) {
      if (args[i] === '-I' && i + 1 < args.length) { replaceStr = args[++i]; i++; continue; }
      if (args[i] === '-n' && i + 1 < args.length) { maxArgs = parseInt(args[++i], 10) || 0; i++; continue; }
      if (args[i] === '-0') { delimiter = '\0'; i++; continue; }
      if (args[i] === '-d' && i + 1 < args.length) { delimiter = args[++i]; i++; continue; }
      cmdParts.push(args[i]);
      i++;
    }

    const command = cmdParts[0] || 'echo';
    const baseArgs = cmdParts.slice(1);

    // Split stdin into tokens
    let stdinTokens: string[];
    if (delimiter !== null) {
      stdinTokens = ctx.stdin.split(delimiter).filter(Boolean);
    } else {
      stdinTokens = ctx.stdin.trim().split(/\s+/).filter(Boolean);
    }

    if (stdinTokens.length === 0) {
      return ok('');
    }

    // -I mode: run one command per token, replacing placeholder
    if (replaceStr) {
      const results: string[] = [];
      for (const token of stdinTokens) {
        const fullArgs = baseArgs.map(a => a.replaceAll(replaceStr!, token));
        const cmdLine = `${command} ${fullArgs.join(' ')}`;
        if (ctx.executeCommand) {
          const r = await ctx.executeCommand(cmdLine);
          if (r.exitCode !== 0) return r;
          results.push(r.stdout);
        } else if (command === 'echo') {
          results.push(fullArgs.join(' ') + '\n');
        } else {
          results.push(cmdLine + '\n');
        }
      }
      return ok(results.join(''));
    }

    // -n mode: batch tokens
    if (maxArgs > 0) {
      const results: string[] = [];
      for (let j = 0; j < stdinTokens.length; j += maxArgs) {
        const batch = stdinTokens.slice(j, j + maxArgs);
        const finalArgs = [...baseArgs, ...batch];
        if (command === 'echo') {
          results.push(finalArgs.join(' ') + '\n');
        } else if (ctx.executeCommand) {
          const cmdLine = `${command} ${finalArgs.join(' ')}`;
          const r = await ctx.executeCommand(cmdLine);
          if (r.exitCode !== 0) return r;
          results.push(r.stdout);
        } else {
          results.push(`${command} ${finalArgs.join(' ')}\n`);
        }
      }
      return ok(results.join(''));
    }

    // Default mode: all tokens in one invocation
    const finalArgs = [...baseArgs, ...stdinTokens];
    if (command === 'echo') {
      return ok(finalArgs.join(' ') + '\n');
    }

    if (ctx.executeCommand) {
      const cmdLine = `${command} ${finalArgs.join(' ')}`;
      return ctx.executeCommand(cmdLine);
    }

    return ok(`${command} ${finalArgs.join(' ')}\n`);
  } catch (e: unknown) {
    return err(`xargs: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// sed — Stream Editor (basic subset)
// ---------------------------------------------------------------------------

interface SedCommand {
  addr: SedAddress | null;
  action: 's' | 'd' | 'p';
  // For 's' action:
  pattern?: RegExp;
  replacement?: string;
  globalFlag?: boolean;
}

type SedAddress =
  | { type: 'line'; n: number }
  | { type: 'range'; start: number; end: number }
  | { type: 'regex'; pattern: RegExp }
  | { type: 'last' };

function parseSedScript(script: string): SedCommand[] {
  const commands: SedCommand[] = [];
  // Trim surrounding whitespace
  const s = script.trim();

  // Try s/old/new/flags
  const sMatch = s.match(/^(?:(\d+|\/[^/]*\/)(?:,(\d+|\$|\/[^/]*\/))?)?s(.)(.+)\3(.*)\3([gi]*)$/);
  if (sMatch) {
    const [, addrStart, addrEnd, , pat, rep, flags] = sMatch;
    let addr: SedAddress | null = null;
    if (addrStart) addr = parseSedAddr(addrStart, addrEnd);

    const regexFlags = (flags.includes('i') ? 'i' : '') + (flags.includes('g') ? 'g' : '');
    commands.push({
      addr,
      action: 's',
      pattern: new RegExp(pat, regexFlags || undefined),
      replacement: rep,
      globalFlag: flags.includes('g'),
    });
    return commands;
  }

  // Try line/range + action (d or p)
  const actionMatch = s.match(/^(?:(\d+|\$|\/[^/]*\/)(?:,(\d+|\$|\/[^/]*\/))?)?([dp])$/);
  if (actionMatch) {
    const [, addrStart, addrEnd, action] = actionMatch;
    let addr: SedAddress | null = null;
    if (addrStart) addr = parseSedAddr(addrStart, addrEnd);
    commands.push({ addr, action: action as 'd' | 'p' });
    return commands;
  }

  return commands;
}

function parseSedAddr(start: string | undefined, end: string | undefined): SedAddress | null {
  if (!start) return null;

  const parseOne = (s: string): { type: 'line'; n: number } | { type: 'regex'; pattern: RegExp } | { type: 'last' } => {
    if (s === '$') return { type: 'last' };
    if (s.startsWith('/') && s.endsWith('/')) {
      return { type: 'regex', pattern: new RegExp(s.slice(1, -1)) };
    }
    return { type: 'line', n: parseInt(s, 10) };
  };

  if (end) {
    const s = parseOne(start);
    const e = parseOne(end);
    if (s.type === 'line' && (e.type === 'line' || e.type === 'last')) {
      return { type: 'range', start: s.n, end: e.type === 'last' ? Infinity : e.n };
    }
    // For regex ranges, just use start address
    return s;
  }

  return parseOne(start);
}

function sedAddressMatches(addr: SedAddress | null, lineNum: number, line: string, totalLines: number): boolean {
  if (!addr) return true;
  switch (addr.type) {
    case 'line': return lineNum === addr.n;
    case 'range': return lineNum >= addr.start && lineNum <= (addr.end === Infinity ? totalLines : addr.end);
    case 'regex': return addr.pattern.test(line);
    case 'last': return lineNum === totalLines;
  }
}

const sed: BuiltinFn = async (args, ctx) => {
  try {
    let inPlace = false;
    let suppressOutput = false;
    const expressions: string[] = [];
    const files: string[] = [];

    let i = 0;
    while (i < args.length) {
      if (args[i] === '-i') { inPlace = true; i++; continue; }
      if (args[i] === '-n') { suppressOutput = true; i++; continue; }
      if (args[i] === '-e' && i + 1 < args.length) { expressions.push(args[++i]); i++; continue; }
      if (expressions.length === 0 && !args[i].startsWith('-')) {
        // First non-flag argument is the expression if no -e given yet
        expressions.push(args[i]);
        i++; continue;
      }
      if (!args[i].startsWith('-')) { files.push(args[i]); }
      i++;
    }

    if (expressions.length === 0) return err('sed: no expression provided');

    const commands = expressions.flatMap(e => parseSedScript(e));
    if (commands.length === 0) return err('sed: invalid expression');

    // Read input
    let input: string;
    if (files.length > 0) {
      const resolved = resolve(ctx.cwd, files[0]);
      ctx.sandbox.checkPath(resolved, 'read');
      try { input = await fs.readFile(resolved, 'utf-8'); } catch { return err(`sed: ${files[0]}: No such file or directory`); }
    } else {
      input = ctx.stdin;
    }

    const lines = input.split('\n');
    const hasTrailing = lines.length > 0 && lines[lines.length - 1] === '';
    if (hasTrailing) lines.pop();

    const totalLines = lines.length;
    const outputLines: string[] = [];

    for (let li = 0; li < lines.length; li++) {
      let line = lines[li];
      const lineNum = li + 1;
      let deleted = false;
      let printed = false;

      for (const cmd of commands) {
        if (!sedAddressMatches(cmd.addr, lineNum, line, totalLines)) continue;

        switch (cmd.action) {
          case 's':
            if (cmd.pattern && cmd.replacement !== undefined) {
              line = line.replace(cmd.pattern, cmd.replacement);
            }
            break;
          case 'd':
            deleted = true;
            break;
          case 'p':
            printed = true;
            break;
        }
        if (deleted) break;
      }

      if (!deleted) {
        if (suppressOutput) {
          if (printed) outputLines.push(line);
        } else {
          outputLines.push(line);
        }
      }
    }

    const result = outputLines.join('\n') + (hasTrailing || outputLines.length > 0 ? '\n' : '');

    if (inPlace && files.length > 0) {
      const resolved = resolve(ctx.cwd, files[0]);
      ctx.sandbox.checkPath(resolved, 'write');
      await fs.writeFile(resolved, result, 'utf-8');
      return ok();
    }

    return ok(result);
  } catch (e: unknown) {
    return err(`sed: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// awk — Pattern Processor (basic subset)
// ---------------------------------------------------------------------------

interface AwkRule {
  pattern: AwkPattern | null;
  action: string;
}

type AwkPattern =
  | { type: 'begin' }
  | { type: 'end' }
  | { type: 'regex'; pattern: RegExp }
  | { type: 'expr'; expr: string };

function parseAwkProgram(program: string): AwkRule[] {
  const rules: AwkRule[] = [];
  let pos = 0;
  const src = program.trim();

  while (pos < src.length) {
    // Skip whitespace
    while (pos < src.length && /\s/.test(src[pos])) pos++;
    if (pos >= src.length) break;

    let pattern: AwkPattern | null = null;

    // Check for BEGIN/END
    if (src.startsWith('BEGIN', pos) && (pos + 5 >= src.length || /[\s{]/.test(src[pos + 5]))) {
      pattern = { type: 'begin' };
      pos += 5;
    } else if (src.startsWith('END', pos) && (pos + 3 >= src.length || /[\s{]/.test(src[pos + 3]))) {
      pattern = { type: 'end' };
      pos += 3;
    } else if (src[pos] === '/') {
      // Regex pattern
      const end = src.indexOf('/', pos + 1);
      if (end > pos) {
        pattern = { type: 'regex', pattern: new RegExp(src.slice(pos + 1, end)) };
        pos = end + 1;
      }
    } else if (src[pos] !== '{') {
      // Expression pattern (e.g. NR==1)
      const braceIdx = src.indexOf('{', pos);
      if (braceIdx > pos) {
        const expr = src.slice(pos, braceIdx).trim();
        if (expr) pattern = { type: 'expr', expr };
        pos = braceIdx;
      }
    }

    // Skip whitespace
    while (pos < src.length && /\s/.test(src[pos])) pos++;

    // Extract action block
    if (pos < src.length && src[pos] === '{') {
      let depth = 1;
      let actionStart = pos + 1;
      pos++;
      while (pos < src.length && depth > 0) {
        if (src[pos] === '{') depth++;
        else if (src[pos] === '}') depth--;
        pos++;
      }
      const action = src.slice(actionStart, pos - 1).trim();
      rules.push({ pattern, action });
    } else {
      // No action block — default to print
      rules.push({ pattern, action: 'print' });
      // Skip to next rule
      if (pos < src.length && src[pos] === ';') pos++;
    }
  }

  return rules;
}

function awkEvalPattern(pattern: AwkPattern, fields: string[], nr: number, nf: number): boolean {
  switch (pattern.type) {
    case 'begin': return false;
    case 'end': return false;
    case 'regex': return pattern.pattern.test(fields[0] || '');
    case 'expr': return awkEvalCondition(pattern.expr, fields, nr, nf);
  }
}

function awkEvalCondition(expr: string, fields: string[], nr: number, nf: number): boolean {
  // Simple condition parser: NR==N, NR>=N, NR<=N, NR>N, NR<N, $N~/regex/
  const e = expr.trim();

  // NR comparisons
  const nrMatch = e.match(/^NR\s*(==|!=|>=|<=|>|<)\s*(\d+)$/);
  if (nrMatch) {
    const [, op, val] = nrMatch;
    const n = parseInt(val, 10);
    switch (op) {
      case '==': return nr === n;
      case '!=': return nr !== n;
      case '>=': return nr >= n;
      case '<=': return nr <= n;
      case '>': return nr > n;
      case '<': return nr < n;
    }
  }

  // NR>=N && NR<=M
  const rangeMatch = e.match(/^NR\s*>=\s*(\d+)\s*&&\s*NR\s*<=\s*(\d+)$/);
  if (rangeMatch) {
    const [, startStr, endStr] = rangeMatch;
    return nr >= parseInt(startStr, 10) && nr <= parseInt(endStr, 10);
  }

  // $N~/regex/
  const regexMatch = e.match(/^\$(\d+)\s*~\s*\/(.+)\/$/);
  if (regexMatch) {
    const [, fieldStr, pat] = regexMatch;
    const fIdx = parseInt(fieldStr, 10);
    const val = fIdx === 0 ? fields[0] : (fields[fIdx] ?? '');
    return new RegExp(pat).test(val);
  }

  // NF comparisons
  const nfMatch = e.match(/^NF\s*(==|!=|>=|<=|>|<)\s*(\d+)$/);
  if (nfMatch) {
    const [, op, val] = nfMatch;
    const n = parseInt(val, 10);
    switch (op) {
      case '==': return nf === n;
      case '!=': return nf !== n;
      case '>=': return nf >= n;
      case '<=': return nf <= n;
      case '>': return nf > n;
      case '<': return nf < n;
    }
  }

  // Fallback: treat as truthy
  return true;
}

function awkExecAction(action: string, fields: string[], nr: number, nf: number, vars: Record<string, number>, ofs: string): string | null {
  const statements = action.split(';').map(s => s.trim()).filter(Boolean);
  const results: string[] = [];

  for (const stmt of statements) {
    // Variable assignment: var=expr or var+=expr
    const assignMatch = stmt.match(/^([a-zA-Z_]\w*)\s*(\+?=)\s*(.+)$/);
    if (assignMatch && !stmt.startsWith('print')) {
      const [, varName, op, valExpr] = assignMatch;
      const val = awkEvalNumExpr(valExpr, fields, nr, nf, vars);
      if (op === '+=') {
        vars[varName] = (vars[varName] ?? 0) + val;
      } else {
        vars[varName] = val;
      }
      continue;
    }

    // print statement
    if (stmt === 'print' || stmt === 'print $0') {
      results.push(fields[0]);
      continue;
    }

    const printMatch = stmt.match(/^print\s+(.+)$/);
    if (printMatch) {
      const printArgs = printMatch[1];
      const output = awkEvalPrintArgs(printArgs, fields, nr, nf, vars, ofs);
      results.push(output);
      continue;
    }
  }

  return results.length > 0 ? results.join('\n') : null;
}

function awkEvalPrintArgs(args: string, fields: string[], nr: number, nf: number, vars: Record<string, number>, ofs: string): string {
  // Split by comma for multi-arg print
  const parts = splitAwkPrintArgs(args);
  const outputParts: string[] = [];

  for (const part of parts) {
    const p = part.trim();
    outputParts.push(awkResolveValue(p, fields, nr, nf, vars));
  }

  return outputParts.join(ofs);
}

function splitAwkPrintArgs(args: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (inString) {
      current += ch;
      if (ch === stringChar) inString = false;
    } else if (ch === '"') {
      inString = true;
      stringChar = ch;
      current += ch;
    } else if (ch === ',') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function awkResolveValue(expr: string, fields: string[], nr: number, nf: number, vars: Record<string, number>): string {
  const e = expr.trim();

  // String literal
  if (e.startsWith('"') && e.endsWith('"')) return e.slice(1, -1);

  // Field reference
  if (e.startsWith('$')) {
    const idx = parseInt(e.slice(1), 10);
    if (idx === 0) return fields[0];
    return fields[idx] ?? '';
  }

  // Built-in variables
  if (e === 'NR') return String(nr);
  if (e === 'NF') return String(nf);

  // User variable
  if (/^[a-zA-Z_]\w*$/.test(e) && e in vars) return String(vars[e]);

  // Simple arithmetic expression
  const numVal = awkEvalNumExpr(e, fields, nr, nf, vars);
  if (!isNaN(numVal) && e.match(/[\d$+\-*/]/)) return String(numVal);

  // String concatenation (space-separated tokens)
  if (e.includes(' ') && !e.includes(',')) {
    const tokens = e.split(/\s+/);
    return tokens.map(t => awkResolveValue(t, fields, nr, nf, vars)).join('');
  }

  return e;
}

function awkEvalNumExpr(expr: string, fields: string[], nr: number, nf: number, vars: Record<string, number>): number {
  const e = expr.trim();
  // Simple field reference
  if (e.startsWith('$')) {
    const idx = parseInt(e.slice(1), 10);
    const val = idx === 0 ? fields[0] : (fields[idx] ?? '');
    return parseFloat(val) || 0;
  }
  if (e === 'NR') return nr;
  if (e === 'NF') return nf;
  if (/^[a-zA-Z_]\w*$/.test(e)) return vars[e] ?? 0;
  const n = parseFloat(e);
  if (!isNaN(n)) return n;
  return 0;
}

const awk: BuiltinFn = async (args, ctx) => {
  try {
    let fs_sep: string | null = null;
    let ofs = ' ';
    const awkVars: Record<string, string> = {};
    let program: string | null = null;
    const files: string[] = [];

    let i = 0;
    while (i < args.length) {
      if (args[i] === '-F' && i + 1 < args.length) { fs_sep = args[++i]; i++; continue; }
      if (args[i].startsWith('-F') && args[i].length > 2) { fs_sep = args[i].slice(2); i++; continue; }
      if (args[i] === '-v' && i + 1 < args.length) {
        const vArg = args[++i];
        const eqIdx = vArg.indexOf('=');
        if (eqIdx > 0) awkVars[vArg.slice(0, eqIdx)] = vArg.slice(eqIdx + 1);
        i++; continue;
      }
      if (program === null) { program = args[i]; i++; continue; }
      files.push(args[i]);
      i++;
    }

    if (!program) return err('awk: no program given');

    const rules = parseAwkProgram(program);
    if (rules.length === 0) return err('awk: invalid program');

    // Read input
    let input: string;
    if (files.length > 0) {
      const resolved = resolve(ctx.cwd, files[0]);
      ctx.sandbox.checkPath(resolved, 'read');
      try { input = await fs.readFile(resolved, 'utf-8'); } catch { return err(`awk: ${files[0]}: No such file or directory`); }
    } else {
      input = ctx.stdin;
    }

    // Initialize variables
    const vars: Record<string, number> = {};
    for (const [k, v] of Object.entries(awkVars)) {
      const n = parseFloat(v);
      vars[k] = isNaN(n) ? 0 : n;
    }

    // Set OFS from vars if provided
    if ('OFS' in awkVars) ofs = awkVars['OFS'];

    const inputLines = input.split('\n');
    if (inputLines.length > 0 && inputLines[inputLines.length - 1] === '') inputLines.pop();

    const outputLines: string[] = [];

    // Execute BEGIN rules
    for (const rule of rules) {
      if (rule.pattern?.type === 'begin') {
        const separator = fs_sep ?? /\s+/;
        const r = awkExecAction(rule.action, [''], 0, 0, vars, ofs);
        if (r !== null) outputLines.push(r);
      }
    }

    // Process each line
    for (let li = 0; li < inputLines.length; li++) {
      const line = inputLines[li];
      const nr = li + 1;
      const separator = fs_sep
        ? (fs_sep.length === 1 ? fs_sep : new RegExp(fs_sep))
        : /\s+/;
      const fieldValues = line.split(separator);
      const fields = [line, ...fieldValues]; // $0 = whole line, $1...$N = fields
      const nf = fieldValues.length;

      for (const rule of rules) {
        if (rule.pattern?.type === 'begin' || rule.pattern?.type === 'end') continue;
        if (rule.pattern === null || awkEvalPattern(rule.pattern, fields, nr, nf)) {
          const r = awkExecAction(rule.action, fields, nr, nf, vars, ofs);
          if (r !== null) outputLines.push(r);
        }
      }
    }

    // Execute END rules
    for (const rule of rules) {
      if (rule.pattern?.type === 'end') {
        const r = awkExecAction(rule.action, [''], inputLines.length, 0, vars, ofs);
        if (r !== null) outputLines.push(r);
      }
    }

    if (outputLines.length === 0) return ok('');
    return ok(outputLines.join('\n') + '\n');
  } catch (e: unknown) {
    return err(`awk: ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const textBuiltins: Record<string, BuiltinFn> = {
  grep,
  wc,
  echo,
  sort,
  uniq,
  tee,
  xargs,
  sed,
  awk,
};
