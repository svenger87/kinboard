import { test, expect } from "@playwright/test";
import {
  windSpeedForDisplay,
  visibilityForDisplay,
  precipitationForDisplay,
  displayTempToCelsius,
  displayWindToKmh,
  unitLabels,
} from "../src/lib/weather-units";

/**
 * Units are the part of the weather feature that goes wrong quietly: a
 * number is still a number, so a wrong conversion renders perfectly and
 * only looks odd if you know what the weather is actually doing.
 *
 * Two halves are covered here. Display conversions, which the imperial
 * release added; and the normalisation used before comparing a value
 * against a threshold, which it did not — every threshold in the modal
 * was written in Celsius and km/h and compared against whatever the
 * household's system produced.
 */

test.describe("display conversions", () => {
  test("wind: m/s becomes km/h in metric, mph passes through", () => {
    // OpenWeatherMap gives m/s for metric and mph for imperial. Running
    // the imperial value through the metric conversion is the mistake
    // this guards — 10 mph would render as 36.
    expect(windSpeedForDisplay(10, "metric")).toBe(36);
    expect(windSpeedForDisplay(10, "imperial")).toBe(10);
  });

  test("visibility: metres regardless of the units parameter", () => {
    expect(visibilityForDisplay(10000, "metric")).toBe(10);
    expect(visibilityForDisplay(10000, "imperial")).toBe(6);
  });

  test("precipitation: millimetres regardless of the units parameter", () => {
    expect(precipitationForDisplay(25.4, "metric")).toBe(25.4);
    expect(precipitationForDisplay(25.4, "imperial")).toBe(1);
    // One decimal in imperial would round most real rainfall to 0.0.
    expect(precipitationForDisplay(2.5, "imperial")).toBe(0.1);
  });

  test("labels match the system", () => {
    expect(unitLabels("metric").speed).toBe("km/h");
    expect(unitLabels("imperial").speed).toBe("mph");
  });
});

test.describe("threshold normalisation", () => {
  // These are the conversions the clothing advice, comfort badge and
  // forecast bar colours now run before comparing against their metric
  // rungs. Each assertion below is a bug that shipped.

  test("a cold Fahrenheit morning is cold in Celsius too", () => {
    // 40 °F was compared against a 25 "t-shirt" rung and fell past the
    // end of the ladder, so the advice was "breathable clothing".
    expect(Math.round(displayTempToCelsius(40, "imperial"))).toBe(4);
    expect(displayTempToCelsius(40, "imperial")).toBeLessThan(5);
  });

  test("a pleasant Fahrenheit day is not 'very hot'", () => {
    // 68 °F cleared the 30 rung and rendered a red "very hot" badge.
    expect(Math.round(displayTempToCelsius(68, "imperial"))).toBe(20);
  });

  test("freezing point maps correctly in both directions", () => {
    expect(displayTempToCelsius(32, "imperial")).toBe(0);
    expect(displayTempToCelsius(0, "metric")).toBe(0);
    expect(displayTempToCelsius(-40, "imperial")).toBe(-40); // the one shared point
  });

  test("metric values pass through untouched", () => {
    for (const v of [-10, 0, 15.5, 30]) {
      expect(displayTempToCelsius(v, "metric"), String(v)).toBe(v);
    }
  });

  test("wind normalises to km/h so the windproof rung fires at the right speed", () => {
    // The rung is 30 km/h. Compared against mph it needed ~30 mph —
    // a near gale rather than a brisk breeze.
    expect(Math.round(displayWindToKmh(30, "imperial"))).toBe(48);
    expect(Math.round(displayWindToKmh(19, "imperial"))).toBe(31); // just trips it
    expect(displayWindToKmh(30, "metric")).toBe(30);
  });

  test("the two directions are inverses, within rounding", () => {
    for (const c of [-20, 0, 18, 35]) {
      const f = (c * 9) / 5 + 32;
      expect(displayTempToCelsius(f, "imperial")).toBeCloseTo(c, 6);
    }
  });
});
