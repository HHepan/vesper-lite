import { loadImageAsDataUri } from './image-store.js';
// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Canvas (CanvasBlock architecture + Drift compression)
// ═══════════════════════════════════════════════════════════════════════════
//
// FOLDING INVARIANTS
// ═══════════════════════════════════════════════════════════════════════════
//
// There are exactly TWO reasons a block can be folded or evicted:
//
// 1. DRIFT FOLD (context budget exceeded)
//    - Triggered by executeDrift() when canvas tokens exceed the threshold.
//    - Marks blocks with foldReason='drift'. This is a PERMANENT fold.
//    - On session save, sanitizeStateForSave strips originalContent from
//      drift-folded blocks (important content has already been extracted
//      by the Memory Agent). They cannot be expanded after reload.
//    - Drift can also evict blocks entirely (evicted=true).
//
// 2. EGO-SWITCH FOLD (persona-based view filtering)
//    - Applied by foldConversationForPersona() as a VIEW-ONLY transformation.
//    - NEVER persisted to state.canvas — only applied when building the LLM
//      prompt (prompt-builder.ts) or history preview.
//    - Does NOT set foldReason on blocks.
//    - Public blocks and blocks belonging to the target persona are NEVER
//      folded, regardless of any other condition.
//    - On session load, reload, or regenerate, the canvas always reflects
//      the true state — no ego-switch folding carries over.
//
// Additionally, users can MANUALLY FOLD blocks via the Canvas Browser:
//    - Marks blocks with foldReason='manual'.
//    - originalContent is PRESERVED on session save so the block can be
//      expanded after reload.
//
// These invariants are enforced by:
//    - foldReason field on CanvasBlock (discriminates fold types)
//    - sanitizeStateForSave (preserves manual-fold originalContent,
//      strips drift-fold originalContent)
//    - restoreLegacyFoldedBlocks (unfolds pre-foldReason orphaned blocks
//      on session load/rollback)
//    - Defensive guards in foldConversationForPersona (never fold public
//      or target-persona blocks)

import { randomUUID } from 'node:crypto';
import type { AgentState, ApiToolCall, Canvas, CanvasBlock, CanvasConfig, CanvasBlockSummary, CanvasBrowserSnapshot, ToolResult } from '@vesper/shared';
import { countTokens } from './tokenizer/index.js';

// ---------------------------------------------------------------------------
// Ego Prefix Deduplication
// ---------------------------------------------------------------------------

/** Regex cache for ego prefix stripping. */
const EGO_PREFIX_RE_CACHE = new Map<string, RegExp>();

/**
 * Get or create a cached regex for stripping ego prefixes.
 * Matches: "Name: ", "Name\uff1a", "Name:Name: ", "Name\uff1aName\uff1a", etc.
 * Supports English colon, Chinese colon (\uff1a), optional trailing spaces.
 */
export function getEgoPrefixRegex(egoName: string): RegExp {
  const cached = EGO_PREFIX_RE_CACHE.get(egoName);
  if (cached) return cached;
  const escaped = egoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^(' + escaped + '[\uff1a:]\\s*)+');
  EGO_PREFIX_RE_CACHE.set(egoName, re);
  return re;
}

/**
 * Strip all leading ego name prefixes from text.
 * E.g. "\u7409\u7483: \u7409\u7483\uff1a\u4f60\u597d" -> { text: "\u4f60\u597d", hadPrefix: true }
 */
export function stripEgoPrefixes(text: string, egoName: string): { text: string; hadPrefix: boolean } {
  if (!egoName || !text) return { text, hadPrefix: false };
  const re = getEgoPrefixRegex(egoName);
  const match = text.match(re);
  if (!match) return { text, hadPrefix: false };
  return { text: text.slice(match[0].length), hadPrefix: true };
}

/**
 * Ensure text has exactly one ego prefix at the start.
 * Strip all leading prefixes and prepend a single clean one.
 */
export function ensureSingleEgoPrefix(text: string, egoName: string): string {
  if (!egoName || !text) return text;
  const { text: stripped } = stripEgoPrefixes(text, egoName);
  return egoName + ': ' + stripped;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_NESTING_DEPTH = 3;

// ---------------------------------------------------------------------------
// Block Factory
// ---------------------------------------------------------------------------

/**
 * Create a new CanvasBlock with auto-generated id, token count, and timestamp.
 */
export function createBlock(
  type: CanvasBlock['type'],
  content: string,
  options?: {
    pinned?: boolean;
    foldable?: boolean;
    parentId?: string;
    depth?: number;
    toolCallId?: string;
    pinZone?: 'top' | 'bottom';
    meta?: CanvasBlock['meta'];
    personaName?: string;
    public?: boolean;
    imageRefs?: string[];
    /** @deprecated Use systemInjected instead. */
    sideband?: boolean;
    /** Mark as system-injected (QQ, cron, link messages) for data collection. */
    systemInjected?: boolean;
    isError?: boolean;
  },
): CanvasBlock {
  // Deduplicate personaName prefix in text blocks.
  // The runtime injects "Persona: " prefix during streaming, but the LLM may also
  // imitate the pattern from historical context, producing "Persona: Persona: "
  // or mixed variants like "Persona\uff1aPersona: ". Strip ALL leading ego name prefixes
  // (supporting both English/Chinese colons and optional spacing) so the
  // block.content is always clean. Rendering layers add the prefix when displaying.
  let cleanContent = content;
  if (type === 'text' && options?.personaName) {
    const { text: stripped } = stripEgoPrefixes(content, options.personaName);
    cleanContent = stripped;
  }
  const block: CanvasBlock = {
    id: randomUUID(),
    type,
    content: cleanContent,
    tokens: countTokens(cleanContent),
    timestamp: Date.now(),
    pinned: options?.pinned ?? false,
    folded: false,
    foldable: options?.foldable ?? (type !== 'pin'),
  };
  if (options?.parentId !== undefined) block.parentId = options.parentId;
  if (options?.depth !== undefined) block.depth = options.depth;
  if (options?.toolCallId !== undefined) block.toolCallId = options.toolCallId;
  if (options?.pinZone !== undefined) block.pinZone = options.pinZone;
  if (options?.meta !== undefined) block.meta = options.meta;
  if (options?.personaName !== undefined) block.personaName = options.personaName;
  if (options?.public !== undefined) block.public = options.public;
  if (options?.imageRefs !== undefined) block.imageRefs = options.imageRefs;
  if (options?.sideband !== undefined) block.sideband = options.sideband;
  if (options?.systemInjected !== undefined) block.systemInjected = options.systemInjected;
  if (options?.isError !== undefined) block.isError = options.isError;
  return block;
}

// ---------------------------------------------------------------------------
// Append Operations
// ---------------------------------------------------------------------------

/**
 * Append a block to the canvas. Returns a new Canvas (immutable).
 */
export function appendBlock(canvas: Canvas, block: CanvasBlock): Canvas {
  return { blocks: [...canvas.blocks, block] };
}

/**
 * Upsert a block by ID. If a block with the same id exists, replace it in-place.
 * Otherwise append. Returns a new Canvas (immutable).
 */
export function upsertBlock(canvas: Canvas, block: CanvasBlock): Canvas {
  const idx = canvas.blocks.findIndex((b) => b.id === block.id);
  if (idx >= 0) {
    const blocks = [...canvas.blocks];
    blocks[idx] = block;
    return { blocks };
  }
  return appendBlock(canvas, block);
}

/**
 * Append text to the canvas. Merges into the last text block if possible
 * to avoid fragmentation. Returns a new Canvas (immutable).
 */
export function appendText(canvas: Canvas, text: string, config: CanvasConfig, personaName?: string): Canvas {
  if (!text) return canvas;

  const blocks = [...canvas.blocks];
  const last = blocks[blocks.length - 1];

  if (last && last.type === 'text' && !last.pinned && !last.folded) {
    // Merge into existing text block — use incremental token count to avoid
    // re-tokenizing the entire block on every streaming chunk (hot path).
    // BPE is not strictly additive across boundaries, but the error is
    // negligible for append-style streaming and self-corrects on fold/drift.
    const merged: CanvasBlock = {
      ...last,
      content: last.content + text,
      tokens: last.tokens + countTokens(text),
    };
    blocks[blocks.length - 1] = merged;
    return { blocks };
  }

  // Create a new text block
  const block = createBlock('text', text, { personaName });
  return { blocks: [...canvas.blocks, block] };
}

// ---------------------------------------------------------------------------
// Pin Operations
// ---------------------------------------------------------------------------

/**
 * Add a pinned block to the canvas. Returns new AgentState (immutable).
 */
export function addPin(state: AgentState, content: string): AgentState {
  const block = createBlock('pin', content, {
    pinned: true,
    foldable: false,
  });
  return {
    ...state,
    canvas: appendBlock(state.canvas, block),
  };
}

/**
 * Remove a pinned block by id. Returns new AgentState (immutable).
 */
export function removePin(state: AgentState, blockId: string): AgentState {
  const blocks = state.canvas.blocks.filter((b) => b.id !== blockId);
  return {
    ...state,
    canvas: { blocks },
  };
}

// ---------------------------------------------------------------------------
// Hierarchy Helpers (Phase 7)
// ---------------------------------------------------------------------------

/**
 * Find a block by ID.
 */
export function findBlock(canvas: Canvas, blockId: string): CanvasBlock | undefined {
  return canvas.blocks.find((b) => b.id === blockId);
}

/**
 * Get direct children of a block.
 */
export function getChildren(canvas: Canvas, parentId: string): CanvasBlock[] {
  return canvas.blocks.filter((b) => b.parentId === parentId);
}

/**
 * Get all descendants of a block (BFS).
 */
export function getDescendants(canvas: Canvas, parentId: string): CanvasBlock[] {
  const result: CanvasBlock[] = [];
  const queue = [parentId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const block of canvas.blocks) {
      if (block.parentId === current) {
        result.push(block);
        queue.push(block.id);
      }
    }
  }
  return result;
}

