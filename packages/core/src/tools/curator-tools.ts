// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Curator Tools (Phase E — GC-Model)
// 11 tools for the Curator sub-agent's canvas curation:
//   Phase 0: overview + intent extraction
//   Phase 1: search/grep to identify relevant blocks (no position-based classification)
//   Phase 2: fine-grained decisions (list_segment, inspect, fold, fold_batch, unfold)
//   Shared:  budget, done
//
// FOLDING INVARIANTS:
//   There is NO "N rounds outside = old" logic. Blocks are not classified by
//   position (very_old/old/recent). The curator makes decisions based on
//   content relevance and token budget — not position in the canvas.
//   Mechanical folding of "very_old" blocks has been REMOVED.
//
// All tools operate on a CuratorWorkspace (structuredClone of parent canvas).
// Parent canvas is never mutated — decisions are committed only on success.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  AgentState,
  Canvas,
  CanvasBlock,
  CanvasConfig,
  CuratorDecision,
  ToolEntry,
  ToolResult,
} from '@vesper/shared';
import {
  canvasTokenCount,
  findBlock,
  manualFoldBlock,
  expandBlock,
} from '../canvas.js';

// ---------------------------------------------------------------------------
// CuratorWorkspace — mutable clone that tracks decisions
// ---------------------------------------------------------------------------

export interface CuratorWorkspace {
  /** Working copy of canvas (mutated by fold/unfold tools) */
  canvas: Canvas;
  config: CanvasConfig;
  /** User's current message (for context) */
  userMessage: string;
  /** Blocks explicitly marked "keep" to protect from folding (stores real UUIDs) */
  keptBlockIds: Set<string>;
  /** Accumulated decisions for reporting (stores real UUIDs) */
  decisions: CuratorDecision[];
  /** Set to true when curator_done is called */
  done: boolean;
  /** The original (unmodified) parent canvas for overview/search */
  originalCanvas: Canvas;
  /** Real prompt tokens from provider API (authoritative when available) */
  realPromptTokens?: number;
  /** Short index → real UUID mapping (rebuilt after canvas mutations) */
  idMap: Map<number, string>;
  /** Real UUID → short index mapping (rebuilt after canvas mutations) */
  uuidMap: Map<string, number>;
  /** AbortController for the curator sub-flow — aborted when curator_done is called */
  abortController?: AbortController;

}

/**
 * Build bidirectional index↔UUID maps from non-evicted blocks.
 * Called on workspace creation and after fold/unfold mutations.
 */
function rebuildIdMaps(ws: CuratorWorkspace): void {
  ws.idMap = new Map();
  ws.uuidMap = new Map();
  const blocks = getNonEvictedBlocks(ws.canvas);
  for (let i = 0; i < blocks.length; i++) {
    ws.idMap.set(i, blocks[i].id);
    ws.uuidMap.set(blocks[i].id, i);
  }
}

/**
 * Resolve a block identifier: accepts "#N" short index or raw UUID.
 * Returns the real UUID, or null if not found.
 */
function resolveBlockId(ws: CuratorWorkspace, input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.startsWith('#')) {
    const idx = parseInt(trimmed.slice(1), 10);
    if (isNaN(idx)) return null;
    return ws.idMap.get(idx) ?? null;
  }
  // Fallback: try as raw UUID
  const block = findBlock(ws.canvas, trimmed);
  return block ? trimmed : null;
}

/**
 * Format a block's short ID for display: "#N"
 */
function shortId(ws: CuratorWorkspace, uuid: string): string {
  const idx = ws.uuidMap.get(uuid);
  return idx !== undefined ? `#${idx}` : uuid;
}

