import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MENU_SECTIONS, SETTINGS_ENTRIES, isEntryVisible, type SettingsEntry } from "../src/lib/settings-search/registry";
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

  test("'ferien' finds the school holidays by their German synonym, in any case", () => {
    // "Ferien" is the school holidays, not public holidays ("Feiertage"), so
    // the first hit is the school-holiday list. Not the OpenHolidays sync
    // section: that one renders nothing when the install switches the sync
    // off or the region isn't covered (the US, the UK), so a family there
    // would land on a section that isn't on the page.
    const items = searchable("de");
    for (const q of ["ferien", "Ferien", "FERIEN"]) {
      const first = searchSettings(items, q)[0];
      expect(first?.href, q).toBe("/settings/holidays");
      expect(first?.anchor, q).toBe("school-holidays");
    }
    expect(ids(searchSettings(items, "feiertage"))[0]).toBe("holidays");
    // The sync section is still found by what it does.
    expect(searchSettings(items, "openholidays")[0]?.anchor).toBe("school-sync");
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

test.describe("the settings menu comes from the registry", () => {
  const indexSource = () => readFileSync(join(process.cwd(), "src/app/settings/page.tsx"), "utf8");

  test("the index no longer keeps its own list of menu items", () => {
    const src = indexSource();
    expect(src).not.toMatch(/const settingsSections\s*=\s*\[/);
    expect(src).toMatch(/import\s*\{[^}]*\bSETTINGS_ENTRIES\b[^}]*\}\s*from\s*"@\/lib\/settings-search\/registry"/);
  });

  test("the menu shows the same items, in the same groups and order, as before", () => {
    // Read from the inline `settingsSections` array the index had before it
    // moved to the registry (main at c1cfe4d). A page that
    // joins the menu later is added here on purpose, in the same change.
    const before: Record<string, string[]> = {
      sectionFamily: [
        "/settings/people",
        "/settings/devices",
        "/settings/catalogue",
        "/settings/schedule",
        "/settings/holidays",
        "/settings/recycle-bin",
        "/settings/task-log",
      ],
      sectionDisplay: [
        "/settings/widgets",
        "/settings/hints",
        "/settings/navigation",
        "/settings/theme",
        "/settings/screensaver",
        "/settings/weather",
        "/settings/notifications",
        "/settings/language",
        "/settings/news",
        "/settings/plugins",
      ],
      sectionIntegrations: [
        "/settings/calendar",
        "/settings/bring",
        "/settings/photos",
        "/settings/homeassistant",
        "/settings/integrations",
        "/settings/vehicles",
        "/settings/energy",
        "/settings/cameras",
        "/settings/stonks",
        "/settings/pocket-money",
        "/settings/media-players",
      ],
    };
    const after: Record<string, string[]> = {};
    for (const section of MENU_SECTIONS) {
      after[section] = SETTINGS_ENTRIES.filter((e) => e.menu && e.section === section).map((e) => e.href);
    }
    expect(after).toEqual(before);
  });

  test("a disabled plugin's page is hidden, and so are its sections", () => {
    const off = { pluginEnabled: (id: string) => id !== "cameras" };
    const hidden = SETTINGS_ENTRIES.filter((e) => !isEntryVisible(e, off)).map((e) => e.href);
    expect(hidden.length).toBeGreaterThan(0);
    for (const href of hidden) expect(href).toBe("/settings/cameras");
    expect(SETTINGS_ENTRIES.every((e) => isEntryVisible(e, { pluginEnabled: () => true }))).toBe(true);
  });
});

/*
  The guards: a settings page or a section heading added without a registry
  entry fails here, and so does an entry pointing at nothing.
*/
const SRC = join(process.cwd(), "src");
const read = (path: string) => readFileSync(path, "utf8");

function settingsPages(dir = join(SRC, "app/settings")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return settingsPages(path);
    return name === "page.tsx" ? [path] : [];
  });
}
const SETTINGS_COMPONENTS = join(SRC, "components/settings");
const settingsComponents = () =>
  readdirSync(SETTINGS_COMPONENTS).filter((f) => f.endsWith(".tsx")).map((f) => join(SETTINGS_COMPONENTS, f));

