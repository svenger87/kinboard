import { defaultGroup, defaultSchoolRegion, topLevel, type PendingPick, type RegionOption } from "./school-region";
import { backingOff } from "./limit";
import { parseSyncSetting, syncFamily, type SchoolSyncDeps, type SchoolSyncSetting, type SyncOutcome } from "./sync";

const FRESH = { last_success_at: null, last_error_at: null, last_error: null, language: null } as const;

/** What a family with a chosen, covered region has before anyone touched the switch (§5.4): on. */
export function defaultSyncSetting(derived: { region: string | null; group: string | null; pending: PendingPick }): SchoolSyncSetting {
  return { enabled: true, region: derived.region, group: derived.group, pending: derived.pending, ...FRESH };
}

/** Switched on, a region, nothing left to pick: a fetch would actually happen. */
export function readyToFetch(setting: SchoolSyncSetting): boolean {
  return setting.enabled && setting.region !== null && setting.pending === null;
}

/** What a session route answers for the fetch it did, skipped, or was not allowed yet. */
export type RouteSyncOutcome = SyncOutcome | { status: "rate-limited"; retryAfterMs: number };

/**
 * Fetch now if the setting is ready, under the once-a-minute limit (§5.2).
 * The limit is only asked -- and so only used up -- when a request would
 * really go out: picking a province and then its group, or a canton and then
 * its Region, fetches on the second step, not "rate-limited" by the first.
 */
export async function fetchIfReady(
  familyId: string,
  setting: SchoolSyncSetting,
  deps: SchoolSyncDeps,
  limit: () => { limited: boolean; retryAfterMs: number },
): Promise<RouteSyncOutcome> {
  if (!setting.enabled) return { status: "skipped", reason: "disabled" };
  if (setting.region === null || setting.pending === "region") return { status: "skipped", reason: "needs-region" };
  if (setting.pending === "group") return { status: "skipped", reason: "needs-group" };
  const limited = limit();
  if (limited.limited) return { status: "rate-limited", retryAfterMs: limited.retryAfterMs };
  return syncFamily(familyId, deps);
}

/**
 * What changing the family's language does to the synced names: fetch them
 * again in `language`, now, if the family's names were fetched in another
 * one -- under the same once-a-minute limit as the card's Refresh. Null when
 * there is nothing to do: the install or the switch is off, there is nothing
 * synced to rename yet (no setting, something to pick, never succeeded), the
 * names are already in `language`, or the family is backing off after a
 * failure. Whatever this does not fetch -- rate-limited, backing off, failed
 * -- the cron's language rule (isDue) fetches at its next run.
 *
 * Asked by /api/locale for every POST that names a family, which the join
 * page sends for each device that joins: re-picking the same language
 * neither fetches nor uses up the limit.
 */
export async function syncAfterLanguageChange(
  familyId: string,
  language: string,
  deps: SchoolSyncDeps,
  limit: () => { limited: boolean; retryAfterMs: number },
): Promise<RouteSyncOutcome | null> {
  if (!deps.installEnabled) return null;
  const setting = await deps.store.setting(familyId);
  if (!setting || !readyToFetch(setting) || !setting.last_success_at) return null;
  if (setting.language === language || backingOff(setting, deps.now())) return null;
  return fetchIfReady(familyId, setting, deps, limit);
}

/**
 * A backup's sync setting, as /api/import restores it: the family's choice
 * (switch, region, group, what is pending) without the old status, so the
 * restored family is due at once rather than up to a week later. Null for a
 * value that is not a sync setting; import drops that row.
 */
export function restoredSyncSetting(value: unknown): SchoolSyncSetting | null {
  const setting = parseSyncSetting(value);
  return setting ? { ...setting, ...FRESH } : null;
}

/** Does the stored school region still belong to the public-holiday region it was derived for? */
function agrees(existing: SchoolSyncSetting, derived: { country: string; region: string | null }): boolean {
  if (existing.region === null) return true;
  if (derived.region === null) return existing.region.split("-")[0] === derived.country;
  return topLevel(existing.region) === topLevel(derived.region);
}

/**
 * What picking the public-holiday region `next` does to the sync (§5.4,
 * plan ruling 31). The first pick in a covered country turns it on; a family
 * that switched it off keeps it off; a new region is off and then on (§6.2):
 * the old region's rows go and the new one is fetched. An uncovered country
 * clears everything and forgets the decision.
 */
export function reconcileOnRegionPick(
  previous: string | null,
  next: string,
  existing: SchoolSyncSetting | null,
  installOn: boolean,
): { setting: SchoolSyncSetting | null; clear: boolean } {
  const derived = defaultSchoolRegion(next);
  if (!derived) return { setting: null, clear: existing !== null };
  if (!existing) {
    if (!installOn) return { setting: null, clear: false };
    return { setting: defaultSyncSetting(derived), clear: false };
  }
  // Confirming the same region keeps the family's choice -- unless the
  // setting no longer belongs to it: a region saved by an earlier request
  // whose sync update failed. Re-picking the region repairs that.
  if (previous === next && agrees(existing, derived)) return { setting: existing, clear: false };
  return {
    setting: { ...existing, region: derived.region, group: derived.group, pending: derived.pending, ...FRESH },
    clear: true,
  };
}

export interface RegionOptions {
  subdivisions: RegionOption[];
  children: RegionOption[];
  groups: RegionOption[];
}

export interface SyncChange {
  enabled?: boolean;
  region?: string;
  group?: string;
}

/**
 * A change from the card. `options` are the choices for the top level of
 * the region being set (the route fetches them); every code must be one of
 * them. A new region or group is off and then on: the rows go, the status
 * resets.
 */
export function applySyncChange(
  existing: SchoolSyncSetting | null,
  change: SyncChange,
  derived: { region: string | null; group: string | null; pending: PendingPick },
  options: RegionOptions | null,
): { setting: SchoolSyncSetting; clear: boolean } | { error: "invalid_region" | "invalid_group" } {
  // No row yet with a chosen, covered region (the route checks both) is the
  // default, which is on (§5.4): a Refresh must not save it as off.
  let next: SchoolSyncSetting = existing ?? defaultSyncSetting(derived);
  let clear = false;
  if (change.enabled === false) {
    next = { ...next, enabled: false };
    clear = true;
  } else if (change.enabled === true && !next.enabled) {
    // Switching off emptied the rows, so the old status describes nothing.
    // A fresh status also makes the family due at once: when the fetch that
    // follows is rate-limited, the cron fills the rows in, not a week later.
    next = { ...next, enabled: true, ...FRESH };
  }
  const before = next;

  if (change.region !== undefined) {
    const top = options?.subdivisions.some((s) => s.code === change.region) ?? false;
    const child = options?.children.some((c) => c.code === change.region) ?? false;
    if (!options || (!top && !child)) return { error: "invalid_region" };
    if (top && options.children.length > 0) {
      next = { ...next, region: change.region, group: null, pending: "region" };
    } else {
      if (change.group !== undefined && !options.groups.some((g) => g.code === change.group)) return { error: "invalid_group" };
      const group = change.group ?? defaultGroup(options.groups);
      next = { ...next, region: change.region, group, pending: options.groups.length > 0 && group === null ? "group" : null };
    }
  } else if (change.group !== undefined) {
    if (!options || !options.groups.some((g) => g.code === change.group)) return { error: "invalid_group" };
    next = { ...next, group: change.group, pending: next.pending === "group" ? null : next.pending };
  }

  if (next.region !== before.region || next.group !== before.group) {
    next = { ...next, ...FRESH };
    clear = true;
  }
  return { setting: next, clear };
}
