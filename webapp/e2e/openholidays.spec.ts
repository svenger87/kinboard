import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_RANGE_DAYS,
  SchoolHolidayRowSchema,
  TIMEOUT_MS,
  SyncError,
  fetchSchoolHolidays,
  rowApplies,
  schoolHolidaysUrl,
  syncWindow,
  type SchoolHolidayRow,
  type SchoolRegion,
  type SyncFetch,
} from "../src/lib/school-sync/openholidays";
import {
  AT_OPENHOLIDAYS_CODES,
  applicableGroups,
  childrenReferenced,
  defaultGroup,
  defaultSchoolRegion,
  parseGroups,
  parseSubdivisions,
  topLevel,
} from "../src/lib/school-sync/school-region";

/**
 * RFC-014 §5.2–§5.3 against recorded responses (ODbL, see the fixture's README).
 *
 * The date assertions only catch a local-time parse when the process is off
 * UTC, and CI runs on UTC; "dates survive any timezone" therefore re-runs
 * them under explicit zones on either side of UTC.
 */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), "e2e/fixtures/openholidays", name), "utf8"));
const rows = (name: string): SchoolHolidayRow[] => (fixture(name) as unknown[]).map((r) => SchoolHolidayRowSchema.parse(r));
const kept = (name: string, choice: SchoolRegion) =>
  rows(name).filter((r) => rowApplies(r, choice)).map((r) => `${r.startDate} ${r.endDate}`);

/** A fake fetch that answers from a fixture and counts its calls. */
function fakeFetch(answer: () => Response): { fetch: SyncFetch; calls: { url: string; init: Parameters<SyncFetch>[1] }[] } {
  const calls: { url: string; init: Parameters<SyncFetch>[1] }[] = [];
  return { calls, fetch: async (url, init) => { calls.push({ url, init }); return answer(); } };
}
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8" }, ...init });
const DEPS = (fetch: SyncFetch) => ({ fetch, userAgent: "Kinboard/test (+https://github.com/svenger87/kinboard)" });
const WINDOW = syncWindow("2026-10-02");
const NI: SchoolRegion = { country: "DE", region: "DE-NI", group: null };

test("no request spans more than 1,095 days (the API's limit)", () => {
  expect(WINDOW).toEqual({ from: "2026-09-02", to: "2029-09-01" });
  const days = (Date.parse(WINDOW.to) - Date.parse(WINDOW.from)) / 86_400_000;
  expect(days).toBe(MAX_RANGE_DAYS);
  const url = new URL(schoolHolidaysUrl(NI, WINDOW, "de"));
  expect(url.origin + url.pathname).toBe("https://openholidaysapi.org/SchoolHolidays");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    countryIsoCode: "DE", subdivisionCode: "DE-NI", validFrom: "2026-09-02", validTo: "2029-09-01", languageIsoCode: "DE",
  });
});

test("one request, identified, with a timeout, sending only country, region and dates", async () => {
  const f = fakeFetch(() => json(fixture("school-de-ni.json")));
  // Record the duration every AbortSignal.timeout() is created with.
  const timeouts: number[] = [];
  const original = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => {
    timeouts.push(ms);
    return original.call(AbortSignal, ms);
  };
  let breaks;
  try {
    breaks = await fetchSchoolHolidays(NI, WINDOW, "de", DEPS(f.fetch));
  } finally {
    AbortSignal.timeout = original;
  }
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].init.headers["User-Agent"]).toMatch(/^Kinboard\/\S+ \(\+https:\/\/github\.com\/svenger87\/kinboard\)$/);
  expect(TIMEOUT_MS).toBe(10_000);
  expect(timeouts).toEqual([TIMEOUT_MS]);
  expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal);
  expect(f.calls[0].init.signal.aborted).toBe(false);
  expect(breaks.length).toBe(rows("school-de-ni.json").length);
  expect(breaks.find((b) => b.startsOn === "2026-07-02")).toMatchObject({ name: "Sommerferien", endsOn: "2026-08-12" });
  // The external id is the API's own, so a re-sync updates rather than duplicates.
  expect(breaks.map((b) => b.externalId)).toEqual(rows("school-de-ni.json").map((r) => r.id));
});