const hrefOf = (pageFile: string) =>
  "/" + pageFile.slice(join(SRC, "app").length + 1).replace(/\/?page\.tsx$/, "");
const pageFileOf = (href: string) => join(SRC, "app", href.slice(1), "page.tsx");

/**
 * Section components outside components/settings: a feature's own settings
 * card, named `*-settings.tsx` (components/pocket-money/rewards-settings.tsx).
 */
function featureSettingsComponents(dir = join(SRC, "components")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return path === SETTINGS_COMPONENTS ? [] : featureSettingsComponents(path);
    return name.endsWith("-settings.tsx") ? [path] : [];
  });
}

/** A page's own source plus every settings component it imports. */
function sourcesOf(pageFile: string): string[] {
  const src = read(pageFile);
  const imported = [
    ...src.matchAll(/from "@\/components\/(settings\/[\w-]+|[\w-]+\/[\w-]+-settings)"/g),
  ].map((m) => join(SRC, "components", `${m[1]}.tsx`));
  return [src, ...imported.filter(existsSync).map(read)];
}
const anchorsIn = (src: string) => [...src.matchAll(/data-setting="([^"]+)"/g)].map((m) => m[1]);

/** Old routes kept only to redirect to their replacement. */
const isRedirectOnly = (src: string) =>
  /export default function \w+\(\)\s*\{\s*redirect\(/.test(src);
/** Per-vehicle routes: the Vehicles page entry covers them. */
const NO_ENTRY = ["/settings/vehicles/[id]", "/settings/vehicles/new"];

test.describe("guards", () => {
  test("(a) every registry href is a settings page", () => {
    for (const e of SETTINGS_ENTRIES) {
      expect(existsSync(pageFileOf(e.href)), `${e.id}: ${e.href}`).toBe(true);
    }
  });

  test("(b) every anchor is on its page, and every anchor on a page is in the registry", () => {
    for (const e of SETTINGS_ENTRIES.filter((x) => x.anchor)) {
      const anchors = sourcesOf(pageFileOf(e.href)).flatMap(anchorsIn);
      expect(anchors, `${e.id}: no data-setting="${e.anchor}" on ${e.href} or its components/settings imports`).toContain(e.anchor);
    }
    for (const file of settingsPages()) {
      const href = hrefOf(file);
      const listed = SETTINGS_ENTRIES.filter((e) => e.href === href && e.anchor).map((e) => e.anchor);
      for (const anchor of new Set(sourcesOf(file).flatMap(anchorsIn))) {
        expect(listed, `${href}#${anchor} has data-setting but no registry entry`).toContain(anchor);
      }
    }
  });

  test("(c) every settings page has a page entry", () => {
    const pages = new Set(SETTINGS_ENTRIES.filter((e) => !e.anchor).map((e) => e.href));
    for (const file of settingsPages()) {
      const href = hrefOf(file);
      if (href === "/settings" || NO_ENTRY.includes(href) || isRedirectOnly(read(file))) continue;
      expect(pages.has(href), `${href} has no page entry in the registry`).toBe(true);
    }
  });

  /*
    Headings that are not settings sections, by file. Each is counted, so a new
    heading in one of these files still has to be a section or join the list.
  */
  const NOT_SECTIONS: Record<string, { count: number; why: string }> = {
    "app/settings/page.tsx": { count: 1, why: "the menu's group headings (one <h2> in the map)" },
    "app/settings/calendar/page.tsx": { count: 4, why: "link cards to Google, ICS, CalDAV and local calendars, each a page entry of its own" },
    "app/settings/catalogue/page.tsx": { count: 2, why: "one heading per room, from the family's data" },
    "app/settings/google/page.tsx": { count: 1, why: "the result of a person-mapping test" },
    "app/settings/homeassistant/page.tsx": { count: 3, why: "link cards to the Energy and Rooms pages, and the help box" },
    "app/settings/homeassistant/rooms/page.tsx": { count: 2, why: "one heading per room, and a one-off notice" },
    "app/settings/integrations/page.tsx": { count: 1, why: "the new token's secret, shown once after creating it" },
    "app/settings/news/page.tsx": { count: 1, why: "one heading per catalogue language" },
    "app/settings/notifications/page.tsx": { count: 1, why: "the help box" },
    "app/settings/photos/page.tsx": { count: 1, why: "the help box" },
    "app/settings/pocket-money/page.tsx": { count: 2, why: "one card per child's account, and that account's requests" },
    "components/pocket-money/rewards-settings.tsx": { count: 1, why: "the reward requests inbox, there only while one waits" },
    "app/settings/schedule/page.tsx": { count: 1, why: "the empty state shown before any child exists" },
    "app/settings/screensaver/page.tsx": { count: 1, why: "the help box" },
    "app/settings/theme/page.tsx": { count: 1, why: "a preview, not a setting" },
    "app/settings/weather/page.tsx": { count: 1, why: "a preview, not a setting" },
  };

  /*
    A heading is a section when the element that opens it carries
    `data-setting` — in practice within a few lines above it, which is how
    every section here is written. Counting headings against anchors per file
    was too loose: a card headed by a <p> made room for an unanchored <h2>.
  */
  const WRAPPER_REACH = 10;
  const uncoveredHeadings = (src: string) => {
    const lines = src.split("\n");
    return lines.flatMap((line, i) =>
      /<h[23]\b/.test(line) &&
      !lines.slice(Math.max(0, i - WRAPPER_REACH), i + 1).some((l) => l.includes("data-setting="))
        ? [`${i + 1}: ${line.trim()}`]
        : [],
    );
  };

  test("(d) every <h2>/<h3> in settings is a linkable section, or listed as not one", () => {
    for (const file of [...settingsPages(), ...settingsComponents(), ...featureSettingsComponents()]) {
      const rel = file.slice(SRC.length + 1);
      if (NO_ENTRY.some((href) => file === pageFileOf(href))) continue;
      const uncovered = uncoveredHeadings(read(file));
      const exempt = NOT_SECTIONS[rel]?.count ?? 0;
      expect(uncovered.length, `${rel}: headings outside a data-setting section:\n${uncovered.join("\n")}`).toBeLessThanOrEqual(exempt);
    }
  });

  test("(e) every label, description and keyword list exists in en, de and fr", () => {
    for (const locale of LOCALES) {
      for (const e of SETTINGS_ENTRIES) {
        for (const key of [e.labelKey, e.descriptionKey, e.pageLabelKey, e.keywordsKey]) {
          if (!key) continue;
          const v = lookup(locale, key);
          expect(typeof v, `${locale}: ${key} (${e.id})`).toBe("string");
          // Translated without arguments, so a placeholder would show raw.
          if (key !== e.descriptionKey) expect(v as string, `${locale}: ${key}`).not.toMatch(/[{}]/);
        }
        const words = (lookup(locale, e.keywordsKey) as string).split(",").map((w) => w.trim()).filter(Boolean);
        expect(words.length, `${locale}: ${e.keywordsKey} is empty`).toBeGreaterThan(0);
      }
      // No keyword list for an entry that no longer exists.
      const listed = Object.keys((messages[locale].settingsSearch as { keywords: Record<string, string> }).keywords);
      const wanted = SETTINGS_ENTRIES.map((e) => e.keywordsKey.replace("settingsSearch.keywords.", ""));
      expect(listed.sort(), locale).toEqual([...wanted].sort());
    }
  });
});
