import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { de, enUS, fr } from "date-fns/locale";
import { renderWallClock } from "../src/hooks/use-time-format";

/**
 * Sunrise, sunset and the hourly forecast are the times the 24-hour switch
 * could not reach, because they are not formatted in the browser at all.
 *
 * They belong to the *weather location's* clock, and OpenWeatherMap describes
 * that zone only as an offset in seconds — no IANA name — so the only way to
 * read it is to shift the instant and read its UTC fields, which happens on the
 * server (lib/weather-time.ts). The server has no way to know a household's
 * clock setting: it is per-family, behind the browser's session. So those
 * routes emitted finished strings, and the switch had nothing to act on
 * (issue #227). The hourly strip was worse than merely 24-hour — it was
 * formatted for the interface *language*, so English households got 12-hour
 * times even with the 24-hour switch on, and German ones the reverse.
 *
 * The routes now send "HH:mm" and the client renders it. This covers the
 * renderer, and asserts the two routes stopped deciding the format themselves.
 */

test.describe("renderWallClock", () => {
  test("24-hour passes the clock through, zero-padded", () => {
    expect(renderWallClock("06:32", true)).toBe("06:32");
    expect(renderWallClock("6:32", true)).toBe("06:32");
    expect(renderWallClock("19:05", true)).toBe("19:05");
    expect(renderWallClock("00:00", true)).toBe("00:00");
  });

  test("12-hour reads as a 12-hour clock", () => {
    expect(renderWallClock("06:32", false, enUS)).toBe("6:32 AM");
    expect(renderWallClock("19:05", false, enUS)).toBe("7:05 PM");
    // The two that are always wrong when someone writes this by hand.
    expect(renderWallClock("00:15", false, enUS)).toBe("12:15 AM");
    expect(renderWallClock("12:00", false, enUS)).toBe("12:00 PM");
  });

  test("the meridiem follows the date-fns locale, not English", () => {
    // A French household reading "PM" would be the units bug again in another
    // costume: correct number, wrong household.
    const fr1 = renderWallClock("19:05", false, fr);
    const de1 = renderWallClock("19:05", false, de);
    expect(fr1).toMatch(/^7:05 /);
    expect(de1).toMatch(/^7:05 /);
  });

  test("anything that is not a wall clock is left alone", () => {
    // The dashboard shows whatever the server sent rather than "Invalid Date".
    for (const junk of ["", "--", "unknown", "6:3", "25:00", "12:60", "6:32:10"]) {
      expect(renderWallClock(junk, false, enUS), `"${junk}" should pass through`).toBe(junk);
    }
  });
});

test.describe("the routes no longer pick the format", () => {
  const forecast = readFileSync("src/app/api/weather/forecast/route.ts", "utf8");
  const current = readFileSync("src/app/api/weather/route.ts", "utf8");

  test("the hourly forecast does not format for the interface language", () => {
    expect(
      forecast,
      "the hourly strip's time is locale-formatted on the server again, so it " +
        "follows the interface language instead of the 24-hour setting",
    ).not.toMatch(/time:\s*date\.toLocaleTimeString/);
    expect(forecast, "it should send the location's wall clock as HH:mm").toMatch(
      /time:\s*date\.toISOString\(\)\.slice\(11, 16\)/,
    );
  });

  test("sunrise and sunset are still sent as a bare wall clock", () => {
    // The server *must* format these — only it knows the location's offset —
    // so what it sends has to stay parseable by renderWallClock.
    expect(current).toMatch(/return `\$\{hours\}:\$\{minutes\}`/);
  });
});

test.describe("the widgets render it", () => {
  const widget = readFileSync("src/components/widgets/weather.tsx", "utf8");
  const modal = readFileSync("src/components/widgets/weather-modal.tsx", "utf8");

  test("the weather widget's sun times go through the formatter", () => {
    expect(widget).toContain("formatWallClock(weatherData.sunrise)");
    expect(widget).toContain("formatWallClock(weatherData.sunset)");
  });

  test("the modal's sun times and hourly strip go through it too", () => {
    expect(modal).toContain("formatWallClock(sunrise)");
    expect(modal).toContain("formatWallClock(sunset)");
    expect(modal).toContain("formatWallClock(hour.time)");
  });
});

test.describe("the Home Assistant charts follow the setting", () => {
  const files = [
    "src/components/home-assistant/battery-chart.tsx",
    "src/components/home-assistant/mini-chart.tsx",
    "src/components/home-assistant/energy-chart.tsx",
    "src/components/home-assistant/power-chart.tsx",
    "src/components/home-assistant/cards/person-card.tsx",
  ];

  for (const file of files) {
    test(`${file.split("/").pop()} does not take its clock from the locale`, () => {
      const source = readFileSync(file, "utf8");
      // Only the explanatory comment may mention it; a call has a paren after.
      const calls = source.match(/toLocaleTimeString\(/g);
      expect(
        calls,
        `${file} still calls toLocaleTimeString, which picks 12- or 24-hour from ` +
          `the interface language rather than the household's setting`,
      ).toBeNull();
      expect(source, `${file} should format times through useTimeFormat`).toContain(
        "useTimeFormat",
      );
    });
  }
});