test("a break is named in the family's language, else in the first one given", async () => {
  const row = {
    id: "two-languages", startDate: "2026-10-12", endDate: "2026-10-23", type: "School", nationwide: true,
    name: [{ language: "EN", text: "Autumn holidays" }, { language: "DE", text: "Herbstferien" }],
  };
  const named = async (language: string) =>
    (await fetchSchoolHolidays(NI, WINDOW, language, DEPS(fakeFetch(() => json([row])).fetch)))[0].name;
  expect(await named("de")).toBe("Herbstferien");
  expect(await named("en")).toBe("Autumn holidays");
  expect(await named("fr")).toBe("Autumn holidays");
});

test("a row scoped to an ancestor of the family's region is kept; a lookalike code is not", () => {
  const base = { id: "a", startDate: "2026-10-10", endDate: "2026-10-25", type: "School", name: [{ language: "DE", text: "x" }], nationwide: false };
  const maloja: SchoolRegion = { country: "CH", region: "CH-GR-ML", group: null };
  expect(rowApplies({ ...base, subdivisions: [{ code: "CH-GR" }] }, maloja)).toBe(true);
  expect(rowApplies({ ...base, subdivisions: [{ code: "CH" }] }, maloja)).toBe(true);
  expect(rowApplies({ ...base, subdivisions: [{ code: "CH-G" }] }, maloja)).toBe(false);
  expect(rowApplies({ ...base, subdivisions: [{ code: "CH-GR-MS" }] }, maloja)).toBe(false);
  // A child of the family's region is not the region.
  expect(rowApplies({ ...base, subdivisions: [{ code: "CH-GR-ML-X" }] }, maloja)).toBe(false);
});

test("BackToSchool and EndOfLessons rows are never holidays", () => {
  const gr = rows("school-ch-gr.json");
  expect(gr.some((r) => r.type === "BackToSchool")).toBe(true);
  expect(gr.filter((r) => rowApplies(r, { country: "CH", region: "CH-GR-ML", group: "CH-GR-VS" })).every((r) => r.type === "School")).toBe(true);
  const fr = rows("school-fr-za.json");
  expect(fr.some((r) => r.type === "EndOfLessons")).toBe(true);
  expect(fr.filter((r) => rowApplies(r, { country: "FR", region: "FR-ZA", group: null })).every((r) => r.type === "School")).toBe(true);
});

test("Graubünden is scoped by Region: Maloja does not get Mesolcina's autumn break", () => {
  expect(kept("school-ch-gr.json", { country: "CH", region: "CH-GR-ML", group: "CH-GR-VS" })).toEqual([
    "2026-10-10 2026-10-25",
    "2026-12-23 2027-01-05",
  ]);
  expect(kept("school-ch-gr.json", { country: "CH", region: "CH-GR-MS", group: "CH-GR-VS" })).toEqual([
    "2026-10-31 2026-11-08",
    "2026-12-24 2027-01-06",
  ]);
});

test("groups: MV general schools and ZH Volksschule keep their own dates and the shared ones", () => {
  const mv = kept("school-de-mv.json", { country: "DE", region: "DE-MV", group: "DE-MV-ABS" });
  expect(mv).toContain("2026-07-13 2026-08-22");
  expect(mv).not.toContain("2026-07-13 2026-08-29"); // vocational schools
  expect(mv).toContain("2026-11-26 2026-11-26"); // both groups
  const zh = rows("school-ch-zh.json");
  const zhVs = zh.filter((r) => rowApplies(r, { country: "CH", region: "CH-ZH", group: "CH-ZH-VS" }));
  expect(zhVs.every((r) => !r.groups?.length || r.groups.some((g) => g.code === "CH-ZH-VS"))).toBe(true);
  expect(zhVs.some((r) => !r.groups?.length)).toBe(true); // Weihnachtsferien, for every school type
  expect(zhVs.length).toBeLessThan(zh.length);
});

