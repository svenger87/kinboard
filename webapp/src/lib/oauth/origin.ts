/**
 * The origin a client reached us on.
 *
 * Not SITE_URL: an install reachable by LAN address and through a tunnel by
 * name must advertise whichever one the client used, or the issuer in the
 * metadata will not match the URL the user pasted. A spoofed Host only
 * changes what *that* caller is told, and tokens are bound to the resource
 * they were minted for (RFC-010 §3.1), so it buys nothing at the real origin.
 *
 * SITE_URL does settle one thing: the scheme, when its host is the one the
 * request arrived on. A TLS-terminating proxy that forwards Host but not
 * X-Forwarded-Proto makes an https request look like plain http here — the
 * metadata then advertises http:// URLs, and the consent page's https Origin
 * no longer matches and every approval is refused. The operator already
 * wrote down "this name is served over https" in SITE_URL; for that name,
 * believe it. A different host (the LAN address) is left alone.
 */
const HOST = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:]+\])(?::\d{1,5})?$/i;

function first(value: string | null): string | null {
  const v = value?.split(",")[0]?.trim();
  return v ? v : null;
}

/** host[:port] with the port dropped when it is 80 or 443 — "default ports normalised", whichever scheme. */
function withoutDefaultPort(host: string): string {
  return /:(?:80|443)$/.test(host) ? host.slice(0, host.lastIndexOf(":")) : host;
}

function siteScheme(siteUrl: string | undefined, host: string): "http" | "https" | null {
  if (!siteUrl) return null;
  try {
    const site = new URL(siteUrl);
    const scheme = site.protocol === "https:" ? "https" : site.protocol === "http:" ? "http" : null;
    if (!scheme) return null;
    return withoutDefaultPort(site.host.toLowerCase()) === withoutDefaultPort(host) ? scheme : null;
  } catch {
    return null;
  }
}

export function publicOrigin(
  headers: Headers,
  fallbackOrigin: string,
  siteUrl: string | undefined = process.env.SITE_URL,
): string {
  const host = first(headers.get("x-forwarded-host")) ?? first(headers.get("host"));
  if (!host || !HOST.test(host)) return fallbackOrigin;
  const lower = host.toLowerCase();
  const proto = first(headers.get("x-forwarded-proto"))?.toLowerCase();
  const fromSite = siteScheme(siteUrl, lower);
  // Matched modulo default ports, so it is SITE_URL's own origin: no port.
  if (fromSite) return `${fromSite}://${withoutDefaultPort(lower)}`;
  const scheme = proto === "https" || proto === "http" ? proto : new URL(fallbackOrigin).protocol.slice(0, -1);
  const bare = (scheme === "https" && lower.endsWith(":443")) || (scheme === "http" && lower.endsWith(":80"))
    ? lower.slice(0, lower.lastIndexOf(":"))
    : lower;
  return `${scheme}://${bare}`;
}

export const MCP_PATH = "/api/mcp";

export function mcpResource(origin: string): string {
  return `${origin}${MCP_PATH}`;
}
