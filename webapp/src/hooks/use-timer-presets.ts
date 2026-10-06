"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys, requireFamilyId, useSetting } from "./use-supabase-queries";
import { useFamilyStore } from "@/stores/family-store";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { isDefaultTimerPresets, timerPresets } from "@/lib/timer-presets";

export interface TimerPresetsState {
  /**
   * The widget's buttons, in whole minutes, smallest first. The defaults
   * until the setting has been read, and if the read fails: the presets are
   * the only way a screen starts a timer, so the widget never goes without.
   */
  presets: number[];
  /** They differ from 3, 5, 10 and 15. */
  custom: boolean;
  /** Not read yet. The editor waits for it; the widget shows `presets` regardless. */
  isLoading: boolean;
}

/** The family's timer presets (Settings → Widgets → Timers). */
export function useTimerPresets(): TimerPresetsState {
  const { data, isLoading } = useSetting<unknown>(SETTINGS_KEYS.timerWidget, null);
  const presets = timerPresets(data);
  return { presets, custom: !isDefaultTimerPresets(presets), isLoading };
}

/**
 * Save the family's presets, or `null` for the defaults, which deletes the
 * setting. Every change sends the whole list, so the next tap must start from
 * this one's result: the saved list is shown at once and the refetch is
 * returned, which keeps the mutation pending (and the editor disabled) until
 * it lands, as useSaveHolidayRegion does.
 */
export function useSaveTimerPresets() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (presets: number[] | null) => {
      const familyId = requireFamilyId(family);
      const res = await fetch("/api/settings", {
        method: presets ? "PUT" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          presets
            ? { family_id: familyId, key: SETTINGS_KEYS.timerWidget, value: { presets } }
            : { family_id: familyId, key: SETTINGS_KEYS.timerWidget },
        ),
      });
      if (!res.ok) throw new Error("Failed to save the timer presets");
      return presets;
    },
    onSuccess: (presets) => {
      const queryKey = queryKeys.settings(family?.id ?? "", SETTINGS_KEYS.timerWidget);
      queryClient.setQueryData(queryKey, presets ? { presets } : null);
      return queryClient.invalidateQueries({ queryKey });
    },
  });
}
