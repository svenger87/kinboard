import type { Holiday } from "./types";

/** The `holidays` namespace translator: next-intl's `useTranslations("holidays")`, or a server one cast to this. */
export interface HolidayTranslator {
  (key: string): string;
  has(key: string): boolean;
}

/**
 * A holiday's name for display (RFC-014 §4.3): Kinboard's own translation
 * for curated countries, else the name date-holidays gave in the UI
 * language, falling back to English and then the native name. A real name
 * in another language beats a blank or a key.
 */
export function holidayLabel(holiday: Pick<Holiday, "nameKey" | "name">, t: HolidayTranslator): string {
  if (holiday.nameKey && t.has(holiday.nameKey)) return t(holiday.nameKey);
  return holiday.name ?? holiday.nameKey;
}
