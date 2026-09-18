// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Tokenizer Vocab Loader (embedded compressed data + cache)
// ═══════════════════════════════════════════════════════════════════════════

import { inflateSync } from 'fflate';
import { bytesToKey } from './bpe.js';
import { CL100K_COMPRESSED } from './data-cl100k.js';
import { O200K_COMPRESSED } from './data-o200k.js';

// ---------------------------------------------------------------------------
// Embedded data registry
// ---------------------------------------------------------------------------

const EMBEDDED: Record<string, string> = {
  cl100k_base: CL100K_COMPRESSED,
  o200k_base: O200K_COMPRESSED,
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const rankCache = new Map<string, Map<string, number>>();

// ---------------------------------------------------------------------------
// Base64 decode (Node built-in Buffer)
// ---------------------------------------------------------------------------

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// ---------------------------------------------------------------------------
// Load & parse embedded vocab
// ---------------------------------------------------------------------------

export function loadTiktokenBpe(name: string): Map<string, number> {
  const cached = rankCache.get(name);
  if (cached) return cached;

  const compressed = EMBEDDED[name];
  if (!compressed) throw new Error(`Unknown tokenizer vocab: ${name}`);

  // Decompress: base64 → deflate bytes → inflate → utf-8 text
  const deflated = b64ToBytes(compressed);
  const raw = inflateSync(deflated);
  const content = new TextDecoder().decode(raw);

  const ranks = new Map<string, number>();
  for (const line of content.split('\n')) {
    if (!line) continue;
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;
    const b64 = line.slice(0, spaceIdx);
    const rank = parseInt(line.slice(spaceIdx + 1), 10);
    const bytes = b64ToBytes(b64);
    ranks.set(bytesToKey(bytes), rank);
  }

  rankCache.set(name, ranks);
  return ranks;
}
