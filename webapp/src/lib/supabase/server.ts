import { serverSupabaseFetch, serverSupabaseUrl } from "@/lib/supabase/api-base";
import { createPostgrestClient, type DbClient } from "@/lib/supabase/postgrest";
import { serviceRoleKey } from "@/lib/env";

// The cookie-bound anon client (`createClient`, from `@supabase/ssr`) is gone:
// it had no importers since Kinboard stopped using Supabase Auth, and the
// cookies it bound were Supabase sessions that never existed. Server code
// reads with the service role below; the browser has lib/supabase/client.ts.

// Admin client with service role key - bypasses RLS
// Use for API routes that need direct database access.
//
// `actor` names who is acting, for the task log: the Integration API passes
// "integration", which the database reads from the request headers
// (todo_actor() in migrations/066_todo_turns.sql). Without it a write
// with this key is logged as the server's.
export function createAdminClient(options?: { actor?: "integration" }): DbClient {
  const supabaseUrl = serverSupabaseUrl();
  // KINBOARD_SERVICE_ROLE_KEY, then its older names, then derived (lib/env.ts).
  const key = serviceRoleKey();

  return createPostgrestClient(supabaseUrl, key, {
    fetch: serverSupabaseFetch(),
    ...(options?.actor ? { headers: { "x-kinboard-actor": options.actor } } : {}),
  });
}
