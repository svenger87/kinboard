import { expect, test } from "@playwright/test";
import offered from "../src/lib/holidays/data/offered.json";
import { getHolidays, getObservances } from "../src/lib/holidays";
import {
  DIWALI,
  FATHERS_DAY,
  FESTIVALS,
  HOLI,
  MOTHERS_DAY,
  NATIONAL_DAY,
  activeFestival,
  commonFestivals,
  familyClock,
  festivalDates,
  firstAdvent,
  orthodoxChristmas,
  orthodoxEaster,
  parseClockTime,
  westernEaster,
  type FestivalId,
} from "../src/lib/festivals";
import {
  BUILT_FESTIVALS,
  DEFAULT_FESTIVAL_SETTINGS,
  FESTIVAL_KITS,
  chosenFestivals,
  currentFestival,
  festivalStage,
  normalizeFestivalSettings,
  parseFestivalPreview,
  parseFestivalPreviewStage,
  withFestivalOutfit,
} from "../src/lib/festival-settings";

/**
 * RFC-020's dates (§3.1, §3.3), the pre-tick table, the overlap rule (§2.4)
 * and the family's setting. Pure; no stack. The ✓ dates in §3.1 and §3.3 are
 * the ones checked against published calendars on 2026-11-01; the
 * per-country days are held against the region data here.
 */

