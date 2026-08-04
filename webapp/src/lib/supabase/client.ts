import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { getFamilyToken, invalidateFamilyToken } from "@/lib/supabase/family-token";

// Runtime env injected by app/layout.tsx via <script>window.__ENV=...</script>.
// Reading from window.__ENV first (when set) lets the published Docker image
// pick up the self-hoster's actual URL/key at container start instead of
// requiring a per-deployment rebuild. Build-time NEXT_PUBLIC_* still works
// as a fallback for the source-build path.
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

export function createClient() {
  return createBrowserClient<Database>(
    publicEnv("NEXT_PUBLIC_SUPABASE_URL"),
    publicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
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
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
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
