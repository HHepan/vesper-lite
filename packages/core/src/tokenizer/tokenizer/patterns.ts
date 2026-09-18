// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Tokenizer Regex Patterns (JS-compatible ports from tiktoken)
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// cl100k_base (GPT-4, GPT-3.5-turbo)
// Original PCRE possessive quantifiers (++) converted to greedy (+).
// In these patterns the possessive vs greedy distinction doesn't matter
// because the surrounding context prevents backtracking into them.
// ---------------------------------------------------------------------------

export const CL100K_PATTERN =
  /(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]|\s+(?!\S)|\s+/gu;

// ---------------------------------------------------------------------------
// o200k_base (GPT-4o, o1, o3, o4-mini)
// ---------------------------------------------------------------------------

export const O200K_PATTERN =
  /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n/]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;