export function createCuratorWorkspace(state: AgentState): CuratorWorkspace {
  const ws: CuratorWorkspace = {
    canvas: structuredClone(state.canvas),
    config: state.canvasConfig,
    userMessage: state.userMessage || '',
    keptBlockIds: new Set(),
    decisions: [],
    done: false,
    originalCanvas: state.canvas, // read-only reference
    realPromptTokens: state.lastRealPromptTokens,
    idMap: new Map(),
    uuidMap: new Map(),
  };
  rebuildIdMaps(ws);
  return ws;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AgeSegment = 'very_old' | 'old' | 'recent';

/**
 * Build an index mapping each non-evicted, non-folded block's position
 * (within the full non-evicted array) to an age segment.
 *
 * Three generations based ONLY on unfolded blocks:
 *   - recent: last `activeWindowSize` unfolded blocks
 *   - very_old: first 25% of unfolded blocks
 *   - old: everything in between
 *
 * Already-folded blocks are excluded from the generation classification
 * entirely — they don't shift the boundaries. Pinned blocks within the
 * unfolded set are classified by position but individually protected.
 *
 * The very_old segment is used by the post-curator mechanical fold
 * (mechanicalFoldVeryOld) as a safety net for very long conversations.
 * The curator can rescue very_old blocks via curator_keep before the
 * mechanical fold runs. This only applies AFTER curator has had a chance
 * to review and protect important blocks — it does NOT affect normal
 * (non-drift) operation or executeDrift.
 */
function buildAgeMap(
  blocks: CanvasBlock[],
  activeWindowSize: number,
): Map<number, AgeSegment> {
  // Collect indices of unfolded blocks (within the full non-evicted array)
  const unfoldedIndices: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i].folded) {
      unfoldedIndices.push(i);
    }
  }

  const unfoldedTotal = unfoldedIndices.length;
  const recentStart = Math.max(0, unfoldedTotal - activeWindowSize);
  const veryOldEnd = Math.floor(unfoldedTotal * 0.25);

  const ageMap = new Map<number, AgeSegment>();
  for (let ui = 0; ui < unfoldedTotal; ui++) {
    const blockIdx = unfoldedIndices[ui];
    let age: AgeSegment;
    if (ui >= recentStart) age = 'recent';
    else if (ui < veryOldEnd) age = 'very_old';
    else age = 'old';
    ageMap.set(blockIdx, age);
  }
  return ageMap;
}

/**
 * Classify a single block's age using a prebuilt age map.
 * Folded blocks return undefined (they are outside the classification system).
 */
function classifyBlockAge(
  index: number,
  ageMap: Map<number, AgeSegment>,
): AgeSegment | undefined {
  return ageMap.get(index);
}

/**
 * Check if a block index falls within the very_old positional range.
 * Unlike classifyBlockAge, this works for ALL blocks (including folded ones)
 * by checking if the index is before the boundary where very_old ends.
 * Used by curator_search to find rescue candidates among folded blocks.
 */
function isInVeryOldRange(
  index: number,
  blocks: CanvasBlock[],
  activeWindowSize: number,
): boolean {
  const unfoldedIndices: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i].folded) unfoldedIndices.push(i);
  }
  const unfoldedTotal = unfoldedIndices.length;
  const veryOldEnd = Math.floor(unfoldedTotal * 0.25);
  const boundaryIdx = veryOldEnd < unfoldedIndices.length
    ? unfoldedIndices[veryOldEnd]
    : blocks.length;
  return index < boundaryIdx;
}

function getNonEvictedBlocks(canvas: Canvas): CanvasBlock[] {
  return canvas.blocks.filter(b => !b.evicted);
}

function budgetSummary(ws: CuratorWorkspace): string {
  const estimatedTokens = canvasTokenCount(ws.canvas);
  // NOTE: realPromptTokens is a snapshot from the provider BEFORE curation started.
  // It does NOT change as we fold/unfold blocks — only estimatedCanvasTokens reflects
  // the curator's changes. We use estimated tokens as the authoritative "current" value
  // for curation decisions, since that's what actually tracks our fold/unfold mutations.
  const current = estimatedTokens;
  // Target is driftTarget (50% of max), not driftThreshold (80% trigger).
  // This prevents bouncing at the threshold boundary.
  const target = ws.config.driftTarget;
  const blocks = getNonEvictedBlocks(ws.canvas);
  let pinned = 0, folded = 0, active = 0;
  for (const b of blocks) {
    if (b.pinned) pinned += b.tokens;
    else if (b.folded) folded += b.tokens;
    else active += b.tokens;
  }

  // Calculate tokens that will be freed by pending mechanical fold of very_old blocks.
  // After curator finishes, all un-rescued very_old blocks are automatically folded.
  // This represents "free" savings the curator doesn't need to manually achieve.
  const pendingVeryOldTokens = computePendingVeryOldTokens(ws);

  const remaining = target - current;
  return JSON.stringify({
    currentTokens: current,
    estimatedCanvasTokens: estimatedTokens,
    realPromptTokens: ws.realPromptTokens ?? null,
    targetTokens: target,
    pinnedTokens: pinned,
    foldedTokens: folded,
    activeTokens: active,
    pendingVeryOldFoldSavings: pendingVeryOldTokens,
    effectiveCurrentTokens: current - pendingVeryOldTokens,
    remainingToTarget: remaining,
    effectiveRemainingToTarget: target - (current - pendingVeryOldTokens),
    overBudget: remaining < 0,
    effectiveOverBudget: (target - (current - pendingVeryOldTokens)) < 0,
  });
}

/**
 * Compute tokens from very_old blocks that will be mechanically folded after curator finishes.
 * These are unfolded, un-pinned, un-kept very_old blocks — the curator gets this "for free".
 */
