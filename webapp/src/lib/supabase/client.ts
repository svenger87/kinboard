import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

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
  );
}
