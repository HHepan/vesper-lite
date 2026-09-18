// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Relay Token Storage
//
// Secure-ish token persistence for relay auto-reconnect.
// Uses localStorage with expiration and user confirmation flow.
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'lux-relay-token-v1';
const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface StoredRelayToken {
  token: string;
  url: string;
  roomId: string;
  joinToken: string;
  e2eSecret: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Parse a connect URI into components.
 */
export function parseConnectUri(uri: string): { url: string; roomId: string; joinToken: string; e2eSecret: string } | null {
  try {
    const trimmed = uri.trim();
    // First try wss:// variant (has protocol in path)
    const m1 = trimmed.match(/^lux-relay:\/\/(wss?:\/\/[^/]+)\/([^#]+)#([^.]+)\.(.+)$/);
    if (m1) return { url: m1[1], roomId: m1[2], joinToken: m1[3], e2eSecret: m1[4] };
    // Standard format: lux-relay://host:port/roomId#joinToken.e2eSecret
    const m2 = trimmed.match(/^lux-relay:\/\/([^/]+)\/([^#]+)#([^.]+)\.(.+)$/);
    if (m2) return { url: `ws://${m2[1]}`, roomId: m2[2], joinToken: m2[3], e2eSecret: m2[4] };
  } catch { /* ignore */ }
  return null;
}

/**
 * Save relay token to localStorage.
 */
export function saveRelayToken(token: string, expiryMs: number = DEFAULT_EXPIRY_MS): StoredRelayToken | null {
  const parsed = parseConnectUri(token);
  if (!parsed) return null;

  const now = Date.now();
  const stored: StoredRelayToken = {
    token,
    ...parsed,
    createdAt: now,
    expiresAt: now + expiryMs,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return stored;
  } catch {
    // localStorage may be unavailable in private mode
    return null;
  }
}

/**
 * Load relay token from localStorage.
 * Returns null if not found, expired, or invalid.
 */
export function loadRelayToken(): StoredRelayToken | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const stored: StoredRelayToken = JSON.parse(raw);
    
    // Check expiration
    if (Date.now() > stored.expiresAt) {
      clearRelayToken();
      return null;
    }

    // Validate structure
    if (!stored.token || !stored.url || !stored.roomId || !stored.joinToken || !stored.e2eSecret) {
      clearRelayToken();
      return null;
    }

    return stored;
  } catch {
    return null;
  }
}

/**
 * Clear saved relay token.
 */
export function clearRelayToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/**
 * Check if a stored token exists and is valid.
 */
export function hasStoredRelayToken(): boolean {
  return loadRelayToken() !== null;
}

/**
 * Get remaining time until token expires (in ms).
 * Returns 0 if expired or not found.
 */
export function getRelayTokenTimeRemaining(): number {
  const stored = loadRelayToken();
  if (!stored) return 0;
  return Math.max(0, stored.expiresAt - Date.now());
}
