import { createAdminClient } from "@/lib/supabase/server";

// Placeholder returned to the browser instead of a stored secret. Truthy,
// so existing `!!settings?.access_token`-style connected-checks keep
// working. A PUT that sends this value back means "keep the stored secret".
export const SECRET_SENTINEL = "__secret_stored__";

// Setting key → dotted paths (within the setting's JSON value) that must
// never reach the browser. Secrets rows store the SAME nested shape.
export const SECRET_FIELDS: Record<string, string[]> = {
  home_assistant: ["access_token"],
  immich: ["api_key"],
  unsplash: ["access_key"],
  google_calendar: ["access_token", "refresh_token"],
  bring_settings: ["credentials.accessToken", "credentials.refreshToken"],
};

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

// Immutable set: returns a copy of obj with path set to value,
// creating intermediate objects as needed.
function setPath(obj: unknown, path: string, value: unknown): JsonObject {
  const parts = path.split(".");
  const root: JsonObject = isObject(obj) ? { ...obj } : {};
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    cur[parts[i]] = isObject(next) ? { ...next } : {};
    cur = cur[parts[i]] as JsonObject;
  }
  cur[parts[parts.length - 1]] = value;
  return root;
}

// Immutable delete of a dotted path (no-op if absent).
function deletePath(obj: unknown, path: string): unknown {
  if (!isObject(obj)) return obj;
  const parts = path.split(".");
  const root: JsonObject = { ...obj };
  let cur: JsonObject = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!isObject(next)) return root;
    cur[parts[i]] = { ...next };
    cur = cur[parts[i]] as JsonObject;
  }
  delete cur[parts[parts.length - 1]];
  return root;
}

/**
 * Split a client-supplied setting value into the public part (stored in
 * `settings`) and the secret part (stored in `integration_secrets`).
 * Sentinel values are dropped from BOTH (public part must not contain the
 * path at all; secret part omitting it means "keep what's stored").
 */
export function splitSecrets(
  key: string,
  value: unknown
): { publicValue: unknown; secretValue: JsonObject | null } {
  const paths = SECRET_FIELDS[key];
  if (!paths) return { publicValue: value, secretValue: null };

  let publicValue = value;
  let secretValue: JsonObject | null = null;
  for (const path of paths) {
    const v = getPath(value, path);
    publicValue = deletePath(publicValue, path);
    if (v !== undefined && v !== null && v !== "" && v !== SECRET_SENTINEL) {
      secretValue = setPath(secretValue ?? {}, path, v);
    }
  }
  return { publicValue, secretValue };
}

/** Inject the sentinel wherever a stored secret exists (for GET responses). */
export function applySentinels(
  key: string,
  value: unknown,
  secrets: unknown
): unknown {
  const paths = SECRET_FIELDS[key];
  if (!paths || value === null || value === undefined) return value;
  let out = value;
  for (const path of paths) {
    const stored = getPath(secrets, path);
    if (stored !== undefined && stored !== null && stored !== "") {
      out = setPath(out, path, SECRET_SENTINEL);
    }
  }
  return out;
}

/** Merge real stored secrets back into a public value (server-side use). */
export function mergeSecrets(key: string, value: unknown, secrets: unknown): unknown {
  const paths = SECRET_FIELDS[key];
  if (!paths || value === null || value === undefined) return value;
  let out = value;
  for (const path of paths) {
    const stored = getPath(secrets, path);
    if (stored !== undefined) out = setPath(out, path, stored);
  }
  return out;
}

export async function getStoredSecrets(
  familyId: string,
  key: string
): Promise<JsonObject | null> {
  const supabase = createAdminClient();
  const { data } = await (supabase as any)
    .from("integration_secrets")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", key)
    .maybeSingle();
  return (data?.value as JsonObject) ?? null;
}

/**
 * The one call server routes should use: the setting's value with real
 * secrets merged back in. Returns null when the setting row doesn't exist.
 */
export async function getMergedSetting<T>(
  familyId: string,
  key: string
): Promise<T | null> {
  const supabase = createAdminClient();
  const { data } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", key)
    .maybeSingle();
  if (!data || data.value === null || data.value === undefined) return null;
  const secrets = await getStoredSecrets(familyId, key);
  return mergeSecrets(key, data.value, secrets) as T;
}

/** Deep-merge new secret paths into the stored row (per-path, not shallow). */
export async function upsertSecrets(
  familyId: string,
  key: string,
  secretValue: JsonObject
): Promise<void> {
  const supabase = createAdminClient();
  const existing = (await getStoredSecrets(familyId, key)) ?? {};
  let merged: unknown = existing;
  for (const path of SECRET_FIELDS[key] ?? []) {
    const v = getPath(secretValue, path);
    if (v !== undefined) merged = setPath(merged, path, v);
  }
  const { error } = await (supabase as any).from("integration_secrets").upsert(
    {
      family_id: familyId,
      key,
      value: merged,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "family_id,key" }
  );
  if (error) throw new Error(`Failed to store secrets for ${key}: ${error.message}`);
}

export async function deleteSecrets(familyId: string, key: string): Promise<void> {
  const supabase = createAdminClient();
  await (supabase as any)
    .from("integration_secrets")
    .delete()
    .eq("family_id", familyId)
    .eq("key", key);
}