const at = (iso: string) => new Date(iso);
/** A holiday's date (local midnight, as lib/holidays gives it) as `YYYY-MM-DD`. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const BERLIN = "Europe/Berlin";
const first = (id: FestivalId, year: number, country?: string | null) => festivalDates(id, year, country)[0];

test("Easter: Gregorian and Julian computus, Palm Sunday to Easter Monday", () => {
  expect(westernEaster(2026)).toBe("2026-04-05");
  expect(westernEaster(2027)).toBe("2027-03-28");
  expect(westernEaster(2028)).toBe("2028-04-16");
  expect(westernEaster(2038)).toBe("2038-04-25");
  expect(orthodoxEaster(2026)).toBe("2026-04-12");
  expect(orthodoxEaster(2027)).toBe("2027-05-02");
  expect(orthodoxEaster(2028)).toBe("2028-04-16"); // the same Sunday as the Western one
  expect(first("easter", 2026)).toEqual({ start: "2026-03-29", end: "2026-04-06" });
  expect(first("orthodox-easter", 2027)).toEqual({ start: "2027-04-25", end: "2027-05-03" });
  // Carnival: the week up to Shrove Tuesday, Easter - 47 days.
  expect(first("carnival", 2026)).toEqual({ start: "2026-02-11", end: "2026-02-17" });
  expect(first("carnival", 2027)).toEqual({ start: "2027-02-03", end: "2027-02-09" });
});

test("Christmas runs from the first of Advent to Epiphany, across the new year", () => {
  expect(firstAdvent(2026)).toBe("2026-11-29");
  expect(firstAdvent(2027)).toBe("2027-11-28");
  expect(firstAdvent(2028)).toBe("2028-12-03");
  expect(firstAdvent(2022)).toBe("2022-11-27");
  expect(first("christmas", 2026)).toEqual({ start: "2026-11-29", end: "2027-01-06" });
});

test("fixed days and weekday rules", () => {
  expect(first("st-martin", 2026)).toEqual({ start: "2026-11-11", end: "2026-11-11", visitorFrom: "dusk" });
  expect(first("st-nicholas", 2026)).toEqual({ start: "2026-12-05", end: "2026-12-06" });
  // New Year's Eve runs to half past midnight: the fireworks are at the family's midnight.
  expect(first("new-years-eve", 2026)).toEqual({ start: "2026-12-31", end: "2027-01-01", endsAt: 30, visitorFrom: "midnight" });
  expect(first("halloween", 2026)).toEqual({ start: "2026-10-24", end: "2026-10-31" });
  expect(first("dia-de-muertos", 2026)).toEqual({ start: "2026-10-31", end: "2026-11-02" });
  expect(first("st-patricks", 2027)).toEqual({ start: "2027-03-17", end: "2027-03-17" });
  expect(first("valentines", 2027)).toEqual({ start: "2027-02-14", end: "2027-02-14" });
  // Thanksgiving: the fourth Thursday of November and its weekend.
  expect(first("thanksgiving", 2026)).toEqual({ start: "2026-11-26", end: "2026-11-29" });
  expect(first("thanksgiving", 2027)).toEqual({ start: "2027-11-25", end: "2027-11-28" });
  // Midsummer: Sweden's eve is the Friday between 19 and 25 June; the Baltics' is the 23rd.
  expect(first("midsummer", 2026, "SE")).toEqual({ start: "2026-06-19", end: "2026-06-20" });
  expect(first("midsummer", 2027, "SE")).toEqual({ start: "2027-06-25", end: "2027-06-26" });
  expect(first("midsummer", 2026, "EE")).toEqual({ start: "2026-06-23", end: "2026-06-24" });
});

test("the Intl calendars give the checked dates (§3.1, §3.3)", () => {
  // Lunar New Year: month 1 day 1, from its eve to the Lantern Festival.
  expect(first("lunar-new-year", 2026)).toEqual({ start: "2026-02-16", end: "2026-03-03" });
  expect(first("lunar-new-year", 2027).start).toBe("2027-02-06");
  // Eid al-Fitr: Shawwal 1; Eid al-Adha: Dhu al-Hijjah 10.
  expect(first("eid-al-fitr", 2026)).toEqual({ start: "2026-03-20", end: "2026-03-22" });
  expect(first("eid-al-fitr", 2027).start).toBe("2027-03-09");
  expect(first("eid-al-adha", 2026)).toEqual({ start: "2026-05-27", end: "2026-05-30" });
  expect(first("eid-al-adha", 2027).start).toBe("2027-05-16");
  // Hanukkah: Kislev 25, eight days; Passover: Nisan 15, eight days.
  expect(first("hanukkah", 2026)).toEqual({ start: "2026-12-05", end: "2026-12-12" });
  expect(first("hanukkah", 2027).start).toBe("2027-12-25");
  expect(first("hanukkah", 2028).start).toBe("2028-12-13");
  expect(first("passover", 2026)).toEqual({ start: "2026-04-02", end: "2026-04-09" });
  expect(first("passover", 2027).start).toBe("2027-04-22");
  // Nowruz: Farvardin 1, with its eve.
  expect(first("nowruz", 2026)).toEqual({ start: "2026-03-20", end: "2026-03-24" });
});

test("an Islamic festival can fall twice in one Gregorian year", () => {
  // 2033: Eid al-Fitr early in January and again in late December.
  const twice = festivalDates("eid-al-fitr", 2033);
  expect(twice.length).toBe(2);
  expect(twice[0].start < "2033-01-15").toBe(true);
  expect(twice[1].start > "2033-12-15").toBe(true);
});

test("the Diwali table: the checked years, and always two years ahead of today", () => {
  expect(first("diwali", 2026)).toEqual({ start: "2026-11-06", end: "2026-11-10" });
  expect(DIWALI[2027]).toBe("2027-10-29");
  // Fails in time (RFC-020 §3.2): top the table up before this goes red.
  const last = Math.max(...Object.keys(DIWALI).map(Number));
  expect(last, "the Diwali table needs topping up").toBeGreaterThanOrEqual(new Date().getFullYear() + 2);
  for (const [year, day] of Object.entries(DIWALI)) {
    expect(day.startsWith(`${year}-1`), day).toBe(true); // October or November
  }
});

test("every festival has a window in every year from 2026 to 2036 (the tables, as far as they go)", () => {
  const tables: Partial<Record<FestivalId, Readonly<Record<number, string>>>> = { diwali: DIWALI, holi: HOLI };
  for (const id of FESTIVALS) {
    for (let year = 2026; year <= 2036; year++) {
      if (tables[id] && !tables[id]![year]) continue;
      const windows = festivalDates(id, year, "SE");
      expect(windows.length, `${id} ${year}`).toBeGreaterThan(0);
      for (const w of windows) expect(w.start <= w.end, `${id} ${year}`).toBe(true);
    }
  }
});

test("the family's day, in the family's zone", () => {
  // 23:30 in Berlin on 28 Nov is already the 29th: Advent has begun there, not in New York.
  const late = at("2026-11-28T23:30:00Z");
  expect(familyClock(late, BERLIN)).toEqual({ day: "2026-11-29", minutes: 30 });
  expect(activeFestival(late, ["christmas"], BERLIN)?.id).toBe("christmas");
  expect(activeFestival(late, ["christmas"], "America/New_York")).toBeNull();
  // Christmas is still on after New Year, from the window that began the year before.
  expect(activeFestival(at("2027-01-06T10:00:00Z"), ["christmas"], BERLIN)?.id).toBe("christmas");
  expect(activeFestival(at("2027-01-07T10:00:00Z"), ["christmas"], BERLIN)).toBeNull();
  expect(activeFestival(at("2026-11-28T10:00:00Z"), ["christmas"], BERLIN)).toBeNull();
});

test("St Martin's Day is on all day; its lantern walk waits for dusk (the weather's sunset, else 17:00)", () => {
  const chosen: FestivalId[] = ["st-martin"];
  const at11 = (iso: string, opts = {}) => activeFestival(at(iso), chosen, BERLIN, opts);
  // Midnight to midnight in Berlin: the wash and the dressing.
  expect(at11("2026-11-10T23:00:00Z")?.id).toBe("st-martin");
  expect(at11("2026-11-11T22:59:00Z")?.id).toBe("st-martin");
  expect(at11("2026-11-11T23:00:00Z")).toBeNull();
  // 15:59 UTC is 16:59 in Berlin: the walk waits for 17:00 ...
  expect(at11("2026-11-11T15:59:00Z")?.visitorReady).toBe(false);
  expect(at11("2026-11-11T16:00:00Z")?.visitorReady).toBe(true);
  // ... or for the weather's sunset, when a screen has it.
  expect(at11("2026-11-11T15:31:00Z", { duskMinutes: 16 * 60 + 30 })?.visitorReady).toBe(true);
  expect(at11("2026-11-11T15:29:00Z", { duskMinutes: 16 * 60 + 30 })?.visitorReady).toBe(false);
  // Festivals without a dusk rule fly all day.
  expect(activeFestival(at("2026-12-20T08:00:00Z"), ["christmas"], BERLIN)?.visitorReady).toBe(true);
  // The stage the screens key on.
  expect(festivalStage(at11("2026-11-11T09:00:00Z"))).toBe("day");
  expect(festivalStage(at11("2026-11-11T17:00:00Z"))).toBe("dusk");
  expect(parseClockTime("16:42")).toBe(16 * 60 + 42);
  expect(parseClockTime("4:42 PM")).toBe(16 * 60 + 42);
  expect(parseClockTime("12:05 AM")).toBe(5);
  expect(parseClockTime("")).toBeNull();
});

test("the shorter festival wins on its own days, and the longer comes back after", () => {
  const all: FestivalId[] = ["christmas", "st-nicholas", "hanukkah", "new-years-eve", "three-kings", "orthodox-christmas"];
  const on = (iso: string) => activeFestival(at(iso), all, BERLIN)?.id;
  expect(on("2026-12-04T10:00:00Z")).toBe("christmas");
  // 5-6 Dec: St Nicholas (2 days) over Hanukkah (8 days, from the 5th) and Advent.
  expect(on("2026-12-05T10:00:00Z")).toBe("st-nicholas");
  expect(on("2026-12-06T10:00:00Z")).toBe("st-nicholas");
  expect(on("2026-12-07T10:00:00Z")).toBe("hanukkah");
  expect(on("2026-12-13T10:00:00Z")).toBe("christmas");
  expect(on("2026-12-31T10:00:00Z")).toBe("new-years-eve");
  // Past the family's midnight, the fireworks' half hour; then Christmas again.
  expect(on("2026-12-31T23:20:00Z")).toBe("new-years-eve");
  expect(on("2026-12-31T23:30:00Z")).toBe("christmas");
  expect(on("2027-01-01T10:00:00Z")).toBe("christmas");
  // The Three Kings' parade and presents on 5-6 January, then Orthodox Christmas on the 7th.
  expect(on("2027-01-05T10:00:00Z")).toBe("three-kings");
  expect(on("2027-01-07T10:00:00Z")).toBe("orthodox-christmas");
  // Only what is chosen.
  expect(activeFestival(at("2026-12-05T10:00:00Z"), ["christmas"], BERLIN)?.id).toBe("christmas");
  expect(activeFestival(at("2026-12-05T10:00:00Z"), [], BERLIN)).toBeNull();
});

test("pre-ticked by country (§3.1), for every offered country", () => {
  const countries = Object.keys((offered as { countries: Record<string, unknown> }).countries);
  expect(countries.length).toBe(38);
  for (const cc of countries) {
    const common = commonFestivals(cc);
    expect(common, cc).toEqual(expect.arrayContaining(["christmas", "new-years-eve"]));
    // Exactly one Easter, the country's.
    expect(common.filter((id) => id === "easter" || id === "orthodox-easter").length, cc).toBe(1);
    // Never a religious or cultural festival a family has to choose.
    for (const id of ["lunar-new-year", "eid-al-fitr", "eid-al-adha", "hanukkah", "passover", "nowruz", "diwali", "valentines", "yalda", "ramadan", "purim", "holi", "dragon-boat", "mid-autumn", "sukkot", "mothers-day", "fathers-day"] as const) {
      expect(common, `${cc} ${id}`).not.toContain(id);
    }
  }
  expect(commonFestivals("DE")).toEqual(["christmas", "new-years-eve", "easter", "st-nicholas", "st-martin", "national-day"]);
  expect(commonFestivals("DE-NI")).toEqual(commonFestivals("DE"));
  expect(commonFestivals("RS")).toEqual(["christmas", "new-years-eve", "orthodox-easter", "orthodox-christmas", "national-day"]);
  expect(commonFestivals("US")).toEqual(["christmas", "new-years-eve", "easter", "halloween", "thanksgiving", "national-day"]);
  expect(commonFestivals("NL")).toEqual(["christmas", "new-years-eve", "easter", "st-nicholas", "st-martin", "kings-day"]);
  expect(commonFestivals("ES")).toContain("three-kings");
  expect(commonFestivals("MX")).toContain("three-kings");
  expect(commonFestivals("GB")).not.toContain("national-day");
  expect(commonFestivals("IE")).toContain("st-patricks");
  expect(commonFestivals("MX")).toContain("dia-de-muertos");
  expect(commonFestivals("BR")).toContain("carnival");
  expect(commonFestivals("SE")).toContain("midsummer");
  expect(commonFestivals("FR")).not.toContain("st-martin");
  // No region picked yet: what every offered country has.
  expect(commonFestivals(null)).toEqual(["christmas", "new-years-eve"]);
});

test("the setting: on by default with the country's festivals, and only drawn festivals can be on", () => {
  expect(normalizeFestivalSettings(undefined)).toEqual(DEFAULT_FESTIVAL_SETTINGS);
  expect(DEFAULT_FESTIVAL_SETTINGS).toEqual({ enabled: true, chosen: null });
  expect(normalizeFestivalSettings({ enabled: false, chosen: ["christmas", "lava", 3] })).toEqual({ enabled: false, chosen: ["christmas"] });
  expect(normalizeFestivalSettings("nonsense")).toEqual(DEFAULT_FESTIVAL_SETTINGS);
  expect(BUILT_FESTIVALS).toEqual(["christmas", "st-nicholas", "st-martin"]);
  expect(chosenFestivals(DEFAULT_FESTIVAL_SETTINGS, "DE")).toEqual(commonFestivals("DE").filter((id) => BUILT_FESTIVALS.includes(id)));
  expect(chosenFestivals(DEFAULT_FESTIVAL_SETTINGS, "DE")).toEqual(["christmas", "st-nicholas", "st-martin"]);
  expect(chosenFestivals(DEFAULT_FESTIVAL_SETTINGS, "FR")).toEqual(["christmas"]);
  expect(chosenFestivals({ enabled: false, chosen: null }, "DE")).toEqual([]);
  expect(chosenFestivals({ enabled: true, chosen: ["st-martin", "halloween"] }, "US")).toEqual(["st-martin"]);
  // New Year's Eve is pre-ticked but not drawn yet: it must not win 31 Dec over Christmas and show nothing.
  expect(currentFestival(at("2026-12-31T10:00:00Z"), DEFAULT_FESTIVAL_SETTINGS, "DE", BERLIN)?.id).toBe("christmas");
  // A festival pre-ticked but not drawn must not win its day and show nothing: Germany's
  // national day (when it's drawn, this moves to one that isn't).
  if (!BUILT_FESTIVALS.includes("national-day")) {
    expect(currentFestival(at("2026-10-03T10:00:00Z"), DEFAULT_FESTIVAL_SETTINGS, "DE", BERLIN)).toBeNull();
  }
  expect(currentFestival(at("2026-11-11T18:00:00Z"), DEFAULT_FESTIVAL_SETTINGS, "DE", BERLIN)?.id).toBe("st-martin");
  expect(currentFestival(at("2026-11-11T18:00:00Z"), DEFAULT_FESTIVAL_SETTINGS, "FR", BERLIN)).toBeNull();
});

test("St Nicholas's boot: empty on the eve, filled in the morning", () => {
  const eve = currentFestival(at("2026-12-05T18:00:00Z"), DEFAULT_FESTIVAL_SETTINGS, "DE", BERLIN);
  const day = currentFestival(at("2026-12-06T07:00:00Z"), DEFAULT_FESTIVAL_SETTINGS, "DE", BERLIN);
  expect(eve?.id).toBe("st-nicholas");
  expect(festivalStage(eve)).toBe("eve");
  expect(festivalStage(day)).toBe("day");
  expect(festivalStage(currentFestival(at("2026-12-10T07:00:00Z"), DEFAULT_FESTIVAL_SETTINGS, "DE", BERLIN))).toBeNull();
});

test("a preview names a drawn festival, and nothing else", () => {
  expect(parseFestivalPreview("christmas")).toBe("christmas");
  expect(parseFestivalPreview(" st-martin ")).toBe("st-martin");
  expect(parseFestivalPreview("new-years-eve")).toBeNull();
  expect(parseFestivalPreview("purim")).toBeNull();
  expect(parseFestivalPreview("<script>")).toBeNull();
  expect(parseFestivalPreview(null)).toBeNull();
});

test("the outfit is worn instead of the child's own, unless the child switched it off", () => {
  const look = { head: "cap", neck: "medal", body: "#6FCF97" };
  expect(withFestivalOutfit(look, "christmas")).toEqual({ ...look, head: "santa_hat" });
  expect(withFestivalOutfit(look, "st-nicholas")).toEqual({ ...look, neck: "scarf" });
  expect(withFestivalOutfit(look, "st-martin")).toBe(look);
  expect(withFestivalOutfit(look, null)).toBe(look);
  expect(withFestivalOutfit({ ...look, festive: "off" as const }, "christmas").head).toBe("cap");
  // The stored look is never changed.
  expect(look.head).toBe("cap");
  expect(FESTIVAL_KITS.christmas?.visitor?.archetype).toBe("fly");
  // A preview's stage: the kit's own preview stage, or one it names.
  expect(parseFestivalPreviewStage("st-nicholas", null)).toBe("day");
  expect(parseFestivalPreviewStage("st-nicholas", "eve")).toBe("eve");
  expect(parseFestivalPreviewStage("st-nicholas", "lava")).toBe("day");
  expect(parseFestivalPreviewStage("christmas", "eve")).toBeNull();
});

/* ---------------------------------------------------------------- §3.3's dates */

