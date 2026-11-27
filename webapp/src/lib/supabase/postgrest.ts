import { PostgrestClient } from "@supabase/postgrest-js";
import type { Database } from "@/types/database";

/**
 * The PostgREST client every part of the app talks to the database with
 * (RFC-024 §4.6, phase 7 step 2).
 *
 * Until 1.17 this was `supabase-js` (`createClient`, and `createBrowserClient`
 * from `@supabase/ssr` in the browser). Of everything those packages bring —
 * auth, realtime, storage, edge functions — only the query builder was used,
 * and the query builder *is* `@supabase/postgrest-js`: supabase-js's
 * `from()` and `rpc()` hand straight to a `PostgrestClient` it builds the
 * same way as below. So this builds that `PostgrestClient` directly, with
 * the same URL, schema and headers, and the ~200 call sites don't change.
 *
 * What supabase-js added on top, and what of it is kept:
 *
 * - **`apikey` and `Authorization: Bearer <key>`, set only when the request
 *   doesn't carry them already** (supabase-js `fetchWithAuth`). Kept exactly
 *   for the server, whose key is the service role's:
 *   `.setHeader("Authorization", …)` at a call site still wins. With no
 *   auth session — Kinboard never had one — supabase-js sent the key itself
 *   as the bearer, as here. The browser has no key since step 3 (`NO_KEY`,
 *   below): PostgREST runs a request without `Authorization` as its
 *   anon role, exactly what the anon key's `role: anon` claim asked for.
 * - **`schema: "public"`**, which makes postgrest-js send
 *   `Accept-Profile: public` on reads and `Content-Profile: public` on writes.
 *   Kept.
 * - **`X-Client-Info: supabase-js-node/<version>`** (`supabase-ssr/<version>`
 *   in the browser). Dropped: it named a library that is no longer here, and
 *   nothing reads it (PostgREST ignores it). The one deliberate difference on
 *   the wire; `e2e/postgrest-client-wire.spec.ts` pins it.
 *
 * The types: `PostgrestClient<Database, { PostgrestVersion: "12" }, "public">`
 * is what `SupabaseClient<Database>` resolved its query builder to for a
 * `Database` without `__InternalSupabase`, so every call site types the same.
 */

/** What `SupabaseClient<Database>` resolved its PostgREST options to. */
type ClientOptions = { PostgrestVersion: "12" };

export type DbClient = PostgrestClient<Database, ClientOptions, "public">;

/**
 * The browser's client: the same strict type as the server's.
 *
 * Until RFC-024 §4.6 step 4 it was typed as loosely as `@supabase/ssr` 0.5.2
 * typed it (any table, any column, rows assignable to anything), because
 * typing it strictly against the hand-written `src/types/database.ts`
 * turned up 12 errors where that file had drifted from the database. With
 * the types generated from the schema, the browser is held to them too.
 */
export type BrowserDbClient = DbClient;

export interface PostgrestClientOptions {
  /** The fetch every request goes through, after `apikey`/`Authorization` are set. */
  fetch?: typeof fetch;
  /** Extra headers on every request, e.g. `x-kinboard-actor`. */
  headers?: Record<string, string>;
}

/**
 * The browser's "no key" (RFC-024 §4.6 step 3): a named value rather than
 * `null`, so a server key that comes out missing (`x ?? null`) can't quietly
 * turn a server client into an anonymous one. `""` is still refused.
 */
export const NO_KEY: unique symbol = Symbol("no key");

/** supabase-js's URL check, with its messages, so a bad URL fails the same way. */
function apiBaseUrl(base: string): URL {
  const trimmed = base?.trim();
  if (!trimmed) throw new Error("supabaseUrl is required.");
  if (!/^https?:\/\//i.test(trimmed)) throw new Error("Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.");
  try {
    return new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
  } catch {
    throw new Error("Invalid supabaseUrl: Provided URL is malformed.");
  }
}

/**
 * Add the key as `apikey` and as the bearer, unless the request already has
 * them, then hand on. supabase-js's `fetchWithAuth`, minus its auth-session
 * lookup (which always came back empty here).
 */
function withKey(key: string, inner: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("apikey")) headers.set("apikey", key);
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${key}`);
    return inner(input, { ...init, headers });
  };
}

/**
 * A PostgREST client at `<base>/rest/v1`, as supabase-js built it.
 *
 * `base` is the address the `/rest/v1` prefix is appended to — the page's
 * origin in the browser, POSTGREST_URL (whose fetch strips the prefix again)
 * or the legacy Kong address on the server.
 *
 * `key` is the server's service-role key, sent as `apikey` and as the
 * bearer. `NO_KEY` sends neither (RFC-024 §4.6, phase 7 step 3): the browser's
 * client, whose only credential is the family token its own fetch adds, and
 * which PostgREST otherwise runs as `anon`, the role the anon key's claim
 * named. An empty string is still refused, so a server whose key is missing
 * fails as loudly as before instead of quietly querying as `anon`.
 */
export function createPostgrestClient(base: string, key: string | typeof NO_KEY, options: PostgrestClientOptions = {}): DbClient {
  const baseUrl = apiBaseUrl(base);
  if (key !== NO_KEY && (typeof key !== "string" || !key)) throw new Error("supabaseKey is required.");
  return new PostgrestClient<Database, ClientOptions, "public">(new URL("rest/v1", baseUrl).href, {
    headers: { ...options.headers },
    schema: "public",
    fetch: key === NO_KEY ? (options.fetch ?? ((input, init) => fetch(input, init))) : withKey(key, options.fetch),
  });
}
