import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OFFERED_COUNTRIES,
  countryForTimeZone,
  hasOpenHolidays,
  isOfferedRegion,
  parseRegionSetting,
  regionCode,
  resolveRegion,
  subdivisionsOf,
} from "../src/lib/holidays/region";

/**
 * RFC-014 §4.1/§4.3/§4.6: the bundled holiday data is exactly what the pinned
 * date-holidays generates, and the region model reads it.
 *
 * The generator is loaded with a dynamic import(), not a static one: Playwright
 * 1.59.1 loads this .ts file through its CommonJS require() hook, and that hook
 * force-transforms any nested .mjs it reaches to CommonJS while Node still
 * evaluates the file as a real ES module (the .mjs extension is unconditionally
 * ESM to Node) -- the transform's injected `exports.x = ...` then throws
 * "exports is not defined in ES module scope". A dynamic import() goes through
 * Node's native loader directly and is unaffected. Reproduced independently of
 * this repo's generator with a two-line .mjs using only `import.meta.url`.
 */
const generatorModule = import("../scripts/generate-holidays-data.mjs");

test("the committed holiday data is what the pinned date-holidays generates", async () => {
  const { buildHolidayData, DATA_DIR } = await generatorModule;
  const built = buildHolidayData();
  expect(readFileSync(join(DATA_DIR, "holidays.json"), "utf8")).toBe(built.holidaysJson);
  expect(readFileSync(join(DATA_DIR, "offered.json"), "utf8")).toBe(built.offeredJson);
  expect(readFileSync(join(DATA_DIR, "LICENSE"), "utf8")).toBe(built.license);
});

test("the data carries no build date, so regenerating it tomorrow changes nothing", async () => {
  const { DATA_DIR } = await generatorModule;
  const data = JSON.parse(readFileSync(join(DATA_DIR, "holidays.json"), "utf8"));
  expect(data.version).toBeUndefined();
  expect(Object.keys(data)).toEqual(expect.arrayContaining(["holidays", "names"]));
});

test("the 38 offered countries, and only those, are offered (RFC-014 §4.3)", async () => {
  const { OFFERED_COUNTRIES: GENERATOR_COUNTRIES } = await generatorModule;
  expect([...OFFERED_COUNTRIES]).toEqual([...GENERATOR_COUNTRIES].sort());
  expect(OFFERED_COUNTRIES).toHaveLength(38);
  for (const c of ["AT", "CH", "DE", "FR", "GB", "NL", "US"]) expect(OFFERED_COUNTRIES).toContain(c);
  // Data the subdivisions borrow (ES-CN reads IC) is bundled but not offered.
  expect(OFFERED_COUNTRIES).not.toContain("IC");
});

test("regions are state or canton level, with ISO codes", () => {
  expect(subdivisionsOf("DE")).toHaveLength(16);
  expect(subdivisionsOf("AT")).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  expect(subdivisionsOf("CH")).toHaveLength(26);
  expect(subdivisionsOf("GB")).toContain("SCT");
  // NL's date-holidays "states" change no day in 2026-2035: no state picker.
  expect(subdivisionsOf("NL")).toEqual([]);
  expect(resolveRegion("AT-9")).toEqual({ code: "AT-9", country: "AT", state: "9" });
  expect(resolveRegion("CH-ZH")).toEqual({ code: "CH-ZH", country: "CH", state: "ZH" });
  expect(resolveRegion("NL")).toEqual({ code: "NL", country: "NL", state: null });
  // Sub-regions are a documented gap, not offered.
  expect(resolveRegion("DE-BY-A")).toBeNull();
  expect(resolveRegion("DE-XX")).toBeNull();
  expect(resolveRegion("JP")).toBeNull();
  expect(regionCode("AT", "9")).toBe("AT-9");
  expect(regionCode("NL", null)).toBe("NL");
});

test("#319's five codes are accepted as aliases for what they meant", () => {
  expect(resolveRegion("de")?.code).toBe("DE-NI");
  expect(resolveRegion("uk")?.code).toBe("GB-ENG");
  expect(resolveRegion("us")?.code).toBe("US");
  expect(resolveRegion("nl")?.code).toBe("NL");
  expect(resolveRegion("fr")?.code).toBe("FR");
  expect(isOfferedRegion("de")).toBe(true);
  expect(isOfferedRegion(42)).toBe(false);
});

test("the setting is validated, and a bad code reads as no region", () => {
  expect(parseRegionSetting({ code: "DE-BY", chosen: true })).toEqual({ code: "DE-BY", chosen: true });
  expect(parseRegionSetting({ code: null, chosen: false })).toEqual({ code: null, chosen: false });
  expect(parseRegionSetting({ code: "XX-1", chosen: true })).toEqual({ code: null, chosen: false });
  expect(parseRegionSetting(null)).toBeNull();
  expect(parseRegionSetting("DE-NI")).toBeNull();
});

test("OpenHolidays covers every offered country except the two Kinboard listed by hand", () => {
  expect(hasOpenHolidays("DE")).toBe(true);
  expect(hasOpenHolidays("NL")).toBe(true);
  expect(hasOpenHolidays("GB")).toBe(false);
  expect(hasOpenHolidays("US")).toBe(false);
  expect(hasOpenHolidays("JP")).toBe(false);
  expect(OFFERED_COUNTRIES.filter(hasOpenHolidays)).toHaveLength(36);
});

test("a timezone suggests a country, never the language", () => {
  expect(countryForTimeZone("Europe/Vienna")).toBe("AT");
  expect(countryForTimeZone("Europe/Zurich")).toBe("CH");
  expect(countryForTimeZone("Europe/Berlin")).toBe("DE");
  expect(countryForTimeZone("Europe/London")).toBe("GB");
  expect(countryForTimeZone("America/Chicago")).toBe("US");
  expect(countryForTimeZone("Asia/Tokyo")).toBeNull();
  expect(countryForTimeZone(null)).toBeNull();
});
