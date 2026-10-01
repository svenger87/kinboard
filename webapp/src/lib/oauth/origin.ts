/**
 * The origin a client reached us on.
 *
 * Not SITE_URL: an install reachable by LAN address and through a tunnel by
 * name must advertise whichever one the client used, or the issuer in the
 * metadata will not match the URL the user pasted. A spoofed Host only
 * changes what *that* caller is told, and tokens are bound to the resource
 * they were minted for (RFC-010 §3.1), so it buys nothing at the real origin.
 *
 * SITE_URL can settle one thing: an upgrade to https, when its host is the
 * one the request arrived on. A TLS-terminating proxy that forwards Host but
 * not X-Forwarded-Proto makes an https request look like plain http here —
 * the metadata then advertises http:// URLs, and the consent page's https
 * Origin no longer matches and every approval is refused. The operator
 * already wrote down "this name is served over https" in SITE_URL; for that
 * name, believe it. It only ever upgrades: an https request (forwarded or
 * direct) stays https whatever SITE_URL says, so an http SITE_URL — a stale
 * value, or one written before TLS was added — never downgrades the issuer.
 * A different host (the LAN address) is left alone.
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

/** True when SITE_URL is https and names the host the request arrived on (default ports normalised). */
function siteSaysHttps(siteUrl: string | undefined, host: string): boolean {
  if (!siteUrl) return false;
  try {
    const site = new URL(siteUrl);
    return site.protocol === "https:" && withoutDefaultPort(site.host.toLowerCase()) === withoutDefaultPort(host);
  } catch {
    return false;
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
  const scheme = proto === "https" || proto === "http" ? proto : new URL(fallbackOrigin).protocol.slice(0, -1);
  // Upgrade only. Matched modulo default ports, so it is SITE_URL's own origin: no port.
  if (scheme !== "https" && siteSaysHttps(siteUrl, lower)) return `https://${withoutDefaultPort(lower)}`;
  const bare = (scheme === "https" && lower.endsWith(":443")) || (scheme === "http" && lower.endsWith(":80"))
    ? lower.slice(0, lower.lastIndexOf(":"))
    : lower;
  return `${scheme}://${bare}`;
}

export const MCP_PATH = "/api/mcp";

export function mcpResource(origin: string): string {
  return `${origin}${MCP_PATH}`;
}
