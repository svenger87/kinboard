import type { IntegrationScope } from "@/lib/integration-auth";

/**
 * OAuth for assistants (RFC-010). The lifetimes are the trade the RFC argues:
 * a short access token so a leaked one dies on its own, a long sliding refresh
 * token so a household does not re-approve Claude every week.
 */
export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_S = 60 * 24 * 60 * 60;
export const AUTH_REQUEST_TTL_S = 10 * 60;
export const CODE_TTL_S = 60;

export const REFRESH_TOKEN_PREFIX = "kbr_";
export const CODE_PREFIX = "kbo_";
export const DCR_CLIENT_PREFIX = "kbclient_";

/**
 * Binds a pending authorization request to the browser that started it.
 * /api/oauth/authorize sets this on success; /api/oauth/consent refuses to
 * show or answer a request unless it matches, which is what stops a consent
 * link forwarded to someone else being approved in their browser instead.
 */
export const OAUTH_REQUEST_COOKIE = "kb_oauth_request";

/**
 * The integration scopes an assistant can be granted.
 *
 * RFC-010 shipped this as read-and-add only. RFC-011 adds edit/delete and
 * actuation — control of devices in the family's catalogue, with PIN-gated
 * confirmation for sensitive actions — superseding RFC-010 §4's "no
 * actuation".
 */
export const MCP_SCOPES = [
  "family:read",
  "notes:read",
  "calendar:write",
  "tasks:write",
  "shopping:write",
  "notes:write",
  "energy:read",
  "meals:write",
  "announcements:write",
  "home:read",
  "home:control",
  "vehicles:read",
  "timers:write",
  "birthdays:write",
  "pocket_money:write",
] as const satisfies readonly IntegrationScope[];

export type McpScope = (typeof MCP_SCOPES)[number];
