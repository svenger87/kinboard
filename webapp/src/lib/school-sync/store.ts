import { createAdminClient } from "@/lib/supabase/server";
import { familyHolidayRegion, familyTimeZone } from "@/lib/family-time";
import { familyContentLanguage, familyContentLanguages } from "@/lib/family-language";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import type { FetchedBreak } from "./openholidays";
import { parseSyncSetting, type SchoolSyncSetting, type SchoolSyncStore } from "./sync";

/**
 * The sync's store, on the admin client. Every query names the family; the
 * only write to school_holidays is the apply_school_holiday_sync function
 * (migration_zzzzz_school_holiday_sync.sql), which cannot match a manual row.
 * The sync's status goes through that function (success, with the rows) and
 * record_school_holiday_sync_error (failure): both merge into the setting
 * as it is, so neither can write back a switch flipped meanwhile.
 */
/** Rows per page when the cron lists families (PostgREST caps an answer at 1000). */
export const ENABLED_PAGE = 1000;

export function liveSchoolSyncStore(db: ReturnType<typeof createAdminClient> = createAdminClient()): SchoolSyncStore {
  // The generated types predate school_holidays.source and the function (Task 10, nit 7).
  const sb = db as any;
  const apply = async (
    familyId: string,
    rows: FetchedBreak[],
    window: { from: string; to: string },
    replace: boolean,
    expect: { region: string; group: string | null } | null,
    syncedAt: string | null,
    language: string | null,
  ): Promise<{ superseded: boolean }> => {
    const { data, error } = await sb.rpc("apply_school_holiday_sync", {
      p_family_id: familyId,
      p_rows: rows.map((r) => ({ external_id: r.externalId, name: r.name, starts_on: r.startsOn, ends_on: r.endsOn })),
      p_window_from: window.from,
      p_window_to: window.to,
      p_replace: replace,
      p_expect_region: expect?.region ?? null,
      p_expect_group: expect?.group ?? null,
      p_synced_at: syncedAt,
      p_language: language,
    });
    if (error) throw error;
    return { superseded: (data as { superseded?: unknown } | null)?.superseded === true };
  };
  return {
    holidayRegion: (familyId) => familyHolidayRegion(familyId, db),
    // The family's `locale`, else its region's language, else English
    // (familyContentLanguage): the language fetchSchoolBreaks names public
    // holidays in, so a schedule never mixes "Herbstferien" with
    // "Christmas Day". A database error throws: the sync records it rather
    // than fetching names in a language nobody chose.
    language: (familyId) => familyContentLanguage(familyId, db),
    // The same rule for the cron's whole list, in a query per 200 families.
    languages: (familyIds) => familyContentLanguages(familyIds, db),
    timeZone: (familyId) => familyTimeZone(familyId, db),
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
    apply: (familyId, rows, window, expect, syncedAt, language) => apply(familyId, rows, window, false, expect, syncedAt, language),
    async clear(familyId) {
      await apply(familyId, [], { from: "1970-01-01", to: "1970-01-01" }, true, null, null, null);
    },
    async recordError(familyId, at, message, expect) {
      const { error } = await sb.rpc("record_school_holiday_sync_error", {
        p_family_id: familyId,
        p_at: at,
        p_error: message,
        p_expect_region: expect?.region ?? null,
        p_expect_group: expect?.group ?? null,
      });
      if (error) throw error;
    },
    async saveSettingIfAbsent(familyId, setting: SchoolSyncSetting) {
      // ON CONFLICT DO NOTHING: a row a session route wrote meanwhile is the
      // family's own choice, and stays. The select returns only inserted rows.
      const { data, error } = await sb
        .from("settings")
        .upsert(
          { family_id: familyId, key: SETTINGS_KEYS.schoolHolidaySync, value: setting },
          { onConflict: "family_id,key", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async unsetFamilies() {
      const rows: { family_id: string; holiday_region: string | null }[] = [];
      for (let from = 0; ; from += ENABLED_PAGE) {
        const { data, error } = await sb.rpc("school_holiday_sync_unset_families").range(from, from + ENABLED_PAGE - 1);
        if (error) throw error;
        rows.push(...((data ?? []) as { family_id: string; holiday_region: string | null }[]));
        if ((data ?? []).length < ENABLED_PAGE) break;
      }
      return rows
        .filter((r) => typeof r.holiday_region === "string" && r.holiday_region.length > 0)
        .map((r) => ({ familyId: String(r.family_id), holidayRegion: r.holiday_region as string }));
    },
    async enabledFamilies() {
      // Switched-on rows only, in pages: PostgREST caps a select at 1000 rows.
      const rows: { family_id: string; value: unknown }[] = [];
      for (let from = 0; ; from += ENABLED_PAGE) {
        const { data, error } = await sb
          .from("settings")
          .select("family_id, value")
          .eq("key", SETTINGS_KEYS.schoolHolidaySync)
          .eq("value->>enabled", "true")
          .order("family_id")
          .range(from, from + ENABLED_PAGE - 1);
        if (error) throw error;
        rows.push(...((data ?? []) as { family_id: string; value: unknown }[]));
        if ((data ?? []).length < ENABLED_PAGE) break;
      }
      return rows
        .map((row) => ({ familyId: String(row.family_id), setting: parseSyncSetting(row.value) }))
        .filter((r): r is { familyId: string; setting: SchoolSyncSetting } => r.setting?.enabled === true);
    },
  };
}