/**
 * Check if nesting at the given depth is allowed.
 */
export function canNest(depth: number): boolean {
  return depth < MAX_NESTING_DEPTH;
}

// ---------------------------------------------------------------------------
// Manual Fold / Expand (Phase 7)
// ---------------------------------------------------------------------------

/**
 * Manually fold a block, preserving originalContent for later expand.
 * Marks the block with foldReason='manual' so that originalContent is
 * preserved on session save (unlike drift folds, manual folds are
 * user-initiated and reversible after reload).
 * Cascades to all descendants.
 */
export function manualFoldBlock(
  canvas: Canvas,
  blockId: string,
  config: CanvasConfig,
): Canvas {
  const block = findBlock(canvas, blockId);
  if (!block || block.folded || !block.foldable || block.pinned) return canvas;

  const descendantIds = new Set(getDescendants(canvas, blockId).map((b) => b.id));

  const blocks = canvas.blocks.map((b) => {
    if (b.id === blockId) {
      const summary = generateFoldSummary(b, config);
      return { ...b, folded: true, foldReason: 'manual' as const, foldSummary: summary, originalContent: b.content, tokens: countTokens(summary) };
    }
    if (descendantIds.has(b.id) && b.foldable && !b.folded) {
      const summary = generateFoldSummary(b, config);
      return { ...b, folded: true, foldReason: 'manual' as const, foldSummary: summary, originalContent: b.content, tokens: countTokens(summary) };
    }
    return b;
  });

  return { blocks };
}

/**
 * Expand a manually-folded block, restoring original content.
 * Only works if originalContent exists (manual fold).
 * Drift-folded blocks (foldReason='drift') have originalContent stripped on
 * save and cannot be expanded after reload — they are permanently compressed.
 * Cascades to descendants.
 */
export function expandBlock(
  canvas: Canvas,
  blockId: string,
  config: CanvasConfig,
): Canvas {
  const block = findBlock(canvas, blockId);
  if (!block || !block.folded || !block.originalContent) return canvas;

  const descendantIds = new Set(getDescendants(canvas, blockId).map((b) => b.id));

  const blocks = canvas.blocks.map((b) => {
    if (b.id === blockId) {
      return {
        ...b,
        folded: false,
        foldReason: undefined,
        foldSummary: undefined,
        content: b.originalContent!,
        tokens: countTokens(b.originalContent!),
        originalContent: undefined,
      };
    }
    if (descendantIds.has(b.id) && b.folded && b.originalContent) {
      return {
        ...b,
        folded: false,
        foldReason: undefined,
        foldSummary: undefined,
        content: b.originalContent!,
        tokens: countTokens(b.originalContent!),
        originalContent: undefined,
      };
    }
    return b;
  });

  return { blocks };
}

// ---------------------------------------------------------------------------
// Canvas Search (Phase 7)
// ---------------------------------------------------------------------------

/**
 * Search canvas blocks using a regex pattern.
 * Searches originalContent for folded blocks, content for active blocks.
 * Returns up to 3 match excerpts per block with surrounding context.
 */