function computePendingVeryOldTokens(ws: CuratorWorkspace): number {
  const blocks = getNonEvictedBlocks(ws.canvas);
  const aws = ws.config.activeWindowSize;
  const ageMap = buildAgeMap(blocks, aws);
  let total = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (classifyBlockAge(i, ageMap) !== 'very_old') continue;
    const b = blocks[i];
    if (b.pinned || b.folded) continue;
    if (ws.keptBlockIds.has(b.id)) continue;
    total += b.tokens;
  }
  return total;
}

function blockPreview(block: CanvasBlock, maxLen = 80): string {
  const raw = block.folded && block.foldSummary
    ? block.foldSummary
    : block.content;
  return raw.length > maxLen ? raw.slice(0, maxLen - 3) + '...' : raw;
}

// ---------------------------------------------------------------------------
// Sentinel for curator_done
// ---------------------------------------------------------------------------

export interface CuratorDoneSentinel {
  __curatorDone: true;
}

export function isCuratorDoneSentinel(value: unknown): value is CuratorDoneSentinel {
  return typeof value === 'object' && value !== null && '__curatorDone' in value;
}

// ---------------------------------------------------------------------------
// Tool Factories
// ---------------------------------------------------------------------------

/**
 * Create all curator tool entries (10 tools).
 * All closures capture the same CuratorWorkspace reference (mutated in-place).
 */
export function createCuratorTools(ws: CuratorWorkspace): ToolEntry[] {
  return [
    createCuratorOverview(ws),
    createCuratorSearch(ws),
    createCuratorGrep(ws),
    createCuratorKeep(ws),
    createCuratorListSegment(ws),
    createCuratorInspect(ws),
    createCuratorFold(ws),
    createCuratorFoldBatch(ws),
    createCuratorUnfold(ws),
    createCuratorBudget(ws),
    createCuratorDone(ws),
  ];
}

// ---------------------------------------------------------------------------
// curator_overview — Phase 0: global summary + recent full content
// ---------------------------------------------------------------------------

function createCuratorOverview(ws: CuratorWorkspace): ToolEntry {
  const SUMMARY_PAGE_SIZE = 100;
  return {
    definition: {
      name: 'curator_overview',
      description:
        'Get a global overview of my canvas: block summaries (paginated, up to 100 per page), recent blocks in full, and token budget. I call this first to understand the overall picture and extract the current intent/topics. Use offset to paginate the summary section for large canvases.',
      parameters: {
        type: 'object',
        properties: {
          offset: {
            type: 'number',
            description: 'Skip first N summary blocks for pagination (default 0). Only affects the "All blocks (summary)" section; recent full-content section is always shown.',
          },
        },
      },
    },
    executor: async (args): Promise<ToolResult> => {
      const offset = Math.max(0, (args?.offset as number) || 0);
      const blocks = getNonEvictedBlocks(ws.originalCanvas);
      const total = blocks.length;
      const aws = ws.config.activeWindowSize;
      const ageMap = buildAgeMap(blocks, aws);

      // Age counts (only unfolded blocks have ages; folded blocks are separate)
      let veryOldCount = 0, oldCount = 0, recentCount = 0, pinnedCount = 0, foldedCount = 0;
      for (let i = 0; i < total; i++) {
        if (blocks[i].pinned) pinnedCount++;
        if (blocks[i].folded) { foldedCount++; continue; }
        const age = classifyBlockAge(i, ageMap);
        if (age === 'very_old') veryOldCount++;
        else if (age === 'old') oldCount++;
        else if (age === 'recent') recentCount++;
      }

      // Collect all summary entries (non-folded blocks)
      const summaryEntries: string[] = [];
      for (let i = 0; i < total; i++) {
        const b = blocks[i];
        // Already-folded blocks are completely omitted — they are outside
        // the classification system and consume zero prompt tokens. The curator
        // only needs to see blocks it can actually act on.
        if (b.folded) continue;
        const age = classifyBlockAge(i, ageMap);
        const ageLabel = age ?? 'unknown';
        const status = b.pinned ? 'pinned' : 'active';
        const preview = blockPreview(b, 100);
        summaryEntries.push(`#${i} type=${b.type} age=${ageLabel} status=${status} tokens=${b.tokens} | ${preview}`);
      }

      // Build output header
      const lines: string[] = [];
      lines.push(`Canvas: ${total} blocks (${veryOldCount} very_old, ${oldCount} old, ${recentCount} recent, ${foldedCount} already_folded, ${pinnedCount} pinned)`);
      lines.push(budgetSummary(ws));
      lines.push('');
      lines.push(`User message: ${ws.userMessage}`);
      lines.push('');

      // Paginated summary section
      const totalSummary = summaryEntries.length;
      const page = summaryEntries.slice(offset, offset + SUMMARY_PAGE_SIZE);
      const hasMore = offset + SUMMARY_PAGE_SIZE < totalSummary;
      lines.push(`--- All blocks (summary): ${totalSummary} total, showing ${offset + 1}-${offset + page.length} ---`);
      lines.push(...page);
      if (hasMore) {
        lines.push(`\n... ${totalSummary - offset - page.length} more — use offset=${offset + SUMMARY_PAGE_SIZE} to see next page`);
      }

      // Recent blocks: full content (only unfolded recent blocks) — always shown
      const recentIndices: number[] = [];
      for (const [idx, age] of ageMap) {
        if (age === 'recent') recentIndices.push(idx);
      }
      if (recentIndices.length > 0) {
        lines.push('');
        lines.push('--- Recent blocks (full content) ---');
        for (const i of recentIndices) {
          const b = blocks[i];
          lines.push(`\n#${i} type=${b.type} tokens=${b.tokens}`);
          lines.push(b.content);
        }
      }

      return { content: lines.join('\n') };
    },
  };
}

