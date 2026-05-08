/**
 * Validate a user-supplied URL before the server fetches it.
 *
 * Used by routes that take an arbitrary URL from the request body and
 * proxy it (e.g. /api/recipes/import for recipe scraping). The goal is
 * to block the obvious SSRF vectors: non-http(s) schemes (`file://`,
 * `javascript:`, `data:`), and literal private/loopback/link-local IPs
 * in the host portion (e.g. `http://10.0.0.1/admin`,
 * `http://[::1]/`).
 *
 * Residual risk this DOES NOT cover:
 *   - DNS rebinding: an attacker registers `evil.com` that resolves to
 *     127.0.0.1. To block that we'd need to DNS-resolve before fetch +
 *     re-check the resolved IP against the same blocklist. Worth doing
 *     in a follow-up; non-blocking for the SSRF that CodeQL flagged
 *     (which is about literal user input, not DNS-bound resolution).
 *   - Time-of-check-to-time-of-use: between validation and the actual
 *     fetch, DNS could change. Same DNS-resolve fix above mitigates.
 *
 * Routes that fetch a URL from per-family settings (HA, Immich, Bring)
 * are NOT in scope — those URLs come from the family's admin-configured
 * settings table, not request input. Their trust boundary is the
 * device-cookie + family-scope auth, not URL validation.
 */
export type ValidateExternalUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_LOOPBACK_RE = /^(::1|0:0:0:0:0:0:0:1)$/i;
const IPV6_LINK_LOCAL_RE = /^fe80:/i;
const IPV6_UNIQUE_LOCAL_RE = /^f[cd][0-9a-f]{2}:/i; // fc00::/7

function isPrivateIpv4(parts: number[]): boolean {
  // Octet-by-octet checks against the standard private/loopback/
  // link-local ranges. Keeps the comparisons in plain JS Number
  // arithmetic (32-bit IPs fit comfortably in 53-bit safe integers
  // without needing BigInt).
  const [a, b] = parts;
  // 10.0.0.0/8 — RFC 1918 private
  if (a === 10) return true;
  // 172.16.0.0/12 — RFC 1918 private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — RFC 1918 private
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (cloud metadata services live here)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 — "this network"
  if (a === 0) return true;
  return false;
}

function isPrivateOrLoopbackHostname(hostname: string): boolean {
  // Strip surrounding brackets from IPv6 literals.
  const host = hostname.replace(/^\[|\]$/g, "");

  if (host === "localhost") return true;

  const m = host.match(IPV4_RE);
  if (m) {
    const parts = [m[1], m[2], m[3], m[4]].map((p) => parseInt(p, 10));
    if (parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
    return isPrivateIpv4(parts);
  }

  if (IPV6_LOOPBACK_RE.test(host)) return true;
  if (IPV6_LINK_LOCAL_RE.test(host)) return true;
  if (IPV6_UNIQUE_LOCAL_RE.test(host)) return true;

  return false;
}

export function validateExternalUrl(input: string): ValidateExternalUrlResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "non-http-protocol" };
  }

  if (isPrivateOrLoopbackHostname(url.hostname)) {
    return { ok: false, reason: "private-or-loopback-host" };
  }

  return { ok: true, url };
}