test("Austria: nationwide rows are kept with the Land's own", () => {
  const wi = rows("school-at-wi.json");
  expect(wi.some((r) => r.nationwide)).toBe(true);
  expect(kept("school-at-wi.json", { country: "AT", region: "AT-WI", group: null })).toHaveLength(wi.length);
});

test("the Netherlands are scoped by region group, not by municipality", () => {
  const midden = kept("school-nl-ut-ut.json", { country: "NL", region: "NL-UT", group: "NL-MI" });
  expect(midden).toContain("2026-07-18 2026-08-30");
  expect(midden).not.toContain("2026-07-04 2026-08-16"); // noord
  // The Christmas row is for all three regions but lists only noord's municipalities.
  expect(midden.some((d) => d.startsWith("2026-12-19"))).toBe(true);
});

test("the AT map is OpenHolidays' own isoCode mapping", () => {
  const subs = parseSubdivisions(fixture("subdivisions-at.json"), "de");
  const iso = (fixture("subdivisions-at.json") as { code: string; isoCode: string }[]).map((s) => [s.isoCode, s.code]);
  expect(Object.entries(AT_OPENHOLIDAYS_CODES).sort()).toEqual(iso.sort());
  expect(subs.map((s) => s.code)).toContain("AT-WI");
});

test("a picked public-holiday region implies a school region where it can", () => {
  expect(defaultSchoolRegion("DE-NI")).toEqual({ country: "DE", region: "DE-NI", group: null, pending: null });
  expect(defaultSchoolRegion("DE-MV")).toEqual({ country: "DE", region: "DE-MV", group: "DE-MV-ABS", pending: null });
  expect(defaultSchoolRegion("AT-9")).toEqual({ country: "AT", region: "AT-WI", group: null, pending: null });
  expect(defaultSchoolRegion("CH-ZH")).toEqual({ country: "CH", region: "CH-ZH", group: "CH-ZH-VS", pending: null });
  expect(defaultSchoolRegion("CH-VD")).toEqual({ country: "CH", region: "CH-VD", group: null, pending: null });
  expect(defaultSchoolRegion("CH-GR")).toEqual({ country: "CH", region: "CH-GR", group: null, pending: "region" });
  // The Swiss lookup sets, as read from live data on 2026-10-02.
  for (const canton of ["CH-ZH", "CH-BE", "CH-SO", "CH-AR"]) {
    expect(defaultSchoolRegion(canton)).toEqual({ country: "CH", region: canton, group: `${canton}-VS`, pending: null });
  }
  expect(defaultSchoolRegion("CH-AI")).toEqual({ country: "CH", region: "CH-AI", group: null, pending: "region" });
  expect(defaultSchoolRegion("NL")).toEqual({ country: "NL", region: null, group: null, pending: "region" });
  expect(defaultSchoolRegion("DE")).toEqual({ country: "DE", region: null, group: null, pending: "region" });
  expect(defaultSchoolRegion("GB-ENG")).toBeNull();
  expect(defaultSchoolRegion("US-CA")).toBeNull();
});

test("children are offered only where rows are scoped below the subdivision", () => {
  expect(childrenReferenced("CH-GR", rows("school-ch-gr.json"))).toEqual(expect.arrayContaining(["CH-GR-ML", "CH-GR-MS"]));
  expect(childrenReferenced("CH-ZH", rows("school-ch-zh.json"))).toEqual([]);
  expect(childrenReferenced("NL-UT", rows("school-nl-ut-ut.json"))).toEqual([]);
  expect(childrenReferenced("DE-MV", rows("school-de-mv.json"))).toEqual([]);
});

