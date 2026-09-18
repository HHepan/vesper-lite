// ============================================================================
// @vesper/bash — Utility Builtin Commands
// printf, sleep, date, seq, mktemp, stat, diff, tr, cut, base64, md5sum, sha256sum
// ============================================================================

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import type { BuiltinFn, ExecResult } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(stdout = ''): ExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string, code = 1): ExecResult {
  return { stdout: '', stderr, exitCode: code };
}

function resolvePath(cwd: string, p: string): string {
  return path.resolve(cwd, p);
}

// ---------------------------------------------------------------------------
// printf
// ---------------------------------------------------------------------------

const printf: BuiltinFn = async (args, _ctx) => {
  if (args.length === 0) return ok();

  const fmt = args[0];
  const params = args.slice(1);
  let paramIdx = 0;
  let output = '';
  let i = 0;

  while (i < fmt.length) {
    if (fmt[i] === '\\') {
      i++;
      if (i < fmt.length) {
        switch (fmt[i]) {
          case 'n': output += '\n'; break;
          case 't': output += '\t'; break;
          case '\\': output += '\\'; break;
          case '0': output += '\0'; break;
          case 'r': output += '\r'; break;
          default: output += '\\' + fmt[i]; break;
        }
      }
      i++;
      continue;
    }

    if (fmt[i] === '%') {
      i++;
      if (i >= fmt.length) { output += '%'; break; }

      if (fmt[i] === '%') {
        output += '%';
        i++;
        continue;
      }

      // Parse optional width/precision
      let spec = '';
      while (i < fmt.length && /[-+ 0-9.]/.test(fmt[i])) {
        spec += fmt[i];
        i++;
      }

      if (i >= fmt.length) { output += '%' + spec; break; }

      const conv = fmt[i];
      const param = paramIdx < params.length ? params[paramIdx] : '';
      paramIdx++;

      switch (conv) {
        case 's':
          if (spec) {
            const width = parseInt(spec, 10);
            if (!isNaN(width)) {
              output += width < 0
                ? param.padEnd(-width)
                : param.padStart(width);
            } else {
              output += param;
            }
          } else {
            output += param;
          }
          break;
        case 'd': {
          const n = parseInt(param, 10) || 0;
          if (spec) {
            const width = parseInt(spec, 10);
            if (!isNaN(width)) {
              const s = String(n);
              output += spec.startsWith('0')
                ? s.padStart(Math.abs(width), '0')
                : width < 0 ? s.padEnd(-width) : s.padStart(width);
            } else {
              output += String(n);
            }
          } else {
            output += String(n);
          }
          break;
        }
        case 'f': {
          const f = parseFloat(param) || 0;
          // Check for .N precision
          const dotIdx = spec.indexOf('.');
          if (dotIdx >= 0) {
            const prec = parseInt(spec.slice(dotIdx + 1), 10);
            output += isNaN(prec) ? f.toFixed(6) : f.toFixed(prec);
          } else {
            output += f.toFixed(6);
          }
          break;
        }
        case 'x': {
          const n = parseInt(param, 10) || 0;
          output += (n >>> 0).toString(16);
          break;
        }
        case 'X': {
          const n = parseInt(param, 10) || 0;
          output += (n >>> 0).toString(16).toUpperCase();
          break;
        }
        default:
          output += '%' + spec + conv;
          break;
      }
      i++;
      continue;
    }

    output += fmt[i];
    i++;
  }

  return ok(output);
};

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

const sleep: BuiltinFn = async (args, _ctx) => {
  if (args.length === 0) return err('sleep: missing operand');

  const seconds = parseFloat(args[0]);
  if (isNaN(seconds) || seconds < 0) {
    return err(`sleep: invalid time interval '${args[0]}'`);
  }

  // Cap at 30s for agent safety
  const capped = Math.min(seconds, 30);
  await new Promise(resolve => setTimeout(resolve, capped * 1000));
  return ok();
};

// ---------------------------------------------------------------------------
// date
// ---------------------------------------------------------------------------

