/**
 * Redirect URIs (RFC-010 §3.3). Exact match, with one exception the native
 * clients need: a loopback redirect matches on any port (RFC 8252 §7.3).
 * Claude Code picks an ephemeral port per session.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function loopback(u: URL): boolean {
  return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
}

export function isLoopbackRedirect(raw: string): boolean {
  const u = parse(raw);
  return !!u && loopback(u);
}

export function isAcceptableRedirectUri(raw: string): boolean {
  if (raw.length > 512) return false;
  const u = parse(raw);
  if (!u || u.hash || u.username || u.password) return false;
  return u.protocol === "https:" || loopback(u);
}

export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (!isAcceptableRedirectUri(requested)) return false;
  const req = new URL(requested);
  return registered.some((candidate) => {
    if (candidate === requested) return true;
    const reg = parse(candidate);
    if (!reg || !loopback(reg) || !loopback(req)) return false;
    return reg.hostname === req.hostname && reg.pathname === req.pathname && reg.search === req.search;
  });
}

export function buildRedirect(uri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.append(key, value);
  }
  return url.toString();
}
