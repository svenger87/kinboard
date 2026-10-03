import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { establishSession } from "./session";
import { storedRowIsStale } from "../src/lib/stored-row";

/**
 * A device's stored family and device rows repair themselves.
 *
 * The family store (`family-calendar-storage`) is written at sign-in and then
 * kept for as long as the session lives. #271 stopped /api/session/resume
 * from answering with `families(id, name)` and a `{ id, name }` device, but
 * that only changed what *future* resumes return: a device that had already
 * stored the partial rows kept them, so Settings went on drawing the family
 * card with the household's name and a blank where the code belongs, and a
 * wall panel stayed without `is_kiosk`.
 *
 * The periodic checks were already reading the database — the family check
 * every five minutes, the heartbeat every minute — but the family check
 * selected only `id`, so it confirmed the family existed and repaired nothing.
 * Both now read the whole row and write it back when the stored copy differs.
 */

const hooks = readFileSync("src/hooks/use-supabase-queries.ts", "utf8");

function hookSource(name: string): string {
  const start = hooks.indexOf(`export function ${name}(`);
  expect(start, `could not find ${name} — did it move?`).toBeGreaterThan(-1);
  const next = hooks.indexOf("\nexport function ", start + 1);
  return hooks.slice(start, next === -1 ? undefined : next);
}

test("the family check reads the whole row, not just the id", () => {
  const src = hookSource("useValidateStoredFamily");
  const select = src.match(/\.from\("families"\)\s*\.select\((["'`])([^"'`]*)\1\)/);
  expect(select, "could not find the families select in the family check").toBeTruthy();
  expect(
    select![2],
    "the family check selects part of the row, so it can confirm the family " +
      "exists but cannot repair a stored family that is missing columns",
  ).toBe("*");
});

test("the family check writes a differing row back into the store", () => {
  const src = hookSource("useValidateStoredFamily");
  expect(src, "the family check never writes the fresh row into the store").toMatch(
    /storedRowIsStale\(stored, data\)\)\s*\{\s*setFamily\(data/,
  );
  // An orphan still signs out, and a failed read still leaves everything alone.
  expect(src).toMatch(/if \(data === null\) return false;/);
  expect(src).toMatch(/if \(error\) \{[\s\S]*?return null;\s*\}/);
});

test("the heartbeat replaces a differing device row instead of merging into it", () => {
  const src = hookSource("useUpdateDeviceLastSeen");
  expect(src).toMatch(/\.select\("\*"\)/);
  expect(
    src,
    "the heartbeat must compare by value and write the whole fresh row",
  ).toMatch(/storedRowIsStale\(current, row, \["last_seen"\]\)\) setDevice\(row\)/);
});

test("nothing writes a hand-typed partial family or device into the store", () => {
  // useQuickRejoin used to type the resume response as `{ id, name }` and
  // cast its way into setFamily/setDevice.
  expect(hooks).not.toMatch(/set(Family|Device)\([^)]*as never\)/);
  expect(hooks).not.toMatch(/family:\s*\{\s*id:\s*string;\s*name:\s*string\s*\};/);
});

test.describe("storedRowIsStale", () => {
  const family = {
    id: "f1",
    name: "Home",
    join_code: "ABC123",
    join_code_expires_at: null,
    setup_completed: true,
  };

  test("a stored family missing its code is stale", () => {
    expect(storedRowIsStale({ id: "f1", name: "Home" }, family)).toBe(true);
  });

  test("an identical row is not", () => {
    expect(storedRowIsStale({ ...family }, family)).toBe(false);
  });

  test("a changed value is", () => {
    expect(storedRowIsStale({ ...family, join_code: "ZZZ999" }, family)).toBe(true);
  });

  test("a column the fresh row no longer has is", () => {
    expect(storedRowIsStale({ ...family, gone: 1 }, family)).toBe(true);
  });

  test("arrays compare by value, so the heartbeat does not rewrite every minute", () => {
    const device = { id: "d1", fingerprint_history: ["a", "b"], last_seen: "1" };
    expect(storedRowIsStale(device, { ...device, fingerprint_history: ["a", "b"] })).toBe(false);
    expect(storedRowIsStale(device, { ...device, fingerprint_history: ["a"] })).toBe(true);
  });

  test("ignored columns do not count", () => {
    const device = { id: "d1", is_kiosk: true, last_seen: "1" };
    expect(storedRowIsStale(device, { ...device, last_seen: "2" }, ["last_seen"])).toBe(false);
    expect(storedRowIsStale({ id: "d1", last_seen: "1" }, device, ["last_seen"])).toBe(true);
  });

  test("no stored row is stale", () => {
    expect(storedRowIsStale(null, family)).toBe(true);
  });
});

const FAMILY_CODE = process.env.FAMILY_CODE;

test.describe("against a running instance", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE");

  test("a stored family without its code gets it back in Settings", async ({ page, context }) => {
    await establishSession(page, FAMILY_CODE!, "claude-store-heal");

    // Rewrite the store cookie the way a pre-#271 resume left it: the
    // family as `{ id, name }`, the device as `{ id, name }`.
    const cookies = await context.cookies();
    const store = cookies.find((c) => c.name === "family-calendar-storage");
    expect(store, "establishSession did not leave a store cookie").toBeTruthy();
    const parsed = JSON.parse(decodeURIComponent(store!.value)) as {
      state: { family: { id: string; name: string }; device: { id: string; name: string } };
      version: number;
    };
    const partial = {
      state: {
        family: { id: parsed.state.family.id, name: parsed.state.family.name },
        device: { id: parsed.state.device.id, name: parsed.state.device.name },
      },
      version: parsed.version,
    };
    await context.addCookies([
      { ...store!, value: encodeURIComponent(JSON.stringify(partial)) },
    ]);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByTestId("family-join-code"),
      "the family code never came back — the stored family was not repaired",
    ).toHaveText(/^[A-Z0-9]{4,}$/, { timeout: 20_000 });

    // And the cookie itself was repaired, not just the screen.
    await expect
      .poll(async () => {
        const c = (await context.cookies()).find((x) => x.name === "family-calendar-storage");
        const s = JSON.parse(decodeURIComponent(c!.value)) as {
          state: { family: Record<string, unknown>; device: Record<string, unknown> };
        };
        return {
          familyHasCode: typeof s.state.family.join_code === "string",
          deviceHasKiosk: "is_kiosk" in s.state.device,
        };
      }, { timeout: 20_000 })
      .toEqual({ familyHasCode: true, deviceHasKiosk: true });
  });
});
