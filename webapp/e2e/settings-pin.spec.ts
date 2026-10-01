import { test, expect } from "@playwright/test";
import {
  familyHasPin, verifySettingsPin, setSettingsPin, setSettingsPinIfAbsent, PIN_FORMAT,
  settingsUnlocked, requireSettingsUnlock, SETTINGS_UNLOCK_TTL_S, clearSettingsUnlockForFamily,
  settleAfterPinSet,
} from "../src/lib/settings-pin";
import type { SessionContext } from "../src/lib/session";

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

test.describe("setSettingsPinIfAbsent", () => {
  test("reports whether the conditional insert won, and validates before reaching it", async () => {
    expect(await setSettingsPinIfAbsent("fam-g", "1234", async () => true)).toBe(true);
    expect(await setSettingsPinIfAbsent("fam-g", "1234", async () => false)).toBe(false);
    let reached = false;
    await expect(setSettingsPinIfAbsent("fam-g", "12a4", async () => { reached = true; return true; })).rejects.toThrow("pin must be 4 digits");
    expect(reached).toBe(false);
  });
});

/**
 * The server-side settings unlock (RFC-010 §3.5): the PIN guards the
 * actions, not just the screen. A session is unlocked when the family has no
 * PIN, or when its settings_unlocked_until is still in the future.
 */
test.describe("settings unlock", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");
  const session = (until: string | null): SessionContext => ({
    familyId: "fam-u", deviceId: "dev-u", sessionId: "ses-u", settingsUnlockedUntil: until,
  });
  const later = new Date(NOW.getTime() + 60_000).toISOString();
  const earlier = new Date(NOW.getTime() - 60_000).toISOString();

  test("truth table", () => {
    const rows: Array<[boolean, string | null, boolean]> = [
      // pinSet, unlockedUntil, expected
      [false, null, true],      // no PIN: nothing to prove
      [false, earlier, true],
      [false, later, true],
      [true, null, false],      // PIN, never entered on this device
      [true, earlier, false],   // PIN, unlock lapsed
      [true, NOW.toISOString(), false], // exactly at expiry is expired
      [true, later, true],      // PIN, entered recently
      [true, "not a date", false],
    ];
    for (const [pinSet, until, expected] of rows) {
      expect(settingsUnlocked(session(until), pinSet, NOW), `${pinSet} ${until}`).toBe(expected);
    }
  });

  test("the unlock lasts fifteen minutes", () => {
    expect(SETTINGS_UNLOCK_TTL_S).toBe(15 * 60);
  });

  test("requireSettingsUnlock: 403 pin_required when locked, null when allowed", async () => {
    const locked = await requireSettingsUnlock(session(earlier), async () => true, NOW);
    expect(locked?.status).toBe(403);
    expect(await locked?.json()).toEqual({ error: "pin_required" });
    expect(await requireSettingsUnlock(session(later), async () => true, NOW)).toBeNull();
    expect(await requireSettingsUnlock(session(null), async () => false, NOW)).toBeNull();
  });

  test("a PIN lookup that fails is a failure, not 'no PIN'", async () => {
    await expect(requireSettingsUnlock(session(null), async () => { throw new Error("db down"); }, NOW)).rejects.toThrow("db down");
  });
});

/** Records the PostgREST builder calls clearSettingsUnlockForFamily makes. */
function recordingDb(error: { message: string } | null = null) {
  const calls: unknown[][] = [];
  const builder: any = {
    eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return builder; },
    neq: (...a: unknown[]) => { calls.push(["neq", ...a]); return builder; },
    then: (resolve: (v: unknown) => void) => resolve({ error }),
  };
  const db = {
    from: (t: string) => {
      calls.push(["from", t]);
      return { update: (v: unknown) => { calls.push(["update", v]); return builder; } };
    },
  };
  return { db, calls };
}

test("a PIN change clears every other device's unlock in the family", async () => {
  const { db, calls } = recordingDb();
  await clearSettingsUnlockForFamily("fam-x", "sess-acting", db);
  expect(calls).toEqual([
    ["from", "device_sessions"],
    ["update", { settings_unlocked_until: null }],
    ["eq", "family_id", "fam-x"],
    ["neq", "id", "sess-acting"],
  ]);
});

test("a PIN removal clears every device's unlock, the acting one included", async () => {
  const { db, calls } = recordingDb();
  await clearSettingsUnlockForFamily("fam-x", undefined, db);
  expect(calls).toEqual([
    ["from", "device_sessions"],
    ["update", { settings_unlocked_until: null }],
    ["eq", "family_id", "fam-x"],
  ]);
});

test("clearing the unlocks throws when the update fails", async () => {
  const { db } = recordingDb({ message: "boom" });
  await expect(clearSettingsUnlockForFamily("fam-x", undefined, db)).rejects.toThrow(/boom/);
});

test.describe("after a PIN is saved (settleAfterPinSet)", () => {
  test("unlocks the acting session first, then clears every other device", async () => {
    const calls: string[] = [];
    await settleAfterPinSet("fam-x", "sess-acting", {
      unlock: async (id) => { calls.push(`unlock:${id}`); },
      clearOthers: async (f, id) => { calls.push(`clear:${f}:except:${id}`); },
      log: () => calls.push("log"),
    });
    expect(calls).toEqual(["unlock:sess-acting", "clear:fam-x:except:sess-acting"]);
  });

  test("a failure to clear the other devices is logged and never thrown — the PIN has already changed", async () => {
    const logged: string[] = [];
    let unlocked = false;
    await expect(settleAfterPinSet("fam-x", "sess-acting", {
      unlock: async () => { unlocked = true; },
      clearOthers: async () => { throw new Error("db down"); },
      log: (message) => logged.push(message),
    })).resolves.toBeUndefined();
    expect(unlocked).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("other devices");
  });

  test("a failed unlock of the acting device is logged too, and the others are still cleared", async () => {
    const calls: string[] = [];
    await expect(settleAfterPinSet("fam-x", "sess-acting", {
      unlock: async () => { throw new Error("db down"); },
      clearOthers: async () => { calls.push("clear"); },
      log: () => calls.push("log"),
    })).resolves.toBeUndefined();
    expect(calls).toEqual(["log", "clear"]);
  });

  test("the route saves the PIN, then settles outside the 500 — never 'Failed to save PIN' after saving it", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const source = readFileSync(join(__dirname, "..", "src", "app", "api", "pin", "route.ts"), "utf8");
    const set = source.slice(source.indexOf('if (action === "set")'), source.indexOf('if (action === "remove")'));
    const settle = set.indexOf("await settleAfterPinSet(familyId, auth.session.sessionId);");
    expect(settle).toBeGreaterThan(-1);
    // After the try/catch that answers "Failed to save PIN", not inside it.
    expect(settle).toBeGreaterThan(set.lastIndexOf("Failed to save PIN"));
    expect(set).not.toContain("clearSettingsUnlockForFamily(");
  });
});