// ---------------------------------------------------------------------------
// curator_search — Phase 1: keyword search across very_old blocks
// ---------------------------------------------------------------------------

function createCuratorSearch(ws: CuratorWorkspace): ToolEntry {
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT = 50;
  return {
    definition: {
      name: 'curator_search',
      description:
        'Search all very_old blocks for keywords. Searches both current content and originalContent (of folded blocks). Returns matching block IDs with context snippets. I use this to rescue relevant blocks before the very_old mechanical fold. Results are paginated — use offset to see more.',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'string',
            description: 'Space-separated keywords to search for (case-insensitive OR match)',
          },
          segment: {
            type: 'string',
            enum: ['old', 'recent', 'all'],
            description: 'Age segment to search in (default: "all")',
          },
          limit: {
            type: 'number',
            description: 'Max results per page (default 20, max 50)',
          },
          offset: {
            type: 'number',
            description: 'Skip first N matches for pagination (default 0)',
          },
        },
        required: ['keywords'],
      },
    },
    executor: async (args): Promise<ToolResult> => {
      const keywords = (args.keywords as string).toLowerCase().split(/\s+/).filter(k => k.length > 0);
      if (keywords.length === 0) {
        return { content: 'Error: No keywords provided.', isError: true };
      }
      const limit = Math.min(Math.max(1, (args.limit as number) || DEFAULT_LIMIT), MAX_LIMIT);
      const offset = Math.max(0, (args.offset as number) || 0);
      const segment = (args.segment as AgeSegment | 'all') || 'very_old';

      const blocks = getNonEvictedBlocks(ws.originalCanvas);
      const aws = ws.config.activeWindowSize;
      const ageMap = buildAgeMap(blocks, aws);

      const allMatches: string[] = [];
      let searched = 0;

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.pinned) continue;
        // Filter by segment if specified
        const age = classifyBlockAge(i, ageMap);
        if (segment !== 'all') {
          if (age !== undefined && age !== segment) continue;
          // Folded blocks without age classification: skip if filtering by segment
          if (age === undefined && b.folded) continue;
        }
        searched++;

        // Search both content and originalContent
        const searchText = (b.content + '\n' + (b.originalContent || '')).toLowerCase();

        const matchedKw = keywords.filter(k => searchText.includes(k));
        if (matchedKw.length > 0) {
          // Extract a context snippet around the first match
          const firstKw = matchedKw[0];
          const idx = searchText.indexOf(firstKw);
          const start = Math.max(0, idx - 40);
          const end = Math.min(searchText.length, idx + firstKw.length + 40);
          const snippet = searchText.slice(start, end).replace(/\n/g, ' ');

          allMatches.push(
            `#${i} type=${b.type} age=${age ?? 'folded'} tokens=${b.tokens} matched=[${matchedKw.join(',')}] | ...${snippet}...`,
          );
        }
      }

      const totalMatches = allMatches.length;
      const page = allMatches.slice(offset, offset + limit);
      const hasMore = offset + limit < totalMatches;

      const result = [
        `Searched ${searched} blocks in segment "${segment}" for: ${keywords.join(', ')}`,
        `Found ${totalMatches} match(es), showing ${offset + 1}-${offset + page.length}:`,
        ...page,
      ];
      if (hasMore) {
        result.push(`\n... ${totalMatches - offset - page.length} more — use offset=${offset + limit} to see next page`);
      }
      return { content: result.join('\n') };
    },
  };
}