test("groups apply to their subdivisions, their ancestors and their descendants", () => {
  const de = parseGroups(fixture("groups-de.json"), "de");
  expect(applicableGroups("DE-MV", de).map((g) => g.code).sort()).toEqual(["DE-MV-ABS", "DE-MV-BBS"]);
  expect(applicableGroups("DE-NI", de)).toEqual([]);
  expect(defaultGroup(applicableGroups("DE-MV", de))).toBe("DE-MV-ABS");
  // NL, from the recorded /Groups: Utrecht is mostly midden, but Eemnes is
  // noord, so a Utrecht family picks; Limburg is wholly zuid, Drenthe noord.
  const nl = parseGroups(fixture("groups-nl.json"), "nl");
  const nlCodes = (region: string) => applicableGroups(region, nl).map((g) => g.code).sort();
  expect(nlCodes("NL-UT")).toEqual(["NL-MI", "NL-NO"]);
  expect(defaultGroup(applicableGroups("NL-UT", nl))).toBeNull();
  expect(nlCodes("NL-GE")).toEqual(["NL-MI", "NL-NO", "NL-ZU"]);
  expect(defaultGroup(applicableGroups("NL-GE", nl))).toBeNull();
  expect(nlCodes("NL-LI")).toEqual(["NL-ZU"]);
  expect(defaultGroup(applicableGroups("NL-LI", nl))).toBe("NL-ZU");
  expect(defaultGroup(applicableGroups("NL-DR", nl))).toBe("NL-NO");
  expect(topLevel("CH-GR-ML")).toBe("CH-GR");
  expect(topLevel("AT-WI")).toBe("AT-WI");
});

for (const [label, answer, kind] of [
  ["a 5xx", () => new Response("oops", { status: 503 }), "http"],
  ["a 4xx", () => new Response("{}", { status: 400, headers: { "content-type": "application/problem+json" } }), "http"],
  ["HTML", () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }), "content-type"],
  ["invalid JSON", () => new Response("[{", { status: 200, headers: { "content-type": "application/json" } }), "json"],
  ["a schema mismatch", () => json([{ id: 1, startDate: "soon" }]), "schema"],
  ["a reversed range", () => json([{ id: "x", startDate: "2026-10-10", endDate: "2026-10-01", type: "School", name: [{ language: "DE", text: "x" }], nationwide: true }]), "schema"],
  ["an impossible date", () => json([{ id: "x", startDate: "2026-02-30", endDate: "2026-03-02", type: "School", name: [{ language: "DE", text: "x" }], nationwide: true }]), "schema"],
  ["a month that does not exist", () => json([{ id: "x", startDate: "2026-12-30", endDate: "2026-13-01", type: "School", name: [{ language: "DE", text: "x" }], nationwide: true }]), "schema"],
  ["a duplicate id", () => json([
    { id: "same", startDate: "2026-10-10", endDate: "2026-10-12", type: "School", name: [{ language: "DE", text: "x" }], nationwide: true },
    { id: "same", startDate: "2026-12-23", endDate: "2027-01-05", type: "School", name: [{ language: "DE", text: "y" }], nationwide: true },
  ]), "schema"],
  ["over 1 MB", () => new Response("x".repeat(1_000_001), { status: 200, headers: { "content-type": "application/json" } }), "too-large"],
  ["a declared length over 1 MB", () => new Response("[]", { status: 200, headers: { "content-type": "application/json", "content-length": "2000000" } }), "too-large"],
] as const) {
  test(`${label} is an error, before anything could be written`, async () => {
    const f = fakeFetch(answer as () => Response);
    const err = await fetchSchoolHolidays(NI, WINDOW, "de", DEPS(f.fetch)).catch((e) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect((err as SyncError).kind).toBe(kind);
  });
}

test("a network failure and a timeout are errors with their own kinds", async () => {
  const down = await fetchSchoolHolidays(NI, WINDOW, "de", DEPS(async () => { throw new TypeError("fetch failed"); })).catch((e) => e);
  expect((down as SyncError).kind).toBe("network");
  const slow = await fetchSchoolHolidays(NI, WINDOW, "de", DEPS(async () => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  })).catch((e) => e);
  expect((slow as SyncError).kind).toBe("timeout");
});