const date: BuiltinFn = async (args, _ctx) => {
  let utc = false;
  let format: string | null = null;
  let isoFormat = false;

  for (const arg of args) {
    if (arg === '-u') {
      utc = true;
    } else if (arg === '-Iseconds' || arg === '--iso-8601=seconds') {
      isoFormat = true;
    } else if (arg.startsWith('+')) {
      format = arg.slice(1);
    }
  }

  const now = new Date();

  if (isoFormat) {
    return ok(now.toISOString() + '\n');
  }

  if (!format) {
    return ok(now.toString() + '\n');
  }

  // strftime-like formatting
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const Y = utc ? now.getUTCFullYear() : now.getFullYear();
  const m = utc ? now.getUTCMonth() + 1 : now.getMonth() + 1;
  const d = utc ? now.getUTCDate() : now.getDate();
  const H = utc ? now.getUTCHours() : now.getHours();
  const M = utc ? now.getUTCMinutes() : now.getMinutes();
  const S = utc ? now.getUTCSeconds() : now.getSeconds();

  let output = '';
  let i = 0;
  while (i < format.length) {
    if (format[i] === '%') {
      i++;
      if (i >= format.length) { output += '%'; break; }
      switch (format[i]) {
        case 'Y': output += String(Y); break;
        case 'm': output += pad2(m); break;
        case 'd': output += pad2(d); break;
        case 'H': output += pad2(H); break;
        case 'M': output += pad2(M); break;
        case 'S': output += pad2(S); break;
        case 's': output += String(Math.floor(now.getTime() / 1000)); break;
        case 'F': output += `${Y}-${pad2(m)}-${pad2(d)}`; break;
        case 'T': output += `${pad2(H)}:${pad2(M)}:${pad2(S)}`; break;
        case 'Z': {
          if (utc) { output += 'UTC'; }
          else {
            const tz = Intl.DateTimeFormat('en', { timeZoneName: 'short' }).formatToParts(now);
            const tzPart = tz.find(p => p.type === 'timeZoneName');
            output += tzPart?.value ?? '';
          }
          break;
        }
        case 'n': output += '\n'; break;
        case 't': output += '\t'; break;
        case '%': output += '%'; break;
        default: output += '%' + format[i]; break;
      }
    } else {
      output += format[i];
    }
    i++;
  }

  return ok(output + '\n');
};

// ---------------------------------------------------------------------------
// seq
// ---------------------------------------------------------------------------

const seq: BuiltinFn = async (args, _ctx) => {
  let separator = '\n';
  let equalWidth = false;
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    if (args[i] === '-s' && i + 1 < args.length) {
      separator = args[i + 1];
      i += 2;
    } else if (args[i] === '-w') {
      equalWidth = true;
      i++;
    } else {
      positional.push(args[i]);
      i++;
    }
  }

  if (positional.length === 0) return err('seq: missing operand');

  let first = 1, increment = 1, last: number;
  if (positional.length === 1) {
    last = parseFloat(positional[0]);
  } else if (positional.length === 2) {
    first = parseFloat(positional[0]);
    last = parseFloat(positional[1]);
  } else {
    first = parseFloat(positional[0]);
    increment = parseFloat(positional[1]);
    last = parseFloat(positional[2]);
  }

  if (isNaN(first) || isNaN(increment) || isNaN(last)) {
    return err('seq: invalid argument');
  }
  if (increment === 0) return err('seq: zero increment');

  const numbers: number[] = [];
  if (increment > 0) {
    for (let n = first; n <= last + 1e-10; n += increment) numbers.push(n);
  } else {
    for (let n = first; n >= last - 1e-10; n += increment) numbers.push(n);
  }

  if (numbers.length === 0) return ok();

  let strs = numbers.map(n => Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (equalWidth) {
    const maxLen = Math.max(...strs.map(s => s.length));
    strs = strs.map(s => s.padStart(maxLen, '0'));
  }

  return ok(strs.join(separator) + '\n');
};

// ---------------------------------------------------------------------------
// mktemp
// ---------------------------------------------------------------------------

