import { NextRequest, NextResponse } from "next/server";
import * as z from "zod";
import { requireSession } from "@/lib/require-session";
import { logApiError } from "@/lib/api-error";
import { hasOpenHolidays, resolveRegion } from "@/lib/holidays/region";
import { liveSchoolSyncDeps } from "@/lib/school-sync/live";
import { applySyncChange, defaultSyncSetting, fetchIfReady, type RegionOptions } from "@/lib/school-sync/reconcile";
import { defaultSchoolRegion, topLevel } from "@/lib/school-sync/school-region";
import { schoolRegionOptions } from "@/lib/school-sync/options";
import { SyncError } from "@/lib/school-sync/openholidays";
import { syncLimited } from "@/lib/school-sync/limit";

export const dynamic = "force-dynamic";

const Change = z
  .object({
    enabled: z.boolean().optional(),
    region: z.string().min(2).max(40).optional(),
    group: z.string().min(2).max(40).optional(),
  })
  .strict();

/** `{ enabled: false }` and nothing else: the one change that needs no OpenHolidays. */
function isSwitchOff(change: z.infer<typeof Change>): boolean {
  return change.enabled === false && change.region === undefined && change.group === undefined;
}

/** The card's view of the sync: may it exist here, and what is it set to. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const familyId = auth.session.familyId;
  const deps = liveSchoolSyncDeps();
  try {
    const region = await deps.store.holidayRegion(familyId);
    const country = region?.code ? (resolveRegion(region.code)?.country ?? null) : null;
    const chosen = region?.chosen === true;
    // No row with a chosen, covered region is the default, which is on
    // (§5.4); the card shows it as such, and the next change saves it.
    const derived = deps.installEnabled && chosen && region?.code ? defaultSchoolRegion(region.code) : null;
    return NextResponse.json({
      installEnabled: deps.installEnabled,
      covered: country !== null && hasOpenHolidays(country),
      chosen,
      setting: (await deps.store.setting(familyId)) ?? (derived ? defaultSyncSetting(derived) : null),
    });
  } catch (err) {
    await logApiError("school-holidays/sync", err);
    return NextResponse.json({ error: "could not read the sync" }, { status: 500 });
  }
}

/**
 * The switch, the school region and group, and Refresh now (an empty body).
 * Off empties the synced rows; a new region or group is off and then on
 * (RFC-014 §6.2). Manual rows and holiday calendars are never touched.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const familyId = auth.session.familyId;

  const body = Change.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid change", code: "invalid_request" }, { status: 400 });

  const deps = liveSchoolSyncDeps();
  if (!deps.installEnabled) {
    // Rows fetched before the operator switched the sync off stay and keep
    // counting. Switching off -- which only removes them, and fetches
    // nothing -- is still the family's to do; everything else is refused.
    if (!isSwitchOff(body.data)) {
      return NextResponse.json({ error: "the school-holiday sync is off on this install", code: "sync_off" }, { status: 403 });
    }
    try {
      const existing = await deps.store.setting(familyId);
      // The setting first, then the rows, as below.
      if (existing) await deps.store.saveSetting(familyId, { ...existing, enabled: false });
      await deps.store.clear(familyId);
      return NextResponse.json({ setting: await deps.store.setting(familyId), outcome: { status: "skipped", reason: "install-off" } });
    } catch (err) {
      await logApiError("school-holidays/sync", err);
      return NextResponse.json({ error: "could not change the sync" }, { status: 500 });
    }
  }

  try {
    const holiday = await deps.store.holidayRegion(familyId);
    // §5.4: the sync follows a region someone chose, in a country OpenHolidays covers.
    const derived = holiday?.code && holiday.chosen ? defaultSchoolRegion(holiday.code) : null;
    if (!derived) return NextResponse.json({ error: "pick a covered region first", code: "not_covered" }, { status: 409 });

    const existing = await deps.store.setting(familyId);
    const target = body.data.region ?? (body.data.group !== undefined ? existing?.region ?? null : null);
    let options: RegionOptions | null = null;
    if (target) {
      try {
        options = await schoolRegionOptions(derived.country, topLevel(target), await deps.store.language(familyId), deps);
      } catch (err) {
        if (err instanceof SyncError) {
          return NextResponse.json({ error: err.message, code: "openholidays_unreachable" }, { status: 502 });
        }
        throw err;
      }
    }

    const change = applySyncChange(existing, body.data, derived, options);
    if ("error" in change) return NextResponse.json({ error: change.error, code: "invalid_request" }, { status: 400 });
    // The setting first, then the rows: a sync already in flight re-checks
    // the setting before it writes, so once this is saved it cannot put
    // back the rows the clear below removes.
    await deps.store.saveSetting(familyId, change.setting);
    if (change.clear) await deps.store.clear(familyId);

    // Only a setting that would really fetch asks the once-a-minute limit,
    // so the first step of a two-step pick does not use it up.
    const outcome = await fetchIfReady(familyId, change.setting, deps, () => syncLimited(familyId));
    return NextResponse.json({ setting: await deps.store.setting(familyId), outcome });
  } catch (err) {
    await logApiError("school-holidays/sync", err);
    return NextResponse.json({ error: "could not change the sync" }, { status: 500 });
  }
}
