/**
 * The browser's path to PostgREST: `/rest/v1/*` on the page's own origin,
 * forwarded by the webapp to the `rest` container (app/rest/v1/[...path]).
 *
 * This replaced Kong, which did three things here: route `/rest/v1` to
 * PostgREST, demand the anon key in an `apikey` header, and add CORS. The key
 * check guarded nothing — the anon key ships in every page, and PostgREST
 * gives a request without a token the same `anon` role a request with it
 * gets — and same-origin requests need no CORS. Routing is what is left.
 *
 * What it adds instead is the service_role gate (pentest 2026-08-05, F3),
 * which used to be a Traefik forward-auth in front of Kong and so only existed
 * on Traefik installs. PostgREST accepts any validly signed JWT, including the
 * service_role key, which bypasses row-level security. That key is only ever
 * used server-side, straight to PostgREST over the internal network; arriving
 * here it is either a leak or an attack, so it is refused on every install.
 *
 * Fail open on anything unparseable: PostgREST verifies the signature anyway,
 * and a gate that denied legitimate traffic would take the dashboard down to
 * guard against a hypothetical.
 */

/** The PostgREST address inside the stack, or null when none is configured. */
export function postgrestUrl(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.POSTGREST_URL?.trim().replace(/\/+$/, "");
  return url ? url : null;
}

/** The `role` claim of a bearer token or bare JWT, when one can be read. */
export function roleOf(token: string | null): string | null {
  if (!token) return null;
  const jwt = token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim();
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** Whether a request carries the service_role key in either header supabase-js uses. */
export function carriesServiceRole(headers: Headers): boolean {
  return [headers.get("authorization"), headers.get("apikey")].some((h) => roleOf(h) === "service_role");
}

// Hop-by-hop headers, and the ones that would mislead PostgREST or leak the
// session: the device-session cookie has no business in PostgREST's logs.
const DROP_REQUEST = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "content-length",
  "accept-encoding",
  "cookie",
  "apikey",
]);

// fetch() has already decoded the body, so the upstream's encoding and length
// would describe bytes that are no longer there.
const DROP_RESPONSE = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie",
]);

export function upstreamRequestHeaders(incoming: Headers): Headers {
  const out = new Headers();
  incoming.forEach((value, name) => {
    if (!DROP_REQUEST.has(name.toLowerCase())) out.set(name, value);
  });
  return out;
}

export function downstreamResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, name) => {
    if (!DROP_RESPONSE.has(name.toLowerCase())) out.set(name, value);
  });
  return out;
}

/**
 * A fetch for supabase-js on the server that goes straight to PostgREST.
 *
 * supabase-js builds `${url}/rest/v1/<table>`; PostgREST serves `/<table>`.
 * Kong used to strip the prefix. With POSTGREST_URL set the clients are built
 * on that address and this strips it instead — one hop, no gateway. Without
 * it (a compose file from before 1.15, still running Kong), requests go to
 * SUPABASE_URL unchanged.
 */
export function postgrestFetch(base: string): typeof fetch {
  const prefix = `${base.replace(/\/+$/, "")}/rest/v1/`;
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(prefix)) return fetch(input, init);
    const target = `${prefix.slice(0, -"rest/v1/".length)}${url.slice(prefix.length)}`;
    return input instanceof Request ? fetch(new Request(target, input), init) : fetch(target, init);
  };
}
