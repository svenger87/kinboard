import { createAdminClient } from "@/lib/supabase/server";
import { serverSupabaseFetch, serverSupabaseUrl } from "@/lib/supabase/api-base";
import expectations from "@/lib/schema-expectations.json";
import { missingFromSchema, type Definitions } from "@/lib/schema-check";
import { serviceRoleKey } from "@/lib/env";

/**
 * The deep health check: `/api/health?deep=1` (RFC-023 §4.11.4).
 *
 * The plain check asks whether the database answers. That stays true when a
 * release renames or drops a column its own code still uses: a rehearsal with
 * a column renamed on purpose kept Docker's health status healthy and
 * /api/health at 200, and only a real write through /rest/v1 failed
 * (PGRST204). That is the case the self-update's rollback exists for, so after
 * it recreates the webapp it runs this as well, and treats a failure as a
 * start that did not come up.
 *
 * Two things, both through PostgREST as the app itself goes:
 *   - every table and column this build declares (src/types/database.ts,
 *     generated into schema-expectations.json) is in PostgREST's schema cache,
 *     read from its OpenAPI description. A table or column that is missing, or
 *     not yet reloaded into the cache, is named;
 *   - a write: a row in instance_settings (the install's, never a family's)
 *     under its own key, written and removed again.
 *
 * Read-only otherwise, and nothing is left behind.
 */

export const PROBE_KEY = "health_probe";

export interface DeepHealth {
  ok: boolean;
  /** Tables and columns the code needs that PostgREST does not have. */
  missing: string[];
  /** Whether a write through PostgREST went through. */
  write: boolean;
  error?: string;
}

async function schemaDefinitions(): Promise<Definitions> {
  const key = serviceRoleKey();
  const res = await serverSupabaseFetch()(`${serverSupabaseUrl().replace(/\/+$/, "")}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`PostgREST's schema description answered ${res.status}`);
  const body = (await res.json()) as { definitions?: Definitions };
  return body.definitions ?? {};
}

async function probeWrite(): Promise<boolean> {
  const db = createAdminClient() as any;
  const { error } = await db
    .from("instance_settings")
    .upsert({ key: PROBE_KEY, value: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "key" });
  const { error: removeError } = await db.from("instance_settings").delete().eq("key", PROBE_KEY);
  return !error && !removeError;
}

export async function deepHealth(): Promise<DeepHealth> {
  try {
    const [definitions, write] = await Promise.all([schemaDefinitions(), probeWrite()]);
    const missing = missingFromSchema(expectations as Record<string, string[]>, definitions);
    return { ok: missing.length === 0 && write, missing, write };
  } catch (err) {
    return { ok: false, missing: [], write: false, error: err instanceof Error ? err.message : String(err) };
  }
}
