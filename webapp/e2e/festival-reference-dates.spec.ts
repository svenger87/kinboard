import { expect, test } from "@playwright/test";
import reference from "./fixtures/festival-reference-dates.json";
import { activeFestival, festivalDates, orthodoxEaster, westernEaster, type FestivalId } from "../src/lib/festivals";

/**
 * RFC-020's dates for every year from 2026 to 2045, held against calendar
 * libraries that don't use ICU (scripts/festival-reference-dates.py, which
 * wrote the fixture), and the family's day in zones far from Berlin: half
 * and three-quarter hours, the southern summer, both ends of the date line,
 * a daylight-saving change inside a window. festivals.spec.ts has the rules;
 * this is whether the days and the moments land where the families are.
 */

const FIRST = 2026;
const LAST = 2045;
const years = Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i);
const ref = reference as unknown as Record<string, string[]>;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Each window's key day (the calendar date the festival is named for), every year, as the reference lists them. */
function keyDays(id: FestivalId, offset = 0): string[] {
  const days = years.flatMap((y) => festivalDates(id, y).map((w) => addDays(w.start, offset)));
  return [...new Set(days)].filter((d) => Number(d.slice(0, 4)) >= FIRST && Number(d.slice(0, 4)) <= LAST).sort();
}

test.describe("every year to 2045 against an independent calendar", () => {
  const cases: Array<[FestivalId, number, string]> = [
    // Tables in lib/festivals.ts: ICU's own calendars are a day out in some of these years.
    ["ramadan", 0, "Ramadan 1 (Umm al-Qura)"],
    ["eid-al-fitr", 0, "Shawwal 1 (Umm al-Qura)"],
    ["eid-al-adha", 0, "Dhu al-Hijjah 10 (Umm al-Qura)"],
    // The window opens on the eve.
    ["lunar-new-year", 1, "the first day of the first month"],
    ["dragon-boat", 0, "the fifth day of the fifth month"],
    ["mid-autumn", 0, "the fifteenth day of the eighth month"],
    // From the browser's `Intl` calendars.
    ["hanukkah", 0, "Kislev 25"],
    ["passover", 0, "Nisan 15"],
    ["sukkot", 0, "Tishri 15"],
    ["purim", 0, "Adar 14, Adar II 14 in a leap year"],
    ["nowruz", 1, "Farvardin 1"],
    ["yalda", 0, "Azar 30"],
  ];
  for (const [id, offset, what] of cases) {
    test(`${id}: ${what}`, () => {
      expect(ref[id]?.length, `${id} in the fixture`).toBeGreaterThanOrEqual(LAST - FIRST + 1);
      expect(keyDays(id, offset)).toEqual(ref[id]);
    });
  }

  test("Ramadan ends the day before Eid al-Fitr, every year", () => {
    const ends = years.flatMap((y) => festivalDates("ramadan", y).map((w) => addDays(w.end, 1)));
    for (const day of ends) if (day.slice(0, 4) <= String(LAST)) expect(ref["eid-al-fitr"], day).toContain(day);
  });

  test("Easter, Western and Orthodox", () => {
    expect(years.map(westernEaster)).toEqual(ref.easter);
    expect(years.map(orthodoxEaster)).toEqual(ref["orthodox-easter"]);
  });
});

test.describe("the family's day, wherever the family is", () => {
  const nye = (iso: string, zone: string) => activeFestival(new Date(iso), ["christmas", "new-years-eve"], zone);

  // Midnight on 1 January 2027 in each zone, in UTC.
  const midnights: Array<[string, string]> = [
    ["Asia/Kolkata", "2026-12-31T18:30:00Z"], // +5:30
    ["Asia/Kathmandu", "2026-12-31T18:15:00Z"], // +5:45
    ["Asia/Tehran", "2026-12-31T20:30:00Z"], // +3:30
    ["Australia/Sydney", "2026-12-31T13:00:00Z"], // +11, summer time
    ["Pacific/Auckland", "2026-12-31T11:00:00Z"], // +13, summer time
    ["Pacific/Kiritimati", "2026-12-31T10:00:00Z"], // +14, the first midnight anywhere
    ["Pacific/Pago_Pago", "2027-01-01T11:00:00Z"], // -11, among the last
    ["America/Sao_Paulo", "2027-01-01T03:00:00Z"], // -3, no summer time since 2019
    ["America/St_Johns", "2027-01-01T03:30:00Z"], // -3:30
  ];
  for (const [zone, midnight] of midnights) {
    test(`New Year's fireworks at midnight in ${zone}`, () => {
      const at = Date.parse(midnight);
      const iso = (ms: number) => new Date(at + ms).toISOString();
      // A second before: still the 31st, the first rocket a second away.
      expect(nye(iso(-1_000), zone)).toMatchObject({ id: "new-years-eve", day: "2026-12-31", visitorReady: true, visitorIn: 1_000 });
      // Six minutes before: not ready yet.
      expect(nye(iso(-6 * 60_000), zone)?.visitorReady).toBe(false);
      // On the stroke: the 1st, now.
      expect(nye(iso(0), zone)).toMatchObject({ id: "new-years-eve", day: "2027-01-01", visitorReady: true, visitorIn: 0 });
      // Half an hour after, Christmas is back.
      expect(nye(iso(30 * 60_000), zone)?.id).toBe("christmas");
    });
  }

  test("a day begins at the family's midnight in a half-hour zone", () => {
    // Diwali 2026's window opens on 6 November: 18:29 UTC on the 5th is 23:59 in Kolkata, 18:30 is midnight.
    expect(activeFestival(new Date("2026-11-05T18:29:00Z"), ["diwali"], "Asia/Kolkata")).toBeNull();
    expect(activeFestival(new Date("2026-11-05T18:30:00Z"), ["diwali"], "Asia/Kolkata")).toMatchObject({ day: "2026-11-06", minutes: 0 });
    // Nowruz 2027's eve, 20 March: 20:30 UTC on the 19th is midnight in Tehran.
    expect(activeFestival(new Date("2027-03-19T20:29:00Z"), ["nowruz"], "Asia/Tehran")).toBeNull();
    expect(activeFestival(new Date("2027-03-19T20:30:00Z"), ["nowruz"], "Asia/Tehran")).toMatchObject({ day: "2027-03-20" });
  });

  test("a window across a daylight-saving change starts and ends at local midnight", () => {
    // Easter 2026 in Berlin: Palm Sunday 29 March, the night the clocks go forward, to Easter Monday 6 April.
    const easter = (iso: string) => activeFestival(new Date(iso), ["easter"], "Europe/Berlin");
    expect(easter("2026-03-28T22:59:00Z")).toBeNull(); // 23:59 CET on the 28th
    expect(easter("2026-03-28T23:00:00Z")).toMatchObject({ day: "2026-03-29", minutes: 0 });
    expect(easter("2026-04-06T21:59:00Z")).toMatchObject({ day: "2026-04-06", minutes: 23 * 60 + 59 }); // 23:59 CEST
    expect(easter("2026-04-06T22:00:00Z")).toBeNull();
  });

  test("dusk is the family's: the weather's sunset in its zone", () => {
    // Ramadan 2027 in Jakarta (+7, no summer time), sunset 18:10: the lanterns at 11:10 UTC.
    const r = (iso: string) => activeFestival(new Date(iso), ["ramadan"], "Asia/Jakarta", { duskMinutes: 18 * 60 + 10 });
    expect(r("2027-03-01T11:09:00Z")?.afterDusk).toBe(false);
    expect(r("2027-03-01T11:10:00Z")?.afterDusk).toBe(true);
  });
});