export function searchCanvas(
  canvas: Canvas,
  pattern: string,
  options?: { maxResults?: number },
): { block: CanvasBlock; matches: string[] }[] {
  const maxResults = options?.maxResults ?? 20;
  const regex = new RegExp(pattern, 'gi');
  const results: { block: CanvasBlock; matches: string[] }[] = [];

  for (const block of canvas.blocks) {
    if (results.length >= maxResults) break;

    const searchContent = (block.folded && block.originalContent) ? block.originalContent : block.content;
    const blockMatches: string[] = [];
    let match: RegExpExecArray | null;
    regex.lastIndex = 0; // Reset for each block (global regex retains lastIndex)

    while ((match = regex.exec(searchContent)) !== null && blockMatches.length < 3) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(searchContent.length, match.index + match[0].length + 50);
      const excerpt = (start > 0 ? '...' : '') +
        searchContent.substring(start, end) +
        (end < searchContent.length ? '...' : '');
      blockMatches.push(excerpt);
    }

    if (blockMatches.length > 0) {
      results.push({ block, matches: blockMatches });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Canvas Browser Primitives
// ---------------------------------------------------------------------------

/**
 * Delete a block and all its descendants from the canvas.
 */
export function deleteBlock(canvas: Canvas, blockId: string): Canvas {
  const descendants = getDescendants(canvas, blockId);
  const idsToRemove = new Set([blockId, ...descendants.map(d => d.id)]);
  return { blocks: canvas.blocks.filter(b => !idsToRemove.has(b.id)) };
}

/**
 * Restore legacy folded blocks after session load.
 *
 * Before the foldReason system was introduced, both drift-folded and
 * ego-switch-folded blocks could persist to state.canvas without a foldReason.
 * On save, sanitizeStateForSave cleared originalContent for non-manual folds,
 * making these blocks permanently folded after reload with no way to recover
 * the original content.
 *
 * This function classifies such orphaned blocks by their foldSummary pattern:
 *
 *  - Ego-switch style (e.g. "[Name 的对话 — 回复]"): These were view-only
 *    folds that should never have been persisted. Unfold them — the content
 *    is recoverable from foldSummary (which preserves the original text
 *    via originalContent at fold time).
 *
 *  - Drift style (e.g. "[tool_call: ...]", "[user] ...", truncated text):
 *    These were genuine drift folds. Their originalContent was stripped on
 *    save and is unrecoverable. Rather than unfolding them (which would
 *    restore only the truncated summary as "content", causing data loss),
 *    we stamp them with foldReason='drift' so the system treats them
 *    correctly going forward. They remain folded — this is the correct
 *    permanent state for drift-folded blocks.
 *
 *  - No foldSummary: Treat as drift-folded (stamp foldReason='drift').
 *
 * Called once after session load / rollback to ensure canvas consistency.
 */
export function restoreLegacyFoldedBlocks(canvas: Canvas): Canvas {
  let changed = false;
  const blocks = canvas.blocks.map((b): CanvasBlock => {
    // Only process blocks that are folded but have no foldReason
    if (!b.folded || b.foldReason) return b;

    // If the block still has originalContent, it's a manual fold that
    // hasn't been categorized yet — leave it as-is (it can still be expanded).
    if (b.originalContent) return b;

    // No foldReason and no originalContent — classify by foldSummary pattern.
    const summary = b.foldSummary || '';
    const isEgoSwitchFold = isEgoSwitchFoldSummary(summary);

    if (isEgoSwitchFold) {
      // Ego-switch fold: this was a view-only fold that should never have
      // been persisted. Unfold it. The foldSummary from ego-switch folding
      // preserves the original content via originalContent at fold time,
      // so content is still the full original (ego-switch never truncates).
      changed = true;
      const restoredContent = b.foldSummary || b.content;
      return {
        ...b,
        folded: false,
        foldReason: undefined,
        foldSummary: undefined,
        content: restoredContent,
        tokens: countTokens(restoredContent),
      };
    }

    // Drift fold (or indeterminate): stamp with foldReason='drift' and
    // keep folded. Unfolding would only restore the truncated summary
    // as "content" — the real original content is gone and was already
    // extracted by the Memory Agent before the original drift fold.
    // Keeping them folded is the correct permanent state.
    changed = true;
    return {
      ...b,
      foldReason: 'drift',
    };
  });

  return changed ? { blocks } : canvas;
}

/**
 * Detect ego-switch fold summary patterns from foldConversationForPersona().
 *
 * Ego-switch fold summaries follow the pattern:
 *   "[PersonaName 的对话 — 用户消息]"
 *   "[PersonaName 的对话 — 思考]"
 *   "[PersonaName 的对话 — 回复]"
 *
 * Drift fold summaries follow the pattern:
 *   "[tool_call: name]"
 *   "[tool_result] ..."
 *   "[think] ..."
 *   "[user] ..."
 *   or plain truncated text (no bracket prefix)
 */
function isEgoSwitchFoldSummary(summary: string): boolean {
  // Ego-switch pattern: "[Name 的对话 — ...]" (Chinese dash)
  // The name can contain any characters except brackets
  return /^\[[^\]]+ 的对话 — /.test(summary);
}

/**
 * Roll back canvas to before the last user_message block (inclusive).
 * Used for regenerate: removes the last user turn and all subsequent blocks,
 * so the next runFlow starts from the state before that user message.
 * Returns the canvas unchanged if no user_message block is found.
 */
export function rollbackLastUserTurn(canvas: Canvas): Canvas {
  const lastUserIdx = canvas.blocks.findLastIndex(b => b.type === 'user_message');
  if (lastUserIdx === -1) return canvas;
  return { blocks: canvas.blocks.slice(0, lastUserIdx) };
}

/**
 * Replace a block's content (and recalculate tokens).
 * For folded blocks, edits foldSummary; for active blocks, edits content.
 */
export function editBlockContent(canvas: Canvas, blockId: string, newContent: string, config: CanvasConfig): Canvas {
  return {
    blocks: canvas.blocks.map(b => {
      if (b.id !== blockId) return b;
      if (b.folded) {
        return { ...b, foldSummary: newContent, tokens: countTokens(newContent) };
      }
      return { ...b, content: newContent, tokens: countTokens(newContent) };
    }),
  };
}

/**
 * Create a CanvasBrowserSnapshot from current canvas state.
 */
export function createBrowserSnapshot(canvas: Canvas): CanvasBrowserSnapshot {
  const blocks: CanvasBlockSummary[] = canvas.blocks
    .filter(b => !b.evicted)
    .map(b => ({
      id: b.id,
      type: b.type,
      tokens: b.tokens,
      pinned: b.pinned,
      folded: b.folded,
      foldable: b.foldable,
      pinZone: b.pinZone,
      parentId: b.parentId,
      preview: (b.folded ? (b.foldSummary ?? '') : b.content).slice(0, 80),
      hasOriginal: !!b.originalContent,
      foldReason: b.foldReason,
      personaName: b.personaName,
      public: b.public,
      conversationStats: b.conversationStats,
    }));
  return { blocks, totalTokens: canvasTokenCount(canvas), blockCount: blocks.length };
}

// ---------------------------------------------------------------------------
// Serialization (block → string for LLM)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Token Counting
// ---------------------------------------------------------------------------

/**
 * Total token count across all blocks in the canvas.
 * Folded blocks contribute their foldSummary token count (stored in block.tokens
 * after folding), since serializeCanvasMarkdown renders foldSummary in the prompt.
 * Evicted blocks contribute 0 tokens (they are completely omitted from rendering).
 */
export function canvasTokenCount(canvas: Canvas): number {
  let total = 0;
  for (const block of canvas.blocks) {
    if (block.evicted) continue; // Evicted blocks don't count
    // Folded blocks contribute their summary token count (block.tokens is set to
    // countTokens(foldSummary) during foldBlock). This is important because
    // serializeCanvasMarkdown renders foldSummary for folded blocks, so they
    // DO consume tokens in the actual prompt.
    total += block.tokens;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Drift Detection
// ---------------------------------------------------------------------------

/**
 * Check if the canvas needs drift compression.
 *
 * Uses canvasTokenCount (canvas-only token estimation) as the decision metric.
 * This is compared against driftThreshold (canvas budget × 0.9) — both values
 * are in the same domain (canvas tokens), so the comparison is semantically correct.
 *
 * lastRealPromptTokens (whole-prompt tokens from the provider API) is NOT used
 * here because it includes system prompt, tool definitions, and message overhead
 * that are outside the canvas budget. Using it would cause drift to trigger
 * infinitely when the non-canvas portion alone exceeds the threshold.
 *
 * lastRealPromptTokens is still used by:
 *   - getTokenBudgetSnapshot() for UI display (totalTokens, utilizationPercent)
 *   - context_overflow recovery in runtime.ts (real prompt size vs model limit)
 */
/**
 * Check if canvas drift should be triggered.
 * Uses lastRealPromptTokens (whole-prompt tokens from provider API) when available,
 * falling back to canvasTokenCount estimation.
 * 
 * lastRealPromptTokens is the authoritative source — it includes:
 *   - system prompt
 *   - tool definitions
 *   - canvas history
 *   - current user message
 *   - API message format overhead
 * 
 * This is far more accurate than estimation and prevents context overflow.
 */
export function shouldDrift(state: AgentState): boolean {
  if (state.forceDrift) return true;
  const { canvasConfig, lastRealPromptTokens } = state;
  const tokenCount = (lastRealPromptTokens && lastRealPromptTokens > 0)
    ? lastRealPromptTokens
    : canvasTokenCount(state.canvas);
  return tokenCount > canvasConfig.driftThreshold;
}

// ---------------------------------------------------------------------------
// Drift Execution
// ---------------------------------------------------------------------------

export interface DriftResult {
  state: AgentState;
  warnings: string[];
}

/**
 * Execute canvas drift compression using the CanvasBlock architecture.
 *
 * FOLDING INVARIANTS (as designed):
 *   Blocks can ONLY be folded or evicted for ONE reason: context budget exceeded.
 *   There is NO "N rounds outside = old" logic. No position-based folding.
 *   This function is the mechanical safety net — it should only be called when
 *   the curator agent is unavailable. When the curator IS available, it handles
 *   all folding decisions intelligently (see curator.ts).
 *
 * Strategy (budget-driven, not position-based):
 *  1. Trim pinned blocks (maxPinnedBlocks + maxPinnedTokens, FIFO eviction)
 *  2. Fold oldest foldable blocks until under budget (paired: tool_call + tool_result)
 *  3. Evict oldest folded non-pinned blocks if still over budget
 *
 * The old activeWindowSize-based "window" folding has been REMOVED. There is
 * no concept of "blocks outside the active window are automatically old" —
 * that would be a position-based heuristic that violates the design invariant.
 */
export function executeDrift(state: AgentState): DriftResult {
  const { canvasConfig } = state;
  const warnings: string[] = [];
  let blocks = [...state.canvas.blocks];

  // --- Step 1: Trim pinned zone ---
  const pinnedBlocks = blocks.filter((b) => b.pinned);
  const nonPinnedBlocks = blocks.filter((b) => !b.pinned && !b.evicted);

  let trimmedPinned = pinnedBlocks;

  // Enforce maxPinnedBlocks (keep most recent)
  if (trimmedPinned.length > canvasConfig.maxPinnedBlocks) {
    const evictedCount = trimmedPinned.length - canvasConfig.maxPinnedBlocks;
    trimmedPinned = trimmedPinned.length > canvasConfig.maxPinnedBlocks
      ? trimmedPinned.slice(-canvasConfig.maxPinnedBlocks)
      : trimmedPinned;
    warnings.push(`Evicted ${evictedCount} oldest pinned blocks (maxPinnedBlocks=${canvasConfig.maxPinnedBlocks})`);
  }

  // Enforce maxPinnedTokens (FIFO eviction from front)
  let pinnedTokenTotal = trimmedPinned.reduce((sum, b) => sum + b.tokens, 0);
  while (pinnedTokenTotal > canvasConfig.maxPinnedTokens && trimmedPinned.length > 0) {
    const evicted = trimmedPinned.shift()!;
    pinnedTokenTotal -= evicted.tokens;
    warnings.push(`Evicted pinned block "${evicted.id}" due to token budget`);
  }

  // --- Step 2: Budget-driven folding ---
  // Only fold when total tokens exceed maxCanvasTokens. Fold oldest first.
  // This is a pure budget-driven approach — no "active window" or position-based heuristic.
  let resultBlocks = [...trimmedPinned, ...nonPinnedBlocks];
  let totalTokens = canvasTokenCount({ blocks: resultBlocks });

  if (totalTokens > canvasConfig.maxCanvasTokens) {
    // Build a set of tool_call IDs that get folded, so we can cascade to their tool_results
    const foldedToolCallIds = new Set<string>();

    // Fold from oldest to newest until under budget
    // Start after pinned blocks
    const pinnedCount = trimmedPinned.length;
    for (let i = pinnedCount; i < resultBlocks.length && totalTokens > canvasConfig.driftTarget; i++) {
      const block = resultBlocks[i];
      if (block.folded || !block.foldable || block.pinned) continue;

      // Skip tool_result if its parent tool_call hasn't been folded yet
      // (we'll fold it when we reach the tool_call, or it stays active)
      if (block.type === 'tool_result' && block.parentId && !foldedToolCallIds.has(block.parentId)) {
        continue;
      }

      const folded = foldBlock(block, canvasConfig);
      const tokensSaved = block.tokens - folded.tokens;
      resultBlocks[i] = folded;
      totalTokens -= tokensSaved;

      if (block.type === 'tool_call') {
        foldedToolCallIds.add(block.id);
      }
    }

    // Cascade: fold tool_result blocks whose parent tool_call was just folded
    for (let i = pinnedCount; i < resultBlocks.length; i++) {
      const block = resultBlocks[i];
      if (block.folded || !block.foldable) continue;
      if (block.type === 'tool_result' && block.parentId && foldedToolCallIds.has(block.parentId)) {
        const tokensSaved = block.tokens - countTokens('[tool_result]');
        resultBlocks[i] = foldBlock(block, canvasConfig);
        totalTokens -= tokensSaved;
      }
    }

    warnings.push(`Budget-driven drift: folded blocks to reduce tokens from ${canvasTokenCount({ blocks: [...trimmedPinned, ...nonPinnedBlocks] })} toward target ${canvasConfig.driftTarget}`);
  }

  // --- Step 3: Evict oldest folded non-pinned blocks if STILL over budget ---
  totalTokens = canvasTokenCount({ blocks: resultBlocks });
  if (totalTokens > canvasConfig.maxCanvasTokens) {
    for (let i = 0; i < resultBlocks.length && totalTokens > canvasConfig.maxCanvasTokens; i++) {
      const block = resultBlocks[i];
      if (!block.pinned && block.folded && !block.evicted) {
        resultBlocks[i] = { ...block, evicted: true };
        totalTokens -= block.tokens;  // block.tokens is the folded summary's count
        warnings.push(`Evicted folded block "${block.id}" (${block.type})`);
      }
    }
  }

  return {
    state: {
      ...state,
      canvas: { blocks: resultBlocks },
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Fold Helper
// ---------------------------------------------------------------------------

/**
 * Fold a single block for drift compression: set folded=true, generate a summary.
 * Marks the block with foldReason='drift' to indicate permanent drift folding.
 * Drift-folded blocks have their originalContent stripped on session save
 * (they are permanently folded; important content is extracted by Memory Agent).
 */
function foldBlock(block: CanvasBlock, config: CanvasConfig): CanvasBlock {
  const summary = generateFoldSummary(block, config);
  return {
    ...block,
    folded: true,
    foldSummary: summary,
    foldReason: 'drift',
    // Preserve originalContent for in-session search (searchCanvas checks
    // originalContent for folded blocks).  It will be stripped on save by
    // sanitizeStateForSave for drift-folded blocks.
    originalContent: block.originalContent ?? block.content,
    // Cache the folded token count so callers don't need to re-tokenize.
    tokens: countTokens(summary),
  };
}

/**
 * Generate a fold summary for a block based on its type.
 * Uses truncation strategy by default.
 */
export function generateFoldSummary(block: CanvasBlock, config: CanvasConfig): string {
  const maxTokens = config.foldSummaryMaxTokens;

  switch (block.type) {
    case 'tool_call': {
      // Extract tool name if possible
      try {
        const parsed = JSON.parse(block.content);
        const name = parsed.name ?? 'unknown';
        return `[tool_call(Truncated): ${name}]`;
      } catch {
        return truncateSummaryByTokens(`[tool_call(Truncated)] ${block.content}`, maxTokens);
      }
    }
    case 'tool_result': {
      const prefix = block.isError ? '[tool_result(Error)] ' : '[tool_result(Truncated)] ';
      return truncateSummaryByTokens(prefix + block.content, maxTokens);
    }
    case 'think': {
      return truncateSummaryByTokens(`[think] ${block.content}`, maxTokens);
    }
    case 'text': {
      return truncateSummaryByTokens(block.content, maxTokens);
    }
    case 'user_message': {
      return truncateSummaryByTokens(`[user] ${block.content}`, maxTokens);
    }
    default: {
      return truncateSummaryByTokens(block.content, maxTokens);
    }
  }
}

/**
 * Truncate text to fit within a BPE token budget.
 * Uses binary search on character length to find the longest prefix that
 * fits within maxTokens.  Falls back to a rough char estimate for the
 * initial guess to minimize iterations.
 */
function truncateSummaryByTokens(text: string, maxTokens: number): string {
  if (countTokens(text) <= maxTokens) return text;

  // Use a conservative char estimate as upper bound to avoid binary-searching
  // over the entire text length. ~4 chars/token is a safe overestimate for
  // mixed content; CJK is ~1-2 chars/token, ASCII ~3-5.
  const ellipsis = '...';
  const charGuess = Math.min(text.length, maxTokens * 5);
  let lo = 0;
  let hi = charGuess;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const candidate = text.substring(0, mid) + ellipsis;
    if (countTokens(candidate) <= maxTokens) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo === 0 ? ellipsis : text.substring(0, lo) + ellipsis;
}

// ---------------------------------------------------------------------------
// Conversation Sequence Folding (shared by runtime.ts & event-loop.ts)
// ---------------------------------------------------------------------------

/** A contiguous sequence of conversation blocks belonging to the same persona. */
export interface ConversationSeq {
  personaName: string;
  startIdx: number;
  endIdx: number;
  userMessageCount: number;
  userLineCount: number;
  agentMessageCount: number;
  agentLineCount: number;
  hasToolCalls: boolean;
  blockIds: string[];
}

/**
 * Identify conversation sequences in a canvas.
 *
 * A "sequence" is a contiguous run of user_message + text/think blocks belonging
 * to the same persona.  Tool calls and tool results *interrupt* a sequence (they
 * are shared facts that stay visible).  Pinned, evicted, already-folded, public,
 * and conversation_summary blocks also break sequences.
 *
 * user_message blocks are attributed to the persona of the *nearest subsequent*
 * text block (the AI that responded).  If no text block follows, "unknown" is used.
 */
export function identifyConversationSequences(blocks: CanvasBlock[]): ConversationSeq[] {
  const sequences: ConversationSeq[] = [];
  let currentSeq: ConversationSeq | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Breakers: pinned / evicted / folded / public / conversation_summary
    if (block.pinned || block.evicted || block.folded || block.public || block.type === 'conversation_summary') {
      if (currentSeq) {
        currentSeq.endIdx = i - 1;
        sequences.push(currentSeq);
        currentSeq = null;
      }
      continue;
    }

    // Tool calls/results interrupt the sequence
    if (block.type === 'tool_call' || block.type === 'tool_result') {
      if (currentSeq) {
        currentSeq.hasToolCalls = true;
        // Tool blocks are NOT included in blockIds — they stay visible independently
      }
      // Close the sequence — tools break contiguity, a new sequence starts after them
      if (currentSeq) {
        currentSeq.endIdx = i - 1;
        sequences.push(currentSeq);
        currentSeq = null;
      }
      continue;
    }

    // User message: attribute to the persona of the nearest subsequent text block
    if (block.type === 'user_message') {
      const nextTextBlock = blocks.slice(i + 1).find(b => b.type === 'text' && !b.pinned && !b.evicted && !b.folded);
      const inferredPersona = nextTextBlock?.personaName || 'unknown';

      if (currentSeq && currentSeq.personaName === inferredPersona) {
        currentSeq.userMessageCount++;
        currentSeq.userLineCount += block.content.split('\n').length;
        currentSeq.blockIds.push(block.id);
      } else {
        if (currentSeq) {
          currentSeq.endIdx = i - 1;
          sequences.push(currentSeq);
        }
        currentSeq = {
          personaName: inferredPersona,
          startIdx: i,
          endIdx: i,
          userMessageCount: 1,
          userLineCount: block.content.split('\n').length,
          agentMessageCount: 0,
          agentLineCount: 0,
          hasToolCalls: false,
          blockIds: [block.id],
        };
      }
      continue;
    }

    // Text block (agent response)
    if (block.type === 'text' && block.personaName) {
      if (currentSeq && currentSeq.personaName === block.personaName) {
        currentSeq.agentMessageCount++;
        currentSeq.agentLineCount += block.content.split('\n').length;
        currentSeq.blockIds.push(block.id);
      } else {
        if (currentSeq) {
          currentSeq.endIdx = i - 1;
          sequences.push(currentSeq);
        }
        currentSeq = {
          personaName: block.personaName,
          startIdx: i,
          endIdx: i,
          userMessageCount: 0,
          userLineCount: 0,
          agentMessageCount: 1,
          agentLineCount: block.content.split('\n').length,
          hasToolCalls: false,
          blockIds: [block.id],
        };
      }
      continue;
    }

    // Think blocks: include in current sequence but don't count as agent message
    if (block.type === 'think') {
      if (currentSeq) {
        currentSeq.blockIds.push(block.id);
      }
      continue;
    }
  }

  // Close final sequence
  if (currentSeq) {
    currentSeq.endIdx = blocks.length - 1;
    sequences.push(currentSeq);
  }

  return sequences;
}

/**
 * Fold conversation blocks belonging to non-target personas.
 *
 * This is a **VIEW-ONLY** operation: the result is used for prompt building
 * (see prompt-builder.ts) and is NEVER written back to state.canvas.
 * The WebUI always sees the fully unfolded canvas.
 *
 * FOLDING INVARIANTS:
 *   - Public blocks (public=true) are NEVER folded — they are shared context.
 *   - Blocks belonging to the target persona are NEVER folded.
 *   - Only private conversations between the user and OTHER personas are folded.
 *   - Drift-folded blocks (foldReason='drift') are left as-is (permanently folded).
 *   - Ego-switch folding does NOT set foldReason and does NOT persist to state.
 *
 * - Blocks belonging to `targetPersonaName` are kept as-is (unfolded if
 *   they were previously folded by this mechanism).
 * - text / user_message / think blocks belonging to other personas are
 *   marked as `folded`. A `conversation_summary` block is inserted at the
 *   start of each folded sequence as a clear marker.
 * - tool_call / tool_result / pinned / public blocks are always kept unchanged.
 * - Blocks that were previously folded by persona-switch and now belong to
 *   the target persona are **unfolded** (restored from originalContent).
 */
export function foldConversationForPersona(
  canvas: Canvas,
  targetPersonaName: string,
): Canvas {
  const blocks = canvas.blocks;
  const sequences = identifyConversationSequences(blocks);

  // Which sequences should be folded?
  const sequencesToFold = sequences.filter(seq => seq.personaName !== targetPersonaName);
  const foldBlockIds = new Set(sequencesToFold.flatMap(s => s.blockIds));

  // Build a map from blockId → sequence for fast lookup (first block only)
  const firstBlockSeqMap = new Map<string, ConversationSeq>();
  for (const seq of sequencesToFold) {
    if (seq.blockIds.length > 0) {
      firstBlockSeqMap.set(seq.blockIds[0], seq);
    }
  }

  const result: CanvasBlock[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Unfold blocks that belong to the target persona and were previously
    // folded by persona-switch (they have originalContent preserved).
    if (block.personaName === targetPersonaName && block.folded && block.originalContent) {
      const unfolded: CanvasBlock = {
        ...block,
        content: block.originalContent,
        folded: false,
        foldSummary: undefined,
        originalContent: undefined,
        tokens: countTokens(block.originalContent),
      };
      result.push(unfolded);
      continue;
    }

    // Blocks to fold — mark them as folded, preserve original content.
    // DEFENSIVE GUARD: even if a block somehow appears in foldBlockIds,
    // never fold public blocks or blocks belonging to the target persona.
    // These invariants must hold regardless of sequence identification logic.
    if (foldBlockIds.has(block.id) && !block.public && block.personaName !== targetPersonaName) {
      // Drift-folded blocks are permanently folded — leave them as-is
      if (block.folded && block.foldReason === 'drift') {
        result.push(block);
        continue;
      }
      // Already folded (e.g. by a previous persona switch) — keep as-is
      if (block.folded) {
        result.push(block);
        continue;
      }

      const seq = firstBlockSeqMap.get(block.id);
      // Insert a conversation_summary marker at the start of each sequence
      // so the LLM context sees a clear fold point.
      if (seq) {
        const totalLines = seq.userLineCount + seq.agentLineCount;
        // When userMessageCount is 0, the sequence consists of AI-only activity
        // (e.g. tool calls without a preceding user message) — use a different
        // summary format to avoid the confusing "0 轮" label.
        const summaryContent = seq.userMessageCount > 0
          ? `[对话已折叠: 主人和${seq.personaName}的对话 ${seq.userMessageCount} 轮，共 ${totalLines} 行。]`
          : `[对话已折叠: ${seq.personaName}的活动记录，共 ${totalLines} 行。]`;
        const summaryBlock: CanvasBlock = {
          id: randomUUID(),
          type: 'conversation_summary',
          content: summaryContent,
          tokens: countTokens(summaryContent),
          timestamp: block.timestamp,
          pinned: false,
          folded: false,
          foldable: false,
          personaName: seq.personaName,
          conversationStats: {
            personaName: seq.personaName,
            userMessageCount: seq.userMessageCount,
            userLineCount: seq.userLineCount,
            agentMessageCount: seq.agentMessageCount,
            agentLineCount: seq.agentLineCount,
            hasToolCalls: seq.hasToolCalls,
            blockIds: seq.blockIds,
          },
        };
        result.push(summaryBlock);
      }

      // Fold this block: preserve originalContent, set a foldSummary
      // Use a concise per-block summary; the conversation_summary above
      // provides the sequence-level overview.
      const displayName = block.personaName || 'unknown';
      const blockSummary = block.type === 'user_message'
        ? `[${displayName} 的对话 — 用户消息]`
        : block.type === 'think'
          ? `[${displayName} 的对话 — 思考]`
          : `[${displayName} 的对话 — 回复]`;
      const folded: CanvasBlock = {
        ...block,
        folded: true,
        foldSummary: blockSummary,
        originalContent: block.content,
        tokens: countTokens(blockSummary),
      };
      result.push(folded);
      continue;
    }

    // Keep all other blocks (tool_call, tool_result, pinned, public, target persona's, etc.)
    result.push(block);
  }

  return { blocks: result };
}

// ---------------------------------------------------------------------------
// Markdown Canvas Serialization (for API function calling mode)
// ---------------------------------------------------------------------------

/**
 * Serialize the canvas as narrative-style Markdown for embedding in system prompt.
 * Reads like a journal / novel dialogue — avoids role markers that could trigger
 * the model to generate fake User/Assistant turns (self-prompting).
 *
 * Rendering rules:
 * - Pinned blocks → "# Pinned Context" section
 * - Evicted blocks → skipped entirely
 * - Folded blocks → `· summary` (bullet)
 * - Active text → bare content (first person, no label)
 * - Active tool_call → `我调用了 name(args)，得到：`
 * - Active tool_result → `> ` quoted block
 * - Active user_message → `「content」` (quoted speech)
 */
/**
 * Serialize canvas for HistoryView preview with full participant labels.
 * Unlike serializeCanvasMarkdown (which uses first-person narrative),
 * this shows explicit labels for all participants: 主人, 琉璃, 竹萤, etc.
 */
export function serializeCanvasForHistoryView(
  canvas: Canvas,
  personaManager?: { getPersona(name: string): { displayName: string } | undefined },
): string {
  const parts: string[] = [];
  const nonPinned = canvas.blocks.filter((b) => !b.pinned && !b.evicted);

  if (nonPinned.length === 0) return '(空)';

  parts.push('# 之前发生的事\n');

  for (const block of nonPinned) {
    // Public block indicator prefix (meeting mode — visible to all personas)
    const pubTag = block.public ? '[公开] ' : '';

    if (block.folded) {
      // Show fold summary with persona name
      if (block.foldSummary) {
        parts.push(`${pubTag}${block.foldSummary}`);
      } else if (block.personaName) {
        const displayName = personaManager?.getPersona(block.personaName)?.displayName || block.personaName;
        parts.push(`[对话已折叠: 主人和${displayName}的对话]`);
      }
      continue;
    }

    switch (block.type) {
      case 'user_message':
        // Human user's message
        const imgNote = block.imageRefs?.length ? ` [附图${block.imageRefs.length}张]` : '';
        parts.push(`${pubTag}主人: 「${block.content}${imgNote}」`);
        break;
      case 'text':
        // Agent's response - label with persona name
        if (block.personaName) {
          const displayName = personaManager?.getPersona(block.personaName)?.displayName || block.personaName;
          // Deduplicate: strip all leading ego prefixes (supporting both English/Chinese colons)
          let content = block.content;
          const { text: stripped } = stripEgoPrefixes(content, block.personaName);
          // Also try displayName in case it differs from personaName
          if (displayName !== block.personaName) {
            const { text: stripped2 } = stripEgoPrefixes(stripped, displayName);
            content = stripped2;
          } else {
            content = stripped;
          }
          parts.push(`${pubTag}${displayName}: ${content}`);
        } else {
          parts.push(`${pubTag}${block.content}`);
        }
        break;
      case 'think':
        // Thinking block - label with persona
        if (block.personaName) {
          const displayName = personaManager?.getPersona(block.personaName)?.displayName || block.personaName;
          parts.push(`${pubTag}(${displayName} 在思考: ${block.content.slice(0, 200)}${block.content.length > 200 ? '…' : ''})`);
        } else {
          parts.push(`${pubTag}(思考: ${block.content.slice(0, 200)}${block.content.length > 200 ? '…' : ''})`);
        }
        break;
      case 'tool_call':
        // Tool call - show compact form
        try {
          const parsed = JSON.parse(block.content);
          const name = parsed.name ?? 'unknown';
          parts.push(`${pubTag}  ▸ ${name}(...)`);
        } catch {
          parts.push(`${pubTag}  ▸ ${block.content.slice(0, 50)}`);
        }
        break;
      case 'tool_result':
        // Tool result - show truncated
        const truncated = block.content.slice(0, 100);
        parts.push(`${pubTag}  → ${truncated}${block.content.length > 100 ? '…' : ''}`);
        break;
      default:
        parts.push(`${pubTag}${block.content}`);
    }
  }

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// History Messages Rebuilder (canvas blocks → API messages)
// ---------------------------------------------------------------------------

/**
 * Reconstructed API message for history injection.
 * Mirrors the ChatMessage shape used in runtime.ts for multi-turn conversations.
 */
export interface RebuiltHistoryMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }>;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  /** Whether the tool returned an error. Used by provider to set API-level error flags. */
  isError?: boolean;
  /** Internal: reasoning content for thinking mode echo-back (DeepSeek, Anthropic) */
  _reasoning?: string;
}

/**
 * Rebuild API-compatible messages from active (unfolded, non-evicted) canvas blocks.
 *
 * This is the core fix for the "tool call becomes text after reload" bug:
 * Previously, serializeCanvasMarkdown rendered ALL blocks (including tool_call
 * and tool_result) as Markdown text in the system prompt. After session reload,
 * the LLM saw tool calls as `▸ name(args)` text notation and imitated this
 * format instead of issuing real tool_calls via the API.
 *
 * Now, ALL conversation blocks (user_message, text, tool_call, tool_result)
 * are rebuilt as proper API messages and injected into the messages array.
 * Only non-conversation blocks (pin, conversation_summary, think) remain in
 * the Markdown canvas history rendered by serializeCanvasMarkdown.
 *
 * Returns messages ordered chronologically (oldest first), suitable for
 * insertion between the system prompt and the current user message.
 */
export function rebuildHistoryMessages(canvas: Canvas): RebuiltHistoryMessage[] {
  const messages: RebuiltHistoryMessage[] = [];
  const activeBlocks = canvas.blocks.filter(b => !b.folded && !b.evicted && !b.pinned);

  // Track which blocks have been consumed (to avoid double-processing)
  const consumedBlockIds = new Set<string>();

  // Index tool_results by parentId (canvas block ID of tool_call) for fast lookup
  const resultByParentId = new Map<string, CanvasBlock>();
  for (const b of activeBlocks) {
    if (b.type === 'tool_result' && b.parentId) {
      resultByParentId.set(b.parentId, b);
    }
  }

  // Helper: parse a tool_call block's content into name + arguments
  function parseToolCallContent(content: string): { name: string; arguments: string } {
    try {
      const parsed = JSON.parse(content);
      return {
        name: parsed.name ?? 'unknown',
        arguments: JSON.stringify(parsed.arguments ?? {}),
      };
    } catch {
      return { name: content.slice(0, 80), arguments: '{}' };
    }
  }

  // Helper: collect tool_call blocks belonging to the same assistant turn.
  // Tool calls in a turn are interleaved with their tool_results:
  //   tc1, tr1, tc2, tr2, ...
  // We scan through tc+tr pairs until we hit a block that isn't tc or tr.
  // Returns the collected tool calls and the index after the last tc/tr pair.
  function collectToolCallsAndSkipResults(startIdx: number): {
    toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    nextIdx: number;
  } {
    const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
    let j = startIdx;
    while (j < activeBlocks.length) {
      const b = activeBlocks[j];
      if (b.type === 'tool_call') {
        consumedBlockIds.add(b.id);
        const callId = b.toolCallId || `rebuilt-${b.id}`;
        const { name, arguments: args } = parseToolCallContent(b.content);
        toolCalls.push({ id: callId, type: 'function', function: { name, arguments: args } });
        j++;
      } else if (b.type === 'tool_result') {
        // Skip tool_result blocks here — they'll be consumed by emitToolResults
        j++;
      } else {
        // Hit a block that's not tool_call or tool_result — end of the turn
        break;
      }
    }
    return { toolCalls, nextIdx: j };
  }

  // Helper: emit tool_result messages for collected tool_calls
  function emitToolResults(toolCalls: Array<{ id: string; type: string; function: { name: string } }>): void {
    for (const tc of toolCalls) {
      // Find the matching tool_result by toolCallId (the API-level tool call ID)
      const resultBlock = activeBlocks.find(
        b => b.type === 'tool_result' && !consumedBlockIds.has(b.id) && b.toolCallId === tc.id,
      );

      if (resultBlock) {
        messages.push({
          role: 'tool',
          content: resultBlock.content,
          tool_call_id: tc.id,
          isError: resultBlock.isError,
        });
        consumedBlockIds.add(resultBlock.id);
      } else {
        // Fallback: try to find by parentId (canvas block ID of the tool_call)
        // This handles cases where toolCallId might not match
        const tcBlockIdx = activeBlocks.findIndex(
          b => b.type === 'tool_call' && (b.toolCallId === tc.id || `rebuilt-${b.id}` === tc.id),
        );
        if (tcBlockIdx >= 0) {
          const fallbackResult = resultByParentId.get(activeBlocks[tcBlockIdx].id);
          if (fallbackResult && !consumedBlockIds.has(fallbackResult.id)) {
            messages.push({
              role: 'tool',
              content: fallbackResult.content,
              tool_call_id: tc.id,
              isError: fallbackResult.isError,
            });
            consumedBlockIds.add(fallbackResult.id);
            continue;
          }
        }

        // Orphaned tool_call without result — provide a synthetic empty result
        messages.push({
          role: 'tool',
          content: '',
          tool_call_id: tc.id,
        });
      }
    }
  }

  for (let i = 0; i < activeBlocks.length; i++) {
    const block = activeBlocks[i];
    if (consumedBlockIds.has(block.id)) continue;

    switch (block.type) {
      case 'user_message': {
        if (block.imageRefs?.length) {
          const imageParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }> = [];
          for (const ref of block.imageRefs) {
            const dataUri = loadImageAsDataUri(ref);
            if (dataUri) {
              imageParts.push({
                type: 'image_url',
                image_url: { url: dataUri, detail: 'auto' },
              });
            }
          }
          if (imageParts.length > 0) {
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: block.content },
                ...imageParts,
              ],
            });
            consumedBlockIds.add(block.id);
            break;
          }
        }
        messages.push({
          role: 'user',
          content: block.content,
        });
        consumedBlockIds.add(block.id);
        break;
      }

      case 'text': {
        // A text block may be followed by tool_calls (same assistant turn).
        const { toolCalls, nextIdx } = collectToolCallsAndSkipResults(i + 1);

        // Build the assistant message (text + optional tool_calls)
        const assistantMsg: RebuiltHistoryMessage = {
          role: 'assistant',
          content: block.content || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        };
        messages.push(assistantMsg);
        consumedBlockIds.add(block.id);

        // Emit tool_result messages
        emitToolResults(toolCalls);

        // Advance past the tool_call and tool_result blocks we consumed
        i = nextIdx - 1; // -1 because the for loop will increment i
        break;
      }

      case 'tool_call': {
        // tool_call without a preceding text block (standalone or at start of canvas)
        const { toolCalls, nextIdx } = collectToolCallsAndSkipResults(i);

        // Build assistant message (no text content, just tool_calls)
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: toolCalls,
        });

        // Emit tool_result messages
        emitToolResults(toolCalls);

        i = nextIdx - 1;
        break;
      }

      case 'tool_result': {
        // Orphaned tool_result (shouldn't normally happen, but handle gracefully)
        // Skip — they're meaningless without their tool_call
        consumedBlockIds.add(block.id);
        break;
      }

      case 'think': {
        // Think block contains reasoning content from thinking mode (DeepSeek, Anthropic).
        // It must be attached to the next assistant message as _reasoning for API echo-back.
        // If there's no subsequent text/tool_call block, create an empty assistant message.
        const thinkContent = block.content;
        consumedBlockIds.add(block.id);

        // Look ahead for the next text or tool_call block
        let foundAssistant = false;
        for (let j = i + 1; j < activeBlocks.length; j++) {
          const nextBlock = activeBlocks[j];
          if (consumedBlockIds.has(nextBlock.id)) continue;

          if (nextBlock.type === 'text') {
            // Attach reasoning to this text block's assistant message
            const { toolCalls, nextIdx } = collectToolCallsAndSkipResults(j + 1);
            const assistantMsg: RebuiltHistoryMessage = {
              role: 'assistant',
              content: nextBlock.content || null,
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
              _reasoning: thinkContent,
            };
            messages.push(assistantMsg);
            consumedBlockIds.add(nextBlock.id);
            emitToolResults(toolCalls);
            i = nextIdx - 1;
            foundAssistant = true;
            break;
          } else if (nextBlock.type === 'tool_call') {
            // Attach reasoning to tool_call-only assistant message
            const { toolCalls, nextIdx } = collectToolCallsAndSkipResults(j);
            messages.push({
              role: 'assistant',
              content: null,
              tool_calls: toolCalls,
              _reasoning: thinkContent,
            });
            emitToolResults(toolCalls);
            i = nextIdx - 1;
            foundAssistant = true;
            break;
          } else if (nextBlock.type === 'user_message') {
            // Hit a user message before finding assistant — create empty assistant with reasoning
            break;
          }
        }

        // No subsequent assistant message found — create an empty one with reasoning
        if (!foundAssistant) {
          messages.push({
            role: 'assistant',
            content: null,
            _reasoning: thinkContent,
          });
        }
        break;
      }

      // pin, conversation_summary blocks stay in Markdown — skip here
      default:
        break;
    }
  }

  return messages;
}

