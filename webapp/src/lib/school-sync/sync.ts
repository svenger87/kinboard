import * as z from "zod";
import { hasOpenHolidays, resolveRegion, type HolidayRegionSetting } from "@/lib/holidays/region";
import { familyDateKey } from "@/lib/family-time";
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
  /** The zone the family's "today" is in. */
  timeZone(familyId: string): Promise<string>;
  setting(familyId: string): Promise<SchoolSyncSetting | null>;
  saveSetting(familyId: string, setting: SchoolSyncSetting): Promise<void>;
  deleteSetting(familyId: string): Promise<void>;
  /** Synced rows ending on or after `today`. */
  futureSyncedCount(familyId: string, today: string): Promise<number>;
  /**
   * One transaction, under the family's lock: if the family still holds
   * `expect` (switched on, that region and group, nothing pending), upsert
   * `rows`, delete synced rows missing from them inside `window`, and record
   * `syncedAt` as the last success. Otherwise write nothing: superseded.
   */
  apply(
    familyId: string,
    rows: FetchedBreak[],
    window: { from: string; to: string },
    expect: { region: string; group: string | null },
    syncedAt: string,
  ): Promise<{ superseded: boolean }>;
  /**
   * Merge last_error_at and last_error into the setting as it is now; nothing
   * if it is gone. `expect` is the choice the failed request was for: when
   * given, the error is recorded only while the family still holds it,
   * switched on -- a slow failure for an old region must not mark the new
   * one as failing. Null when the failure came before the setting was read.
   */
  recordError(familyId: string, at: string, message: string, expect: { region: string | null; group: string | null } | null): Promise<void>;
  /** Delete every synced row (switched off, or a new school region). Manual rows stay. */
  clear(familyId: string): Promise<void>;
  enabledFamilies(): Promise<{ familyId: string; setting: SchoolSyncSetting }[]>;
  /**
   * Families with a chosen public-holiday region and no sync setting at all:
   * the default, on, that nothing has saved yet (§5.4). The cron saves it for
   * the covered ones and syncs them.
   */
  unsetFamilies(): Promise<{ familyId: string; holidayRegion: string }[]>;
  /** Save `setting` only if the family has none; true when it was saved. A concurrent pick's row wins. */
  saveSettingIfAbsent(familyId: string, setting: SchoolSyncSetting): Promise<boolean>;
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

/** What a family sees for a failure that is not OpenHolidays' (a database error, a bug): the detail goes to the log. */
export const INTERNAL_SYNC_ERROR = "the school-holiday sync could not save the holidays";

export async function syncFamily(familyId: string, deps: SchoolSyncDeps): Promise<SyncOutcome> {
  if (!deps.installEnabled) return { status: "skipped", reason: "install-off" };
  const now = deps.now();
  // Outside the try, so a failure can say which choice it was for.
  let setting: SchoolSyncSetting | null = null;
  try {
    setting = await deps.store.setting(familyId);
    if (!setting?.enabled) return { status: "skipped", reason: "disabled" };
    const holidayRegion = await deps.store.holidayRegion(familyId);
    const country = holidayRegion?.code ? (resolveRegion(holidayRegion.code)?.country ?? null) : null;
    if (!country || !hasOpenHolidays(country)) return { status: "skipped", reason: "not-covered" };
    if (!setting.region || setting.pending === "region") return { status: "skipped", reason: "needs-region" };
    if (setting.pending === "group") return { status: "skipped", reason: "needs-group" };

    const today = familyDateKey(now, await deps.store.timeZone(familyId));
    const window = syncWindow(today);
    const choice: SchoolRegion = { country, region: setting.region, group: setting.group };
    const language = await deps.store.language(familyId);
    const rows = await fetchSchoolHolidays(choice, window, language, { fetch: deps.fetch, userAgent: deps.userAgent });
    // §5.2: a region does not lose every school holiday overnight. An empty
    // answer where the last run left future rows is the API misbehaving,
    // so the rows stay and it counts as a failure.
    if (rows.length === 0 && (await deps.store.futureSyncedCount(familyId, today)) > 0) {
      throw new SyncError("empty", "OpenHolidays returned no school holidays where it had some before");
    }
    // The request can take ten seconds. If the family switched off or picked
    // another region meanwhile, that change already cleared the synced rows;
    // writing this answer would bring them back. A cheap early look here;
    // the binding check is apply's, under the lock, in the same transaction
    // as the write and the success timestamp.
    if (!sameChoice(await deps.store.setting(familyId), setting)) return { status: "skipped", reason: "superseded" };
    const applied = await deps.store.apply(familyId, rows, window, { region: setting.region, group: setting.group }, now.toISOString());
    if (applied.superseded) return { status: "skipped", reason: "superseded" };
    return { status: "synced", rows: rows.length };
  } catch (err) {
    const detail = err instanceof SyncError ? err.message : `${INTERNAL_SYNC_ERROR} (${(err as Error)?.message ?? String(err)})`;
    deps.log(`[school-sync] family ${familyId}: ${detail}`);
    const message = err instanceof SyncError ? err.message : INTERNAL_SYNC_ERROR;
    try {
      const expect = setting ? { region: setting.region, group: setting.group } : null;
      await deps.store.recordError(familyId, now.toISOString(), message.slice(0, 500), expect);
    } catch (recordErr) {
      // The rows are as they were; failing to note why must not throw.
      deps.log(`[school-sync] family ${familyId}: could not record the error (${(recordErr as Error)?.message ?? String(recordErr)})`);
    }
    return { status: "failed", error: message };
  }
}