const mktemp: BuiltinFn = async (args, ctx) => {
  let isDir = false;
  let parentDir = tmpdir();
  let template = 'tmp.XXXXXXXXXX';

  let i = 0;
  while (i < args.length) {
    if (args[i] === '-d') {
      isDir = true;
      i++;
    } else if (args[i] === '-p' && i + 1 < args.length) {
      parentDir = resolvePath(ctx.cwd, args[i + 1]);
      i += 2;
    } else if (args[i] === '-t' && i + 1 < args.length) {
      template = args[i + 1];
      i += 2;
    } else if (!args[i].startsWith('-')) {
      template = args[i];
      i++;
    } else {
      i++;
    }
  }

  ctx.sandbox.checkPath(parentDir, 'write');

  // Replace X sequences with random chars
  const randomChars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const name = template.replace(/X/g, () =>
    randomChars[Math.floor(Math.random() * randomChars.length)]
  );
  const fullPath = path.join(parentDir, name);

  if (isDir) {
    await fs.mkdir(fullPath, { recursive: true });
  } else {
    await fs.writeFile(fullPath, '', { flag: 'wx' });
  }

  return ok(fullPath + '\n');
};

// ---------------------------------------------------------------------------
// stat
// ---------------------------------------------------------------------------

const statCmd: BuiltinFn = async (args, ctx) => {
  let format: string | null = null;
  const files: string[] = [];

  let i = 0;
  while (i < args.length) {
    if ((args[i] === '-c' || args[i] === '--format') && i + 1 < args.length) {
      format = args[i + 1];
      i += 2;
    } else if (args[i].startsWith('--format=')) {
      format = args[i].slice('--format='.length);
      i++;
    } else if (!args[i].startsWith('-')) {
      files.push(args[i]);
      i++;
    } else {
      i++;
    }
  }

  if (files.length === 0) return err('stat: missing operand');

  const output: string[] = [];

  for (const file of files) {
    const resolved = resolvePath(ctx.cwd, file);
    ctx.sandbox.checkPath(resolved, 'read');

    let s;
    try {
      s = await fs.stat(resolved);
    } catch {
      return err(`stat: cannot stat '${file}': No such file or directory`);
    }

    if (format) {
      let line = '';
      let j = 0;
      while (j < format.length) {
        if (format[j] === '%') {
          j++;
          if (j >= format.length) { line += '%'; break; }
          switch (format[j]) {
            case 's': line += String(s.size); break;
            case 'Y': line += String(Math.floor(s.mtimeMs / 1000)); break;
            case 'X': line += String(Math.floor(s.atimeMs / 1000)); break;
            case 'W': line += String(Math.floor(s.birthtimeMs / 1000)); break;
            case 'F':
              line += s.isDirectory() ? 'directory' : s.isFile() ? 'regular file' : s.isSymbolicLink() ? 'symbolic link' : 'other';
              break;
            case 'a': line += (s.mode & 0o7777).toString(8); break;
            case 'n': line += file; break;
            case 'N': line += `'${file}'`; break;
            default: line += '%' + format[j]; break;
          }
        } else if (format[j] === '\\') {
          j++;
          if (j < format.length) {
            if (format[j] === 'n') line += '\n';
            else if (format[j] === 't') line += '\t';
            else line += '\\' + format[j];
          }
        } else {
          line += format[j];
        }
        j++;
      }
      output.push(line);
    } else {
      const type = s.isDirectory() ? 'directory' : s.isFile() ? 'regular file' : 'other';
      const mode = (s.mode & 0o7777).toString(8);
      output.push(`  File: ${file}`);
      output.push(`  Size: ${s.size}\tType: ${type}`);
      output.push(`  Mode: (0${mode})\tUid: ${s.uid}\tGid: ${s.gid}`);
      output.push(`Modify: ${s.mtime.toISOString()}`);
      output.push(` Birth: ${s.birthtime.toISOString()}`);
    }
  }

  return ok(output.join('\n') + '\n');
};

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