// ---------------------------------------------------------------------------
// curator_grep — Phase 1: regex search, can target any segment
// ---------------------------------------------------------------------------

function createCuratorGrep(ws: CuratorWorkspace): ToolEntry {
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT = 50;
  return {
    definition: {
      name: 'curator_grep',
      description:
        'Regex search across block content. Can target a specific age segment. Searches both content and originalContent. Returns matching block IDs with context. Results are paginated — use offset to see more.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for (case-insensitive)',
          },
          segment: {
            type: 'string',
            enum: ['old', 'recent', 'all'],
            description: 'Age segment to search in (default: "all")',
          },
          limit: {
            type: 'number',
            description: 'Max results per page (default 20, max 50)',
          },
          offset: {
            type: 'number',
            description: 'Skip first N matches for pagination (default 0)',
          },
        },
        required: ['pattern'],
      },
    },
    executor: async (args): Promise<ToolResult> => {
      const patternStr = args.pattern as string;
      const segment = (args.segment as AgeSegment | 'all') || 'very_old';
      const limit = Math.min(Math.max(1, (args.limit as number) || DEFAULT_LIMIT), MAX_LIMIT);
      const offset = Math.max(0, (args.offset as number) || 0);

      let regex: RegExp;
      try {
        regex = new RegExp(patternStr, 'i');
      } catch {
        return { content: `Error: Invalid regex pattern: ${patternStr}`, isError: true };
      }

      const blocks = getNonEvictedBlocks(ws.originalCanvas);
      const aws = ws.config.activeWindowSize;
      const ageMap = buildAgeMap(blocks, aws);

      const allMatches: string[] = [];
      let searched = 0;

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.pinned) continue;
        const age = classifyBlockAge(i, ageMap);
        if (segment === 'all') {
          // Search everything
        } else if (age !== undefined) {
          // Unfolded block — must match segment
          if (age !== segment) continue;
        } else if (b.folded) {
          // Folded blocks are not classified by age; skip if filtering by segment
          continue;
        } else {
          continue;
        }
        searched++;

        const searchText = b.content + '\n' + (b.originalContent || '');
        const match = regex.exec(searchText);

        if (match) {
          const idx = match.index;
          const start = Math.max(0, idx - 40);
          const end = Math.min(searchText.length, idx + match[0].length + 40);
          const snippet = searchText.slice(start, end).replace(/\n/g, ' ');

          allMatches.push(
            `#${i} type=${b.type} age=${age ?? 'folded'} tokens=${b.tokens} | ...${snippet}...`,
          );
        }
      }

      const totalMatches = allMatches.length;
      const page = allMatches.slice(offset, offset + limit);
      const hasMore = offset + limit < totalMatches;

      const result = [
        `Grep /${patternStr}/i in ${segment}: searched ${searched} blocks`,
        `Found ${totalMatches} match(es), showing ${offset + 1}-${offset + page.length}:`,
        ...page,
      ];
      if (hasMore) {
        result.push(`\n... ${totalMatches - offset - page.length} more — use offset=${offset + limit} to see next page`);
      }
      return { content: result.join('\n') };
    },
  };
}

// ---------------------------------------------------------------------------
// curator_keep — Phase 1: mark a block to be preserved
// ---------------------------------------------------------------------------

function createCuratorKeep(ws: CuratorWorkspace): ToolEntry {
  return {
    definition: {
      name: 'curator_keep',
      description:
        'Mark a very_old block to be preserved (not folded). I call this after searching very_old blocks to rescue them before the mechanical fold.',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string', description: 'Block short ID (e.g. "#3")' },
        },
        required: ['blockId'],
      },
    },
    executor: async (args): Promise<ToolResult> => {
      const rawId = args.blockId as string;
      const uuid = resolveBlockId(ws, rawId);
      if (!uuid) return { content: `Error: Block "${rawId}" not found.`, isError: true };
      const block = findBlock(ws.canvas, uuid);
      if (!block) return { content: `Error: Block "${rawId}" not found.`, isError: true };
      ws.keptBlockIds.add(uuid);
      return { content: `Marked ${shortId(ws, uuid)} (${block.type}) as keep. ${budgetSummary(ws)}` };
    },
  };
}

// ---------------------------------------------------------------------------
// curator_list_segment — Phase 2: view summaries for an age segment
// ---------------------------------------------------------------------------

