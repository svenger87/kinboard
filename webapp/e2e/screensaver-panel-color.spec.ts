import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SCREENSAVER_SETTINGS,
  SCREENSAVER_PANEL_ACCENT_RGB,
  SCREENSAVER_PANEL_AMBER_RGB,
  SCREENSAVER_PANEL_COLORS,
  SCREENSAVER_PANEL_RGB,
  SCREENSAVER_PANEL_TEXT_RGB,
  screensaverPanelColor,
  screensaverPanelTextColor,
} from "../src/types/screensaver";

/**
 * Settings -> Screensaver -> Panel colour / Panel text colour: the
 * screensaver's panels (weather, events, news, energy, a
 * designed layout's boxes) take one colour, and the writing on them
 * another. The screensaver root publishes both as CSS variables —
 * --screensaver-panel-rgb for the fill (with the Panel opacity setting)
 * and --screensaver-panel-fg-rgb for the writing, which the panels'
 * .panel-fg* classes read at every strength. Until the family picks a
 * writing colour, it derives from the panel colour: white on the dark
 * panels, black on the light ones.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("the panel colours are the five offered, darkest to lightest, and unset means black", () => {
  expect(SCREENSAVER_PANEL_COLORS).toEqual(["black", "graphite", "grey", "silver", "white"]);
  expect(DEFAULT_SCREENSAVER_SETTINGS.panelColor).toBe("black");
  expect(screensaverPanelColor(undefined)).toBe("black");
  expect(screensaverPanelColor(null)).toBe("black");
  expect(screensaverPanelColor("pink")).toBe("black");
  expect(screensaverPanelColor("")).toBe("black");
  for (const color of SCREENSAVER_PANEL_COLORS) {
    expect(screensaverPanelColor(color)).toBe(color);
    expect(SCREENSAVER_PANEL_RGB[color]).toMatch(/^\d+ \d+ \d+$/);
  }
});

test("the writing colour derives from the panel colour until one is picked, then the pick wins", () => {
  // No stored pick: white writing on the dark panels, black on the light ones.
  expect(screensaverPanelTextColor(undefined, "black")).toBe("white");
  expect(screensaverPanelTextColor(undefined, "graphite")).toBe("white");
  expect(screensaverPanelTextColor(undefined, "grey")).toBe("black");
  expect(screensaverPanelTextColor(undefined, "silver")).toBe("black");
  expect(screensaverPanelTextColor(undefined, "white")).toBe("black");
  // A malformed stored value derives too.
  expect(screensaverPanelTextColor("pink", "silver")).toBe("black");
  expect(screensaverPanelTextColor(null, "black")).toBe("white");
  // An explicit pick is stored and wins, even against the derivation.
  expect(screensaverPanelTextColor("white", "silver")).toBe("white");
  expect(screensaverPanelTextColor("black", "black")).toBe("black");
  // The defaults carry no writing colour at all: it is derived, not a
  // constant, so nothing stored can freeze the wrong one in place.
  expect("panelTextColor" in DEFAULT_SCREENSAVER_SETTINGS).toBe(false);
  expect(SCREENSAVER_PANEL_TEXT_RGB).toEqual({ white: "255 255 255", black: "0 0 0" });
  // The accents come in a light and a deep version, one per writing colour.
  expect(SCREENSAVER_PANEL_ACCENT_RGB.white).not.toBe(SCREENSAVER_PANEL_ACCENT_RGB.black);
  expect(SCREENSAVER_PANEL_AMBER_RGB.white).not.toBe(SCREENSAVER_PANEL_AMBER_RGB.black);
});

test("the screensaver root publishes both colours as CSS variables", () => {
  const saver = read("src/components/screensaver.tsx");
  expect(saver).toContain("const panelColor = screensaverPanelColor(screensaverSettings.panelColor);");
  expect(saver).toContain("const panelTextColor = screensaverPanelTextColor(screensaverSettings.panelTextColor, panelColor);");
  expect(saver).toContain('"--screensaver-panel-rgb": SCREENSAVER_PANEL_RGB[panelColor]');
  expect(saver).toContain('"--screensaver-panel-fg-rgb": SCREENSAVER_PANEL_TEXT_RGB[panelTextColor]');
  expect(saver).toContain('"--screensaver-panel-accent-rgb": SCREENSAVER_PANEL_ACCENT_RGB[panelTextColor]');
  expect(saver).toContain('"--screensaver-panel-amber-rgb": SCREENSAVER_PANEL_AMBER_RGB[panelTextColor]');
  const css = read("src/app/globals.css");
  expect(css).toContain("background-color: rgb(var(--screensaver-panel-rgb, 0 0 0) / var(--screensaver-overlay-opacity, 0.7));");
  expect(css).toContain(".panel-fg { color: rgb(var(--screensaver-panel-fg-rgb, 255 255 255)); }");
  expect(css).toContain(".panel-fg-border { border-color: rgb(var(--screensaver-panel-fg-rgb, 255 255 255) / 0.15); }");
  expect(css).toContain(".panel-accent { color: rgb(var(--screensaver-panel-accent-rgb, 125 211 252)); }");
  expect(css).toContain(".panel-amber { color: rgb(var(--screensaver-panel-amber-rgb, 252 211 77)); }");
});

test("no panel keeps white writing or white furniture hardcoded", () => {
  const weather = read("src/components/screensaver-weather.tsx");
  expect(weather).not.toContain("text-white");
  expect(weather).not.toContain("bg-white");
  expect(weather).not.toContain("border-white");
  expect(weather).not.toContain("text-sky-300");
  const rows = read("src/components/screensaver-rows.tsx");
  expect(rows).not.toContain("bg-white/");
  expect(rows).not.toContain("text-amber-300");
  expect(rows).not.toContain("group-hover:text-white");
  expect(rows).toContain("panel-fg-fill panel-fg-70");
  expect(rows).toContain("panel-amber");
  // What stays white in rows, deliberately: the section headings sit on
  // the photo, not on a panel, and the birthday "today" badge is a solid
  // pink chip of its own.
  expect(rows).toContain("text-white/60");
  expect(rows).toContain("bg-pink-500 text-white");
  const lessons = read("src/components/screensaver-lessons.tsx");
  expect(lessons).toContain("panel-amber");
  expect(lessons).not.toContain("text-amber-200");
  const saver = read("src/components/screensaver.tsx");
  expect(saver).not.toContain("border-white/10");
  expect(saver).toContain("border-t panel-fg-border-soft");
});

test("the settings page offers both choices, next to the opacity slider", () => {
  const page = read("src/app/settings/screensaver/page.tsx");
  expect(page).toContain('id="panel-color" data-setting="panel-color"');
  expect(page).toContain('id="panel-text-color" data-setting="panel-text-color"');
  expect(page).toContain("SCREENSAVER_PANEL_COLORS.map");
  expect(page).toContain("value: { ...settings, panelColor: value }");
  expect(page).toContain("value: { ...settings, panelTextColor: value }");
  expect(page).toContain("const panelTextColor = screensaverPanelTextColor(settings.panelTextColor, panelColor);");
  const registry = read("src/lib/settings-search/registry.ts");
  expect(registry).toContain('{ anchor: "panel-color", labelKey: "settings.screensaver.panelColorLabel", descriptionKey: "settings.screensaver.panelColorDescription" }');
  expect(registry).toContain('{ anchor: "panel-text-color", labelKey: "settings.screensaver.panelTextColorLabel", descriptionKey: "settings.screensaver.panelTextColorDescription" }');
});
