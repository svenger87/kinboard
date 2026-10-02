"use client";

import { useSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { parseRegionSetting, type HolidayRegionSetting } from "@/lib/holidays/region";

export interface HolidayRegionState {
  /** The region to compute holidays for; null until someone picks one -- show none then. */
  region: string | null;
  setting: HolidayRegionSetting | null;
  isLoading: boolean;
}

/** The family's holiday region (RFC-014 §4.2). Nothing reads the UI locale to choose it. */
export function useHolidayRegion(): HolidayRegionState {
  const { data, isLoading } = useSetting<unknown>(SETTINGS_KEYS.holidayRegion, null);
  const setting = parseRegionSetting(data);
  return { region: setting?.code ?? null, setting, isLoading };
}
