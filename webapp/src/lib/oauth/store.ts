import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { DCR_CLIENT_PREFIX, MCP_SCOPES, type McpScope } from "@/lib/oauth/config";
import type { AuthRequest, GrantRecord, OAuthClient, OAuthStore } from "@/lib/oauth/types";

const toScopes = (value: unknown): McpScope[] =>
  Array.isArray(value) ? MCP_SCOPES.filter((s) => value.includes(s)) : [];

function toRequest(row: any): AuthRequest {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUri: row.redirect_uri,
    state: row.state,
    codeChallenge: row.code_challenge,
    scopes: toScopes(row.scopes),
    resource: row.resource,
    expiresAt: row.expires_at,
    familyId: row.family_id,
    grantedScopes: row.granted_scopes ? toScopes(row.granted_scopes) : null,
    codeExpiresAt: row.code_expires_at,
    usedAt: row.used_at,
    grantId: row.grant_id,
  };
}

function toGrant(row: any): GrantRecord {
  return {
    id: row.id,
    familyId: row.family_id,
    scopes: toScopes(row.scopes),
    oauthClientId: row.oauth_client_id,
    resource: row.resource,
    refreshExpiresAt: row.refresh_expires_at,
    revokedAt: row.revoked_at,
  };
}

export function createOAuthStore(): OAuthStore {
  const db = () => createAdminClient() as any;
  return {
    async createAuthRequest(r) {
      const now = new Date().toISOString();
      // Opportunistic sweep: expired attempts are useless and unbounded otherwise.
      // Non-blocking — a sweep failure must not stop a new request from being
      // created — but logged, so a persistent failure doesn't go unnoticed.
      //
      // "Expired" is the later of the request's and its code's expiry. A
      // request approved in its last minute holds a code that outlives the
      // request itself; sweeping on expires_at alone would delete it while
      // the code is still being exchanged, turning a valid exchange (and a
      // replay check) into "unknown code".
      const { error: sweepError } = await db().from("oauth_authorization_requests")
        .delete().lt("expires_at", now).or(`code_expires_at.is.null,code_expires_at.lt.${now}`).is("grant_id", null);
      if (sweepError) console.error("[oauth] sweep of expired authorization requests failed", sweepError);
      const { data, error } = await db().from("oauth_authorization_requests").insert({
        client_id: r.clientId, client_name: r.clientName, redirect_uri: r.redirectUri, state: r.state,
        code_challenge: r.codeChallenge, scopes: r.scopes, resource: r.resource, expires_at: r.expiresAt,
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    async getAuthRequest(id) {
      const { data, error } = await db().from("oauth_authorization_requests").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? toRequest(data) : null;
    },
    async approveAuthRequest(id, familyId, granted, codeHash, codeExpiresAt, now) {
      const { data, error } = await db().from("oauth_authorization_requests")
        .update({ family_id: familyId, granted_scopes: granted, code_hash: codeHash, code_expires_at: codeExpiresAt })
        .eq("id", id).is("family_id", null).is("used_at", null).gt("expires_at", now.toISOString())
        .select("id");
      if (error) throw error;
      return (data ?? []).length === 1;
    },
    async denyAuthRequest(id, now) {
      // Only a still-pending row — matches approveAuthRequest's own guard, so
      // a deny can't overwrite an answer (approved or denied) that already
      // happened, e.g. a double-submit racing a first click's response.
      const { error } = await db().from("oauth_authorization_requests")
        .update({ used_at: now.toISOString() })
        .eq("id", id).is("family_id", null).is("used_at", null);
      if (error) throw error;
    },
    async consumeCode(codeHash, now) {
      const { data, error } = await db().from("oauth_authorization_requests")
        .update({ used_at: now.toISOString() })
        .eq("code_hash", codeHash).is("used_at", null).gt("code_expires_at", now.toISOString())
        .select("*");
      if (error) throw error;
      if ((data ?? []).length === 1) return { status: "ok", request: toRequest(data[0]) };
      // Not consumable: a replay if it was already used, else unknown or
      // expired. The replay is recorded in the same statement that detects it.
      const { data: seen, error: seenError } = await db().from("oauth_authorization_requests")
        .update({ replayed_at: now.toISOString() })
        .eq("code_hash", codeHash).not("used_at", "is", null)
        .select("id");
      if (seenError) throw seenError;
      return (seen ?? []).length === 1 ? { status: "reused", requestId: seen[0].id } : { status: "missing" };
    },
    async insertGrant(g) {
      const { data, error } = await db().from("integration_tokens").insert({
        family_id: g.familyId, name: g.name, scopes: g.scopes, token_hash: g.accessHash, expires_at: g.accessExpiresAt,
        oauth_client_id: g.oauthClientId, resource: g.resource, refresh_token_hash: g.refreshHash, refresh_expires_at: g.refreshExpiresAt,
        oauth_request_id: g.requestId,
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    async linkGrant(requestId, grantId) {
      const { error } = await db().from("oauth_authorization_requests").update({ grant_id: grantId }).eq("id", requestId);
      if (error) throw error;
    },
    async wasReplayed(requestId) {
      const { data, error } = await db().from("oauth_authorization_requests").select("replayed_at").eq("id", requestId).maybeSingle();
      if (error) throw error;
      return !!data?.replayed_at;
    },
    async revokeGrantsForRequest(requestId, now) {
      const { error } = await db().from("integration_tokens").update({ revoked_at: now.toISOString() })
        .eq("oauth_request_id", requestId).is("revoked_at", null);
      if (error) throw error;
    },
    async findGrantByRefreshHash(refreshHash) {
      const { data, error } = await db().from("integration_tokens")
        .select("id, family_id, scopes, oauth_client_id, resource, refresh_expires_at, revoked_at")
        .eq("refresh_token_hash", refreshHash).maybeSingle();
      if (error) throw error;
      return data ? toGrant(data) : null;
    },
    async rotateGrant(id, oldRefreshHash, next) {
      const { data, error } = await db().from("integration_tokens").update({
        token_hash: next.accessHash, expires_at: next.accessExpiresAt,
        refresh_token_hash: next.refreshHash, refresh_expires_at: next.refreshExpiresAt,
      }).eq("id", id).eq("refresh_token_hash", oldRefreshHash).is("revoked_at", null).select("id");
      if (error) throw error;
      return (data ?? []).length === 1;
    },
    async revokeGrant(id, now) {
      const { error } = await db().from("integration_tokens").update({ revoked_at: now.toISOString() }).eq("id", id).is("revoked_at", null);
      if (error) throw error;
    },
  };
}

export async function findDcrClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId.startsWith(DCR_CLIENT_PREFIX)) return null;
  const { data, error } = await (createAdminClient() as any).from("oauth_clients")
    .select("client_id, client_name, redirect_uris").eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  return data ? { clientId: data.client_id, clientName: data.client_name, redirectUris: data.redirect_uris, kind: "dcr" } : null;
}

/** How many DCR clients were registered since `sinceIso`, across every caller. */
export async function countDcrClientsSince(sinceIso: string): Promise<number> {
  const { count, error } = await (createAdminClient() as any).from("oauth_clients")
    .select("client_id", { count: "exact", head: true }).gte("created_at", sinceIso);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Deletes DCR clients registered before `beforeIso` that never got a
 * connection (no integration_tokens row names them, revoked or not).
 * Registration is anonymous, so without this the table only grows.
 *
 * The used clients are excluded in the candidate query itself, not filtered
 * out of a page afterwards: filtering a page of the 200 oldest let 200 old
 * *used* clients fill every page, and the sweep then deleted nothing, ever.
 * integration_tokens has no foreign key to oauth_clients (CIMD client ids
 * are URLs with no row there), so PostgREST cannot anti-join; instead the
 * set of DCR client ids that have a connection is read first and excluded
 * with `not.in`. That set stays small by construction — every entry is a
 * connection someone approved with the family PIN — so it fits a URL.
 *
 * Oldest first, at most 200 per call; the next registration continues
 * with whatever is left.
 *
 * The exclusion set must be complete, or a client with a live connection
 * could be deleted. So the read is bounded (USED_DCR_IDS_LIMIT) and counted:
 * when there may be more used ids than were returned — the count reaches the
 * limit, or exceeds what came back (PostgREST's own max-rows cap) — the
 * sweep does nothing at all rather than delete on a partial list.
 *
 * `db` is injectable so that rule is tested without a database.
 */
export const USED_DCR_IDS_LIMIT = 10_000;

export async function sweepUnusedDcrClients(beforeIso: string, db: any = createAdminClient()): Promise<void> {
  const { data: used, error: usedError, count } = await db.from("integration_tokens")
    .select("oauth_client_id", { count: "exact" })
    .like("oauth_client_id", `${DCR_CLIENT_PREFIX}%`)
    .limit(USED_DCR_IDS_LIMIT);
  if (usedError) throw usedError;
  const rows = (used ?? []) as { oauth_client_id: string }[];
  if (typeof count !== "number" || count >= USED_DCR_IDS_LIMIT || count > rows.length) {
    console.warn("[oauth] unused-client sweep skipped: the list of connected clients may be incomplete");
    return;
  }
  const usedIds = [...new Set(rows.map((r) => r.oauth_client_id))];

  let candidates = db.from("oauth_clients").select("client_id").lt("created_at", beforeIso);
  // Ids are the prefix plus base64url, so quoting them is enough for the list.
  if (usedIds.length > 0) candidates = candidates.not("client_id", "in", `(${usedIds.map((id) => `"${id}"`).join(",")})`);
  const { data: old, error } = await candidates.order("created_at", { ascending: true }).limit(200);
  if (error) throw error;
  const unused = ((old ?? []) as { client_id: string }[]).map((r) => r.client_id);
  if (unused.length === 0) return;
  const { error: deleteError } = await db.from("oauth_clients").delete().in("client_id", unused);
  if (deleteError) throw deleteError;
}

export async function registerDcrClient(clientName: string, redirectUris: string[]): Promise<OAuthClient> {
  const clientId = `${DCR_CLIENT_PREFIX}${randomBytes(16).toString("base64url")}`;
  const { error } = await (createAdminClient() as any).from("oauth_clients")
    .insert({ client_id: clientId, client_name: clientName, redirect_uris: redirectUris });
  if (error) throw error;
  return { clientId, clientName, redirectUris, kind: "dcr" };
}
