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
      // 401 means no valid session — the caller is not joined, or was signed
      // out. Not an error to shout about: the auth guard will send them to
      // /join. Returning null lets the request proceed with the anon key,
      // which under RLS simply sees nothing.
      cached = null;
      return null;
    }
    const data = (await response.json()) as { token: string; expiresAt: number };
    cached = { token: data.token, expiresAt: data.expiresAt };
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
}

/** Forget everything. For sign-out. */
export function clearFamilyToken(): void {
  cached = null;
  inFlight = null;
}