test("§3.3's checked dates: Ramadan, Purim (Adar II), Sukkot, Yalda, Mid-Autumn, Dragon Boat", () => {
  // Ramadan 1 to the day before Eid al-Fitr; its dusk is 18:00 without the weather.
  expect(first("ramadan", 2026)).toEqual({ start: "2026-02-18", end: "2026-03-19", duskFallback: 18 * 60 });
  expect(first("ramadan", 2027)).toEqual({ start: "2027-02-08", end: "2027-03-08", duskFallback: 18 * 60 });
  // 2030: Ramadan begins twice, in January and in late December.
  expect(festivalDates("ramadan", 2030).map((w) => w.start)).toEqual(["2030-01-05", "2030-12-26"]);
  expect(festivalDates("ramadan", 2030)[1].end).toBe("2031-01-23");
  // Purim: Adar 14, and Adar II 14 in a Hebrew leap year (2027).
  expect(first("purim", 2026)).toEqual({ start: "2026-03-03", end: "2026-03-03" });
  expect(first("purim", 2027)).toEqual({ start: "2027-03-23", end: "2027-03-23" });
  // Sukkot: Tishri 15, seven days.
  expect(first("sukkot", 2026)).toEqual({ start: "2026-09-26", end: "2026-10-02" });
  expect(first("sukkot", 2027).start).toBe("2027-10-16");
  // Yalda: Azar 30.
  expect(first("yalda", 2026)).toEqual({ start: "2026-12-21", end: "2026-12-21" });
  // The Chinese calendar's eighth month 15th and fifth month 5th (never a leap month).
  expect(first("mid-autumn", 2026).start).toBe("2026-09-25");
  expect(first("mid-autumn", 2027).start).toBe("2027-09-15");
  expect(first("dragon-boat", 2026).start).toBe("2026-06-19");
  expect(first("dragon-boat", 2027).start).toBe("2027-06-09");
  for (let y = 2026; y <= 2036; y++) {
    expect(festivalDates("mid-autumn", y).length, `mid-autumn ${y}`).toBe(1);
    expect(festivalDates("dragon-boat", y).length, `dragon-boat ${y}`).toBe(1);
    expect(festivalDates("purim", y).length, `purim ${y}`).toBe(1);
  }
});

