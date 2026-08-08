import { test, expect } from "@playwright/test";
import { minutesToFullCharge } from "../src/plugins/vehicles/charge-eta";

/**
 * The vehicle card read this sensor with `parseFloat`, like every other
 * numeric entity in the driver. On the Tesla integrations it is not numeric —
 * it is a `device_class: timestamp` holding the moment charging completes:
 *
 *   sensor.model_y_zeit_zum_vollstandigen_aufladen = "2026-08-08T12:51:36+00:00"
 *
 * `parseFloat` on that returns 2026, the year, which the card rendered as
 * minutes: "~33h 46min" on a car that was 108 minutes from full. The values
 * below are that car, mid-charge at 11 kW.
 */

const AT = Date.parse("2026-08-08T11:02:36+00:00"); // "now" for these cases

test.describe("timestamp sensors (tesla_custom, tesla_fleet)", () => {
  test("counts down to the completion time", () => {
    const entity = {
      state: "2026-08-08T12:51:36+00:00",
      attributes: { device_class: "timestamp" },
    };
    expect(minutesToFullCharge(entity, AT)).toBe(109);
  });

  test("recognises an ISO datetime even without the device class", () => {
    // Template sensors mirroring the same field often omit it.
    expect(minutesToFullCharge({ state: "2026-08-08T12:51:36+00:00" }, AT)).toBe(109);
  });

  test("a deadline in the past is zero, not a negative countdown", () => {
    const entity = {
      state: "2026-08-08T10:00:00+00:00",
      attributes: { device_class: "timestamp" },
    };
    expect(minutesToFullCharge(entity, AT)).toBe(0);
  });

  test("the year is never mistaken for a duration", () => {
    // The actual regression: anything that returns ~2026 means parseFloat won.
    const entity = {
      state: "2026-08-08T12:51:36+00:00",
      attributes: { device_class: "timestamp" },
    };
    expect(minutesToFullCharge(entity, AT)).toBeLessThan(24 * 60);
  });
});

test.describe("duration sensors (TeslaMate, templates)", () => {
  test("minutes stay minutes", () => {
    expect(minutesToFullCharge({ state: "45", attributes: { unit_of_measurement: "min" } })).toBe(45);
  });

  test("hours become minutes", () => {
    // The Tesla API's own time_to_full_charge is in hours.
    expect(minutesToFullCharge({ state: "1.75", attributes: { unit_of_measurement: "h" } })).toBe(105);
  });

  test("a bare number is read as minutes", () => {
    expect(minutesToFullCharge({ state: "90" })).toBe(90);
  });
});

test.describe("no reading", () => {
  test("undefined entity", () => {
    expect(minutesToFullCharge(undefined)).toBe(0);
  });

  for (const state of ["unknown", "unavailable", "", "   ", "none"]) {
    test(`state ${JSON.stringify(state)}`, () => {
      expect(minutesToFullCharge({ state })).toBe(0);
    });
  }

  test("zero and negative durations", () => {
    expect(minutesToFullCharge({ state: "0" })).toBe(0);
    expect(minutesToFullCharge({ state: "-5" })).toBe(0);
  });

  test("a string that is neither a number nor a date", () => {
    expect(minutesToFullCharge({ state: "charging" })).toBe(0);
  });
});
