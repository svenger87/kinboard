import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SETTINGS_ENTRIES, type SettingsEntry } from "../src/lib/settings-search/registry";
import { normalize, searchSettings, toSearchable, type SearchableEntry } from "../src/lib/settings-search/search";

/**
 * Settings search: the registry every settings page and section is listed in,
 * and the ranking over it. Source and unit level — no stack, no browser. The
 * rendered flow is settings-search-ui.spec.ts.
 */

const LOCALES = ["en", "de", "fr"] as const;
type Locale = (typeof LOCALES)[number];
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(process.cwd(), "messages", `${l}.json`), "utf8"))]),
) as Record<Locale, Record<string, unknown>>;

/** The value at a full i18n path, or undefined. */
function lookup(locale: Locale, key: string): unknown {
  return key.split(".").reduce<unknown>(
    (o, part) => (o && typeof o === "object" ? (o as Record<string, unknown>)[part] : undefined),
    messages[locale],
  );
}
const translator = (locale: Locale) => (key: string) => {
  const v = lookup(locale, key);
  if (typeof v !== "string") throw new Error(`${locale}: no string at ${key}`);
  return v;
};
const searchable = (locale: Locale) => toSearchable(SETTINGS_ENTRIES, translator(locale));
const ids = (entries: SettingsEntry[]) => entries.map((e) => e.id);

test.describe("search", () => {
  test("normalize folds case, accents and ß", () => {
    expect(normalize("Straße Ä")).toBe("strasse a");
    expect(normalize("  TÜRKLINGEL\t Économiseur ")).toBe("turklingel economiseur");
  });

  test("'ferien' finds Holidays by its German synonym, in any case", () => {
    const items = searchable("de");
    for (const q of ["ferien", "Ferien", "FERIEN"]) {
      const result = ids(searchSettings(items, q));
      expect(result[0], q).toBe("holidays");
    }
  });

  test("'pin' puts the settings PIN first, in every language", () => {
    for (const locale of LOCALES) {
      expect(searchSettings(searchable(locale), "pin")[0]?.id, locale).toBe("index.pin");
    }
  });

  test("every word of a two-word query has to match", () => {
    const items = searchable("de");
    const one = ids(searchSettings(items, "kalender"));
    const two = ids(searchSettings(items, "kalender google"));
    expect(one.length).toBeGreaterThan(two.length);
    expect(two).toContain("google");
    for (const id of two) expect(one).toContain(id);
    expect(searchSettings(items, "kalender zzzz")).toEqual([]);
  });

  test("an empty or blank query finds nothing", () => {
    expect(searchSettings(searchable("en"), "")).toEqual([]);
    expect(searchSettings(searchable("en"), "   ")).toEqual([]);
  });

  test("on a tie a page comes before a section, then registry order", () => {
    const fake = (id: string, anchor?: string): SearchableEntry => ({
      entry: { ...SETTINGS_ENTRIES[0], id, anchor },
      label: "Alpha",
      description: "",
      keywords: [],
      sectionLabel: "",
    });
    const items = [fake("s1", "a"), fake("p1"), fake("s2", "b"), fake("p2")];
    expect(ids(searchSettings(items, "alpha"))).toEqual(["p1", "p2", "s1", "s2"]);
  });

  test("a label start outranks a keyword, which outranks a mention", () => {
    const fake = (id: string, label: string, keywords: string[], description = ""): SearchableEntry => ({
      entry: { ...SETTINGS_ENTRIES[0], id },
      label,
      description,
      keywords,
      sectionLabel: "",
    });
    const items = [
      fake("mention", "Other", [], "mentions weather"),
      fake("keyword", "Other", ["weather"]),
      fake("word", "Local weather", []),
      fake("start", "Weather", []),
    ];
    expect(ids(searchSettings(items, "weat"))).toEqual(["start", "word", "keyword", "mention"]);
  });

  test("the limit caps the list", () => {
    expect(searchSettings(searchable("en"), "e", 5)).toHaveLength(5);
    expect(searchSettings(searchable("en"), "e").length).toBeLessThanOrEqual(20);
  });
});

test.describe("registry", () => {
  test("ids are unique and anchors are unique per page", () => {
    const all = ids([...SETTINGS_ENTRIES]);
    expect(new Set(all).size).toBe(all.length);
    const anchors = SETTINGS_ENTRIES.filter((e) => e.anchor).map((e) => `${e.href}#${e.anchor}`);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const e of SETTINGS_ENTRIES) {
      if (e.anchor) expect(e.anchor, e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.id, e.id).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)?$/);
    }
  });

  test("only whole pages are menu items", () => {
    for (const e of SETTINGS_ENTRIES) if (e.menu) expect(e.anchor, e.id).toBeUndefined();
  });
});
