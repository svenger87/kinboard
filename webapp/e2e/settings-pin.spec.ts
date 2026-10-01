import { test, expect } from "@playwright/test";
import { familyHasPin, verifySettingsPin, setSettingsPin, PIN_FORMAT } from "../src/lib/settings-pin";

const load = (pin: string | null) => async () => pin;

test("a correct PIN is valid, a wrong one invalid", async () => {
  expect(await verifySettingsPin("fam-a", "1234", load("1234"))).toBe("valid");
  expect(await verifySettingsPin("fam-a", "9999", load("1234"))).toBe("invalid");
});

test("no PIN set means nothing verifies", async () => {
  expect(await familyHasPin("fam-b", load(null))).toBe(false);
  expect(await verifySettingsPin("fam-b", "", load(null))).toBe("invalid");
});

test("five failures in a minute lock the family out, a success clears it", async () => {
  for (let i = 0; i < 5; i++) expect(await verifySettingsPin("fam-c", "0000", load("1234"))).toBe("invalid");
  expect(await verifySettingsPin("fam-c", "1234", load("1234"))).toBe("rate_limited");
  expect(await verifySettingsPin("fam-d", "1234", load("1234"))).toBe("valid"); // per family
});

test("10 concurrent wrong verifications: at most 5 invalid, the rest rate_limited", async () => {
  const slowWrongLoad = () => new Promise<string | null>((resolve) => setTimeout(() => resolve("1234"), 10));
  const results = await Promise.all(
    Array.from({ length: 10 }, () => verifySettingsPin("fam-race", "0000", slowWrongLoad)),
  );
  const invalid = results.filter((r) => r === "invalid").length;
  const rateLimited = results.filter((r) => r === "rate_limited").length;
  expect(invalid).toBeLessThanOrEqual(5);
  expect(invalid + rateLimited).toBe(10);
  expect(rateLimited).toBeGreaterThanOrEqual(5);
});

test("20 failures in a rolling hour lock the family out even spread well past the minute window", async () => {
  let clock = 1_700_000_000_000;
  const now = () => clock;
  const results: string[] = [];
  for (let i = 0; i < 25; i++) {
    results.push(await verifySettingsPin("fam-hour", "0000", async () => "1234", now));
    clock += 61_000; // outside the 60s window every time, so only the hourly cap can fire
  }
  expect(results.slice(0, 20)).toEqual(Array(20).fill("invalid"));
  expect(results.slice(20)).toEqual(Array(5).fill("rate_limited"));
});

test.describe("setSettingsPin", () => {
  test("a valid 4-digit PIN reaches the injected store with the right family and value", async () => {
    const calls: Array<{ familyId: string; pin: string }> = [];
    const store = async (familyId: string, pin: string) => {
      calls.push({ familyId, pin });
    };

    await setSettingsPin("fam-e", "4321", store);

    expect(calls).toEqual([{ familyId: "fam-e", pin: "4321" }]);
  });

  test("an invalid format throws and never reaches the store", async () => {
    for (const bad of ["12a4", "123", "12345"]) {
      const calls: Array<{ familyId: string; pin: string }> = [];
      const store = async (familyId: string, pin: string) => {
        calls.push({ familyId, pin });
      };

      await expect(setSettingsPin("fam-f", bad, store)).rejects.toThrow("pin must be 4 digits");
      expect(calls).toEqual([]);
    }
  });

  test("PIN_FORMAT matches exactly four digits", () => {
    expect(PIN_FORMAT.test("1234")).toBe(true);
    expect(PIN_FORMAT.test("12a4")).toBe(false);
    expect(PIN_FORMAT.test("123")).toBe(false);
    expect(PIN_FORMAT.test("12345")).toBe(false);
  });
});