test("fixed and Julian days: Three Kings, Orthodox Christmas", () => {
  expect(first("three-kings", 2027)).toEqual({ start: "2027-01-05", end: "2027-01-06" });
  expect(orthodoxChristmas(2027)).toBe("2027-01-07");
  expect(orthodoxChristmas(2100)).toBe("2100-01-07");
  expect(orthodoxChristmas(2101)).toBe("2101-01-08");
  // Where it's pre-ticked, the region data has Christmas Day on 7 January.
  for (const cc of ["RS", "MD", "BY"]) {
    expect(commonFestivals(cc), cc).toContain("orthodox-christmas");
    const days = [...getHolidays(cc, 2027, "en"), ...getObservances(cc, 2027, "en")].map((h) => ymd(h.date).slice(5));
    expect(days, cc).toContain("01-07");
  }
});

test("King's Day: 27 April, the 26th when the 27th is a Sunday, as the region data has it", () => {
  for (let y = 2025; y <= 2036; y++) {
    const ours = first("kings-day", y).start;
    const theirs = [...getHolidays("NL", y, "en")].find((h) => /king/i.test(h.name ?? h.nameKey));
    expect(theirs, `${y}`).toBeTruthy();
    expect(ours, `${y}`).toBe(ymd(theirs!.date));
  }
  expect(first("kings-day", 2025).start).toBe("2025-04-26");
});