export function serializeCanvasMarkdown(canvas: Canvas, currentEgo?: string, activeOnly?: boolean): string {
  const parts: string[] = [];

  // 1a. Top pinned blocks (pinZone undefined or 'top')
  const topPinned = canvas.blocks.filter((b) => b.pinned && !b.evicted && (b.pinZone ?? 'top') === 'top');
  // 1b. Bottom pinned blocks (pinZone === 'bottom')
  const bottomPinned = canvas.blocks.filter((b) => b.pinned && !b.evicted && b.pinZone === 'bottom');

  if (topPinned.length > 0) {
    parts.push('# Pinned Context\n');
    for (const block of topPinned) {
      parts.push(block.content);
    }
  }

  // 2. Non-pinned blocks in order
  const nonPinned = canvas.blocks.filter((b) => !b.pinned && !b.evicted);
  // When activeOnly is true, skip folded blocks entirely — only active (unfolded) blocks
  // are serialized. This is used when injectCanvasHistory is false: the current session's
  // active conversation is always visible, but folded/compressed history is excluded to
  // save context space.
  const visibleNonPinned = activeOnly
    ? nonPinned.filter((b) => !b.folded)
    : nonPinned;

  // Determine which block types are rendered in Markdown (vs. rebuilt as API messages).
  // Active conversation blocks (text, user_message, tool_call, tool_result) are rebuilt
  // as API messages by rebuildHistoryMessages() and NOT rendered here to avoid duplication.
  // Only contextual blocks (think, conversation_summary) and folded summaries are rendered.
  // Folded blocks of any type are rendered (as summaries), since they're not in API messages.
  const hasMarkdownContent = visibleNonPinned.some(b =>
    b.folded || b.type === 'think' || b.type === 'conversation_summary',
  );
  if (!hasMarkdownContent && bottomPinned.length === 0) return parts.join('\n');

  parts.push('\n# 之前发生的事\n');

  // Build parentId → tool_call map for paired fold rendering
  const toolCallMap = new Map<string, CanvasBlock>();
  for (const block of visibleNonPinned) {
    if (block.type === 'tool_call') {
      toolCallMap.set(block.id, block);
    }
  }

  // Track which tool_results have been paired-rendered with their tool_call
  const pairedResultIds = new Set<string>();

  for (const block of visibleNonPinned) {
    // Skip tool_results that were already rendered as part of a paired fold
    if (pairedResultIds.has(block.id)) continue;

    // Public block indicator: subtle [公] prefix for blocks marked as public (meeting mode)
    // When currentEgo is set, also show persona name for public blocks from OTHER personas
    const isPublicFromOther = block.public && currentEgo && block.personaName && block.personaName !== currentEgo;
    const pubPrefix = block.public ? (isPublicFromOther ? `[公·${block.personaName}] ` : '[公] ') : '';

    if (block.folded) {
      // Folded blocks show a summary if available, otherwise are omitted.
      // For persona-based folding, show who the conversation was with.
      if (block.foldSummary) {
        parts.push(block.foldSummary);
      } else if (block.personaName && (block.type === 'text' || block.type === 'user_message')) {
        // Persona conversation folded without explicit summary
        parts.push(`[对话已折叠: 主人和${block.personaName}的对话]`);
      }
      // Skip tool_call/tool_result content entirely
      if (block.type === 'tool_call') {
        // Also skip the paired tool_result
        const pairedResult = nonPinned.find(
          (b) => b.type === 'tool_result' && b.parentId === block.id,
        );
        if (pairedResult) pairedResultIds.add(pairedResult.id);
      }
      continue;
    } else {
      // Active block rendering
      switch (block.type) {
        case 'text':
          // Active text blocks are now rebuilt as API messages (assistant role) by
          // rebuildHistoryMessages() and injected into the messages array. This
          // ensures the LLM sees proper multi-turn conversation structure and
          // prevents the "tool call becomes text" bug after session reload.
          // Skip rendering in Markdown to avoid duplication.
          break;
        case 'tool_call':
          // Active tool_call blocks are rebuilt as API messages by
          // rebuildHistoryMessages(). Skip rendering in Markdown.
          // Also mark the paired tool_result so it's skipped below.
          {
            const pairedResult = nonPinned.find(
              (b) => b.type === 'tool_result' && b.parentId === block.id,
            );
            if (pairedResult) pairedResultIds.add(pairedResult.id);
          }
          break;
        case 'tool_result':
          // Active tool_result blocks are rebuilt as API messages alongside their
          // tool_call. Skip rendering in Markdown.
          break;
        case 'user_message':
          // Active user_message blocks are rebuilt as API messages (user role) by
          // rebuildHistoryMessages(). Skip rendering in Markdown to avoid duplication.
          break;
        case 'think':
          // Render think blocks as internal monologue, truncated if long
          parts.push(`${pubPrefix}（我当时在想：${block.content.slice(0, 500)}${block.content.length > 500 ? '…' : ''}）`);
          break;
        case 'conversation_summary':
          // Conversation summary from folded persona conversations
          parts.push(block.content);
          break;
        default:
          parts.push(`${pubPrefix}${block.content}`);
      }
    }
  }

  // 3. Bottom pinned blocks (after conversation history)
  if (bottomPinned.length > 0) {
    parts.push('\n# Active Context\n');
    for (const block of bottomPinned) {
      parts.push(block.content);
    }
  }

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Format Completed Interaction into Canvas Blocks
// ---------------------------------------------------------------------------

/** Strip heavy fields from ToolResultMeta before persisting to canvas block.
 * Removes fileContent from file_read meta to avoid bloating session storage. */
function stripMetaForStorage(meta: ToolResult['meta']): CanvasBlock['meta'] {
  if (!meta) return undefined;
  if (meta.type === 'file_read') {
    const { fileContent: _, ...rest } = meta;
    return rest as any;
  }
  return meta;
}

/**
 * After each LLM turn completes, format the assistant text + tool calls + tool results
 * into a linear sequence of CanvasBlock objects to append to the canvas.
 *
 * Returns CanvasBlock[] to be appended via appendBlock().
 */
export function formatCompletedInteraction(
  assistantText: string,
  toolCalls: ApiToolCall[],
  toolResults: { toolCallId: string; result: ToolResult }[],
  config: CanvasConfig,
  personaName?: string,
  publicMode?: boolean,
): CanvasBlock[] {
  const blocks: CanvasBlock[] = [];

  // 1. Assistant text block (if non-empty)
  if (assistantText.trim()) {
    blocks.push(createBlock('text', assistantText.trim(), { personaName, public: publicMode }));
  }

  // 2. For each tool call, create tool_call + tool_result pair
  for (const tc of toolCalls) {
    const tcContent = JSON.stringify({
      name: tc.function.name,
      arguments: safeParseJson(tc.function.arguments),
    });
    const toolCallBlock = createBlock('tool_call', tcContent, {
      toolCallId: tc.id,
      personaName,
      public: publicMode,
    });
    blocks.push(toolCallBlock);

    // Find matching result
    const matchingResult = toolResults.find((r) => r.toolCallId === tc.id);
    if (matchingResult) {
      const resultBlock = createBlock('tool_result', matchingResult.result.content, {
        parentId: toolCallBlock.id,
        toolCallId: tc.id,
        meta: stripMetaForStorage(matchingResult.result.meta),
        public: publicMode,
        isError: matchingResult.result.isError,
      });
      blocks.push(resultBlock);
    }
  }

  return blocks;
}

/** Safely parse JSON string or return as-is object. */
function safeParseJson(s: string): Record<string, any> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
