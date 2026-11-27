/**
 * Refuse an UPDATE or DELETE that would touch every row of a table
 * (RFC-024 §4.2.1, decision §11.12).
 *
 * `supabase.from("todos").delete()` without `.eq(…)` is a request PostgREST
 * will happily run. Under a family token RLS narrows it to that family's rows;
 * under the service role nothing narrows it, and every family's rows go. The
 * database refuses such a statement where `safeupdate` is loaded (it is, in
 * `supabase/postgres`); this is the second net, in the app, before anything is
 * sent, so a shape without `safeupdate` is never weaker than today's.
 *
 * It sits in the custom `fetch` every PostgREST client the app builds goes
 * through (lib/supabase/client.ts for the browser, api-base.ts
 * `serverSupabaseFetch` for the server's), so it covers every call path: the
 * browser's family client, the service-role client and the
 * `x-kinboard-actor: integration` one. What it
 * looks at is the outgoing request itself — a PATCH or DELETE to
 * `/rest/v1/<table>` whose query string carries no filter — not the builder
 * chain, so it does not depend on how the query was put together.
 *
 * "Filter" means any query parameter other than the ones PostgREST uses for
 * shaping (`select`, `order`, `limit`, `offset`, `columns`, `on_conflict`).
 * An empty `.in("id", [])` is sent as `id=in.()` and counts as a filter: it
 * matches no row, which is the opposite of the danger, and refusing it would
 * turn a harmless "nothing to remove" into an error at the call site. Like
 * `safeupdate`, this checks that a filter exists, not that it narrows much.
 *
 * Not covered, on purpose: `.rpc()` (a POST; the function's SQL is out of
 * reach here and stays covered by `safeupdate` in the database), inserts and
 * upserts (POST).
 *
 * A deliberate whole-table write says so with `allowUnfiltered(query,
 * "reason")`, which is greppable; every use is listed in
 * `e2e/allow-unfiltered-sites.txt`, and `e2e/unfiltered-write-guard.spec.ts`
 * fails when the code and that list disagree.
 */

/** Set by `allowUnfiltered`, read and stripped by the guard; never sent. */
export const ALLOW_UNFILTERED_HEADER = "x-kinboard-allow-unfiltered";

/** Query parameters that shape a PostgREST request without narrowing its rows. */
const NOT_FILTERS = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

const GUARDED_METHODS = new Set(["PATCH", "DELETE"]);

export class UnfilteredWriteError extends Error {
  readonly table: string;
  readonly method: "PATCH" | "DELETE";

  constructor(table: string, method: "PATCH" | "DELETE") {
    const verb = method === "PATCH" ? "UPDATE" : "DELETE";
    super(
      `Refused ${verb} on "${table}" without a filter: it would change every row the caller can reach. ` +
        `Add a filter (.eq, .in, .match, .or, …), or mark a deliberate whole-table write with ` +
        `allowUnfiltered(query, "reason") and list it in e2e/allow-unfiltered-sites.txt.`,
    );
    this.name = "UnfilteredWriteError";
    this.table = table;
    this.method = method;
  }
}

/**
 * Mark one query as a deliberate whole-table UPDATE or DELETE.
 *
 * Works on anything with postgrest-js's `setHeader` — the builder `update()`
 * and `delete()` return — and returns the same builder, so the chain goes on:
 * `allowUnfiltered(db.from("t").delete(), "why").select()`.
 */
export function allowUnfiltered<B extends { setHeader(name: string, value: string): B }>(
  query: B,
  reason: string,
): B {
  const why = reason.trim();
  if (!why) throw new Error("allowUnfiltered needs a reason");
  // Header values must be ByteStrings; a reason in German would not be.
  return query.setHeader(ALLOW_UNFILTERED_HEADER, encodeURIComponent(why));
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "object" && !(input instanceof URL)) return input.method.toUpperCase();
  return "GET";
}

/**
 * The table an unfiltered PATCH/DELETE to PostgREST would hit, or null when
 * the request is anything else (a read, an insert, an RPC, a filtered write,
 * a URL outside `/rest/v1/`).
 */
export function unfilteredWriteTarget(url: string, method: string): string | null {
  const m = method.toUpperCase();
  if (!GUARDED_METHODS.has(m)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, "http://relative.invalid");
  } catch {
    return null;
  }
  const at = parsed.pathname.indexOf("/rest/v1/");
  if (at < 0) return null;
  const path = parsed.pathname.slice(at + "/rest/v1/".length).replace(/\/+$/, "");
  if (!path || path.startsWith("rpc/")) return null;
  for (const key of parsed.searchParams.keys()) {
    if (!NOT_FILTERS.has(key)) return null;
  }
  return decodeURIComponent(path);
}

/**
 * Wrap a fetch so an unfiltered PATCH/DELETE to `/rest/v1/<table>` is refused
 * before it is sent. The marker header is removed from every request either
 * way, so PostgREST never sees it.
 *
 * The refusal is a rejected promise with `UnfilteredWriteError`; postgrest-js
 * turns it into the usual `{ error }` (message
 * `UnfilteredWriteError: Refused DELETE on "…"`), or throws it under
 * `.throwOnError()`. It is logged where it happens: in the server's log for
 * the server clients, in the browser console for the browser's.
 */
export function guardUnfilteredWrites(inner: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      init?.headers ?? (typeof input === "object" && !(input instanceof URL) ? input.headers : undefined),
    );
    const allowed = headers.get(ALLOW_UNFILTERED_HEADER);
    const method = requestMethod(input, init);
    const table = unfilteredWriteTarget(requestUrl(input), method);

    if (table !== null && allowed === null) {
      const error = new UnfilteredWriteError(table, method as "PATCH" | "DELETE");
      console.error(`[unfiltered-write-guard] ${error.message}`);
      return Promise.reject(error);
    }
    if (allowed === null) return inner(input, init);

    headers.delete(ALLOW_UNFILTERED_HEADER);
    if (table !== null) {
      console.warn(`[unfiltered-write-guard] allowed ${method} on "${table}" without a filter: ${decodeURIComponent(allowed)}`);
    }
    if (typeof input === "object" && !(input instanceof URL) && !init?.headers) {
      return inner(new Request(input, { headers }), init);
    }
    return inner(input, { ...init, headers });
  };
}
