// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Tokenizer Public API
// ═══════════════════════════════════════════════════════════════════════════

import { bytePairEncode, bytesToKey } from './bpe.js';
import { loadTiktokenBpe } from './ranks.js';
import { CL100K_PATTERN, O200K_PATTERN } from './patterns.js';

// Shared TextEncoder singleton — avoids per-match allocation in hot paths.
const textEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Encoding definitions
// ---------------------------------------------------------------------------

interface EncodingDef {
  name: string;
  pattern: RegExp;
  vocabFile: string;
}

const ENCODINGS: Record<string, EncodingDef> = {
  cl100k_base: {
    name: 'cl100k_base',
    pattern: CL100K_PATTERN,
    vocabFile: 'cl100k_base',
  },
  o200k_base: {
    name: 'o200k_base',
    pattern: O200K_PATTERN,
    vocabFile: 'o200k_base',
  },
};

const DEFAULT_ENCODING = 'cl100k_base';

// ---------------------------------------------------------------------------
// BpeEncoding class
// ---------------------------------------------------------------------------

export class BpeEncoding {
  readonly name: string;
  private readonly pattern: RegExp;
  private readonly ranks: Map<string, number>;

  constructor(def: EncodingDef) {
    this.name = def.name;
    this.pattern = def.pattern;
    this.ranks = loadTiktokenBpe(def.vocabFile);
  }

  /** Encode text into token IDs. */
  encode(text: string): number[] {
    const tokens: number[] = [];
    // Reset regex state (it's global + unicode)
    const re = new RegExp(this.pattern.source, this.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const piece = textEncoder.encode(match[0]);
      const key = bytesToKey(piece);
      const direct = this.ranks.get(key);
      if (direct !== undefined) {
        tokens.push(direct);
      } else {
        tokens.push(...bytePairEncode(piece, this.ranks));
      }
    }
    return tokens;
  }

  /** Count tokens in text (without allocating the full token array). */
  countTokens(text: string): number {
    let count = 0;
    const re = new RegExp(this.pattern.source, this.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const piece = textEncoder.encode(match[0]);
      const key = bytesToKey(piece);
      if (this.ranks.has(key)) {
        count++;
      } else {
        count += bytePairEncode(piece, this.ranks).length;
      }
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// Encoding cache (lazy singleton per encoding name)
// ---------------------------------------------------------------------------

const encodingCache = new Map<string, BpeEncoding>();

/** Get (or create) a BpeEncoding instance by name. */
export function getEncoding(name?: string): BpeEncoding {
  const key = name ?? DEFAULT_ENCODING;
  let enc = encodingCache.get(key);
  if (enc) return enc;

  const def = ENCODINGS[key];
  if (!def) throw new Error(`Unknown encoding: ${key}`);

  enc = new BpeEncoding(def);
  encodingCache.set(key, enc);
  return enc;
}

// ---------------------------------------------------------------------------
// Model → Encoding mapping (subset from tiktoken/model.py)
// ---------------------------------------------------------------------------

const MODEL_TO_ENCODING: Record<string, string> = {
  'gpt-4o': 'o200k_base',
  'gpt-4': 'cl100k_base',
  'gpt-3.5-turbo': 'cl100k_base',
  'gpt-3.5': 'cl100k_base',
};

const MODEL_PREFIX_TO_ENCODING: Array<[string, string]> = [
  ['o1-', 'o200k_base'],
  ['o3-', 'o200k_base'],
  ['o4-mini-', 'o200k_base'],
  ['gpt-5-', 'o200k_base'],
  ['gpt-4.5-', 'o200k_base'],
  ['gpt-4.1-', 'o200k_base'],
  ['gpt-4o-', 'o200k_base'],
  ['gpt-4-', 'cl100k_base'],
  ['gpt-3.5-turbo-', 'cl100k_base'],
  ['chatgpt-4o-', 'o200k_base'],
];

/** Infer encoding name from model name. Falls back to cl100k_base. */
export function encodingForModel(model: string): string {
  if (MODEL_TO_ENCODING[model]) return MODEL_TO_ENCODING[model];
  for (const [prefix, enc] of MODEL_PREFIX_TO_ENCODING) {
    if (model.startsWith(prefix)) return enc;
  }
  return DEFAULT_ENCODING;
}

// ---------------------------------------------------------------------------
// Convenience: top-level countTokens
// ---------------------------------------------------------------------------

/**
 * Count tokens in text using BPE encoding.
 * Default encoding: cl100k_base.
 */
export function countTokens(text: string, encoding?: string): number {
  return getEncoding(encoding).countTokens(text);
}