function createCuratorListSegment(ws: CuratorWorkspace): ToolEntry {
  const PAGE_SIZE = 30;
  return {
    definition: {
      name: 'curator_list_segment',
      description:
        'List block summaries for a specific age segment. Shows #id, type, status, tokens, and a preview. Returns up to 30 blocks per page — use offset to paginate.',
      parameters: {
        type: 'object',
        properties: {
          segment: {
            type: 'string',
            enum: ['very_old', 'old', 'recent'],
            description: 'Age segment to list',
          },
          offset: {
            type: 'number',
            description: 'Skip first N matching blocks (default 0, for pagination)',
          },
        },
        required: ['segment'],
      },
    },
    executor: async (args): Promise<ToolResult> => {
      const segment = args.segment as AgeSegment;
      const offset = Math.max(0, (args.offset as number) || 0);
      const blocks = getNonEvictedBlocks(ws.canvas);
      const aws = ws.config.activeWindowSize;
      const ageMap = buildAgeMap(blocks, aws);

      // Collect all matching entries
      const allEntries: string[] = [];
      for (let i = 0; i < blocks.length; i++) {
        if (classifyBlockAge(i, ageMap) !== segment) continue;
        const b = blocks[i];
        const status = b.pinned ? 'pinned' : b.folded ? 'folded' : 'active';
        const hasOrig = b.originalContent ? ' [has_original]' : '';
        allEntries.push(
          `#${i} type=${b.type} status=${status} tokens=${b.tokens}${hasOrig} | ${blockPreview(b)}`,
        );
      }

      const totalCount = allEntries.length;
      const page = allEntries.slice(offset, offset + PAGE_SIZE);
      const hasMore = offset + PAGE_SIZE < totalCount;

      const header = `${segment} segment: ${totalCount} blocks (showing ${offset}-${offset + page.length - 1})\n${budgetSummary(ws)}`;
      const footer = hasMore ? `\n... ${totalCount - offset - page.length} more — use offset=${offset + PAGE_SIZE} to see next page` : '';

      return {
        content: `${header}\n\n${page.join('\n')}${footer}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// curator_inspect — Phase 2: view full content of one block
// ---------------------------------------------------------------------------

function createCuratorInspect(ws: CuratorWorkspace): ToolEntry {
  return {
    definition: {
      name: 'curator_inspect',
      description:
        'View the full content of a specific block (up to 2000 characters). If the block is folded and has originalContent, shows both the summary and original.',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string', description: 'Block short ID (e.g. "#3")' },
        },
        required: ['blockId'],
      },
    },
    executor: async (args): Promise<ToolResult> => {
      const rawId = args.blockId as string;
      const uuid = resolveBlockId(ws, rawId);
      if (!uuid) return { content: `Error: Block "${rawId}" not found.`, isError: true };
      const block = findBlock(ws.canvas, uuid);
      if (!block) return { content: `Error: Block "${rawId}" not found.`, isError: true };

      const lines: string[] = [];
      const sid = shortId(ws, uuid);
      const status = block.pinned ? 'pinned' : block.folded ? 'folded' : 'active';
      lines.push(`Block ${sid}: type=${block.type} status=${status} tokens=${block.tokens}`);

      if (block.folded && block.originalContent) {
        lines.push('--- Fold summary ---');
        lines.push(block.foldSummary || '(no summary)');
        lines.push('--- Original content (truncated to 2000 chars) ---');
        lines.push(block.originalContent.slice(0, 2000));
      } else {
        lines.push('--- Content (truncated to 2000 chars) ---');
        lines.push(block.content.slice(0, 2000));
      }

      return { content: lines.join('\n') };
    },
  };
}

// ---------------------------------------------------------------------------
// curator_fold — Phase 2: mark a block for folding
// ---------------------------------------------------------------------------

function createCuratorFold(ws: CuratorWorkspace): ToolEntry {
  return {
    definition: {
      name: 'curator_fold',
      description:
        'Fold a block to compress it. Preserves originalContent so it can be unfolded later. Cannot fold pinned blocks. Returns updated budget.',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string', description: 'Block short ID (e.g. "#3")' },
          reason: { type: 'string', description: 'Brief reason for folding' },
        },
        required: ['blockId', 'reason'],
      },
    },
    executor: async (args): Promise<ToolResult> => {
      const rawId = args.blockId as string;
      const reason = args.reason as string;
      const uuid = resolveBlockId(ws, rawId);
      if (!uuid) return { content: `Error: Block "${rawId}" not found.`, isError: true };
      const block = findBlock(ws.canvas, uuid);
      if (!block) return { content: `Error: Block "${rawId}" not found.`, isError: true };

      const sid = shortId(ws, uuid);
      if (block.pinned) return { content: `Error: ${sid} is pinned.`, isError: true };
      if (block.folded) return { content: `${sid} is already folded. ${budgetSummary(ws)}` };

      ws.canvas = manualFoldBlock(ws.canvas, uuid, ws.config);
      ws.decisions.push({ blockId: uuid, action: 'fold', reason });
      rebuildIdMaps(ws);

      return { content: `Folded ${sid} (${block.type}). ${budgetSummary(ws)}` };
    },
  };
}

// ---------------------------------------------------------------------------
// curator_fold_batch — Phase 2: fold multiple blocks in one call
// ---------------------------------------------------------------------------

/**
 * Parse a batch block specification into an array of short indices.
 * Accepts comma-separated items where each item is either:
 *   - A single ref: "#3" or "3"
 *   - A range: "#3-#7", "#3-7", "3-7"
 *
 * Returns sorted, deduplicated array of indices, or an error string.
 */
export function parseBatchBlockIds(input: string): number[] | string {
  const items = input.split(',').map(s => s.trim()).filter(s => s.length > 0);
  if (items.length === 0) return 'No block IDs provided.';

  const indices = new Set<number>();

  for (const item of items) {
    // Try range: e.g. "#3-#7", "#3-7", "3-7"
    const rangeMatch = item.match(/^#?(\d+)\s*-\s*#?(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (isNaN(start) || isNaN(end)) return `Invalid range: "${item}"`;
      if (start > end) return `Invalid range (start > end): "${item}"`;
      if (end - start > 200) return `Range too large (max 200): "${item}"`;
      for (let i = start; i <= end; i++) indices.add(i);
      continue;
    }

    // Try single: e.g. "#3" or "3"
    const singleMatch = item.match(/^#?(\d+)$/);
    if (singleMatch) {
      const idx = parseInt(singleMatch[1], 10);
      if (isNaN(idx)) return `Invalid block ID: "${item}"`;
      indices.add(idx);
      continue;
    }

    return `Invalid block ID format: "${item}". Use #N or #N-#M.`;
  }

  return [...indices].sort((a, b) => a - b);
}

function createCuratorFoldBatch(ws: CuratorWorkspace): ToolEntry {
  return {
    definition: {
      name: 'curator_fold_batch',
      description:
        'Fold multiple blocks in one call. Accepts comma-separated block IDs and ranges. Examples: "#3,#5,#8", "#3-#10", "#2,#5-#8,#12". Skips pinned and already-folded blocks. Returns a summary of what was folded and what was skipped.',
      parameters: {
        type: 'object',
        properties: {
          blockIds: {
            type: 'string',
            description: 'Comma-separated block short IDs and/or ranges. E.g. "#3,#5-#10,#12"',
          },
          reason: { type: 'string', description: 'Brief reason for folding these blocks' },
        },
        required: ['blockIds', 'reason'],
      },
    },
    executor: async (args): Promise<ToolResult> => {
      const rawIds = args.blockIds as string;
      const reason = args.reason as string;

      const parsed = parseBatchBlockIds(rawIds);
      if (typeof parsed === 'string') {
        return { content: `Error: ${parsed}`, isError: true };
      }

      let folded = 0;
      let skippedPinned = 0;
      let skippedFolded = 0;
      let skippedNotFound = 0;
      const foldedIds: string[] = [];

      for (const idx of parsed) {
        const uuid = ws.idMap.get(idx);
        if (!uuid) { skippedNotFound++; continue; }
        const block = findBlock(ws.canvas, uuid);
        if (!block) { skippedNotFound++; continue; }
        if (block.pinned) { skippedPinned++; continue; }
        if (block.folded) { skippedFolded++; continue; }

        ws.canvas = manualFoldBlock(ws.canvas, uuid, ws.config);
        ws.decisions.push({ blockId: uuid, action: 'fold', reason });
        foldedIds.push(`#${idx}`);
        folded++;
      }

      // Rebuild maps after batch mutation
      rebuildIdMaps(ws);

      const parts: string[] = [];
      parts.push(`Folded ${folded} block(s): ${foldedIds.join(', ') || '(none)'}`);
      if (skippedPinned > 0) parts.push(`Skipped ${skippedPinned} pinned`);
      if (skippedFolded > 0) parts.push(`Skipped ${skippedFolded} already folded`);
      if (skippedNotFound > 0) parts.push(`Skipped ${skippedNotFound} not found`);
      parts.push(budgetSummary(ws));

      return { content: parts.join('. ') };
    },
  };
}

// ---------------------------------------------------------------------------
// curator_unfold — Phase 2: restore a folded block
// ---------------------------------------------------------------------------

function createCuratorUnfold(ws: CuratorWorkspace): ToolEntry {
  return {
    definition: {
      name: 'curator_unfold',
      description:
        'Unfold a previously folded block, restoring its original content. Only works on blocks with preserved originalContent. Returns updated budget.',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string', description: 'Block short ID (e.g. "#3")' },
          reason: { type: 'string', description: 'Brief reason for unfolding' },
        },
        required: ['blockId', 'reason'],
      },
    },
    executor: async (args): Promise<ToolResult> => {
      const rawId = args.blockId as string;
      const reason = args.reason as string;
      const uuid = resolveBlockId(ws, rawId);
      if (!uuid) return { content: `Error: Block "${rawId}" not found.`, isError: true };
      const block = findBlock(ws.canvas, uuid);
      if (!block) return { content: `Error: Block "${rawId}" not found.`, isError: true };

      const sid = shortId(ws, uuid);
      if (!block.folded) return { content: `${sid} is not folded. ${budgetSummary(ws)}` };
      if (!block.originalContent) return { content: `Error: ${sid} has no originalContent to restore.`, isError: true };

      ws.canvas = expandBlock(ws.canvas, uuid, ws.config);
      ws.decisions.push({ blockId: uuid, action: 'unfold', reason });
      rebuildIdMaps(ws);

      return { content: `Unfolded ${sid} (${block.type}). ${budgetSummary(ws)}` };
    },
  };
}

