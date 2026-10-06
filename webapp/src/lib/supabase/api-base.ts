/**
 * Where the browser finds the API (RFC-018).
 *
 * The browser talks to the API at the address it opened Kinboard from:
 * `/rest/v1`, `/auth/v1`, `/storage/v1` and `/realtime/v1` are served on the
 * same origin as the app, by Kong, which is the stack's front door. A tablet
 * at home uses the LAN address, a phone away from home uses the domain, and
 * neither depends on a URL somebody typed into setup.sh once.
 *
 * A fixed API address (`API_EXTERNAL_URL`) is still honoured for an install
 * that really keeps the API on a separate host, and for an install that has
 * not been moved to Kong yet (`KINBOARD_ENTRY=webapp`, the webapp answering
 * on its own port).
 *
 * The decision is made on the server, per request, from plain environment
 * variables — never from a `process.env.NEXT_PUBLIC_*` expression, which Next
 * replaces at build time with whatever the build machine had. That is how a
 * build carrying `localhost:8130` once took production down (2026-08-06).
 */

/** The marker `window.__ENV` carries when the browser should use its own origin. */
export const SAME_ORIGIN = "same-origin";

type EnvLike = Record<string, string | undefined>;

/**
 * The API address the browser should use, or `null` for "the address the page
 * was opened from".
 *
 * - `API_EXTERNAL_URL` (as the stack passes it), falling back to
 *   `NEXT_PUBLIC_SUPABASE_URL` where it is absent (`next dev`, a compose file
 *   from before 1.13). Empty or `same-origin` means the page's own origin.
 * - With `KINBOARD_ENTRY=kong`, an address on SITE_URL's host is the old
 *   two-port layout (`http://nas:8100` next to `http://nas:3001`) and is
 *   ignored: Kong serves the API on the page's own address now, and that is
 *   what lets the same install work from the LAN and from outside.
 * - An address on a DIFFERENT host than SITE_URL is a separate API host that
 *   somebody set up on purpose — a proxy may send it, and only it, to Kong.
 *   It is honoured in every layout; the automatic move to Kong leaves such
 *   installs alone for the same reason (kinboard-entry.sh).
 *
 * `next dev` sets neither KINBOARD_ENTRY nor API_EXTERNAL_URL, so it keeps
 * using NEXT_PUBLIC_SUPABASE_URL from .env.local: same-origin is a property of
 * the containerised stack, not of a dev server on :3000 with Kong on :8130.
 */
export function browserApiUrl(env: EnvLike = process.env): string | null {
  const configured = (env.API_EXTERNAL_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!configured || configured.toLowerCase() === SAME_ORIGIN) return null;
  const url = configured.replace(/\/+$/, "");
  if ((env.KINBOARD_ENTRY ?? "").trim().toLowerCase() === "kong" && sameHost(url, env.SITE_URL)) return null;
  return url;
}

/** Whether two URLs name the same host, ports aside. No SITE_URL: not known to be. */
function sameHost(a: string, b: string | undefined): boolean {
  if (!b) return false;
  try {
    return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase();
  } catch {
    return false;
  }
}

/** What the root layout hands the browser in `window.__ENV`. */
export interface PublicEnv {
  /** The API address, or `same-origin`. */
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
}

export function publicApiEnv(anonKey: string, env: EnvLike = process.env): PublicEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: browserApiUrl(env) ?? SAME_ORIGIN,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  };
}

/**
 * The base the browser-side client connects to.
 *
 * `runtime` is `window.__ENV.NEXT_PUBLIC_SUPABASE_URL`, `baked` the build-time
 * value. The runtime value wins whenever the server sent one — including
 * `same-origin`, which must never fall through to a baked address. The baked
 * value only matters when there is no `window.__ENV` at all.
 */
export function resolveBrowserBase(
  runtime: string | undefined,
  baked: string | undefined,
  origin: string,
): string {
  const pick = runtime?.trim() ? runtime.trim() : (baked ?? "").trim();
  if (!pick || pick.toLowerCase() === SAME_ORIGIN) return origin;
  return pick.replace(/\/+$/, "");
}

/**
 * The URL server-side code uses to reach Kong: the internal `SUPABASE_URL`
 * (`http://kong:8000` in the stack), never the browser's address.
 */
export function serverSupabaseUrl(env: EnvLike = process.env): string {
  const internal = env.SUPABASE_URL?.trim();
  if (internal) return internal;
  const external = browserApiUrl(env);
  if (external) return external;
  throw new Error(
    "SUPABASE_URL is not set: server-side code needs Kong's internal address " +
      "(docker-compose.yml sets SUPABASE_URL=http://kong:8000; for `next dev`, set " +
      "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in .env.local)",
  );
}
