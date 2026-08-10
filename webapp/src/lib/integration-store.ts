/**
 * The database half of Integration API authentication.
 *
 * Kept apart from lib/integration-auth.ts on purpose: that file holds the
 * *rules* — what a valid token is, which scope grants what — and is pure, so
 * it can be tested exhaustively without a database. This file is the part that
 * talks to Postgres, and is thin enough that reading it is the test.
 *
 * Nothing here ever takes a plaintext token. Callers hash first; a plaintext
 * credential must not be able to reach a query, a log line or an error message.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { shouldRefreshLastUsed } from "@/lib/integration-auth";

export interface StoredToken {
  id: string;
  family_id: string;
  name: string;
  scopes: string[] | null;
  token_hash: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

/**
 * Look a token up by hash.
 *
 * Uses the service-role client because integration_tokens is REVOKEd from anon
 * and authenticated — the browser cannot read it at all, which is the point.
 *
 * Returns null for "no such token" rather than throwing. Whether a token is
 * unknown, revoked or expired is decided by `evaluateToken`, and all three
 * answer the caller identically.
 */
/**
 * Thrown when the token cannot be *checked*, as distinct from being wrong.
 *
 * These are not the same answer and must never be given the same one. "No such
 * token" is a permanent verdict a client should act on; "the database did not
 * respond" is a temporary condition it should retry through.
 */
export class TokenLookupUnavailable extends Error {
  constructor(cause?: unknown) {
    super("Could not verify the token");
    this.name = "TokenLookupUnavailable";
    this.cause = cause;
  }
}

export async function findTokenByHash(hash: string): Promise<StoredToken | null> {
  const supabase = createAdminClient();

  const { data, error } = await (supabase as any)
    .from("integration_tokens")
    .select("id, family_id, name, scopes, token_hash, expires_at, revoked_at, last_used_at")
    .eq("token_hash", hash)
    .maybeSingle();

  // `if (error || !data) return null` collapsed these two, and the collapse had
  // teeth: during a Kinboard restart the lookup errors for a few seconds, the
  // caller was told 401, and Home Assistant — correctly believing a 401 — put
  // the integration into "reauthentication required" and STOPPED POLLING until
  // a human intervened. A database hiccup permanently disabled the
  // integration, and nothing in the logs said why.
  if (error) throw new TokenLookupUnavailable(error);
  if (!data) return null;
  return data as StoredToken;
}

/**
 * Record that a token was used — at most hourly.
 *
 * A heartbeat, not an access log. Writing on every request would put a row
 * update in front of every Integration API call, which on a wall display
 * polling every 60 seconds is a write per minute per token, forever, for
 * information nobody reads at that resolution.
 *
 * Deliberately fire-and-forget: a failure here must never fail the request the
 * caller actually made. The worst case is a stale timestamp in Settings.
 */
export async function touchToken(token: StoredToken, now: Date = new Date()): Promise<void> {
  if (!shouldRefreshLastUsed(token.last_used_at, now)) return;

  try {
    const supabase = createAdminClient();

    await (supabase as any)
      .from("integration_tokens")
      .update({ last_used_at: now.toISOString() })
      .eq("id", token.id);
  } catch {
    // Intentionally swallowed — see above.
  }
}

/**
 * Read domain events after a cursor.
 *
 * Ordered by id, which is BIGSERIAL: that is what makes "everything after N"
 * a meaningful question. `limit` is capped by the caller.
 */
export interface StoredEvent {
  id: number;
  event_type: string;
  payload_version: number;
  payload: Record<string, unknown>;
  actor_id: string | null;
  source: string;
  occurred_at: string;
}

export async function readEventsAfter(
  familyId: string,
  afterId: number | null,
  limit: number,
): Promise<StoredEvent[]> {
  const supabase = createAdminClient();

  let query = (supabase as any)
    .from("domain_events")
    .select("id, event_type, payload_version, payload, actor_id, source, occurred_at")
    .eq("family_id", familyId)
    .order("id", { ascending: true })
    .limit(limit);

  if (afterId !== null) query = query.gt("id", afterId);

  const { data, error } = await query;
  if (error || !data) return [];
  return data as StoredEvent[];
}

/**
 * The highest event id for a family, or 0 if there are none.
 *
 * A consumer connecting for the first time needs somewhere to start. Handing
 * it the current head — rather than 0 — means it does not replay the entire
 * retained history on first connect, which for a household that has been
 * running for a month is thousands of events describing things that already
 * happened.
 */
export async function currentEventCursor(familyId: string): Promise<number> {
  const supabase = createAdminClient();

  const { data, error } = await (supabase as any)
    .from("domain_events")
    .select("id")
    .eq("family_id", familyId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return 0;
  return Number(data.id) || 0;
}
