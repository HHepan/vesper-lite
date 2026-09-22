// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Permission Store
// Persists allow/deny permission decisions to .vesper-lite/permissions.json
// so they survive across session restarts.
// ═══════════════════════════════════════════════════════════════════════════

import { readFile } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// File Format
// ---------------------------------------------------------------------------

interface PermissionRule {
  key: string;
  decision: 'allow' | 'deny';
}

interface PermissionFile {
  version: 1;
  rules: PermissionRule[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const PERMISSIONS_DIR = '.vesper-lite';
const PERMISSIONS_FILE = 'permissions.json';

function permissionsPath(cwd: string): string {
  return join(cwd, PERMISSIONS_DIR, PERMISSIONS_FILE);
}

/**
 * Load persisted permissions from `.vesper-lite/permissions.json`.
 * Returns an empty Map if the file is missing or malformed.
 */
export async function loadPermissions(cwd: string): Promise<Map<string, 'allow' | 'deny'>> {
  const map = new Map<string, 'allow' | 'deny'>();
  try {
    const raw = await readFile(permissionsPath(cwd), 'utf-8');
    const data: PermissionFile = JSON.parse(raw);
    if (data.version === 1 && Array.isArray(data.rules)) {
      for (const rule of data.rules) {
        if (rule.key && (rule.decision === 'allow' || rule.decision === 'deny')) {
          map.set(rule.key, rule.decision);
        }
      }
    }
  } catch {
    // File missing or malformed — return empty map
  }
  return map;
}

/**
 * Write the full permission map to `.vesper-lite/permissions.json` (synchronous).
 * Entries are sorted alphabetically by key for deterministic output.
 */
export function savePermissions(cwd: string, map: Map<string, 'allow' | 'deny'>): void {
  const rules: PermissionRule[] = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, decision]) => ({ key, decision }));

  const data: PermissionFile = { version: 1, rules };

  const dir = join(cwd, PERMISSIONS_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(permissionsPath(cwd), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// Coalesce multiple persist calls within the same microtask
let pendingSave: { cwd: string; map: Map<string, 'allow' | 'deny'> } | null = null;

/**
 * Record a single permission decision into the map and schedule a
 * non-blocking save via `queueMicrotask`.
 */
export function persistPermissionDecision(
  cwd: string,
  map: Map<string, 'allow' | 'deny'>,
  key: string,
  decision: 'allow' | 'deny',
): void {
  map.set(key, decision);

  if (!pendingSave) {
    pendingSave = { cwd, map };
    queueMicrotask(() => {
      if (pendingSave) {
        try {
          savePermissions(pendingSave.cwd, pendingSave.map);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[permission-store] Failed to save: ${msg}\n`);
        }
        pendingSave = null;
      }
    });
  }
}

/**
 * Clear all persisted permissions: empties the map and writes an empty file.
 */
export function clearPermissions(cwd: string, map: Map<string, 'allow' | 'deny'>): void {
  map.clear();
  try {
    savePermissions(cwd, map);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[permission-store] Failed to clear: ${msg}\n`);
  }
}
