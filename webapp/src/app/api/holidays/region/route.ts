import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { resolveRegion, type HolidayRegionSetting } from "@/lib/holidays/region";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { logApiError } from "@/lib/api-error";
import { liveSchoolSyncDeps } from "@/lib/school-sync/live";
import { fetchIfReady, reconcileOnRegionPick, type RouteSyncOutcome } from "@/lib/school-sync/reconcile";
import { INTERNAL_SYNC_ERROR, type SchoolSyncSetting } from "@/lib/school-sync/sync";
import { syncLimited } from "@/lib/school-sync/limit";

export const dynamic = "force-dynamic";

/**
 * The only writer of `holiday_region` a family's devices can call (RFC-014
 * §4.2; plan ruling 20). Creating a family writes its "no region" row, and
 * /api/import restores a backup's (ruling 8); neither reaches an existing
 * family.
 * Picking or keeping a region records that someone in the family chose it.
 * The family comes from the session, never from the body.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const familyId = auth.session.familyId;

  const body = await request.json().catch(() => null);
  const resolved = resolveRegion(typeof body?.code === "string" ? body.code : null);
  if (!resolved) {
    return NextResponse.json({ error: "code must be an offered region", code: "invalid_request" }, { status: 400 });
  }
  const deps = liveSchoolSyncDeps();
  const previous = await deps.store.holidayRegion(familyId).catch(() => null);

  const region: HolidayRegionSetting = { code: resolved.code, chosen: true };
  const { error } = await (createAdminClient() as any)
    .from("settings")
    .upsert({ family_id: familyId, key: SETTINGS_KEYS.holidayRegion, value: region }, { onConflict: "family_id,key" });
  if (error) {
    await logApiError("holidays/region", error);
    return NextResponse.json({ error: "could not save the region" }, { status: 500 });
  }

  // §5.4: picking a region is what turns the school-holiday sync on, and a
  // new region replaces what was synced for the old one. A failure here is
  // logged and reported in the card; it never undoes the region the family
  // just picked.
  let sync: SchoolSyncSetting | null = null;
  // Null only where there is no sync (uncovered country, install off).
  // "rate-limited" and the skipped reasons tell the card what happens next.
  let outcome: RouteSyncOutcome | null = null;
  try {
    const existing = await deps.store.setting(familyId);
    const result = reconcileOnRegionPick(previous?.code ?? null, resolved.code, existing, deps.installEnabled);
    // The setting first, then the rows, so a sync in flight sees the change
    // before it writes and cannot bring the old region's rows back.
    if (result.setting) await deps.store.saveSetting(familyId, result.setting);
    else if (existing) await deps.store.deleteSetting(familyId);
    if (result.clear) await deps.store.clear(familyId);
    sync = result.setting;
    if (result.setting) {
      outcome = await fetchIfReady(familyId, result.setting, deps, () => syncLimited(familyId));
      sync = await deps.store.setting(familyId);
    }
  } catch (err) {
    await logApiError("holidays/region/sync", err);
    // The region is saved; the sync is not. Re-picking the region repairs it.
    outcome = { status: "failed", error: INTERNAL_SYNC_ERROR };
  }

  return NextResponse.json({ region, sync, outcome });
}
