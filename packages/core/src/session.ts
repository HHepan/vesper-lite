// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Session Manager (node:sqlite storage)
// Persists AgentState to disk with checkpoint support.
// Uses Node.js 22+ built-in `node:sqlite` (DatabaseSync, synchronous API).
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AgentState,
  CanvasBlock,
  SessionManifest,
  SessionCheckpointEntry,
  SessionExportData,
} from '@vesper/shared';

// ---------------------------------------------------------------------------
// State Sanitization for Persistence
// ---------------------------------------------------------------------------

/**
 * Prepare an AgentState for serialization by stripping data that should not
 * be persisted across sessions:
 *
 * 1. Evicted blocks are removed entirely — they are dead weight that bloats
 *    storage and causes token-explosion on reload (the blocks are already
 *    beyond the sliding window and irrecoverable).
 *
 * 2. Folded blocks — treatment depends on foldReason:
 *    - Drift-folded (foldReason='drift'): originalContent is cleared — the
 *      fold summary is sufficient for context. These are permanently compressed;
 *      important content has already been extracted by the Memory Agent.
 *    - Manually-folded (foldReason='manual'): originalContent is PRESERVED so
 *      the user can expand the block after reload.
 *    - Legacy folded (no foldReason): stamped with foldReason='drift' before
 *      saving, then originalContent is cleared (same as drift-folded).
 *      This prevents restoreLegacyFoldedBlocks from misclassifying them on load.
 *
 * 3. `lastRealPromptTokens` is cleared — it is a transient metric from the
 *    last API call and meaningless after a reload.
 *
 * 4. `beginWithPromptTokens` is cleared — it depends on the drift history
 *    which doesn't carry over across sessions.
 *
 * 5. `cumulativePromptTokens` is PRESERVED — it represents the total
 *    conversation footprint and should persist across saves/reloads.
 *
 * INVARIANT: Ego-switch folding is view-only (applied in prompt-builder,
 * never persisted to state.canvas), so it never appears here.
 */
