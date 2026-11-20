import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SCREENSAVER_SETTINGS,
  SCREENSAVER_OVERLAY_OPACITY_DEFAULT,
  SCREENSAVER_OVERLAY_OPACITY_MAX,
  SCREENSAVER_OVERLAY_OPACITY_MIN,
  screensaverOverlayOpacity,
} from "../src/types/screensaver";

/**
 * Settings -> Screensaver -> Panel opacity: one setting for how solid
 * the screensaver's dark panels are over the photos. Every panel —
 * weather, events, news, energy, a designed layout's boxes —
 * fills with the shared .screensaver-panel class, whose opacity comes
 * from the --screensaver-overlay-opacity variable the screensaver root
 * publishes from the setting.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("the default is 70, and unset or malformed values fall back to it", () => {
  expect(SCREENSAVER_OVERLAY_OPACITY_DEFAULT).toBe(70);
  expect(DEFAULT_SCREENSAVER_SETTINGS.overlayOpacity).toBe(70);
  expect(screensaverOverlayOpacity(undefined)).toBe(70);
  expect(screensaverOverlayOpacity(null)).toBe(70);
  expect(screensaverOverlayOpacity("70")).toBe(70);
  expect(screensaverOverlayOpacity(Number.NaN)).toBe(70);
});

test("stored values are respected, clamped to the slider's range and snapped to its steps", () => {
  expect(screensaverOverlayOpacity(30)).toBe(SCREENSAVER_OVERLAY_OPACITY_MIN);
  expect(screensaverOverlayOpacity(50)).toBe(50);
  expect(screensaverOverlayOpacity(95)).toBe(SCREENSAVER_OVERLAY_OPACITY_MAX);
  expect(screensaverOverlayOpacity(10)).toBe(30);
  expect(screensaverOverlayOpacity(100)).toBe(95);
  expect(screensaverOverlayOpacity(52)).toBe(50);
  expect(screensaverOverlayOpacity(53)).toBe(55);
});

test("the screensaver root publishes the setting as the panels' CSS variable", () => {
  const saver = read("src/components/screensaver.tsx");
  expect(saver).toContain("const overlayOpacity = screensaverOverlayOpacity(screensaverSettings.overlayOpacity);");
  expect(saver).toContain('"--screensaver-overlay-opacity": overlayOpacity / 100');
  const css = read("src/app/globals.css");
  expect(css).toContain(".screensaver-panel {");
  // The fill's colour is the Panel colour variable (screensaver-panel-color.spec.ts);
  // the opacity in it is this setting.
  expect(css).toContain("background-color: rgb(var(--screensaver-panel-rgb, 0 0 0) / var(--screensaver-overlay-opacity, 0.7));");
  expect(css).toContain(".screensaver-panel-hover:hover {");
});

test("every screensaver panel fills with the shared class, not a hardcoded black", () => {
  // The weather surfaces are asserted one by one in screensaver-weather.spec.ts.
  const rows = read("src/components/screensaver-rows.tsx");
  expect(rows).not.toContain("bg-black/");
  // rowCard in both scales, the news card in both scales, its hover.
  expect(rows.match(/screensaver-panel/g)?.length).toBeGreaterThanOrEqual(5);
  expect(rows).toContain("screensaver-panel-hover");
  const shared = read("src/components/layouts/saver-widgets/shared.tsx");
  expect(shared).not.toContain("bg-black/");
  expect(shared).toContain("screensaver-panel");
  const saver = read("src/components/screensaver.tsx");
  expect(saver).toContain('className="screensaver-panel rounded-xl p-4 flex flex-col gap-3 gpu-blur"');
  expect(saver).not.toContain("bg-black/50 rounded-xl");
  // What stays hardcoded, deliberately: the photo's readability gradient
  // and the news modal's scrim are not panels — both must stay dark
  // whatever the panels are set to — and the roots are solid black.
  expect(saver).toContain("bg-gradient-to-t from-black/80 via-black/20 to-black/40");
  expect(saver).toContain("bg-black/85");
});

test("the settings page drives the setting with a slider in the setting's range", () => {
  const page = read("src/app/settings/screensaver/page.tsx");
  expect(page).toContain('id="panel-opacity" data-setting="panel-opacity"');
  expect(page).toContain("min={SCREENSAVER_OVERLAY_OPACITY_MIN}");
  expect(page).toContain("max={SCREENSAVER_OVERLAY_OPACITY_MAX}");
  expect(page).toContain("step={SCREENSAVER_OVERLAY_OPACITY_STEP}");
  expect(page).toContain("value: { ...settings, overlayOpacity: value }");
  const registry = read("src/lib/settings-search/registry.ts");
  expect(registry).toContain('{ anchor: "panel-opacity", labelKey: "settings.screensaver.panelOpacityLabel", descriptionKey: "settings.screensaver.panelOpacityDescription" }');
});
