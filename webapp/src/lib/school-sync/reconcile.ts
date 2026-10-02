import { defaultGroup, defaultSchoolRegion, type PendingPick, type RegionOption } from "./school-region";
import type { SchoolSyncSetting } from "./sync";

const FRESH = { last_success_at: null, last_error_at: null, last_error: null } as const;

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
    return {
      setting: { enabled: true, region: derived.region, group: derived.group, pending: derived.pending, ...FRESH },
      clear: false,
    };
  }
  if (previous === next) return { setting: existing, clear: false };
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
  let next: SchoolSyncSetting = existing ?? {
    enabled: false, region: derived.region, group: derived.group, pending: derived.pending, ...FRESH,
  };
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
