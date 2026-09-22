// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Image Store (persist user-pasted images to project-local files)
// ═══════════════════════════════════════════════════════════════════════════
//
// When a user pastes an image (Alt+V), it arrives as a base64 ImageAttachment.
// This module writes it to a project-local file so the canvas can reference it
// by path. On subsequent message rebuilds, the image is loaded back from disk
// and re-injected as an image_url content part — making images persistent
// across the entire conversation, not just the first API call.
//
// Storage layout:
//   .vesper-lite/images/{sessionSlug}/{uuid}.png
//
// sessionSlug is a short identifier per runFlow invocation (timestamp + short
// random suffix) so images are grouped by conversation session.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ImageAttachment } from '@vesper/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// ---------------------------------------------------------------------------
// Session slug — groups images by conversation session
// ---------------------------------------------------------------------------

/**
 * Generate a session slug for image storage.
 * Format: `YYYYMMDD-HHmmss-xxxx` (date + short random suffix).
 * Unique enough to avoid collisions, human-readable for browsing.
 */
export function generateSessionSlug(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 15); // 20260305-130042
  const formatted = date.slice(0, 8) + '-' + date.slice(8); // 20260305-130042
  const suffix = randomUUID().slice(0, 4);
  return `${formatted}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Image directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the image storage directory for a given session.
 * Uses `cwd/.vesper-lite/images/{sessionSlug}/` — project-local, session-scoped.
 */
function resolveImageDir(sessionSlug: string, cwd?: string): string {
  const base = cwd ?? process.cwd();
  return join(base, '.vesper-lite', 'images', sessionSlug);
}

// ---------------------------------------------------------------------------
// Persist (async — called once at flow start)
// ---------------------------------------------------------------------------

/**
 * Write an ImageAttachment's base64 data to a project-local file.
 * Returns the absolute file path.
 *
 * @param image      The image attachment to persist
 * @param sessionSlug Session identifier for directory grouping
 * @param cwd        Project root (defaults to process.cwd())
 */
export async function persistImage(
  image: ImageAttachment,
  sessionSlug: string,
  cwd?: string,
): Promise<string> {
  const ext = mimeToExt(image.mimeType);
  const dir = resolveImageDir(sessionSlug, cwd);
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}${ext}`;
  const filepath = join(dir, filename);
  await writeFile(filepath, Buffer.from(image.data, 'base64'));
  return filepath;
}

/**
 * Persist multiple images in parallel.
 * Returns array of absolute file paths (same order as input).
 */
export async function persistImages(
  images: ImageAttachment[],
  sessionSlug: string,
  cwd?: string,
): Promise<string[]> {
  return Promise.all(images.map(img => persistImage(img, sessionSlug, cwd)));
}

// ---------------------------------------------------------------------------
// Load (sync — called in hot message-rebuild path)
// ---------------------------------------------------------------------------

/**
 * Load a persisted image file back into a data URI suitable for image_url content parts.
 * Returns null if the file cannot be read (e.g. deleted, moved).
 *
 * Uses synchronous I/O because message rebuilds happen in synchronous code paths
 * and these files are small (already in OS page cache from recent write).
 */
export function loadImageAsDataUri(filepath: string): string | null {
  try {
    const buf = readFileSync(filepath);
    const ext = extname(filepath).toLowerCase();
    const mime = EXT_TO_MIME[ext] ?? 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mimeToExt(mimeType: string): string {
  switch (mimeType) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    default: return '.png';
  }
}
