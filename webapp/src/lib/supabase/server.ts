import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { serverSupabaseUrl } from "@/lib/supabase/api-base";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

export async function createClient() {
  const cookieStore = await cookies();

  // The internal address: server code never goes out through the browser's
  // (RFC-018 — with the API on the page's own origin there is none to use).
  return createServerClient<Database>(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  );
}

// Admin client with service role key - bypasses RLS
// Use for API routes that need direct database access.
//
// `actor` names who is acting, for the task log: the Integration API passes
// "integration", which the database reads from the request headers
// (todo_actor() in migration_zzzzzy_todo_turns.sql). Without it a write
// with this key is logged as the server's.
export function createAdminClient(options?: { actor?: "integration" }) {
  const supabaseUrl = serverSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(options?.actor ? { global: { headers: { "x-kinboard-actor": options.actor } } } : {}),
  });
}
