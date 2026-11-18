/**
 * Where the browser and the server find the database API.
 *
 * The browser: always the address the page was opened from. `/rest/v1` is
 * served by the webapp itself (app/rest/v1, lib/rest-proxy.ts) and uploaded
 * files by app/storage/v1, so a tablet at home uses the LAN address, a phone
 * away from home uses the domain, and neither depends on a URL somebody typed
 * into setup.sh once.
 *
 * Until 1.15 the API sat behind Kong, which could live on another port or host
 * (API_EXTERNAL_URL, KINBOARD_ENTRY — RFC-018). Kong is gone; both settings are
 * ignored. An install that still points a proxy or an old API_EXTERNAL_URL at
 * Kong's port loses nothing, because the browser no longer goes there.
 *
 * Decided on the server and handed over in `window.__ENV`, never through a
 * `process.env.NEXT_PUBLIC_*` expression, which Next replaces at build time
 * with whatever the build machine had. That is how a build carrying
 * `localhost:8130` once took production down (2026-08-06).
 */

import { postgrestFetch, postgrestUrl } from "@/lib/rest-proxy";

/** The marker `window.__ENV` carries: the browser uses its own origin. */
export const SAME_ORIGIN = "same-origin";

type EnvLike = Record<string, string | undefined>;

/** What the root layout hands the browser in `window.__ENV`. */
export interface PublicEnv {
  /** Always `same-origin` since 1.15; kept so a cached client still parses it. */
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
}

export function publicApiEnv(anonKey: string): PublicEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: SAME_ORIGIN,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  };
}

/**
 * The base server-side supabase-js clients are built on.
 *
 * POSTGREST_URL (`http://rest:3000` in the stack, a published port for
 * `next dev`): the clients talk to PostgREST directly, through
 * lib/rest-proxy.ts `postgrestFetch`, which strips the `/rest/v1` prefix
 * supabase-js adds. SUPABASE_URL is the pre-1.15 compose file's Kong address,
 * honoured until that file is updated.
 */
export function serverSupabaseUrl(env: EnvLike = process.env): string {
  const direct = postgrestUrl(env);
  if (direct) return direct;
  const kong = env.SUPABASE_URL?.trim();
  if (kong) return kong;
  throw new Error(
    "POSTGREST_URL is not set: server-side code needs PostgREST's internal address " +
      "(docker-compose.yml sets POSTGREST_URL=http://rest:3000; for `next dev`, set it in .env.local)",
  );
}

/**
 * The fetch the server clients are built with. Against PostgREST it strips the
 * `/rest/v1` prefix supabase-js adds; against Kong (a compose file from before
 * 1.15, POSTGREST_URL unset) it leaves the URL alone, because Kong routes on
 * that prefix. Stripping it there sent every server query to a path Kong has
 * no route for: the family count came back empty, and the join page offered to
 * create a family on an install that had three.
 */
export function serverSupabaseFetch(env: EnvLike = process.env): typeof fetch {
  const direct = postgrestUrl(env);
  return direct ? postgrestFetch(direct) : (input, init) => fetch(input, init);
}