// ---------------------------------------------------------------------------
// curator_budget — check token budget status
// ---------------------------------------------------------------------------

function createCuratorBudget(ws: CuratorWorkspace): ToolEntry {
  return {
    definition: {
      name: 'curator_budget',
      description: 'Check the current token budget status. Shows estimated token usage (tracks my fold/unfold changes), target (50% of max — well below the 80% trigger threshold to prevent bouncing), and breakdown by category. pendingVeryOldFoldSavings shows tokens that will be automatically freed when un-rescued very_old blocks are mechanically folded after I finish — this is "free" savings I do not need to manually achieve. Use effectiveCurrentTokens and effectiveRemainingToTarget to gauge real progress. Note: realPromptTokens is a frozen snapshot from before curation.',
      parameters: { type: 'object', properties: {} },
    },
    executor: async (): Promise<ToolResult> => {
      return { content: budgetSummary(ws) };
    },
  };
}

// ---------------------------------------------------------------------------
// curator_done — signal completion (sentinel pattern)
// ---------------------------------------------------------------------------

function createCuratorDone(ws: CuratorWorkspace): ToolEntry {
  return {
    definition: {
      name: 'curator_done',
      description:
        'Signal that I have finished curating the canvas. This commits all my fold/unfold decisions. I call this when I have reached the token budget target or have reviewed all relevant segments.',
      parameters: { type: 'object', properties: {} },
    },
    executor: async (): Promise<ToolResult> => {
      ws.done = true;
      // Abort the child runFlow so it exits immediately after returning
      // this tool result — no extra LLM round needed.
      if (ws.abortController) ws.abortController.abort();
      return { content: 'Done. All decisions committed.' };
    },
  };
}

