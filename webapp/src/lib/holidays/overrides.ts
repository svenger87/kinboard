/**
 * Kinboard's deliberate differences from date-holidays (RFC-014 §4.5),
 * applied after the type mapping. An override never changes a date: a
 * wrong date is an upstream bug, reported there.
 */
export interface HolidayOverride {
  country: string;
  /** date-holidays' English name, as in curated.ts. */
  englishName: string;
  dayOff?: boolean | ((year: number) => boolean);
  /** Show it on the calendar even though its type would not be. */
  marked?: boolean;
  why: string;
}

export const OVERRIDES: readonly HolidayOverride[] = [
  {
    country: "NL",
    englishName: "Liberation Day",
    dayOff: (year) => year % 5 === 0,
    why: "A holiday every year, but most CAOs give it off only in a lustrum year (2025, 2030, …). date-holidays has it as `school` every year.",
  },
];

export function overrideFor(country: string, englishName: string): HolidayOverride | undefined {
  return OVERRIDES.find((o) => o.country === country && o.englishName === englishName);
}

/**
 * Countries where a public holiday does not mean no school (RFC-014 §6.3):
 * US districts set their own calendars, and many schools are open on
 * Columbus Day and Veterans Day.
 */
export const PUBLIC_HOLIDAYS_KEEP_SCHOOL_OPEN: readonly string[] = ["US"];
