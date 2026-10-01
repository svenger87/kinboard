import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

/**
 * "Allow AI assistants" — a per-family switch, off by default (RFC-010).
 *
 * The OAuth endpoints are anonymous by nature: discovery, registration,
 * authorize and token have to answer a caller who has no session. Merging
 * them would otherwise give every Kinboard on the internet that surface,
 * including the ones whose families never wanted an assistant. So until at
 * least one family on the install switches assistants on, those routes and
 * /api/mcp answer 404 as if they did not exist; and a family that has not
 * switched it on cannot approve an assistant or use /api/mcp even when
 * another family on the same install has.
 *
 * The Integration API (Home Assistant) is deliberately not behind this.
 */

/** How long "is it on anywhere?" is remembered. The anonymous routes ask on every request. */
export const ENABLED_CACHE_MS = 30_000;

let anywhereCache: { value: boolean; until: number } | null = null;

async function loadAnywhere(): Promise<boolean> {
  const { data, error } = await (createAdminClient() as any)
    .from("settings")
    .select("family_id")
    .eq("key", SETTINGS_KEYS.assistantsEnabled)
    .eq("value", true)
    .limit(1);
  if (error) throw new Error(`could not read ${SETTINGS_KEYS.assistantsEnabled}: ${error.message}`);
  return (data ?? []).length > 0;
}

async function loadFor(familyId: string): Promise<boolean> {
  const { data, error } = await (createAdminClient() as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", SETTINGS_KEYS.assistantsEnabled)
    .maybeSingle();
  if (error) throw new Error(`could not read ${SETTINGS_KEYS.assistantsEnabled}: ${error.message}`);
  return data?.value === true;
}

/**
 * Whether any family on this install allows assistants. Cached for 30 s in
 * memory; a failed lookup reads as "no" (fail closed) and is not cached, so
 * the next request tries again.
 */
export async function assistantsEnabledAnywhere(
  load: () => Promise<boolean> = loadAnywhere,
  now: number = Date.now(),
): Promise<boolean> {
  if (anywhereCache && anywhereCache.until > now) return anywhereCache.value;
  try {
    const value = await load();
    anywhereCache = { value, until: now + ENABLED_CACHE_MS };
    return value;
  } catch (err) {
    console.error("[oauth] assistants switch lookup failed", err);
    return false;
  }
}

/** Forget the cached answer — after this process changed the switch, so it takes effect at once here. */
export function forgetAssistantsEnabled(): void {
  anywhereCache = null;
}

/** Whether this family allows assistants. Not cached: it gates approval and every MCP call. Throws on a failed lookup. */
export async function assistantsEnabledFor(
  familyId: string,
  load: (familyId: string) => Promise<boolean> = loadFor,
): Promise<boolean> {
  return load(familyId);
}

/**
 * For the anonymous OAuth routes and /api/mcp: null to proceed, or the 404
 * that makes them look absent while no family has switched assistants on.
 */
export async function assistantsGate(
  anywhere: () => Promise<boolean> = () => assistantsEnabledAnywhere(),
): Promise<NextResponse | null> {
  if (await anywhere()) return null;
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