test("a leap day is a date; the 29th of February in a common year is not", () => {
  const row = (startDate: string) => ({ id: "x", startDate, endDate: startDate, type: "School", name: [{ language: "DE", text: "x" }], nationwide: true });
  expect(SchoolHolidayRowSchema.safeParse(row("2028-02-29")).success).toBe(true);
  expect(SchoolHolidayRowSchema.safeParse(row("2027-02-29")).success).toBe(false);
});

/**
 * The request shapes the sync sends that differ from the ones first
 * recorded, each checked live once on 2026-10-02 (README):
 * - NL-UT (the family's province) answered byte-for-byte what NL-UT-UT did,
 *   so school-nl-ut-ut.json stands for both and is filtered by group;
 * - CH-GR-ML (a Graubünden Region) answered only Maloja's rows;
 * - AT-KÄ, percent-encoded, answered 200 with Kärnten's rows.
 */
test("the shapes the sync sends: a Graubünden Region, an Austrian Land with an umlaut", () => {
  const ml: SchoolRegion = { country: "CH", region: "CH-GR-ML", group: "CH-GR-VS" };
  expect(kept("school-ch-gr-ml.json", ml)).toEqual(["2026-10-10 2026-10-25", "2026-12-23 2027-01-05"]);
  // The same answer as filtering the canton-wide query for Maloja.
  expect(kept("school-ch-gr-ml.json", ml)).toEqual(kept("school-ch-gr.json", ml));

  const ka = defaultSchoolRegion("AT-2");
  expect(ka).toEqual({ country: "AT", region: "AT-KÄ", group: null, pending: null });
  const url = schoolHolidaysUrl(ka!, { from: "2026-08-01", to: "2027-07-31" }, "de");
  expect(url).toContain("subdivisionCode=AT-K%C3%84");
  expect(new URL(url).searchParams.get("subdivisionCode")).toBe("AT-KÄ");
  const kaRows = rows("school-at-ka.json");
  expect(kaRows.length).toBeGreaterThan(0);
  const kaKept = kept("school-at-ka.json", ka!);
  expect(kaKept).toHaveLength(kaRows.length);
  expect(kaKept).toContain("2027-02-08 2027-02-13"); // Semesterferien, Kärnten's own
  expect(kaKept).toContain("2026-10-27 2026-10-31"); // Herbstferien, nationwide

  const utrecht = kept("school-nl-ut-ut.json", { country: "NL", region: "NL-UT", group: "NL-NO" });
  expect(utrecht).toContain("2026-07-04 2026-08-16");
  expect(utrecht).not.toContain("2026-07-18 2026-08-30"); // midden
});

for (const [zone, januaryOffset] of [["Pacific/Auckland", -780], ["America/Los_Angeles", 480]] as const) {
  test(`dates survive the ${zone} timezone`, async () => {
    const before = process.env.TZ;
    process.env.TZ = zone;
    try {
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(januaryOffset); // the zone took effect
      expect(syncWindow("2026-10-02")).toEqual({ from: "2026-09-02", to: "2029-09-01" });
      const breaks = await fetchSchoolHolidays(NI, WINDOW, "de", DEPS(fakeFetch(() => json(fixture("school-de-ni.json"))).fetch));
      expect(breaks.map((b) => `${b.startsOn} ${b.endsOn}`)).toEqual(rows("school-de-ni.json").map((r) => `${r.startDate} ${r.endDate}`));
      expect(breaks.find((b) => b.startsOn === "2026-07-02")).toMatchObject({ endsOn: "2026-08-12" });
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
}
