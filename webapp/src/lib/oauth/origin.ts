/**
 * The origin a client reached us on.
 *
 * Not SITE_URL: an install reachable by LAN address and through a tunnel by
 * name must advertise whichever one the client used, or the issuer in the
 * metadata will not match the URL the user pasted. A spoofed Host only
 * changes what *that* caller is told, and tokens are bound to the resource
 * they were minted for (RFC-010 §3.1), so it buys nothing at the real origin.
 */
const HOST = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:]+\])(?::\d{1,5})?$/i;

function first(value: string | null): string | null {
  const v = value?.split(",")[0]?.trim();
  return v ? v : null;
}

export function publicOrigin(headers: Headers, fallbackOrigin: string): string {
  const host = first(headers.get("x-forwarded-host")) ?? first(headers.get("host"));
  if (!host || !HOST.test(host)) return fallbackOrigin;
  const proto = first(headers.get("x-forwarded-proto"));
  const scheme = proto === "https" || proto === "http" ? proto : new URL(fallbackOrigin).protocol.slice(0, -1);
  const lower = host.toLowerCase();
  const bare = (scheme === "https" && lower.endsWith(":443")) || (scheme === "http" && lower.endsWith(":80"))
    ? lower.slice(0, lower.lastIndexOf(":"))
    : lower;
  return `${scheme}://${bare}`;
}

export const MCP_PATH = "/api/mcp";

export function mcpResource(origin: string): string {
  return `${origin}${MCP_PATH}`;
}
