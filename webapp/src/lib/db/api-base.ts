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
 * Nothing to hand over, then: the browser client builds on
 * `window.location.origin` (lib/db/client.ts), and neither it nor the
 * root layout reads an address from the environment. Until 1.18 the layout
 * still wrote `same-origin` and the anon key into `window.__ENV`; a
 * `process.env.NEXT_PUBLIC_*` read in their place, which Next replaces at
 * build time with whatever the build machine had, is how a build carrying
 * `localhost:8130` once took production down (2026-08-06).
 */

import { postgrestFetch, postgrestUrl } from "@/lib/rest-proxy";
import { guardUnfilteredWrites } from "@/lib/db/unfiltered-write-guard";
import { legacyKongUrl } from "@/lib/db/legacy-kong";

type EnvLike = Record<string, string | undefined>;

/**
 * The base the server-side PostgREST client is built on.
 *
 * POSTGREST_URL (`http://rest:3000` in the stack, a published port for
 * `next dev`): the clients talk to PostgREST directly, through
 * lib/rest-proxy.ts `postgrestFetch`, which strips the `/rest/v1` prefix
 * the client adds (lib/db/postgrest.ts). SUPABASE_URL is the pre-1.15 compose file's Kong address,
 * honoured until that file is updated.
 */
export function serverSupabaseUrl(env: EnvLike = process.env): string {
  const direct = postgrestUrl(env);
  if (direct) return direct;
  const kong = legacyKongUrl(env);
  if (kong) return kong;
  throw new Error(
    "POSTGREST_URL is not set: server-side code needs PostgREST's internal address " +
      "(docker-compose.yml sets POSTGREST_URL=http://rest:3000; for `next dev`, set it in .env.local)",
  );
}

/**
 * The fetch the server clients are built with. Against PostgREST it strips the
 * `/rest/v1` prefix the client adds; against Kong (a compose file from before
 * 1.15, POSTGREST_URL unset) it leaves the URL alone, because Kong routes on
 * that prefix. Stripping it there sent every server query to a path Kong has
 * no route for: the family count came back empty, and the join page offered to
 * create a family on an install that had three.
 *
 * The server factory (lib/db/server.ts `createAdminClient`, with or
 * without the integration actor) uses this, so the unfiltered-write guard
 * (RFC-024 §4.2.1) sits here, outside the prefix strip, where the URL still
 * reads `/rest/v1/<table>`.
 */
export function serverSupabaseFetch(env: EnvLike = process.env): typeof fetch {
  const direct = postgrestUrl(env);
  return guardUnfilteredWrites(direct ? postgrestFetch(direct) : (input, init) => fetch(input, init));
}