const diff: BuiltinFn = async (args, ctx) => {
  let quiet = false;
  let contextLines = 3;
  const files: string[] = [];

  let i = 0;
  while (i < args.length) {
    if (args[i] === '-q') { quiet = true; i++; }
    else if (args[i] === '-u') { i++; } // unified is default
    else if (args[i] === '-U' && i + 1 < args.length) {
      contextLines = parseInt(args[i + 1], 10) || 3;
      i += 2;
    } else if (args[i] === '-C' && i + 1 < args.length) {
      contextLines = parseInt(args[i + 1], 10) || 3;
      i += 2;
    } else if (!args[i].startsWith('-')) {
      files.push(args[i]);
      i++;
    } else {
      i++;
    }
  }

  if (files.length < 2) return err('diff: missing operand');

  const file1 = resolvePath(ctx.cwd, files[0]);
  const file2 = resolvePath(ctx.cwd, files[1]);
  ctx.sandbox.checkPath(file1, 'read');
  ctx.sandbox.checkPath(file2, 'read');

  let content1: string, content2: string;
  try { content1 = await fs.readFile(file1, 'utf-8'); } catch { return err(`diff: ${files[0]}: No such file or directory`); }
  try { content2 = await fs.readFile(file2, 'utf-8'); } catch { return err(`diff: ${files[1]}: No such file or directory`); }

  if (content1 === content2) return ok();

  if (quiet) {
    return ok(`Files ${files[0]} and ${files[1]} differ\n`);
  }

  // Myers diff (line-level) — strip trailing empty line from split
  const aLines = content1.split('\n');
  const bLines = content2.split('\n');
  if (aLines.length > 0 && aLines[aLines.length - 1] === '') aLines.pop();
  if (bLines.length > 0 && bLines[bLines.length - 1] === '') bLines.pop();
  const editScript = myersDiff(aLines, bLines);

  // Generate unified diff output
  const hunks = buildHunks(editScript, aLines, bLines, contextLines);
  const out: string[] = [];
  out.push(`--- ${files[0]}`);
  out.push(`+++ ${files[1]}`);

  for (const hunk of hunks) {
    out.push(`@@ -${hunk.aStart + 1},${hunk.aCount} +${hunk.bStart + 1},${hunk.bCount} @@`);
    for (const line of hunk.lines) {
      out.push(line);
    }
  }

  return { stdout: out.join('\n') + '\n', stderr: '', exitCode: 1 };
};

// Simple Myers diff returning edit operations
interface Edit { type: '=' | '+' | '-'; aIdx: number; bIdx: number; }

function myersDiff(a: string[], b: string[]): Edit[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v: Record<number, number> = { 1: 0 };
  const trace: Record<number, number>[] = [];

  outer:
  for (let d = 0; d <= max; d++) {
    trace.push({ ...v });
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[k - 1] ?? 0) < (v[k + 1] ?? 0))) {
        x = v[k + 1] ?? 0;
      } else {
        x = (v[k - 1] ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  // Backtrack to build edit script
  const edits: Edit[] = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d - 1];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && (prev[k - 1] ?? 0) < (prev[k + 1] ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prev[prevK] ?? 0;
    const prevY = prevX - prevK;

    // Diagonal (equal lines)
    while (x > prevX && y > prevY) {
      x--; y--;
      edits.unshift({ type: '=', aIdx: x, bIdx: y });
    }
    if (x > prevX) {
      x--;
      edits.unshift({ type: '-', aIdx: x, bIdx: y });
    } else if (y > prevY) {
      y--;
      edits.unshift({ type: '+', aIdx: x, bIdx: y });
    }
  }
  // Remaining diagonal at d=0
  while (x > 0 && y > 0) {
    x--; y--;
    edits.unshift({ type: '=', aIdx: x, bIdx: y });
  }

  return edits;
}

interface Hunk { aStart: number; aCount: number; bStart: number; bCount: number; lines: string[]; }

function buildHunks(edits: Edit[], a: string[], b: string[], ctx: number): Hunk[] {
  // Find changed regions and surround with context
  const changed: number[] = [];
  for (let i = 0; i < edits.length; i++) {
    if (edits[i].type !== '=') changed.push(i);
  }
  if (changed.length === 0) return [];

  const hunks: Hunk[] = [];
  let hunkStart = Math.max(0, changed[0] - ctx);
  let hunkEnd = Math.min(edits.length - 1, changed[0] + ctx);

  for (let ci = 1; ci < changed.length; ci++) {
    const newStart = Math.max(0, changed[ci] - ctx);
    const newEnd = Math.min(edits.length - 1, changed[ci] + ctx);
    if (newStart <= hunkEnd + 1) {
      // Merge with current hunk
      hunkEnd = newEnd;
    } else {
      // Emit current hunk
      hunks.push(makeHunk(edits, a, b, hunkStart, hunkEnd));
      hunkStart = newStart;
      hunkEnd = newEnd;
    }
  }
  hunks.push(makeHunk(edits, a, b, hunkStart, hunkEnd));
  return hunks;
}

