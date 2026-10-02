import { createAdminClient } from "@/lib/supabase/server";
import { familyHolidayRegion } from "@/lib/family-time";
import { getFamilyLocale } from "@/lib/family-locale";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import type { FetchedBreak } from "./openholidays";
import { parseSyncSetting, type SchoolSyncSetting, type SchoolSyncStore } from "./sync";

/**
 * The sync's store, on the admin client. Every query names the family; the
 * only write to school_holidays is the apply_school_holiday_sync function
 * (migration_zzzzz_school_holiday_sync.sql), which cannot match a manual row.
 */
export function liveSchoolSyncStore(db: ReturnType<typeof createAdminClient> = createAdminClient()): SchoolSyncStore {
  // The generated types predate school_holidays.source and the function (Task 10, nit 7).
  const sb = db as any;
  const apply = async (familyId: string, rows: FetchedBreak[], window: { from: string; to: string }, replace: boolean) => {
    const { error } = await sb.rpc("apply_school_holiday_sync", {
      p_family_id: familyId,
      p_rows: rows.map((r) => ({ external_id: r.externalId, name: r.name, starts_on: r.startsOn, ends_on: r.endsOn })),
      p_window_from: window.from,
      p_window_to: window.to,
      p_replace: replace,
    });
    if (error) throw error;
  };
  return {
    holidayRegion: (familyId) => familyHolidayRegion(familyId, db),
    language: (familyId) => getFamilyLocale(familyId, db),
    async setting(familyId) {
      const { data, error } = await sb
        .from("settings")
        .select("value")
        .eq("family_id", familyId)
        .eq("key", SETTINGS_KEYS.schoolHolidaySync)
        .maybeSingle();
      if (error) throw error;
      return parseSyncSetting(data?.value);
    },
    async saveSetting(familyId, setting: SchoolSyncSetting) {
      const { error } = await sb
        .from("settings")
        .upsert({ family_id: familyId, key: SETTINGS_KEYS.schoolHolidaySync, value: setting }, { onConflict: "family_id,key" });
      if (error) throw error;
    },
    async deleteSetting(familyId) {
      const { error } = await sb.from("settings").delete().eq("family_id", familyId).eq("key", SETTINGS_KEYS.schoolHolidaySync);
      if (error) throw error;
    },
    async futureSyncedCount(familyId, today) {
      const { count, error } = await sb
        .from("school_holidays")
        .select("id", { head: true, count: "exact" })
        .eq("family_id", familyId)
        .eq("source", "openholidays")
        .gte("ends_on", today);
      if (error) throw error;
      return count ?? 0;
    },
    apply: (familyId, rows, window) => apply(familyId, rows, window, false),
    clear: (familyId) => apply(familyId, [], { from: "1970-01-01", to: "1970-01-01" }, true),
    async enabledFamilies() {
      const { data, error } = await sb.from("settings").select("family_id, value").eq("key", SETTINGS_KEYS.schoolHolidaySync);
      if (error) throw error;
      return ((data ?? []) as { family_id: string; value: unknown }[])
        .map((row) => ({ familyId: String(row.family_id), setting: parseSyncSetting(row.value) }))
        .filter((r): r is { familyId: string; setting: SchoolSyncSetting } => r.setting?.enabled === true);
    },
  };
}
