// ═══════════════════════════════════════════════════════════════════════════
// Vesper Core — Proxy Utilities
//
// A configured HTTP/SOCKS proxy cannot route to the local machine or a
// private LAN — the best it can do is answer 502. When a provider endpoint
// lives on a private network (e.g. a LAN-hosted new-api gateway), the global
// proxy must be dropped so the request goes direct.
//
// This keeps profiles that point at private endpoints working without having
// to special-case them in config (the WebUI profile editor cannot even
// express "no proxy" — an empty string is stripped on save).
// ═══════════════════════════════════════════════════════════════════════════

/** Hostname of a URL, lowercased and unwrapped. Tolerates bare "host:port". */
export function hostnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const raw = url.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return undefined;
  }
}

/**
 * True when a hostname refers to the local machine or a private network,
 * where a public proxy cannot reach:
 *   - loopback:            127.0.0.0/8, ::1, localhost
 *   - private IPv4:        10/8, 172.16/12, 192.168/16
 *   - link-local:          169.254/16, fe80::/10
 *   - CGNAT:               100.64/10 (also covers Tailscale's 100.x)
 *   - unique-local IPv6:   fc00::/7
 *   - single-label names:  "myserver" (resolved via search domain, i.e. LAN)
 *   - *.local / *.lan / *.internal
 */
export function isPrivateHost(hostname: string): boolean {
  const h = (hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;

  if (
    h === 'localhost' || h === 'ip6-localhost' ||
    h.endsWith('.localhost') || h.endsWith('.local') ||
    h.endsWith('.lan') || h.endsWith('.internal')
  ) {
    return true;
  }

  // ── IPv6 ──
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;   // fc00::/7  unique-local
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true;   // fe80::/10 link-local
    return false;
  }

  // ── IPv4 ──
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  // ── Hostname: a single label (no dot) resolves on the local search domain ──
  if (!h.includes('.')) return true;

  return false;
}

/**
 * Drop the proxy when the target endpoint lives on a private network.
 * Returns the proxy unchanged otherwise, and `undefined` when either the
 * proxy is empty or the target is private (meaning: connect directly).
 */
export function resolveProxyForUrl(
  proxy: string | undefined,
  baseURL: string | undefined,
): string | undefined {
  if (!proxy) return undefined;
  const host = hostnameOf(baseURL);
  if (host && isPrivateHost(host)) return undefined;
  return proxy;
}
