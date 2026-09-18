// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Checkpoint Manager (State Snapshot / Rollback)
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type { AgentState, Checkpoint } from '@vesper/shared';
import { cloneState } from './clone.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface CheckpointManager {
  save(state: AgentState, step: number, description?: string): Checkpoint;
  rollback(checkpointId: string): AgentState | null;
  list(): Checkpoint[];
  latest(): Checkpoint | null;
  clear(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHECKPOINTS = 20;

export function createCheckpointManager(maxCheckpoints?: number): CheckpointManager {
  const max = maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS;
  const checkpoints: Checkpoint[] = [];

  function save(state: AgentState, step: number, description?: string): Checkpoint {
    const cp: Checkpoint = {
      id: randomUUID(),
      timestamp: Date.now(),
      state: cloneState(state),
      step,
      description,
    };

    checkpoints.push(cp);

    // FIFO eviction
    while (checkpoints.length > max) {
      checkpoints.shift();
    }

    return cp;
  }

  function rollback(checkpointId: string): AgentState | null {
    const cp = checkpoints.find((c) => c.id === checkpointId);
    if (!cp) return null;
    return cloneState(cp.state);
  }

  function list(): Checkpoint[] {
    return [...checkpoints];
  }

  function latest(): Checkpoint | null {
    return checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
  }

  function clear(): void {
    checkpoints.length = 0;
  }

  return { save, rollback, list, latest, clear };
}