// ---------------------------------------------------------------------------
// Mechanical fold of un-kept very_old blocks (post-curator safety net)
// ---------------------------------------------------------------------------

/**
 * After the curator sub-agent finishes its work (search, keep, fold/unfold),
 * fold all very_old blocks that were NOT explicitly marked as "keep".
 *
 * DESIGN RATIONALE:
 *   This is NOT "position-based folding that bypasses the curator".
 *   The curator has already had a chance to search and keep important blocks.
 *   This is the safety net for very long conversations: when the curator
 *   can't decide what to fold (because everything looks important after
 *   earlier curation rounds), very_old blocks are the ones that should
 *   make way for newer content — even if they seem valuable.
 *
 *   This only runs AFTER the curator completes. The curator can rescue
 *   any very_old block via `curator_keep`. Un-rescued very_old blocks
 *   are assumed to be safe to fold.
 *
 * INVARIANT:
 *   This is part of the curator's recycling logic, NOT a standalone
 *   position-based fold. It never runs outside of curator drift.
 */
export function mechanicalFoldVeryOld(ws: CuratorWorkspace): number {
  const blocks = getNonEvictedBlocks(ws.canvas);
  const aws = ws.config.activeWindowSize;
  const ageMap = buildAgeMap(blocks, aws);
  let folded = 0;

  for (let i = 0; i < blocks.length; i++) {
    if (classifyBlockAge(i, ageMap) !== 'very_old') continue;
    const b = blocks[i];
    if (b.pinned || b.folded) continue;
    if (ws.keptBlockIds.has(b.id)) continue;

    ws.canvas = manualFoldBlock(ws.canvas, b.id, ws.config);
    ws.decisions.push({ blockId: b.id, action: 'fold', reason: 'mechanical: very_old, not rescued' });
    folded++;
  }

  return folded;
}