function makeHunk(edits: Edit[], a: string[], b: string[], start: number, end: number): Hunk {
  const lines: string[] = [];
  let aStart = Infinity, bStart = Infinity, aCount = 0, bCount = 0;
  for (let i = start; i <= end && i < edits.length; i++) {
    const e = edits[i];
    if (e.type === '=') {
      lines.push(' ' + a[e.aIdx]);
      if (e.aIdx < aStart) aStart = e.aIdx;
      if (e.bIdx < bStart) bStart = e.bIdx;
      aCount++; bCount++;
    } else if (e.type === '-') {
      lines.push('-' + a[e.aIdx]);
      if (e.aIdx < aStart) aStart = e.aIdx;
      if (e.bIdx < bStart) bStart = e.bIdx;
      aCount++;
    } else {
      lines.push('+' + b[e.bIdx]);
      if (e.aIdx < aStart) aStart = e.aIdx;
      if (e.bIdx < bStart) bStart = e.bIdx;
      bCount++;
    }
  }
  if (aStart === Infinity) aStart = 0;
  if (bStart === Infinity) bStart = 0;
  return { aStart, aCount, bStart, bCount, lines };
}

// ---------------------------------------------------------------------------
// tr
// ---------------------------------------------------------------------------

const tr: BuiltinFn = async (args, ctx) => {
  let deleteMode = false;
  let squeezeMode = false;
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    if (args[i] === '-d') { deleteMode = true; i++; }
    else if (args[i] === '-s') { squeezeMode = true; i++; }
    else { positional.push(args[i]); i++; }
  }

  const input = ctx.stdin;

  if (deleteMode) {
    if (positional.length < 1) return err('tr: missing operand');
    const charSet = expandTrSet(positional[0]);
    let output = '';
    for (const ch of input) {
      if (!charSet.has(ch)) output += ch;
    }
    return ok(output);
  }

  if (squeezeMode && positional.length === 1) {
    // Squeeze only mode
    const charSet = expandTrSet(positional[0]);
    let output = '';
    let prev = '';
    for (const ch of input) {
      if (charSet.has(ch) && ch === prev) continue;
      output += ch;
      prev = ch;
    }
    return ok(output);
  }

  if (positional.length < 2) return err('tr: missing operand');

  const set1 = expandTrSetToArray(positional[0]);
  const set2 = expandTrSetToArray(positional[1]);

  // Build translation map
  const map = new Map<string, string>();
  for (let j = 0; j < set1.length; j++) {
    const replacement = j < set2.length ? set2[j] : set2[set2.length - 1];
    map.set(set1[j], replacement);
  }

  let output = '';
  let prev = '';
  for (const ch of input) {
    let out = map.get(ch) ?? ch;
    if (squeezeMode && out === prev && (map.has(ch) || new Set(set2).has(ch))) {
      continue;
    }
    output += out;
    prev = out;
  }

  return ok(output);
};

function expandTrSet(spec: string): Set<string> {
  return new Set(expandTrSetToArray(spec));
}

function expandTrSetToArray(spec: string): string[] {
  const chars: string[] = [];
  let i = 0;
  while (i < spec.length) {
    // Character classes
    if (spec.startsWith('[:upper:]', i)) {
      for (let c = 65; c <= 90; c++) chars.push(String.fromCharCode(c));
      i += 9;
    } else if (spec.startsWith('[:lower:]', i)) {
      for (let c = 97; c <= 122; c++) chars.push(String.fromCharCode(c));
      i += 9;
    } else if (spec.startsWith('[:digit:]', i)) {
      for (let c = 48; c <= 57; c++) chars.push(String.fromCharCode(c));
      i += 9;
    } else if (spec.startsWith('[:alpha:]', i)) {
      for (let c = 65; c <= 90; c++) chars.push(String.fromCharCode(c));
      for (let c = 97; c <= 122; c++) chars.push(String.fromCharCode(c));
      i += 9;
    } else if (spec.startsWith('[:space:]', i)) {
      chars.push(' ', '\t', '\n', '\r', '\f', '\v');
      i += 9;
    } else if (i + 2 < spec.length && spec[i + 1] === '-') {
      // Range notation: a-z
      const start = spec.charCodeAt(i);
      const end = spec.charCodeAt(i + 2);
      if (start <= end) {
        for (let c = start; c <= end; c++) chars.push(String.fromCharCode(c));
      }
      i += 3;
    } else {
      chars.push(spec[i]);
      i++;
    }
  }
  return chars;
}

