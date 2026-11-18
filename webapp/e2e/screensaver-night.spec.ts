import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DEFAULT_BEDTIME } from "../src/lib/creature-mood";
import { isScreensaverNight } from "../src/lib/screensaver-night";
import { DEFAULT_SCREENSAVER_SETTINGS } from "../src/types/screensaver";

/**
 * RFC-021 §3.4: night on the idle screen is the family's bedtime, when the
 * family switched it on: a dim clock and nothing else.
 */

const berlin = "Europe/Berlin";
const at = (iso: string) => new Date(iso);

test("off unless switched on, whatever the hour", () => {
  expect(DEFAULT_SCREENSAVER_SETTINGS.night).toBe(false);
  expect(isScreensaverNight(undefined, at("2026-11-10T22:00:00Z"), berlin, DEFAULT_BEDTIME)).toBe(false);
  expect(isScreensaverNight(false, at("2026-11-10T22:00:00Z"), berlin, DEFAULT_BEDTIME)).toBe(false);
});

test("switched on, it follows the family's bedtime on the family's clock", () => {
  // 20:00 to 06:30 in Berlin (UTC+1 in November).
  expect(isScreensaverNight(true, at("2026-11-10T18:59:00Z"), berlin, DEFAULT_BEDTIME)).toBe(false); // 19:59
  expect(isScreensaverNight(true, at("2026-11-10T19:00:00Z"), berlin, DEFAULT_BEDTIME)).toBe(true); // 20:00
  expect(isScreensaverNight(true, at("2026-11-11T05:29:00Z"), berlin, DEFAULT_BEDTIME)).toBe(true); // 06:29
  expect(isScreensaverNight(true, at("2026-11-11T05:30:00Z"), berlin, DEFAULT_BEDTIME)).toBe(false); // 06:30
  // A family's own bedtime, and none at all when both times are the same.
  const late = { sleep: 22 * 60, wake: 7 * 60 };
  expect(isScreensaverNight(true, at("2026-11-10T20:30:00Z"), berlin, late)).toBe(false); // 21:30
  expect(isScreensaverNight(true, at("2026-11-10T21:30:00Z"), berlin, late)).toBe(true); // 22:30
  expect(isScreensaverNight(true, at("2026-11-10T21:30:00Z"), berlin, { sleep: 720, wake: 720 })).toBe(false);
  // The family's zone, not the display's: 20:30 in Sydney is 09:30 UTC.
  expect(isScreensaverNight(true, at("2026-11-10T09:30:00Z"), "Australia/Sydney", DEFAULT_BEDTIME)).toBe(true);
});

test("at night the screensaver draws the clock alone, and stops the photos", () => {
  const saver = readFileSync("src/components/screensaver.tsx", "utf8");
  expect(saver).toContain("const nightNow = isScreensaverNight(screensaverSettings.night, date, familyTimeZone, bedtime);");
  expect(saver).toContain("if (nightNow || photoUrls.length <= 1 || currentPhotoIndex === -1) return;");
  // The night branch returns before the photo, the news, the events and the festival visitor.
  const night = saver.indexOf('data-testid="screensaver-night"');
  const photo = saver.indexOf("{/* Background Photo");
  expect(night).toBeGreaterThan(0);
  expect(night).toBeLessThan(photo);
  const start = saver.indexOf("if (nightNow) {");
  const branch = saver.slice(start, saver.indexOf("\n  }\n", start));
  expect(branch).toContain("style={burnInStyle}");
  expect(branch).toContain("text-white/35");
  expect(branch).not.toMatch(/news|upcomingEvents|FestivalVisitor|currentBlobUrl/);
  const settings = readFileSync("src/app/settings/screensaver/page.tsx", "utf8");
  expect(settings).toContain('updateDisplayOption("night", value)');
  expect(settings).toContain('href="/settings/creatures#home"');
});
