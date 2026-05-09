import type { Holiday } from "./types";
import { getDeHolidays } from "./de";
import { getUsHolidays } from "./us";
import { getUkHolidays } from "./uk";
import { getNlHolidays } from "./nl";
import { getFrHolidays } from "./fr";
import { addDays } from "./utils";

export type CountryCode = "de" | "us" | "uk" | "nl" | "fr";
export const COUNTRIES: readonly CountryCode[] = ["de", "us", "uk", "nl", "fr"];
export const DEFAULT_COUNTRY: CountryCode = "de";

const PROVIDERS: Record<CountryCode, (year: number) => Holiday[]> = {
  de: getDeHolidays,
  us: getUsHolidays,
  uk: getUkHolidays,
  nl: getNlHolidays,
  fr: getFrHolidays,
};

export function getHolidays(country: CountryCode, year: number): Holiday[] {
  return PROVIDERS[country](year);
}

export function getUpcomingHolidays(country: CountryCode, daysAhead: number = 14): Holiday[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cutoff = addDays(today, daysAhead);
  const year = today.getFullYear();
  const holidays = [...getHolidays(country, year), ...getHolidays(country, year + 1)];
  return holidays
    .filter((h) => h.date >= today && h.date <= cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export type { Holiday } from "./types";