// ---------------------------------------------------------------------------
// cut
// ---------------------------------------------------------------------------

const cut: BuiltinFn = async (args, ctx) => {
  let delimiter = '\t';
  let fields: string | null = null;
  let charPositions: string | null = null;
  const files: string[] = [];

  let i = 0;
  while (i < args.length) {
    if (args[i] === '-d' && i + 1 < args.length) {
      delimiter = args[i + 1];
      i += 2;
    } else if (args[i].startsWith('-d') && args[i].length > 2) {
      delimiter = args[i].slice(2);
      i++;
    } else if (args[i] === '-f' && i + 1 < args.length) {
      fields = args[i + 1];
      i += 2;
    } else if (args[i].startsWith('-f') && args[i].length > 2) {
      fields = args[i].slice(2);
      i++;
    } else if (args[i] === '-c' && i + 1 < args.length) {
      charPositions = args[i + 1];
      i += 2;
    } else if (args[i].startsWith('-c') && args[i].length > 2) {
      charPositions = args[i].slice(2);
      i++;
    } else if (!args[i].startsWith('-')) {
      files.push(args[i]);
      i++;
    } else {
      i++;
    }
  }

  if (!fields && !charPositions) return err('cut: you must specify a list of bytes, characters, or fields');

  // Read input
  let input: string;
  if (files.length > 0) {
    const resolved = resolvePath(ctx.cwd, files[0]);
    ctx.sandbox.checkPath(resolved, 'read');
    try { input = await fs.readFile(resolved, 'utf-8'); } catch { return err(`cut: ${files[0]}: No such file or directory`); }
  } else {
    input = ctx.stdin;
  }

  const lines = input.split('\n');
  // Remove trailing empty line
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const outputLines: string[] = [];

  if (charPositions) {
    const ranges = parseRanges(charPositions);
    for (const line of lines) {
      const selected: string[] = [];
      for (const [start, end] of ranges) {
        for (let j = start; j <= Math.min(end, line.length); j++) {
          selected.push(line[j - 1] || '');
        }
      }
      outputLines.push(selected.join(''));
    }
  } else if (fields) {
    const ranges = parseRanges(fields);
    for (const line of lines) {
      const parts = line.split(delimiter);
      const selected: string[] = [];
      for (const [start, end] of ranges) {
        for (let j = start; j <= Math.min(end, parts.length); j++) {
          selected.push(parts[j - 1] || '');
        }
      }
      outputLines.push(selected.join(delimiter));
    }
  }

  if (outputLines.length === 0) return ok();
  return ok(outputLines.join('\n') + '\n');
};

/** Parse field/char range spec like "1", "1,3", "1-3", "2-" */
function parseRanges(spec: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const part of spec.split(',')) {
    if (part.includes('-')) {
      const [s, e] = part.split('-');
      const start = s ? parseInt(s, 10) : 1;
      const end = e ? parseInt(e, 10) : 999999;
      if (!isNaN(start) && !isNaN(end)) ranges.push([start, end]);
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) ranges.push([n, n]);
    }
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// base64
// ---------------------------------------------------------------------------

