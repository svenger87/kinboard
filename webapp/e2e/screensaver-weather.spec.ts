import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DEFAULT_SCREENSAVER_SETTINGS } from "../src/types/screensaver";
import { SLOT_MS, upcomingSlots } from "../src/lib/weather-effects";

/**
 * The screensaver's weather (#282): a forecast strip beside the temperature,
 * and Home's weather effects over the photos. Both off unless switched on
 * under Settings -> Screensaver.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("both are off unless switched on", () => {
  expect(DEFAULT_SCREENSAVER_SETTINGS.showForecast).toBe(false);
  expect(DEFAULT_SCREENSAVER_SETTINGS.weatherEffects).toBe(false);
});

test("the strip lists the slots still to come, and moves on as each one starts", () => {
  const t0 = Date.UTC(2026, 10, 17, 6); // 07:00 in Berlin
  const slots = Array.from({ length: 8 }, (_, i) => ({ id: i, at: t0 + i * SLOT_MS }));
  // Before the first: all of them.
  expect(upcomingSlots(slots, t0 - 1).map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  // During the first: the weather now stands for it; the strip starts with the next.
  expect(upcomingSlots(slots, t0 + 60_000).map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(upcomingSlots(slots, t0 + SLOT_MS).map((s) => s.id)).toEqual([2, 3, 4, 5, 6, 7]);
  // After the last: nothing left (the forecast is asked for again long before).
  expect(upcomingSlots(slots, t0 + 8 * SLOT_MS)).toEqual([]);
  // An older server without slot times: all of them, as sent.
  expect(upcomingSlots<{ id: number; at?: number }>([{ id: 0 }, { id: 1 }], t0).map((s) => s.id)).toEqual([0, 1]);
  expect(upcomingSlots(null, t0)).toEqual([]);
});

test("the screensaver shows the strip and the effects from its own switches", () => {
  const saver = read("src/components/screensaver.tsx");
  expect(saver).toContain("const showForecast = screensaverSettings.showForecast ?? false;");
  expect(saver).toContain("const weatherEffects = screensaverSettings.weatherEffects ?? false;");
  expect(saver).toContain("<ScreensaverWeather weather={weather} showForecast={showForecast} large={largeDetails} />");
  // The effects sit above the photo and below everything that reads.
  const effects = saver.indexOf('<WeatherEffects placement="screensaver" enabled={weatherEffects} />');
  expect(effects).toBeGreaterThan(saver.indexOf("screensaver-photo-in"));
  expect(effects).toBeLessThan(saver.indexOf("ref={newsListRef}"));
  expect(effects).toBeLessThan(saver.indexOf("<ScreensaverWeather"));
  // The forecast reuses the Weather widget's query: no second provider call.
  const strip = read("src/components/screensaver-weather.tsx");
  expect(strip).toContain("useWeatherForecast({ enabled: showForecast })");
  const settings = read("src/app/settings/screensaver/page.tsx");
  expect(settings).toContain('updateDisplayOption("showForecast", value)');
  expect(settings).toContain('updateDisplayOption("weatherEffects", value)');
  expect(settings).toContain('href="/settings/weather#effects"');
});

test("on the screensaver the effects keep its order, and Home's stop underneath", () => {
  const fx = read("src/components/weather-effects.tsx");
  // The screensaver's switch decides there; the thresholds stay Settings -> Weather's.
  expect(fx).toContain("return enabled === undefined ? s : { ...s, enabled };");
  // Absolute and without a z-index on the screensaver, so DOM order puts them under the clock.
  expect(fx).toContain('const layer = home ? "fixed" : "absolute";');
  expect(fx).toContain('const behind = home ? "z-[5]" : "";');
  // Home's ?weather-preview= is Home's only.
  expect(fx).toContain("if (forced || !home) return;");
  // Home's scene under the screensaver draws nothing anyone sees, so it stops.
  expect(fx).toContain('const covered = () => placement === "home" && document.documentElement.hasAttribute("data-screensaver");');
  expect(fx).toContain('if (placement === "home") screensaver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-screensaver"] });');
});

test("the weather surfaces pair their fill with a border, so the card survives a black backdrop", () => {
  const strip = read("src/components/screensaver-weather.tsx");
  // The surfaces' fill is the screensaver's shared panel fill
  // (.screensaver-panel — Settings -> Screensaver -> Panel opacity),
  // never a bare translucent black: on the black pillarbox beside a
  // portrait photo a black fill is invisible at any opacity, and the
  // wide forecast strip — anchored top right — straddles the photo's
  // edge, so its card visibly ended mid-widget. Every surface (the
  // strip, the scaled strip for layout boxes, the now chip in both
  // sizes) pairs the fill with the hairline border instead. The border
  // takes the Panel text colour (.panel-fg-border), so a light panel
  // gets a dark hairline rather than a white one.
  const paired = strip.match(/screensaver-panel border panel-fg-border/g) ?? [];
  expect(paired.length).toBe(4);
  expect(strip).not.toContain("bg-black/");
});
