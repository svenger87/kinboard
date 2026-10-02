import { backingOff } from "./limit";
import { defaultSyncSetting } from "./reconcile";
import { defaultSchoolRegion } from "./school-region";
import { isDue, syncFamily, type SchoolSyncDeps, type SchoolSyncSetting } from "./sync";

export type SchoolSyncCronResult =
  | { skipped: "SCHOOL_HOLIDAY_SYNC=off" }
  | { due: number; synced: number; failed: number; skipped: number; adopted: number };

/**
 * Families with a chosen, covered region and no sync setting: the default,
 * which is on (§5.4) and which the card already shows as on. Their default
 * is saved -- only if there is still no row, so a pick made meanwhile wins
 * -- and they are synced with the rest. A region that leaves something to
 * pick (a Dutch province, Graubünden's Regions) or that OpenHolidays does
 * not cover is left alone: no fetch could happen for it.
 */
async function adoptDefaults(deps: SchoolSyncDeps): Promise<{ familyId: string; setting: SchoolSyncSetting }[]> {
  let unset: { familyId: string; holidayRegion: string }[];
  try {
    unset = await deps.store.unsetFamilies();
  } catch (err) {
    // The families that have a setting are still synced.
    deps.log(`[school-sync] could not list families without a sync setting (${(err as Error)?.message ?? String(err)})`);
    return [];
  }
  const adopted: { familyId: string; setting: SchoolSyncSetting }[] = [];
  for (const { familyId, holidayRegion } of unset) {
    const derived = defaultSchoolRegion(holidayRegion);
    if (!derived || derived.pending !== null) continue;
    const setting = defaultSyncSetting(derived);
    try {
      if (await deps.store.saveSettingIfAbsent(familyId, setting)) adopted.push({ familyId, setting });
    } catch (err) {
      deps.log(`[school-sync] family ${familyId}: could not save the default sync setting (${(err as Error)?.message ?? String(err)})`);
    }
  }
  return adopted;
}

/**
 * One run of the weekly sync (RFC-014 §5.2), for the cron route: every
 * switched-on family, plus the ones whose default nobody saved, that has not
 * synced for a week and is not backing off after a failure. One family at a
 * time; one family's error never stops the run. Listing the switched-on
 * families failing throws: the route answers 500.
 */
export async function runSchoolSyncCron(deps: SchoolSyncDeps): Promise<SchoolSyncCronResult> {
  if (!deps.installEnabled) return { skipped: "SCHOOL_HOLIDAY_SYNC=off" };
  const now = deps.now();
  const enabled = await deps.store.enabledFamilies();
  const adopted = await adoptDefaults(deps);

  const seen = new Set<string>();
  const families = [...enabled, ...adopted].filter(({ familyId }) => !seen.has(familyId) && !!seen.add(familyId));
  const due = families.filter(({ setting }) => isDue(setting, now) && !backingOff(setting, now));
  const counts = { due: due.length, synced: 0, failed: 0, skipped: 0, adopted: adopted.length };
  for (const { familyId } of due) {
    try {
      const outcome = await syncFamily(familyId, deps);
      if (outcome.status === "synced") counts.synced++;
      else if (outcome.status === "failed") counts.failed++;
      else counts.skipped++;
    } catch (err) {
      counts.failed++;
      deps.log(`[school-sync] family ${familyId}: ${(err as Error)?.message ?? String(err)}`);
    }
  }
  return counts;
}
