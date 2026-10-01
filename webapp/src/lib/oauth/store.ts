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
      const { error: sweepError } = await db().from("oauth_authorization_requests")
        .delete().lt("expires_at", now).is("grant_id", null);
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
      const { data: seen, error: seenError } = await db().from("oauth_authorization_requests")
        .select("used_at, grant_id").eq("code_hash", codeHash).maybeSingle();
      if (seenError) throw seenError;
      return seen?.used_at ? { status: "reused", grantId: seen.grant_id } : { status: "missing" };
    },
    async insertGrant(g) {
      const { data, error } = await db().from("integration_tokens").insert({
        family_id: g.familyId, name: g.name, scopes: g.scopes, token_hash: g.accessHash, expires_at: g.accessExpiresAt,
        oauth_client_id: g.oauthClientId, resource: g.resource, refresh_token_hash: g.refreshHash, refresh_expires_at: g.refreshExpiresAt,
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    async linkGrant(requestId, grantId) {
      const { error } = await db().from("oauth_authorization_requests").update({ grant_id: grantId }).eq("id", requestId);
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

export async function registerDcrClient(clientName: string, redirectUris: string[]): Promise<OAuthClient> {
  const clientId = `${DCR_CLIENT_PREFIX}${randomBytes(16).toString("base64url")}`;
  const { error } = await (createAdminClient() as any).from("oauth_clients")
    .insert({ client_id: clientId, client_name: clientName, redirect_uris: redirectUris });
  if (error) throw error;
  return { clientId, clientName, redirectUris, kind: "dcr" };
}