function sanitizeStateForSave(state: AgentState): AgentState {
  const blocks = state.canvas.blocks
    .filter(b => !b.evicted)
    .map((b: CanvasBlock): CanvasBlock => {
      if (b.folded) {
        // Legacy folded blocks without foldReason: stamp as 'drift' before saving.
        // This prevents restoreLegacyFoldedBlocks from misclassifying them on load.
        if (!b.foldReason) {
          b = { ...b, foldReason: 'drift' };
        }

        if (b.originalContent) {
          // Manually-folded blocks: preserve originalContent for expand after reload
          if (b.foldReason === 'manual') {
            return b;
          }
          // Drift-folded or legacy folded: drop the bulky original
          const { originalContent: _oc, ...rest } = b;
          return rest as CanvasBlock;
        }
      }
      return b;
    });

  return {
    ...state,
    canvas: { blocks },
    lastRealPromptTokens: undefined,
    beginWithPromptTokens: undefined,
    systemPromptTokens: undefined,
    // cumulativePromptTokens is preserved — it's a cumulative metric
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  scene_name TEXT
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  description TEXT,
  timestamp INTEGER NOT NULL,
  state TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, step);
`;

// Migration: add scene_name column if missing (for existing databases)
const MIGRATION_ADD_SCENE_NAME = `
ALTER TABLE sessions ADD COLUMN scene_name TEXT;
`;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface SessionManager {
  /** Save state as a new session. If a session with the same name already exists and has a different ID, an error is thrown. */
  save(state: AgentState, opts?: { name?: string; description?: string; model?: string; sceneName?: string; currentSessionId?: string }): SessionManifest;
  load(sessionId: string, checkpointId?: string): AgentState;
  list(): SessionManifest[];
  /** Find a session by its custom name. Returns null if not found. */
  findByName(name: string): SessionManifest | null;
  /** Rename a session. Returns the updated manifest, or null if not found. Throws an error if the new name already exists. */
  rename(sessionId: string, newName: string): SessionManifest | null;
  /** Delete a session and all its checkpoints. Returns true if found & deleted. */
  delete(sessionId: string): boolean;
  rollback(sessionId: string, checkpointId: string): AgentState;
  addCheckpoint(sessionId: string, state: AgentState, step: number, desc?: string): SessionCheckpointEntry;
  getCheckpoints(sessionId: string): SessionCheckpointEntry[];
  /** Export a session's latest state to a JSON file. Returns the resolved output path. */
  exportSession(sessionIdOrName: string, outputPath?: string): { filePath: string; name: string };
  /** Import a session from a JSON file. Returns the created session manifest. */
  importSession(filePath: string): SessionManifest;
  close(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createSessionManager(dbPath?: string): SessionManager {
  const resolvedPath = dbPath ?? '.vesper/sessions.db';

  // Ensure parent directory exists
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath, { timeout: 10000 });
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(SCHEMA);

  // Migration: add scene_name column if missing (SQLite doesn't support IF NOT EXISTS for ALTER TABLE)
  try {
    // Check if scene_name column exists
    const tableInfo = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    const hasSceneName = tableInfo.some(col => col.name === 'scene_name');
    if (!hasSceneName) {
      db.exec(MIGRATION_ADD_SCENE_NAME);
    }
  } catch {
    // Migration failed (column might already exist or other error) — ignore
  }

  // Prepare statements
  const insertSession = db.prepare(
    'INSERT INTO sessions (id, name, model, description, created_at, updated_at, scene_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const updateSessionTimestamp = db.prepare(
    'UPDATE sessions SET updated_at = ? WHERE id = ?',
  );
  const selectSession = db.prepare(
    'SELECT * FROM sessions WHERE id = ?',
  );
  const selectAllSessions = db.prepare(
    'SELECT s.*, (SELECT COUNT(*) FROM checkpoints WHERE session_id = s.id) AS checkpoint_count FROM sessions s ORDER BY s.updated_at DESC',
  );
  const insertCheckpoint = db.prepare(
    'INSERT INTO checkpoints (id, session_id, step, description, timestamp, state) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const selectCheckpoint = db.prepare(
    'SELECT * FROM checkpoints WHERE id = ?',
  );
  const selectLatestCheckpoint = db.prepare(
    'SELECT * FROM checkpoints WHERE session_id = ? ORDER BY step DESC LIMIT 1',
  );
  const selectCheckpoints = db.prepare(
    'SELECT id, session_id, step, description, timestamp FROM checkpoints WHERE session_id = ? ORDER BY step ASC',
  );
  const selectSessionByName = db.prepare(
    'SELECT s.*, (SELECT COUNT(*) FROM checkpoints WHERE session_id = s.id) AS checkpoint_count FROM sessions s WHERE s.name = ? ORDER BY s.updated_at DESC LIMIT 1',
  );
  const deleteCheckpointsBySession = db.prepare(
    'DELETE FROM checkpoints WHERE session_id = ?',
  );
  const deleteSession = db.prepare(
    'DELETE FROM sessions WHERE id = ?',
  );
  const updateSession = db.prepare(
    'UPDATE sessions SET name = ?, model = ?, description = ?, updated_at = ?, scene_name = ? WHERE id = ?',
  );

  return {
    save(state: AgentState, opts?: { name?: string; description?: string; model?: string; sceneName?: string; currentSessionId?: string }): SessionManifest {
      const now = Date.now();
      const name = opts?.name ?? `session-${new Date(now).toISOString().replace(/[:.]/g, '-')}`;
      const model = opts?.model ?? 'unknown';
      const sceneName = opts?.sceneName ?? null;

      // Check if a session with the same name already exists
      if (opts?.name) {
        const existing = selectSessionByName.get(opts.name) as any;
        if (existing) {
          // If this is an update to the same session (same ID), allow it
          // Otherwise, reject to prevent multiple sessions with the same name
          if (opts.currentSessionId && existing.id !== opts.currentSessionId) {
            throw new Error(`Session "${opts.name}" already exists. Please choose a different name.`);
          }
          
          // Overwrite existing session (same ID)
          deleteCheckpointsBySession.run(existing.id);
          updateSession.run(name, model, opts?.description ?? null, now, sceneName, existing.id);
          const cpId = randomUUID();
          const stateJson = JSON.stringify(sanitizeStateForSave(state));
          insertCheckpoint.run(cpId, existing.id, 0, 'initial', now, stateJson);
          return {
            id: existing.id,
            name,
            createdAt: existing.created_at,
            updatedAt: now,
            model,
            checkpointCount: 1,
            description: opts?.description,
            sceneName: opts?.sceneName ?? undefined,
          };
        }
      }

      const sessionId = randomUUID();
      insertSession.run(sessionId, name, model, opts?.description ?? null, now, now, sceneName);

      // Auto-create initial checkpoint (step 0)
      const cpId = randomUUID();
      const stateJson = JSON.stringify(sanitizeStateForSave(state));
      insertCheckpoint.run(cpId, sessionId, 0, 'initial', now, stateJson);

      return {
        id: sessionId,
        name,
        createdAt: now,
        updatedAt: now,
        model,
        checkpointCount: 1,
        description: opts?.description,
        sceneName: opts?.sceneName ?? undefined,
      };
    },

    load(sessionId: string, checkpointId?: string): AgentState {
      const session = selectSession.get(sessionId) as any;
      if (!session) {
        throw new Error(`Session "${sessionId}" not found.`);
      }

      let row: any;
      if (checkpointId) {
        row = selectCheckpoint.get(checkpointId) as any;
        if (!row || row.session_id !== sessionId) {
          throw new Error(`Checkpoint "${checkpointId}" not found in session "${sessionId}".`);
        }
      } else {
        row = selectLatestCheckpoint.get(sessionId) as any;
        if (!row) {
          throw new Error(`No checkpoints found for session "${sessionId}".`);
        }
      }

      return JSON.parse(row.state) as AgentState;
    },

    list(): SessionManifest[] {
      const rows = selectAllSessions.all() as any[];
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        model: row.model,
        checkpointCount: row.checkpoint_count,
        description: row.description ?? undefined,
        sceneName: row.scene_name ?? undefined,
      }));
    },

    findByName(name: string): SessionManifest | null {
      const row = selectSessionByName.get(name) as any;
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        model: row.model,
        checkpointCount: row.checkpoint_count,
        description: row.description ?? undefined,
        sceneName: row.scene_name ?? undefined,
      };
    },

    rename(sessionId: string, newName: string): SessionManifest | null {
      const session = selectSession.get(sessionId) as any;
      if (!session) return null;
      
      // Check if another session with the same name already exists
      const existing = selectSessionByName.get(newName) as any;
      if (existing && existing.id !== sessionId) {
        throw new Error(`Session "${newName}" already exists. Please choose a different name.`);
      }
      
      const now = Date.now();
      // Use the same updateSession prepared statement but only change the name
      updateSession.run(newName, session.model, session.description, now, session.scene_name, sessionId);
      const updated = selectSession.get(sessionId) as any;
      const checkpointCount = (db.prepare('SELECT COUNT(*) AS cnt FROM checkpoints WHERE session_id = ?').get(sessionId) as any)?.cnt ?? 0;
      return {
        id: updated.id,
        name: updated.name,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
        model: updated.model,
        checkpointCount,
        description: updated.description ?? undefined,
        sceneName: updated.scene_name ?? undefined,
      };
    },

    delete(sessionId: string): boolean {
      const session = selectSession.get(sessionId) as any;
      if (!session) return false;
      deleteCheckpointsBySession.run(sessionId);
      deleteSession.run(sessionId);
      return true;
    },

    rollback(sessionId: string, checkpointId: string): AgentState {
      const session = selectSession.get(sessionId) as any;
      if (!session) {
        throw new Error(`Session "${sessionId}" not found.`);
      }

      const row = selectCheckpoint.get(checkpointId) as any;
      if (!row || row.session_id !== sessionId) {
        throw new Error(`Checkpoint "${checkpointId}" not found in session "${sessionId}".`);
      }

      // Update session timestamp
      updateSessionTimestamp.run(Date.now(), sessionId);

      return JSON.parse(row.state) as AgentState;
    },

    addCheckpoint(sessionId: string, state: AgentState, step: number, desc?: string): SessionCheckpointEntry {
      const session = selectSession.get(sessionId) as any;
      if (!session) {
        throw new Error(`Session "${sessionId}" not found.`);
      }

      const now = Date.now();
      const cpId = randomUUID();
      const stateJson = JSON.stringify(sanitizeStateForSave(state));
      const filename = `state-${String(step).padStart(3, '0')}.json`;

      insertCheckpoint.run(cpId, sessionId, step, desc ?? null, now, stateJson);
      updateSessionTimestamp.run(now, sessionId);

      return {
        id: cpId,
        step,
        timestamp: now,
        description: desc,
        filename,
      };
    },

    getCheckpoints(sessionId: string): SessionCheckpointEntry[] {
      const rows = selectCheckpoints.all(sessionId) as any[];
      return rows.map((row) => ({
        id: row.id,
        step: row.step,
        timestamp: row.timestamp,
        description: row.description ?? undefined,
        filename: `state-${String(row.step).padStart(3, '0')}.json`,
      }));
    },

    exportSession(sessionIdOrName: string, outputPath?: string): { filePath: string; name: string } {
      // Resolve: try name-based lookup first, fall back to raw id
      let resolvedId = sessionIdOrName;
      let sessionName = sessionIdOrName;
      const manifest = (selectSessionByName.get(sessionIdOrName) as any) ?? (selectSession.get(sessionIdOrName) as any);
      if (!manifest) {
        throw new Error(`Session "${sessionIdOrName}" not found.`);
      }
      resolvedId = manifest.id;
      sessionName = manifest.name;

      // Get latest checkpoint state
      const latest = selectLatestCheckpoint.get(resolvedId) as any;
      if (!latest) {
        throw new Error(`No checkpoints found for session "${sessionIdOrName}".`);
      }

      const state = JSON.parse(latest.state) as AgentState;

      const exportData: SessionExportData = {
        version: 1,
        exportedAt: Date.now(),
        session: {
          name: sessionName,
          model: manifest.model,
          description: manifest.description ?? undefined,
          createdAt: manifest.created_at,
          updatedAt: manifest.updated_at,
        },
        state: sanitizeStateForSave(state),
      };

      // Default output path: .vesper/<name>.session.json
      const safeName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const resolvedOutput = outputPath
        ? resolve(outputPath)
        : resolve('.vesper', `${safeName}.session.json`);

      mkdirSync(dirname(resolvedOutput), { recursive: true });
      writeFileSync(resolvedOutput, JSON.stringify(exportData, null, 2), 'utf-8');

      return { filePath: resolvedOutput, name: sessionName };
    },

    importSession(filePath: string): SessionManifest {
      const resolvedPath = resolve(filePath);
      let raw: string;
      try {
        raw = readFileSync(resolvedPath, 'utf-8');
      } catch (err) {
        throw new Error(`Cannot read file: ${resolvedPath}`);
      }

      let data: SessionExportData;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Invalid JSON in file: ${resolvedPath}`);
      }

      // Basic validation
      if (!data.version || !data.session || !data.state) {
        throw new Error(`Invalid session export format — missing required fields.`);
      }

      const { session: meta, state } = data;
      const now = Date.now();
      const sessionId = randomUUID();

      insertSession.run(
        sessionId,
        meta.name,
        meta.model ?? 'unknown',
        meta.description ?? null,
        now,
        now,
      );

      // Create initial checkpoint from imported state
      const cpId = randomUUID();
      insertCheckpoint.run(cpId, sessionId, 0, 'imported', now, JSON.stringify(sanitizeStateForSave(state)));

      return {
        id: sessionId,
        name: meta.name,
        createdAt: now,
        updatedAt: now,
        model: meta.model ?? 'unknown',
        checkpointCount: 1,
        description: meta.description,
      };
    },

    close(): void {
      db.close();
    },
  };
}
