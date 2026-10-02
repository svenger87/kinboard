"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { queryKeys, useSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { parseRegionSetting } from "@/lib/holidays/region";
import type { SchoolSyncSetting, SyncOutcome } from "@/lib/school-sync/sync";
import type { RegionOptions } from "@/lib/school-sync/reconcile";

export interface SchoolSyncStatus {
  installEnabled: boolean;
  covered: boolean;
  chosen: boolean;
  setting: SchoolSyncSetting | null;
}

export interface SchoolSyncResult {
  setting: SchoolSyncSetting | null;
  outcome: SyncOutcome | { status: "rate-limited"; retryAfterMs: number } | null;
}

export const schoolSyncKeys = {
  status: (familyId: string) => ["school-holiday-sync", familyId] as const,
  options: (familyId: string, country: string | null, subdivision: string | null) =>
    ["school-region-options", familyId, country, subdivision] as const,
};

/** The sync as the card shows it (RFC-014 §5.4). */
export function useSchoolHolidaySync() {
  const { family } = useFamilyStore();
  return useQuery<SchoolSyncStatus>({
    queryKey: schoolSyncKeys.status(family?.id ?? ""),
    enabled: !!family?.id,
    queryFn: async () => {
      const res = await fetch("/api/school-holidays/sync");
      if (!res.ok) throw new Error("failed to load the school-holiday sync");
      return res.json();
    },
  });
}

/** The switch, a school region or group, or Refresh now (`{}`). */
export function useUpdateSchoolHolidaySync() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (body: { enabled?: boolean; region?: string; group?: string }): Promise<SchoolSyncResult> => {
      const res = await fetch("/api/school-holidays/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("failed to change the school-holiday sync");
      return res.json();
    },
    onSettled: () => {
      const familyId = family?.id ?? "";
      queryClient.invalidateQueries({ queryKey: schoolSyncKeys.status(familyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.schoolHolidays(familyId) });
    },
  });
}

/** The school regions and groups to offer; the server caches OpenHolidays' answer for a day. */
export function useSchoolRegionOptions(subdivision: string | null, enabled: boolean) {
  const { family } = useFamilyStore();
  // The server answers for the family's country, so the country is part of
  // the key: without it, the top-level list cached for Germany (subdivision
  // null) was served again after switching to the Netherlands.
  const { data: region } = useSetting<unknown>(SETTINGS_KEYS.holidayRegion, null);
  const country = parseRegionSetting(region)?.code?.split("-")[0] ?? null;
  return useQuery<RegionOptions>({
    queryKey: schoolSyncKeys.options(family?.id ?? "", country, subdivision),
    enabled: enabled && !!family?.id && country !== null,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const qs = subdivision ? `?subdivision=${encodeURIComponent(subdivision)}` : "";
      const res = await fetch(`/api/school-holidays/options${qs}`);
      if (!res.ok) throw new Error("failed to load school regions");
      return res.json();
    },
  });
}
