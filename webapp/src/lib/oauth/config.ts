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

/** The integration scopes an assistant can be granted. No actuation (RFC-002 §6). */
export const MCP_SCOPES = [
  "family:read",
  "notes:read",
  "calendar:write",
  "tasks:write",
  "shopping:write",
  "notes:write",
  "energy:read",
] as const satisfies readonly IntegrationScope[];

export type McpScope = (typeof MCP_SCOPES)[number];
