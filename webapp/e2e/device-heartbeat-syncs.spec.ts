import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";

/**
 * A device has to notice changes made to it from somewhere else.
 *
 * `useUpdateDevice` writes the store only when the device being changed is the
 * one you are looking at:
 *
 *   if (currentDevice?.id === data.id) setDevice(data);
 *
 * which is right for the device you are on and leaves every other one stale.
 * Flag the kitchen panel as a kiosk from your phone and the database has it
 * while the panel does not — so `data-kiosk` never goes on, the body
 * scrollbar stays (globals.css gates it on `html[data-kiosk]`) and
 * useReturnToDashboard stays off. Nothing refetched the row, so the panel
 * kept the copy it was handed when it joined, potentially for months.
 *
 * The heartbeat is the fix's natural home: it already writes to that exact
 * row on mount and on a timer, so reading the row back costs one round trip
 * that was already happening.
 */

const source = readFileSync("src/hooks/use-supabase-queries.ts", "utf8");

test("the heartbeat reads the device row back", () => {
  const fn = source.slice(
    source.indexOf("export function useUpdateDeviceLastSeen"),
    source.indexOf("export function", source.indexOf("export function useUpdateDeviceLastSeen") + 10),
  );
  expect(fn, "could not find useUpdateDeviceLastSeen").toBeTruthy();
  expect(
    fn,
    "the heartbeat updates last_seen and reads nothing back, so a device never " +
      "learns about a change made to it from another screen",
  ).toMatch(/\.select\(/);
});

test("the heartbeat puts what it read into the store", () => {
  const fn = source.slice(
    source.indexOf("export function useUpdateDeviceLastSeen"),
    source.indexOf("export function", source.indexOf("export function useUpdateDeviceLastSeen") + 10),
  );
  expect(
    fn,
    "the heartbeat reads the row but never updates the store, so the stale " +
      "copy survives anyway",
  ).toContain("setDevice");
});

const FAMILY_CODE = process.env.FAMILY_CODE;

test.describe("against a running instance", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE");

  // Same shape as rooms-migration.spec.ts: the change has to come from
  // outside this browser, because that is the whole scenario — the flag is
  // flipped on another screen and this one is told nothing.
  const psql = (sql: string) =>
    execFileSync(
      "docker",
      ["exec", "-i", process.env.KB_DB_CONTAINER ?? "kbfresh-db", "psql", "-U", "postgres",
       "-d", "postgres", "-tA", "-q", "-c", sql],
      { encoding: "utf8" },
    ).trim();

  test("a device picks up a kiosk flag set from elsewhere", async ({ page }) => {
    await establishSession(page, FAMILY_CODE!, "claude-heartbeat");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const before = await page.evaluate(() => document.documentElement.hasAttribute("data-kiosk"));
    expect(before, "should not start as a kiosk").toBe(false);

    // Somebody flags this panel as a kiosk from another screen. The DB gets it;
    // this device is told nothing.
    const deviceId = await page.evaluate(() => {
      const c = document.cookie.split("; ").find((x) => x.startsWith("family-calendar-storage="));
      return JSON.parse(decodeURIComponent(c!.split("=").slice(1).join("="))).state.device.id;
    });
    psql(`UPDATE devices SET is_kiosk = true WHERE id = '${deviceId}';`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const after = await page.evaluate(() => ({
      dataKiosk: document.documentElement.hasAttribute("data-kiosk"),
      stored: (() => {
        const c = document.cookie.split("; ").find((x) => x.startsWith("family-calendar-storage="));
        return JSON.parse(decodeURIComponent(c!.split("=").slice(1).join("="))).state.device?.is_kiosk;
      })(),
    }));
    expect(after.stored, "the store still holds the stale device row").toBe(true);
    expect(after.dataKiosk, "data-kiosk never went on, so the panel is not a kiosk").toBe(true);
  });
});
