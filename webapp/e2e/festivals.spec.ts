import { expect, test } from "@playwright/test";
import offered from "../src/lib/holidays/data/offered.json";
import {
  DIWALI,
  FESTIVALS,
  activeFestival,
  commonFestivals,
  familyClock,
  festivalDates,
  firstAdvent,
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
  withFestivalOutfit,
} from "../src/lib/festival-settings";

/**
 * RFC-020's dates (§3.1), the pre-tick table, the overlap rule (§2.4) and the
 * family's setting. Pure; no stack. The ✓ dates in §3.1 and §3.3 are the
 * ones checked against published calendars on 2026-11-01.
 */

const at = (iso: string) => new Date(iso);
const BERLIN = "Europe/Berlin";
const first = (id: FestivalId, year: number, country?: string) => festivalDates(id, year, country)[0];

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
  expect(first("new-years-eve", 2026)).toEqual({ start: "2026-12-31", end: "2026-12-31" });
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

test("every festival has a window in every year from 2026 to 2036", () => {
  for (const id of FESTIVALS) {
    for (let year = 2026; year <= 2036; year++) {
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
  const all: FestivalId[] = ["christmas", "st-nicholas", "hanukkah", "new-years-eve"];
  const on = (iso: string) => activeFestival(at(iso), all, BERLIN)?.id;
  expect(on("2026-12-04T10:00:00Z")).toBe("christmas");
  // 5-6 Dec: St Nicholas (2 days) over Hanukkah (8 days, from the 5th) and Advent.
  expect(on("2026-12-05T10:00:00Z")).toBe("st-nicholas");
  expect(on("2026-12-06T10:00:00Z")).toBe("st-nicholas");
  expect(on("2026-12-07T10:00:00Z")).toBe("hanukkah");
  expect(on("2026-12-13T10:00:00Z")).toBe("christmas");
  expect(on("2026-12-31T10:00:00Z")).toBe("new-years-eve");
  expect(on("2027-01-01T10:00:00Z")).toBe("christmas");
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
    for (const id of ["lunar-new-year", "eid-al-fitr", "eid-al-adha", "hanukkah", "passover", "nowruz", "diwali", "valentines"] as const) {
      expect(common, `${cc} ${id}`).not.toContain(id);
    }
  }
  expect(commonFestivals("DE")).toEqual(["christmas", "new-years-eve", "easter", "st-nicholas", "st-martin"]);
  expect(commonFestivals("DE-NI")).toEqual(commonFestivals("DE"));
  expect(commonFestivals("RS")).toEqual(["christmas", "new-years-eve", "orthodox-easter"]);
  expect(commonFestivals("US")).toEqual(["christmas", "new-years-eve", "easter", "halloween", "thanksgiving"]);
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
  expect(chosenFestivals(DEFAULT_FESTIVAL_SETTINGS, "DE")).toEqual(["christmas", "st-nicholas", "st-martin"]);
  expect(chosenFestivals(DEFAULT_FESTIVAL_SETTINGS, "FR")).toEqual(["christmas"]);
  expect(chosenFestivals({ enabled: false, chosen: null }, "DE")).toEqual([]);
  expect(chosenFestivals({ enabled: true, chosen: ["st-martin", "halloween"] }, "US")).toEqual(["st-martin"]);
  // New Year's Eve is pre-ticked but not drawn yet: it must not win 31 Dec over Christmas and show nothing.
  expect(currentFestival(at("2026-12-31T10:00:00Z"), DEFAULT_FESTIVAL_SETTINGS, "DE", BERLIN)?.id).toBe("christmas");
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
  expect(parseFestivalPreview("halloween")).toBeNull();
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
  expect(FESTIVAL_KITS.christmas?.visitor).toBe("sleigh");
});
