import { createAdminClient } from "@/lib/db/server";
import { UPDATE_OPERATOR_KEY, decideOperator } from "@/lib/update-status";

/**
 * Whether a family is the install's operator: the one that sees what belongs
 * to the install rather than to a family, such as the automatic updater's
 * status (RFC-023 §4.11.4) and the compose file's revision (§4.6). The rules
 * are decideOperator's; this reads and records what it needs.
 *
 * Server only: it reads instance_settings and counts families with the
 * service role.
 */

async function readKey(key: string): Promise<string | null> {
  const { data, error } = await (createAdminClient() as any)
    .from("instance_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.value === "string" ? data.value : null;
}

async function writeKey(key: string, value: string): Promise<void> {
  const { error } = await (createAdminClient() as any)
    .from("instance_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function isInstallOperator(familyId: string): Promise<boolean> {
  const db = createAdminClient() as any;
  const { count, error } = await db.from("families").select("id", { head: true, count: "exact" });
  if (error) throw new Error(error.message);
  let recorded = await readKey(UPDATE_OPERATOR_KEY);
  if (recorded) {
    const { data, error: famError } = await db.from("families").select("id").eq("id", recorded).maybeSingle();
    if (famError) throw new Error(famError.message);
    if (!data) recorded = null; // that family was deleted
  }
  const decision = decideOperator(familyId, {
    familyCount: count ?? 0,
    recorded,
    env: {
      INSTANCE_ADMIN_FAMILY_ID: process.env.INSTANCE_ADMIN_FAMILY_ID,
      KINBOARD_DEMO_FAMILY_CODE: process.env.KINBOARD_DEMO_FAMILY_CODE,
    },
  });
  if (decision.record) await writeKey(UPDATE_OPERATOR_KEY, familyId);
  return decision.operator;
}
