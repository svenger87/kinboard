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
 *   doesn't carry them already** (supabase-js `fetchWithAuth`). Kept exactly:
 *   the browser's family-token fetch overwrites `Authorization` after this,
 *   and `.setHeader("Authorization", …)` at a call site still wins. With no
 *   auth session — Kinboard never had one — supabase-js sent the key itself
 *   as the bearer, as here.
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
 * The browser's client, typed as loosely as `@supabase/ssr` 0.5.2 typed it.
 *
 * `createBrowserClient<Database>` returned `SupabaseClient<Database,
 * SchemaName, Schema>`, written for an older supabase-js whose third generic
 * was the schema; supabase-js 2.105's third is the schema *name*, so the
 * browser client's tables resolved to nothing in particular: any table name,
 * any column, rows assignable to anything. The server client was typed
 * strictly all along. Typing the browser one strictly here turns up 12
 * errors in two hooks where `src/types/database.ts` has drifted from the
 * database (`attention_items` and `context_rules` are missing, and
 * `events → calendars` has no relationship) — real, and the business of the
 * generated types (RFC-024 §4.6 step 4), not of a swap that must not change
 * behaviour. Until then the browser keeps the typing it had.
 */
export type BrowserDbClient = PostgrestClient<Database, ClientOptions, "public", any>;

export interface PostgrestClientOptions {
  /** The fetch every request goes through, after `apikey`/`Authorization` are set. */
  fetch?: typeof fetch;
  /** Extra headers on every request, e.g. `x-kinboard-actor`. */
  headers?: Record<string, string>;
}

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
 */
export function createPostgrestClient(base: string, key: string, options: PostgrestClientOptions = {}): DbClient {
  const baseUrl = apiBaseUrl(base);
  if (!key) throw new Error("supabaseKey is required.");
  return new PostgrestClient<Database, ClientOptions, "public">(new URL("rest/v1", baseUrl).href, {
    headers: { ...options.headers },
    schema: "public",
    fetch: withKey(key, options.fetch),
  });
}
