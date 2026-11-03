import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { getFamilyToken, invalidateFamilyToken } from "@/lib/supabase/family-token";

// Runtime env injected by app/layout.tsx via <script>window.__ENV=...</script>.
// Reading from window.__ENV first (when set) lets the published Docker image
// pick up the self-hoster's actual URL/key at container start instead of
// requiring a per-deployment rebuild. Build-time NEXT_PUBLIC_* still works
// as a fallback for the source-build path.
//
// NEXT_PUBLIC_SUPABASE_URL is `same-origin` when the API is served at the
// address the page was opened from (RFC-018, lib/supabase/api-base.ts).
declare global {
  interface Window {
    __ENV?: {
      NEXT_PUBLIC_SUPABASE_URL?: string;
      NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
    };
  }
}

function publicEnv(key: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY"): string {
  if (typeof window !== "undefined") {
    const v = window.__ENV?.[key];
    if (v) return v;
  }
  return process.env[key] ?? "";
}

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

export function createClient() {
  return createBrowserClient<Database>(
    browserApiBase(),
    publicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      // No `accessToken` option: it existed only for the Supabase Realtime
      // WebSocket, which never goes through `fetch`. Live updates now come
      // from /api/realtime, authenticated by the session cookie
      // (hooks/use-realtime.ts).
      global: {
        /**
         * Attach the family-scoped token to every direct Supabase call.
         *
         * Row-level security reads a `family_id` claim from the request's JWT.
         * The anon key above carries no such claim — with RLS enabled it can
         * read nothing, which is the point — so without this the app would see
         * an empty database.
         *
         * Done here rather than at the ~200 call sites because `createClient()`
         * is synchronous and used everywhere; a custom fetch is the one place
         * every request passes through. It also means the token can be
         * refreshed transparently, which a kiosk needs: nobody is going to
         * reload the wall display every hour.
         *
         * The anon key stays as the `apikey` header (Kong requires it to route
         * at all); the Authorization header is what PostgREST verifies and what
         * the policies read.
         */
        fetch: async (input: RequestInfo | URL, rawInit?: RequestInit) => {
          const init = withReadTimeout(rawInit);
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
        },
      },
    },
  );
}
