import { NO_KEY, createPostgrestClient, type BrowserDbClient } from "@/lib/supabase/postgrest";
import { legacyKongBrowserApikey } from "@/lib/supabase/legacy-kong";
import { getFamilyToken, invalidateFamilyToken } from "@/lib/supabase/family-token";
import { guardUnfilteredWrites } from "@/lib/supabase/unfiltered-write-guard";

// No key, and nothing read from the build (RFC-024 §4.6, phase 7 step 3).
//
// Before 1.18 the root layout handed this client the anon key in
// `window.__ENV`, and it sent that key as `apikey` and as the bearer before
// a family token replaced it. The key's only claim was `role: anon`, and
// PostgREST runs a request with no `Authorization` header as that same role
// (PGRST_DB_ANON_ROLE=anon), so it gave the browser nothing; the family token
// is what row-level security reads. Without a key there is also nothing left
// for `next build` to inline, which is how a stray `.env.local` once ended up
// in production's bundle (2026-08-06).
//
// One exception, for one release: an install still on a compose file from
// before 1.15 with Kong as its front door, where Kong answers `/rest/v1`
// and refuses a request without `apikey`. There the layout still hands the
// page the key in `window.__ENV`, and this client sends it as `apikey`, and
// only that (lib/supabase/legacy-kong.ts). A page rendered before the
// update, still carrying the old `window.__ENV`, works the same way; its old
// NEXT_PUBLIC_SUPABASE_URL is never read. e2e/anon-key-retired.spec.ts
// holds all of it.

/**
 * The API base for this browser: the page's own origin, always (1.15 —
 * `/rest/v1` is served by the webapp itself, see lib/supabase/api-base.ts).
 */
export function browserApiBase(): string {
  // Server render of a client component: nothing is fetched there (queries
  // run in effects), but the constructor insists on a URL.
  if (typeof window === "undefined") return "http://localhost";
  return window.location.origin;
}

/**
 * How long a read may take before it is given up and React Query retries it.
 *
 * Without a limit, a request that never answers — a connection that died
 * while a wall display slept, a proxy that stalled — kept its widget on
 * "loading" until somebody changed page. Reads only: an abandoned write may
 * still have reached the database, and retrying it could apply it twice.
 * Browsers without AbortSignal.any (before Safari 17.4) keep the old
 * behaviour rather than lose the caller's own signal.
 */
const READ_TIMEOUT_MS = 30_000;

export function withReadTimeout(init?: RequestInit): RequestInit | undefined {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return init;
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return init;
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  if (!init?.signal) return { ...init, signal: timeout };
  if (typeof AbortSignal.any !== "function") return init;
  return { ...init, signal: AbortSignal.any([init.signal, timeout]) };
}

/**
 * One client per page, as `@supabase/ssr`'s `createBrowserClient` kept it:
 * the ~24 callers call `createClient()` freely, in render and in effects.
 * Only in a browser; a server render of a client component gets a fresh one.
 */
let browserClient: BrowserDbClient | undefined;

export function createClient(): BrowserDbClient {
  const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
  if (isBrowser && browserClient) return browserClient;
  // Only behind a pre-1.15 Kong, or on a page rendered before 1.18; else null.
  const kongApikey = legacyKongBrowserApikey();
  const withKongApikey = (init?: RequestInit): RequestInit | undefined => {
    if (!kongApikey) return init;
    const headers = new Headers(init?.headers);
    if (!headers.has("apikey")) headers.set("apikey", kongApikey);
    return { ...init, headers };
  };
  const client = createPostgrestClient(
    browserApiBase(),
    NO_KEY,
    {
      /**
       * Attach the family-scoped token to every direct database call.
       *
       * Row-level security reads a `family_id` claim from the request's JWT.
       * A request without one runs as `anon`, which with RLS enabled can read
       * nothing — the point — so without this the app would see an empty
       * database.
       *
       * Done here rather than at the ~200 call sites because `createClient()`
       * is synchronous and used everywhere; a custom fetch is the one place
       * every request passes through. It also means the token can be
       * refreshed transparently, which a kiosk needs: nobody is going to
       * reload the wall display every hour.
       *
       * No `apikey` header: Kong, which wanted one, is gone since 1.15. An
       * install whose webapp still forwards to Kong gets the key added by
       * the server's /rest/v1 route; one with Kong in front gets it from the
       * page (`kongApikey` above). The Authorization header is what
       * PostgREST verifies and what the policies read.
       *
       * Wrapped in the unfiltered-write guard (RFC-024 §4.2.1): an UPDATE
       * or DELETE without a filter is refused before a token is even asked
       * for.
       */
      fetch: guardUnfilteredWrites(async (input: RequestInfo | URL, rawInit?: RequestInit) => {
        const init = withKongApikey(withReadTimeout(rawInit));
        const token = await getFamilyToken();
        if (!token) return fetch(input, init);

        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${token}`);
        const response = await fetch(input, { ...init, headers });

        // The token expired between the freshness check and the request
        // landing, or the session was revoked. Mint once and retry once —
        // never loop, or a genuinely revoked session becomes a hot spin.
        if (response.status === 401) {
          invalidateFamilyToken();
          const retryToken = await getFamilyToken();
          if (retryToken && retryToken !== token) {
            const retryHeaders = new Headers(init?.headers);
            retryHeaders.set("Authorization", `Bearer ${retryToken}`);
            return fetch(input, { ...init, headers: retryHeaders });
          }
        }

        return response;
      }),
    },
  ) as BrowserDbClient;
  if (isBrowser) browserClient = client;
  return client;
}
