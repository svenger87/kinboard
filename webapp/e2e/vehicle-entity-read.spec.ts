import { test, expect } from "@playwright/test";
import {
  readNumber,
  readState,
  isCharging,
  isPluggedIn,
  isLocked,
  isOpen,
  isOnline,
  isMissing,
  formatReading,
} from "../src/plugins/vehicles/entity-read";

/**
 * These cases come from a real Home Assistant instance — a Model Y on
 * `tesla_fleet`, 61 entities — plus the state vocabularies the other
 * integrations use. The audit that produced them found the vehicle card
 * reading every one of these with `parseFloat` and hardcoded unit labels.
 */

test.describe("readNumber", () => {
  test("keeps the entity's own unit", () => {
    // Live: sensor.model_y_batteriereichweite
    expect(readNumber({ state: "295.94226816", attributes: { unit_of_measurement: "km" } }))
      .toEqual({ value: 295.94226816, unit: "km" });
    // The same car sold in the US
    expect(readNumber({ state: "183.9", attributes: { unit_of_measurement: "mi" } }))
      .toEqual({ value: 183.9, unit: "mi" });
  });

  test("no reading is null, never zero", () => {
    // Live: sensor.model_y_entfernung_bis_zur_ankunft is "unknown" right now.
    for (const state of ["unknown", "unavailable", "none", "", "  ", "NaN-ish"]) {
      expect(readNumber({ state }), state).toBeNull();
    }
    expect(readNumber(undefined)).toBeNull();
  });

  test("a unitless number still reads", () => {
    expect(readNumber({ state: "42" })).toEqual({ value: 42, unit: null });
  });

  test("negative and zero are readings, not absences", () => {
    expect(readNumber({ state: "0", attributes: { unit_of_measurement: "kW" } }))
      .toEqual({ value: 0, unit: "kW" });
    expect(readNumber({ state: "-4.5", attributes: { unit_of_measurement: "°C" } }))
      .toEqual({ value: -4.5, unit: "°C" });
  });
});

test.describe("readState", () => {
  test("lowercases so integrations can be compared", () => {
    expect(readState({ state: "Charging" })).toBe("charging");
    expect(readState({ state: "NOT_CHARGING" })).toBe("not_charging");
  });

  test("absence is null", () => {
    expect(readState({ state: "unavailable" })).toBeNull();
    expect(readState(undefined)).toBeNull();
  });
});

test.describe("isCharging", () => {
  test("the Tesla enum", () => {
    // Live options: starting | charging | stopped | complete | disconnected | no_power
    expect(isCharging("charging")).toBe(true);
    expect(isCharging("starting")).toBe(true);
    expect(isCharging("stopped")).toBe(false);
    expect(isCharging("complete")).toBe(false);
    expect(isCharging("disconnected")).toBe(false);
    expect(isCharging("no_power")).toBe(false);
  });

  test("tesla_custom capitalises", () => {
    expect(isCharging("Charging")).toBe(true);
  });

  test("a binary_sensor says on/off", () => {
    // The config has always allowed one here; it never registered as charging.
    expect(isCharging("on")).toBe(true);
    expect(isCharging("off")).toBe(false);
  });

  test("other vendors' free text", () => {
    expect(isCharging("AC charging")).toBe(true);
    expect(isCharging("DC Charging")).toBe(true);
    expect(isCharging("NOT_CHARGING")).toBe(false);
    expect(isCharging("not charging")).toBe(false);
  });

  test("power drawn overrides whatever the state claims", () => {
    expect(isCharging("stopped", 11)).toBe(true);
    expect(isCharging(null, 7.4)).toBe(true);
    expect(isCharging("charging", 0)).toBe(true);
    expect(isCharging(null, 0)).toBe(false);
    expect(isCharging(null, null)).toBe(false);
  });
});

test.describe("isPluggedIn", () => {
  test("a full car is still plugged in", () => {
    expect(isPluggedIn("complete")).toBe(false); // charge state, not a plug state
    expect(isPluggedIn("on")).toBe(true);        // live: binary_sensor.model_y_ladekabel
    expect(isPluggedIn("connected")).toBe(true);
    expect(isPluggedIn("disconnected")).toBe(false);
    expect(isPluggedIn("off")).toBe(false);
  });
});

