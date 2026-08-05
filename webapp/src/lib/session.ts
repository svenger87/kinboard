import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Server-issued device sessions.
 *
 * What this replaces: the app kept its family and device in
 * `family-calendar-storage`, a cookie written client-side by
 * `document.cookie` holding the Zustand store as JSON. Not HttpOnly, not
 * signed, and — more to the point — never read by the server at all. API
 * routes took `family_id` from the query string and trusted it, so the UUID
 * in every URL was the only thing protecting a family's data, on an instance
 * published to the internet.
 *
 * A session here is a random 256-bit token. The client holds the plaintext in
 * an HttpOnly cookie; the database holds only its SHA-256. A dump of
 * device_sessions therefore doesn't yield a working session, for the same
 * reason password hashes exist.
 *
 * Sessions live in a table rather than being stateless (a signed JWT) because
 * revocation is the point: a hosted service has to be able to sign one device
 * out. Statelessness would trade that away for a lookup we can afford.
 */

export const SESSION_COOKIE = "kinboard_session";

/**
 * A year. The kitchen kiosk is the constraint — it is a wall display that
 * nobody logs into, so anything shorter turns into a support call. Revocation
 * covers the case a long life is otherwise uncomfortable about.
 */
export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Only refresh last_used_at this often — it's a heartbeat, not an access log. */
const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

export interface SessionContext {
  familyId: string;
  deviceId: string | null;
  sessionId: string;
}

/** SHA-256, hex. What the database stores. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a session and return the plaintext token — the only time it exists in
 * readable form. The caller must set it as a cookie and then forget it.
 */
export async function createSession(params: {
  familyId: string;
  deviceId?: string | null;
  userAgent?: string | null;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const supabase = createAdminClient();

  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  const { error } = await supabase.from("device_sessions").insert({
    token_hash: hashToken(token),
    family_id: params.familyId,
    device_id: params.deviceId ?? null,
    expires_at: expiresAt.toISOString(),
    user_agent: params.userAgent ?? null,
  });
  if (error) throw new Error(`could not create session: ${error.message}`);

  return token;
}

/**
 * Resolve a token to the family it belongs to, or null.
 *
 * Null covers every failure identically — unknown, revoked, expired — because
 * the caller turns them all into the same 401 and there is nothing useful to
 * tell a caller who didn't present a valid session.
 */
export async function verifySession(token: string | undefined): Promise<SessionContext | null> {
  if (!token) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("device_sessions")
    .select("id, family_id, device_id, expires_at, revoked_at, last_used_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    id: string;
    family_id: string;
    device_id: string | null;
    expires_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
  };

  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  // A session always belongs to a device (both routes that create one register
  // the device first), so a null here means the device was deleted underneath
  // it. The foreign key now cascades, which should make this unreachable —
  // but this is the check that decides whether a credential is good, and
  // "removed from Settings" has to mean signed out even if a row survives.
  if (!row.device_id) return null;

  // Heartbeat, at most hourly, and deliberately not awaited: a failure to
  // record "last seen" must never fail the request it was observing.
  const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > LAST_USED_REFRESH_MS) {
    void supabase
      .from("device_sessions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", row.id)
      .then(undefined, () => {
        /* best effort */
      });
  }

  return { familyId: row.family_id, deviceId: row.device_id, sessionId: row.id };
}

/** Sign one device out. */
export async function revokeSession(sessionId: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("device_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId);
}

/** Sign every device in a family out — for a lost device, or a join-code rotation. */
export async function revokeFamilySessions(familyId: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("device_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("family_id", familyId)
    .is("revoked_at", null);
}

/** The Set-Cookie attributes. Exported so the proxy and the routes can't drift. */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    // The old cookie had neither of these: JS could read it, and it would go
    // out over plain http.
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
