"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys, useSetting } from "./use-supabase-queries";
import { useFamilyStore } from "@/stores/family-store";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { parseRegionSetting, type HolidayRegionSetting } from "@/lib/holidays/region";
import { schoolSyncKeys, type SchoolSyncResult } from "./use-school-holiday-sync";

export interface HolidayRegionState {
  /** The region to compute holidays for; null until someone picks one -- show none then. */
  region: string | null;
  setting: HolidayRegionSetting | null;
  isLoading: boolean;
  /** The setting could not be read (offline start, a failed request): the region is unknown, not unset. */
  isError: boolean;
}

/** The family's holiday region (RFC-014 §4.2). Nothing reads the UI locale to choose it. */
export function useHolidayRegion(): HolidayRegionState {
  const { data, isLoading, isError } = useSetting<unknown>(SETTINGS_KEYS.holidayRegion, null);
  const setting = parseRegionSetting(data);
  return { region: setting?.code ?? null, setting, isLoading, isError };
}

/**
 * Save the family's holiday region through PUT /api/holidays/region, the only
 * route a device can write it with. The route also reconciles the school-holiday
 * sync in the same request, so the sync status and the school holidays refetch too.
 */
export function useSaveHolidayRegion() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch("/api/holidays/region", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error("Failed to save the holiday region");
      // `outcome` is what the sync did with the pick (RFC-014 §5.4): the caller reports a failure or a deferred fetch.
      return (await res.json()) as { region: HolidayRegionSetting; outcome: SchoolSyncResult["outcome"] };
    },
    onSuccess: ({ region }) => {
      const familyId = family?.id ?? "";
      // Picking a region turns the sync on or replaces its rows (RFC-014 §5.4),
      // in the same request: refetch both. Not awaited -- the picker waits only
      // for its own row.
      queryClient.invalidateQueries({ queryKey: schoolSyncKeys.status(familyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.schoolHolidays(familyId) });
      // The response is the stored row: show it at once, so the picker never
      // falls back to the old region between the save and the refetch. The
      // refetch is returned, so the mutation stays pending (and the picker
      // disabled) until it lands.
      const queryKey = queryKeys.settings(family?.id ?? "", SETTINGS_KEYS.holidayRegion);
      queryClient.setQueryData(queryKey, region);
      return queryClient.invalidateQueries({ queryKey });
    },
  });
}
