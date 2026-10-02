/**
 * The parts of date-holidays-parser Kinboard uses (RFC-014). The package
 * ships types/index.d.ts but no "types" field, so TypeScript cannot find it;
 * this ambient module stands in. Keep it to what src/lib/holidays calls.
 */
declare module "date-holidays-parser" {
  export type HolidayKind = "public" | "bank" | "school" | "optional" | "observance";

  export interface ParsedHoliday {
    /** Wall-calendar start, "YYYY-MM-DD hh:mm:ss". The only date Kinboard reads. */
    date: string;
    /** An instant in the parser's timezone. Never read (RFC-014 §4.1). */
    start: Date;
    end: Date;
    name: string;
    type: HolidayKind;
    rule: string;
    substitute?: boolean;
    note?: string;
  }

  export interface ParserOptions {
    languages?: string | string[];
    timezone?: string;
    types?: HolidayKind[];
  }

  export default class Holidays {
    constructor(data: object, opts?: ParserOptions);
    constructor(data: object, country: string, opts?: ParserOptions);
    constructor(data: object, country: string, state: string, opts?: ParserOptions);
    getHolidays(year?: number, lang?: string): ParsedHoliday[];
    getStates(country: string, lang?: string): Record<string, string> | undefined;
    getCountries(lang?: string): Record<string, string>;
    getTimezones(): string[];
    /** Undefined makes every date a local date, and keeps moment-timezone out of the path. */
    setTimezone(timezone?: string): void;
  }
}
