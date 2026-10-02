import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_RANGE_DAYS,
  SchoolHolidayRowSchema,
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

/** RFC-014 §5.2–§5.3 against recorded responses (ODbL, see the fixture's README). */

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
  const breaks = await fetchSchoolHolidays(NI, WINDOW, "de", DEPS(f.fetch));
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].init.headers["User-Agent"]).toMatch(/^Kinboard\/\S+ \(\+https:\/\/github\.com\/svenger87\/kinboard\)$/);
  expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal);
  expect(breaks.length).toBe(rows("school-de-ni.json").length);
  expect(breaks.find((b) => b.startsOn === "2026-07-02")).toMatchObject({ name: "Sommerferien", endsOn: "2026-08-12" });
  expect(breaks.every((b) => /^[0-9a-f-]{36}$/.test(b.externalId))).toBe(true);
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
  const nl = [
    { code: "NL-MI", name: "midden", subdivisions: ["NL-UT-UT", "NL-GE-AR"] },
    { code: "NL-NO", name: "noord", subdivisions: ["NL-GE-AP"] },
    { code: "NL-ZU", name: "zuid", subdivisions: ["NL-LI-MA"] },
  ];
  expect(applicableGroups("NL-GE", nl).map((g) => g.code)).toEqual(["NL-MI", "NL-NO"]);
  expect(defaultGroup(applicableGroups("NL-GE", nl))).toBeNull();
  expect(defaultGroup(applicableGroups("NL-UT", nl))).toBe("NL-MI");
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
  ["over 1 MB", () => new Response("x".repeat(1_000_001), { status: 200, headers: { "content-type": "application/json" } }), "too-large"],
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
