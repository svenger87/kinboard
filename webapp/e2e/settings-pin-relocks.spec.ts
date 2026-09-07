import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { isUnlocked, grantUnlock, clearUnlock, isSettingsPath, UNLOCK_TTL_MS } from "../src/lib/pin-session";

/**
 * The settings PIN stopped being asked after the first time.
 *
 * `PinGuard` wrote a bare `"unlocked"` marker into `sessionStorage` on success
 * and never removed it. `sessionStorage` lives for the life of the *tab*, and a
 * kiosk's tab is never closed — so on the one device the PIN actually protects,
 * a wall tablet anybody in the house can walk up to, it was asked once and then
 * never again. Measured against the running app before the fix:
 *
 *   1. first visit            prompted=true   marker=null
 *      (entered the PIN)  ->  marker="unlocked"
 *   2. back home, then in     prompted=false  marker="unlocked"
 *   3. after wandering        prompted=false  marker="unlocked"
 *   4. new tab                prompted=true   marker=null
 *
 * Step 4 is why it looked fine: every ordinary browser test opens a new tab.
 *
 * The unlock now carries a family and a timestamp, and lapses two ways — on
 * leaving Settings, and after an idle window.
 */

// The module reads `sessionStorage`, which does not exist in the test runner.
// A minimal stand-in is enough: these functions only get, set and remove.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
}

test.beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();
});

const FAMILY = "fam-1";
const OTHER = "fam-2";

test.describe("the unlock", () => {
  test("is not granted until the PIN is entered", () => {
    expect(isUnlocked(FAMILY)).toBe(false);
  });

  test("holds for the idle window and then lapses", () => {
    const t0 = 1_000_000;
    grantUnlock(FAMILY, t0);
    expect(isUnlocked(FAMILY, t0)).toBe(true);
    expect(isUnlocked(FAMILY, t0 + UNLOCK_TTL_MS - 1)).toBe(true);
    // This is the whole bug: before, this was still true.
    expect(isUnlocked(FAMILY, t0 + UNLOCK_TTL_MS)).toBe(false);
    expect(isUnlocked(FAMILY, t0 + UNLOCK_TTL_MS * 100)).toBe(false);
  });

  test("does not survive a clock that jumps backwards", () => {
    // A wall panel correcting its time by NTP must not read as freshly unlocked.
    const t0 = 1_000_000;
    grantUnlock(FAMILY, t0);
    expect(isUnlocked(FAMILY, t0 - 60_000)).toBe(false);
  });

  test("belongs to one family", () => {
    grantUnlock(FAMILY, 1_000_000);
    expect(isUnlocked(OTHER, 1_000_000)).toBe(false);
  });

  test("is dropped by clearUnlock", () => {
    grantUnlock(FAMILY, 1_000_000);
    clearUnlock();
    expect(isUnlocked(FAMILY, 1_000_000)).toBe(false);
  });

  test("needs a family at all", () => {
    grantUnlock(FAMILY, 1_000_000);
    expect(isUnlocked(undefined, 1_000_000)).toBe(false);
  });
});

test.describe("the old marker", () => {
  test("does not count as an unlock", () => {
    // An instance upgrading mid-session has the bare string sitting there. An
    // unlock whose age cannot be read is treated as no unlock, so it re-prompts
    // once. That is the safe direction, and the only one available.
    sessionStorage.setItem("kinboard_settings_unlock", "unlocked");
    expect(isUnlocked(FAMILY, 1_000_000)).toBe(false);
  });

  test("neither does anything else unreadable", () => {
    for (const junk of ["", "{}", "null", "[]", '{"familyId":"fam-1"}', '{"at":123}', "not json"]) {
      sessionStorage.setItem("kinboard_settings_unlock", junk);
      expect(isUnlocked(FAMILY, 1_000_000), `"${junk}" should not unlock`).toBe(false);
    }
  });
});

test.describe("leaving Settings", () => {
  test("only paths inside Settings keep the unlock", () => {
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/settings/people")).toBe(true);
    expect(isSettingsPath("/settings/photos/icloud")).toBe(true);
    expect(isSettingsPath("/")).toBe(false);
    expect(isSettingsPath("/calendar")).toBe(false);
    // Must not match a path that merely starts with the same letters.
    expect(isSettingsPath("/settings-export")).toBe(false);
    expect(isSettingsPath("/settingsomething")).toBe(false);
  });

  test("the reaper is mounted where it can see the route change", () => {
    /*
      It cannot live in PinGuard. The guard is rendered by the settings layout,
      so it has already unmounted by the time the path changes and never sees
      the transition — and clearing from its unmount cleanup would misfire under
      StrictMode in development, dropping the unlock right after granting it.
    */
    const providers = readFileSync("src/app/providers.tsx", "utf8");
    expect(providers, "the reaper should be mounted in providers").toContain(
      "<SettingsUnlockReaper />",
    );
    expect(providers).toMatch(/if \(!isSettingsPath\(pathname\)\) clearUnlock\(\)/);

    const guard = readFileSync("src/components/pin-guard.tsx", "utf8");
    expect(
      guard,
      "PinGuard must not clear the unlock on unmount — StrictMode would drop it " +
        "immediately after it was granted",
    ).not.toMatch(/return \(\) => \{?\s*clearUnlock/);
  });
});
