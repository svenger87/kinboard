"use client";

/**
 * The browser's family-scoped token for talking to PostgREST directly.
 *
 * Row-level security resolves the caller's family from a `family_id` claim on
 * the request's JWT. The anon key that ships in the bundle carries no such
 * claim — deliberately, so it can read nothing — which means every direct
 * Supabase call from the browser has to carry a token minted by
 * /api/session/token instead.
 *
 * That endpoint is gated by the HttpOnly device-session cookie, so this module
 * never handles the durable credential: it exchanges a cookie it cannot read
 * for a short-lived token it can.
 *
 * Held in a module-level cache rather than React state on purpose. Every
 * `createClient()` call across the app shares it, and refreshing it must not
 * re-render anything.
 */

import { FAMILY_TOKEN_REFRESH_MARGIN_SECONDS } from "@/lib/family-token-timing";

interface CachedToken {
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

let cached: CachedToken | null = null;

/**
 * The in-flight request, if any.
 *
 * The dashboard fires a dozen queries the moment it mounts. Without this they
 * would each mint a separate token — a burst of identical round trips, and a
 * row in device_sessions' access pattern that looks like a stampede. They all
 * await the same promise instead.
 */
let inFlight: Promise<CachedToken | null> | null = null;

/**
 * When we last learned there is no session, and until when to believe it.
 *
 * Without this, every query on an anonymous page asks again. Short enough
 * that joining takes effect promptly — the join flow clears it explicitly.
 */
let noSessionUntil = 0;
const NO_SESSION_CACHE_MS = 30_000;

function isFresh(entry: CachedToken | null): entry is CachedToken {
  if (!entry) return false;
  const now = Math.floor(Date.now() / 1000);
  return entry.expiresAt - now > FAMILY_TOKEN_REFRESH_MARGIN_SECONDS;
}

async function fetchToken(): Promise<CachedToken | null> {
  try {
    const response = await fetch("/api/session/token", {
      // The session cookie is the whole point of the request.
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      cached = null;
      return null;
    }
    const data = (await response.json()) as {
      token: string | null;
      expiresAt: number | null;
    };
    if (!data.token || !data.expiresAt) {
      // Not joined, or signed out. The auth guard sends them to /join; the
      // request meanwhile proceeds with the anon key, which under RLS sees
      // nothing. Remembered for a short while so an anonymous page with a
      // dozen queries doesn't ask a dozen times.
      cached = null;
      noSessionUntil = Date.now() + NO_SESSION_CACHE_MS;
      return null;
    }
    cached = { token: data.token, expiresAt: data.expiresAt };
    noSessionUntil = 0;
    return cached;
  } catch {
    // Offline. Keep whatever we have — a cached token may still be valid, and
    // the service worker serves cached data regardless.
    return cached;
  }
}

/** The current token, refreshing it if it is missing or close to expiry. */
export async function getFamilyToken(): Promise<string | null> {
  if (isFresh(cached)) return cached.token;
  if (Date.now() < noSessionUntil) return null;

  if (!inFlight) {
    inFlight = fetchToken().finally(() => {
      inFlight = null;
    });
  }
  const entry = await inFlight;
  return entry?.token ?? null;
}

/**
 * Drop the cached token so the next call mints a fresh one.
 *
 * Called after a 401 from PostgREST — which means the token expired between
 * the freshness check and the request landing, or was minted before a session
 * was revoked.
 */
export function invalidateFamilyToken(): void {
  cached = null;
  noSessionUntil = 0;
}

/**
 * Adopt a token the server has just handed us.
 *
 * The join and resume routes mint one as part of signing a device in, and it
 * is the same token /api/session/token would return a moment later. Taking it
 * directly saves that round trip, and — more to the point — closes the window
 * where a query fires between the session existing and the client knowing it
 * does, which under RLS reads as "this family has nothing in it".
 *
 * `inFlight` is dropped too: a token request started while the page was still
 * anonymous is about to resolve to null, and whoever is awaiting it would
 * otherwise get that answer despite the session now being real.
 */
export function primeFamilyToken(token: string, expiresAt: number): void {
  cached = { token, expiresAt };
  inFlight = null;
  noSessionUntil = 0;
}

/** Forget everything. For sign-out. */
export function clearFamilyToken(): void {
  cached = null;
  inFlight = null;
  noSessionUntil = 0;
}