test("the Holi table: the checked years, and always two years ahead of today", () => {
  expect(first("holi", 2026)).toEqual({ start: "2026-03-03", end: "2026-03-04" });
  expect(HOLI[2027]).toBe("2027-03-22");
  // Fails in time (RFC-020 §3.2, as for Diwali): top the table up before this goes red.
  const last = Math.max(...Object.keys(HOLI).map(Number));
  expect(last, "the Holi table needs topping up").toBeGreaterThanOrEqual(new Date().getFullYear() + 2);
  for (const [year, day] of Object.entries(HOLI)) {
    expect(day.startsWith(`${year}-0`), day).toBe(true);
    expect(day >= `${year}-02-25` && day <= `${year}-03-31`, day).toBe(true);
  }
});

const countries = Object.keys((offered as { countries: Record<string, unknown> }).countries);

test("each offered country's national day is in its region data (or has none, for a reason)", () => {
  // No national day of its own: Great Britain keeps none, Ireland's is St Patrick's, the Netherlands' King's Day.
  const none = ["GB", "IE", "NL"];
  expect([...Object.keys(NATIONAL_DAY), ...none].sort()).toEqual([...countries].sort());
  for (const [cc, day] of Object.entries(NATIONAL_DAY)) {
    // Liechtenstein's Staatsfeiertag isn't in the region data (its church holidays only).
    if (cc === "LI") continue;
    for (let y = 2026; y <= 2030; y++) {
      const marked = new Set([...getHolidays(cc, y, "en"), ...getObservances(cc, y, "en")].map((h) => ymd(h.date)));
      // On the day, or the day it moves to off a Sunday (Serbia's Statehood Day).
      const near = [0, 1, 2].map((d) => new Date(Date.parse(`${y}-${day}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10));
      expect(near.some((d) => marked.has(d)), `${cc} ${y}-${day}`).toBe(true);
    }
  }
  expect(first("national-day", 2026, "FR")).toEqual({ start: "2026-07-14", end: "2026-07-14", visitorFrom: "dusk" });
  // Mexico's Grito is the night before.
  expect(first("national-day", 2026, "MX")).toEqual({ start: "2026-09-15", end: "2026-09-16", visitorFrom: "dusk" });
  expect(festivalDates("national-day", 2026, "GB")).toEqual([]);
  expect(festivalDates("national-day", 2026, null)).toEqual([]);
});

test("Mother's and Father's Day by country, every offered country covered", () => {
  expect(Object.keys(MOTHERS_DAY).sort()).toEqual([...countries].sort());
  expect(Object.keys(FATHERS_DAY).sort()).toEqual([...countries].sort());
  // The US's, in its region data.
  for (let y = 2026; y <= 2030; y++) {
    const obs = getObservances("US", y, "en");
    const day = (re: RegExp) => obs.find((h) => re.test(h.name ?? h.nameKey))?.date;
    const day_ = (re: RegExp) => { const d = day(re); return d ? ymd(d) : undefined; };
    expect(first("mothers-day", y, "US").start, `${y}`).toBe(day_(/mother/i));
    expect(first("fathers-day", y, "US").start, `${y}`).toBe(day_(/father/i));
  }
  // Mothering Sunday: three weeks before Easter.
  expect(first("mothers-day", 2026, "GB").start).toBe("2026-03-15");
  // France: the last Sunday of May, a week later when that is Pentecost (2020).
  expect(first("mothers-day", 2026, "FR").start).toBe("2026-05-31");
  expect(first("mothers-day", 2020, "FR").start).toBe("2020-06-07");
  // Sweden: the last Sunday of May; Mexico: 10 May; Germany's Vatertag: Ascension Day.
  expect(first("mothers-day", 2026, "SE").start).toBe("2026-05-31");
  expect(first("mothers-day", 2026, "MX").start).toBe("2026-05-10");
  expect(first("fathers-day", 2026, "DE").start).toBe("2026-05-14");
  expect(first("fathers-day", 2026, "IT").start).toBe("2026-03-19");
  // None kept in Moldova and Serbia; no region: the commonest rules.
  expect(festivalDates("fathers-day", 2026, "RS")).toEqual([]);
  expect(first("mothers-day", 2026, null).start).toBe("2026-05-10");
  expect(first("fathers-day", 2026, null).start).toBe("2026-06-21");
  for (const cc of countries) {
    expect(commonFestivals(cc), cc).not.toContain("mothers-day");
    expect(commonFestivals(cc), cc).not.toContain("fathers-day");
  }
});

test("New Year's Eve: the visitor waits for the family's midnight, set up five minutes before it", () => {
  const nye = (iso: string) => activeFestival(at(iso), ["christmas", "new-years-eve"], BERLIN);
  // All day on the 31st: the wash and the confetti, no fireworks yet.
  expect(nye("2026-12-31T12:00:00Z")).toMatchObject({ id: "new-years-eve", visitorReady: false, visitorIn: 11 * 3_600_000 });
  expect(nye("2026-12-31T22:54:00Z")?.visitorReady).toBe(false);
  // 23:55:30 in Berlin: ready, the first rocket due in four and a half minutes.
  expect(nye("2026-12-31T22:55:30Z")).toMatchObject({ visitorReady: true, visitorIn: 270_000 });
  // After midnight: on the 1st, at once, for half an hour; the moment stays the same one.
  expect(nye("2026-12-31T23:00:00Z")).toMatchObject({ id: "new-years-eve", day: "2027-01-01", visitorReady: true, visitorIn: 0 });
  expect(nye("2026-12-31T23:12:30Z")?.visitorIn).toBe(-750_000);
  // Festivals without one have none.
  expect(activeFestival(at("2026-12-20T08:00:00Z"), ["christmas"], BERLIN)?.visitorIn).toBeNull();
  expect(nye("2026-12-31T23:29:00Z")?.id).toBe("new-years-eve");
  expect(nye("2026-12-31T23:30:00Z")?.id).toBe("christmas");
  // The family's midnight, not the display's: in New York it's still the afternoon.
  expect(activeFestival(at("2026-12-31T23:00:00Z"), ["new-years-eve"], "America/New_York")).toMatchObject({ day: "2026-12-31", visitorReady: false });
});

test("dusk for every day of a window, and Ramadan's evening from 18:00", () => {
  const r = (iso: string, opts = {}) => activeFestival(at(iso), ["ramadan"], BERLIN, opts);
  // 2027-03-01 is in Ramadan; Berlin is UTC+1.
  expect(r("2027-03-01T16:59:00Z")).toMatchObject({ id: "ramadan", afterDusk: false });
  expect(r("2027-03-01T17:00:00Z")?.afterDusk).toBe(true);
  expect(r("2027-03-01T16:30:00Z", { duskMinutes: 17 * 60 + 20 })?.afterDusk).toBe(true);
  // Where in the window today is.
  expect(r("2027-03-01T12:00:00Z")).toMatchObject({ start: "2027-02-08", dayIndex: 21, days: 29 });
});
