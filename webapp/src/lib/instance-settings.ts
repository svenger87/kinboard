import { createAdminClient } from "@/lib/supabase/server";

/**
 * Settings of the install rather than of a family (instance_settings), read
 * and written with the service role: the browser roles see nothing of that
 * table (migrations/065_instance_settings.sql).
 */
export async function readInstanceKey(key: string): Promise<string | null> {
  const { data, error } = await (createAdminClient() as any)
    .from("instance_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.value === "string" ? data.value : null;
}

export async function writeInstanceKey(key: string, value: string): Promise<void> {
  const { error } = await (createAdminClient() as any)
    .from("instance_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function deleteInstanceKey(key: string): Promise<void> {
  const { error } = await createAdminClient().from("instance_settings").delete().eq("key", key);
  if (error) throw new Error(error.message);
}
