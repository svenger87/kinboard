import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * The screensaver's widgets, each drawn in a box it did not choose. Source
 * guard: one component per widget in the registry, list widgets clip through
 * ListBox, value widgets size through useFitToBox, a widget whose feature is
 * not set up shows its hint only in the designer, and the widgets read the
 * screensaver's data from the context rather than starting the hook again.
 */

const DIR = "src/components/layouts/saver-widgets";
const read = (p: string) => readFileSync(p, "utf8");

const FILES: Record<string, string> = {
  clock: "clock",
  date: "date",
  nextEvent: "next-event",
  weatherNow: "weather-now",
  forecast: "forecast",
  events: "events",
  birthdays: "birthdays",
  holidays: "holidays",
  news: "news",
  lessons: "lessons",
  energy: "energy",
  vehicles: "vehicles",
  photoCount: "photo-count",
};

const specKinds = (): Record<string, string> => {
  const src = read("src/lib/layouts/widgets.ts");
  const kinds: Record<string, string> = {};
  for (const m of src.matchAll(/^\s+(\w+): spec\("(list|value|fixed)"/gm)) kinds[m[1]] = m[2];
  return kinds;
};

test("the registry has exactly the keys of SAVER_WIDGETS", () => {
  const kinds = specKinds();
  expect(Object.keys(kinds).sort()).toEqual(Object.keys(FILES).sort());
  const index = read(`${DIR}/index.ts`);
  expect(index).toMatch(/export const SAVER_WIDGET_COMPONENTS: Record<SaverWidgetKey, /);
  const body = index.slice(index.indexOf("SAVER_WIDGET_COMPONENTS"));
  const keys = [...body.matchAll(/^\s+(\w+)(?::|,)/gm)].map((m) => m[1]);
  expect(keys.sort()).toEqual(Object.keys(kinds).sort());
});

test("one file per widget", () => {
  for (const file of Object.values(FILES)) expect(existsSync(`${DIR}/${file}.tsx`), file).toBe(true);
});

test("list widgets clip through ListBox, value widgets fit through useFitToBox", () => {
  for (const [key, kind] of Object.entries(specKinds())) {
    const src = read(`${DIR}/${FILES[key]}.tsx`);
    if (kind === "list") expect(src, key).toMatch(/import \{[^}]*\bListBox\b[^}]*\} from "@\/components\/layouts\/list-box"/);
    if (kind === "value") expect(src, key).toMatch(/import \{[^}]*\buseFitToBox\b[^}]*\} from "@\/hooks\/use-fit-to-box"/);
  }
});

test("a widget not set up shows its hint only while editing", () => {
  for (const key of ["weatherNow", "forecast", "energy", "vehicles", "photoCount"]) {
    const src = read(`${DIR}/${FILES[key]}.tsx`);
    expect(src, key).toMatch(new RegExp(`return editing \\? <NotSetUp[^>]*t\\("notSetUp\\.${key}"\\)[^>]*/> : null;`));
  }
  for (const locale of ["de", "en", "fr"]) {
    const layouts = JSON.parse(read(`messages/${locale}.json`)).components.layouts;
    for (const key of ["weatherNow", "forecast", "energy", "vehicles", "photoCount"]) {
      expect(layouts.notSetUp[key], `${locale} ${key}`).toBeTruthy();
    }
  }
});

test("widgets read the data from the context, never the hook", () => {
  for (const file of Object.values(FILES)) {
    const src = read(`${DIR}/${file}.tsx`);
    expect(src, file).not.toMatch(/useScreensaverData\(/);
  }
  const saver = read("src/components/screensaver.tsx");
  expect(saver).toMatch(/<ScreensaverDataProvider value=/);
});

test("the built-in screensaver and the widgets share their rows", () => {
  const saver = read("src/components/screensaver.tsx");
  for (const row of ["EventRow", "BirthdayRow", "NewsCard"]) {
    expect(saver, row).toMatch(new RegExp(`<${row}\\b`));
  }
  expect(read(`${DIR}/events.tsx`)).toMatch(/<EventRow\b/);
  expect(read(`${DIR}/holidays.tsx`)).toMatch(/<EventRow\b/);
  expect(read(`${DIR}/birthdays.tsx`)).toMatch(/<BirthdayRow\b/);
  expect(read(`${DIR}/news.tsx`)).toMatch(/<NewsCard\b/);
});

test("the '+n' line is translated", () => {
  const more = { de: "+{count} weitere", en: "+{count} more", fr: "+{count} de plus" } as const;
  for (const [locale, text] of Object.entries(more)) {
    expect(JSON.parse(read(`messages/${locale}.json`)).components.layouts.more).toBe(text);
  }
});