test.describe("isLocked", () => {
  test("lock domain", () => {
    // Live: lock.model_y_schloss = "unlocked"
    expect(isLocked({ state: "unlocked" })).toBe(false);
    expect(isLocked({ state: "locked" })).toBe(true);
  });

  test("a lock device class inverts on/off", () => {
    expect(isLocked({ state: "on", attributes: { device_class: "lock" } })).toBe(false);
    expect(isLocked({ state: "off", attributes: { device_class: "lock" } })).toBe(true);
  });

  test("a plain binary_sensor", () => {
    expect(isLocked({ state: "off" })).toBe(true);
    expect(isLocked({ state: "on" })).toBe(false);
  });

  test("no reading", () => {
    expect(isLocked({ state: "unavailable" })).toBeNull();
    expect(isLocked(undefined)).toBeNull();
  });
});

test.describe("isOpen", () => {
  test("cover domain", () => {
    // Live: cover.model_y_kofferraum = "closed", cover.model_y_ladeanschluss_klappe = "open"
    expect(isOpen({ state: "closed" })).toBe(false);
    expect(isOpen({ state: "open" })).toBe(true);
    expect(isOpen({ state: "opening" })).toBe(true);
  });

  test("binary_sensor door/window", () => {
    // Live: binary_sensor.model_y_fahrertur_vorne = "off"
    expect(isOpen({ state: "off", attributes: { device_class: "door" } })).toBe(false);
    expect(isOpen({ state: "on", attributes: { device_class: "window" } })).toBe(true);
  });

  test("no reading", () => {
    expect(isOpen({ state: "unknown" })).toBeNull();
  });
});

test.describe("isOnline", () => {
  test("awake, asleep, offline", () => {
    expect(isOnline("online")).toBe(true);
    expect(isOnline("driving")).toBe(true);
    expect(isOnline("asleep")).toBe(false);
    expect(isOnline("offline")).toBe(false);
    expect(isOnline(null)).toBeNull();
  });
});

test.describe("formatReading", () => {
  test("prints the entity's unit, never a hardcoded one", () => {
    expect(formatReading({ value: 295.94226816, unit: "km" }, { locale: "en-US" })).toBe("296 km");
    expect(formatReading({ value: 183.9, unit: "mi" }, { locale: "en-US" })).toBe("184 mi");
  });

  test("degrees and percent sit tight against the number", () => {
    expect(formatReading({ value: 27.6, unit: "°C" }, { digits: 1, locale: "en-US" })).toBe("27.6°C");
    expect(formatReading({ value: 68, unit: "°F" }, { digits: 1, locale: "en-US" })).toBe("68.0°F");
    expect(formatReading({ value: 57, unit: "%" }, { locale: "en-US" })).toBe("57%");
  });

  test("pressure keeps whatever the sensor uses", () => {
    expect(formatReading({ value: 2.9, unit: "bar" }, { digits: 1, locale: "en-US" })).toBe("2.9 bar");
    expect(formatReading({ value: 42, unit: "psi" }, { digits: 1, locale: "en-US" })).toBe("42.0 psi");
  });

  test("no reading is a dash, not a zero", () => {
    expect(formatReading(null)).toBe("—");
    expect(formatReading(null, { dash: "n/a" })).toBe("n/a");
  });

  test("a unitless reading prints bare", () => {
    expect(formatReading({ value: 12, unit: null }, { locale: "en-US" })).toBe("12");
  });
});

test.describe("isMissing", () => {
  test("covers Home Assistant's vocabulary of absence", () => {
    for (const s of ["unknown", "Unavailable", "NONE", "", "   ", null, undefined]) {
      expect(isMissing(s), String(s)).toBe(true);
    }
    expect(isMissing("charging")).toBe(false);
    expect(isMissing("0")).toBe(false);
  });
});