const base64: BuiltinFn = async (args, ctx) => {
  let decode = false;
  let wrapAt = 76;
  const files: string[] = [];

  let i = 0;
  while (i < args.length) {
    if (args[i] === '-d' || args[i] === '--decode') { decode = true; i++; }
    else if (args[i] === '-w' && i + 1 < args.length) {
      wrapAt = parseInt(args[i + 1], 10);
      i += 2;
    } else if (!args[i].startsWith('-')) {
      files.push(args[i]);
      i++;
    } else {
      i++;
    }
  }

  let input: string;
  if (files.length > 0) {
    const resolved = resolvePath(ctx.cwd, files[0]);
    ctx.sandbox.checkPath(resolved, 'read');
    try { input = await fs.readFile(resolved, 'utf-8'); } catch { return err(`base64: ${files[0]}: No such file or directory`); }
  } else {
    input = ctx.stdin;
  }

  if (decode) {
    // Strip whitespace before decoding
    const clean = input.replace(/\s/g, '');
    try {
      const decoded = Buffer.from(clean, 'base64').toString('utf-8');
      return ok(decoded);
    } catch {
      return err('base64: invalid input');
    }
  }

  // Encode
  const encoded = Buffer.from(input).toString('base64');
  if (wrapAt > 0) {
    const wrapped: string[] = [];
    for (let j = 0; j < encoded.length; j += wrapAt) {
      wrapped.push(encoded.slice(j, j + wrapAt));
    }
    return ok(wrapped.join('\n') + '\n');
  }
  return ok(encoded + '\n');
};

// ---------------------------------------------------------------------------
// md5sum
// ---------------------------------------------------------------------------

const md5sum: BuiltinFn = async (args, ctx) => {
  return hashCommand('md5', args, ctx);
};

// ---------------------------------------------------------------------------
// sha256sum
// ---------------------------------------------------------------------------

const sha256sum: BuiltinFn = async (args, ctx) => {
  return hashCommand('sha256', args, ctx);
};

async function hashCommand(algo: string, args: string[], ctx: { cwd: string; stdin: string; sandbox: { checkPath(p: string, op: 'read' | 'write'): void } }): Promise<ExecResult> {
  let checkFile: string | null = null;
  const files: string[] = [];

  let i = 0;
  while (i < args.length) {
    if (args[i] === '-c' && i + 1 < args.length) {
      checkFile = args[i + 1];
      i += 2;
    } else if (!args[i].startsWith('-')) {
      files.push(args[i]);
      i++;
    } else {
      i++;
    }
  }

  if (checkFile) {
    // Check mode
    const resolved = resolvePath(ctx.cwd, checkFile);
    ctx.sandbox.checkPath(resolved, 'read');
    let content: string;
    try { content = await fs.readFile(resolved, 'utf-8'); } catch { return err(`${algo}sum: ${checkFile}: No such file or directory`); }

    const lines = content.trim().split('\n');
    const output: string[] = [];
    let allOk = true;

    for (const line of lines) {
      const match = line.match(/^([0-9a-f]+)\s+(.+)$/);
      if (!match) continue;
      const [, expectedHash, fileName] = match;
      const filePath = resolvePath(ctx.cwd, fileName);
      ctx.sandbox.checkPath(filePath, 'read');
      try {
        const fileContent = await fs.readFile(filePath);
        const actualHash = crypto.createHash(algo).update(fileContent).digest('hex');
        if (actualHash === expectedHash) {
          output.push(`${fileName}: OK`);
        } else {
          output.push(`${fileName}: FAILED`);
          allOk = false;
        }
      } catch {
        output.push(`${fileName}: FAILED open or read`);
        allOk = false;
      }
    }

    return { stdout: output.join('\n') + '\n', stderr: '', exitCode: allOk ? 0 : 1 };
  }

  // Hash mode
  if (files.length === 0) {
    // Hash stdin
    const hash = crypto.createHash(algo).update(ctx.stdin).digest('hex');
    return ok(`${hash}  -\n`);
  }

  const output: string[] = [];
  for (const file of files) {
    const resolved = resolvePath(ctx.cwd, file);
    ctx.sandbox.checkPath(resolved, 'read');
    try {
      const content = await fs.readFile(resolved);
      const hash = crypto.createHash(algo).update(content).digest('hex');
      output.push(`${hash}  ${file}`);
    } catch {
      return err(`${algo}sum: ${file}: No such file or directory`);
    }
  }

  return ok(output.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const utilsBuiltins: Record<string, BuiltinFn> = {
  printf,
  sleep,
  date,
  seq,
  mktemp,
  stat: statCmd,
  diff,
  tr,
  cut,
  base64,
  md5sum,
  sha256sum,
};
