import * as z from "zod";
import { hasOpenHolidays, resolveRegion, type HolidayRegionSetting } from "@/lib/holidays/region";
import { fetchSchoolHolidays, syncWindow, SyncError, type FetchedBreak, type SchoolRegion, type SyncFetch } from "./openholidays";
import type { PendingPick } from "./school-region";

/**
 * The school-holiday sync for one family (RFC-014 §5.2, §9). Everything it
 * touches is injected, so the specs drive it with a fake store and a
 * counting fake fetch; lib/school-sync/live.ts wires the real ones.
 *
 * Rows change only after a complete, valid answer, and only through
 * store.apply -- one SQL function that cannot match a manual row. Any
 * failure leaves every row as it was and records the error.
 *
 * The family id is the caller's to vouch for: the cron loop reads it from
 * the settings table, a session route from the session. Never a request body.
 */

export interface SchoolSyncSetting {
  enabled: boolean;
  /** OpenHolidays subdivision: `DE-NI`, `AT-WI`, `CH-GR-ML`, `NL-UT`, `FR-ZA`. While `pending` is "region", a parent the family still has to narrow down. */
  region: string | null;
  /** OpenHolidays group: `DE-MV-ABS`, `CH-ZH-VS`, `NL-MI`. */
  group: string | null;
  /** What the family still has to pick before anything is fetched. */
  pending: PendingPick;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
}

const SettingSchema = z.object({
  enabled: z.boolean(),
  region: z.string().min(1).max(40).nullable(),
  group: z.string().min(1).max(40).nullable(),
  pending: z.enum(["region", "group"]).nullable(),
  last_success_at: z.string().nullable(),
  last_error_at: z.string().nullable(),
  last_error: z.string().max(500).nullable(),
});

export function parseSyncSetting(value: unknown): SchoolSyncSetting | null {
  const parsed = SettingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface SchoolSyncStore {
  holidayRegion(familyId: string): Promise<HolidayRegionSetting | null>;
  language(familyId: string): Promise<string>;
  setting(familyId: string): Promise<SchoolSyncSetting | null>;
  saveSetting(familyId: string, setting: SchoolSyncSetting): Promise<void>;
  deleteSetting(familyId: string): Promise<void>;
  /** Synced rows ending on or after `today`. */
  futureSyncedCount(familyId: string, today: string): Promise<number>;
  /** One transaction: upsert `rows`, delete synced rows missing from them inside `window`. */
  apply(familyId: string, rows: FetchedBreak[], window: { from: string; to: string }): Promise<void>;
  /** Delete every synced row (switched off, or a new school region). Manual rows stay. */
  clear(familyId: string): Promise<void>;
  enabledFamilies(): Promise<{ familyId: string; setting: SchoolSyncSetting }[]>;
}

export interface SchoolSyncDeps {
  fetch: SyncFetch;
  store: SchoolSyncStore;
  now: () => Date;
  /** False when the operator set SCHOOL_HOLIDAY_SYNC=off. */
  installEnabled: boolean;
  userAgent: string;
  log: (message: string) => void;
}

export type SyncOutcome =
  | { status: "synced"; rows: number }
  | {
      status: "skipped";
      /** "superseded": the switch, region or group changed while the request was out; its answer is for a choice nobody holds any more. */
      reason: "install-off" | "disabled" | "not-covered" | "needs-region" | "needs-group" | "superseded";
    }
  | { status: "failed"; error: string };

/** Once a week per family (§5.2). */
export const SYNC_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

export function installEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.SCHOOL_HOLIDAY_SYNC ?? "").trim().toLowerCase() !== "off";
}

/** Enabled, nothing left to pick, and no success in the last week. A failing family stays due. */
export function isDue(setting: SchoolSyncSetting, now: Date): boolean {
  if (!setting.enabled || !setting.region || setting.pending !== null) return false;
  if (!setting.last_success_at) return true;
  return now.getTime() - Date.parse(setting.last_success_at) > SYNC_EVERY_MS;
}

/** The same switch, region, group and nothing pending: the answer still fits. */
function sameChoice(a: SchoolSyncSetting | null, b: SchoolSyncSetting): a is SchoolSyncSetting {
  return a !== null && a.enabled && a.pending === null && a.region === b.region && a.group === b.group;
}

export async function syncFamily(familyId: string, deps: SchoolSyncDeps): Promise<SyncOutcome> {
  if (!deps.installEnabled) return { status: "skipped", reason: "install-off" };
  const setting = await deps.store.setting(familyId);
  if (!setting?.enabled) return { status: "skipped", reason: "disabled" };
  const holidayRegion = await deps.store.holidayRegion(familyId);
  const country = holidayRegion?.code ? (resolveRegion(holidayRegion.code)?.country ?? null) : null;
  if (!country || !hasOpenHolidays(country)) return { status: "skipped", reason: "not-covered" };
  if (!setting.region || setting.pending === "region") return { status: "skipped", reason: "needs-region" };
  if (setting.pending === "group") return { status: "skipped", reason: "needs-group" };

  const now = deps.now();
  const today = now.toISOString().slice(0, 10);
  const window = syncWindow(today);
  const choice: SchoolRegion = { country, region: setting.region, group: setting.group };
  try {
    const language = await deps.store.language(familyId);
    const rows = await fetchSchoolHolidays(choice, window, language, { fetch: deps.fetch, userAgent: deps.userAgent });
    // §5.2: a region does not lose every school holiday overnight. An empty
    // answer where the last run left future rows is the API misbehaving,
    // so the rows stay and it counts as a failure.
    if (rows.length === 0 && (await deps.store.futureSyncedCount(familyId, today)) > 0) {
      throw new SyncError("empty", "OpenHolidays returned no school holidays where it had some before");
    }
    // The request can take ten seconds. If the family switched off or
    // picked another region meanwhile, that change already cleared the
    // synced rows; writing this answer would bring them back.
    const latest = await deps.store.setting(familyId);
    if (!sameChoice(latest, setting)) return { status: "skipped", reason: "superseded" };
    await deps.store.apply(familyId, rows, window);
    await deps.store.saveSetting(familyId, { ...latest, last_success_at: now.toISOString() });
    return { status: "synced", rows: rows.length };
  } catch (err) {
    const message =
      err instanceof SyncError ? err.message : `the school-holiday sync failed (${(err as Error)?.message ?? String(err)})`;
    deps.log(`[school-sync] family ${familyId}: ${message}`);
    // Recorded on the setting as it is now, so a switch flipped during the
    // request is kept; and not at all if the setting is gone.
    try {
      const latest = await deps.store.setting(familyId);
      if (latest) {
        await deps.store.saveSetting(familyId, { ...latest, last_error_at: now.toISOString(), last_error: message.slice(0, 500) });
      }
    } catch {
      // The rows are as they were; failing to note why must not throw.
    }
    return { status: "failed", error: message };
  }
}
