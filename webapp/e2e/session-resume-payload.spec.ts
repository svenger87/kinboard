import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { establishSession } from "./session";

/**
 * A resumed session has to be indistinguishable from a fresh join.
 *
 * `useRestoreSession` writes the resume response straight into the persisted
 * family store — `setFamily(result.family)`, `setDevice(result.device)` — and
 * nothing ever refetches either. So whatever this endpoint leaves out is gone
 * from that device until somebody types the family code in again.
 *
 * It left out two things that matter, and both were reported from a real
 * household before anything here caught them:
 *
 *   family.join_code  — Settings renders the family card from the store, so
 *                       the card appeared with the household's name and a
 *                       blank space where the join code belongs.
 *   device.is_kiosk   — KioskProvider puts `data-kiosk` on <html> from this
 *                       value. Without it the wall panel stops being a kiosk:
 *                       the body scrollbar comes back (globals.css gates it on
 *                       `html[data-kiosk]`) and useReturnToDashboard switches
 *                       off.
 *
 * It fired only when a resume actually happened — which needs the cookie's
 * family to be missing — so it lay unnoticed from 2026-08-09 until a device
 * lost its cookie. Safari caps script-set cookies at 7 days, which is what
 * makes it come round weekly on an iPhone PWA.
 */

const source = readFileSync("src/app/api/session/resume/route.ts", "utf8");

test("resume asks the database for the whole family, not two columns", () => {
  const select = source.match(/\.select\((["'`])([^"'`]*families\([^)]*\)[^"'`]*)\1\)/);
  expect(select, "could not find the device select — did it move?").toBeTruthy();
  expect(
    select![2],
    "resume selects only part of the family, and useRestoreSession persists " +
      "exactly what it returns — so whatever is missing here is missing from " +
      "that device's Settings screen until it rejoins",
  ).toContain("families(*)");
});

test("resume returns the device row it read, not a hand-built subset", () => {
  expect(
    source,
    "the response builds a device object by naming fields, so any column not " +
      "named here (is_kiosk, and anything added later) is dropped from the store",
  ).not.toMatch(/device:\s*\{\s*id:\s*row\.id/);
});

const FAMILY_CODE = process.env.FAMILY_CODE;

test.describe("against a running instance", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE");

  test("a resumed session carries the join code and the kiosk flag", async ({ page }) => {
    await establishSession(page, FAMILY_CODE!, "claude-resume-guard");
    await page.goto("/join", { waitUntil: "domcontentloaded" });

    const payload = await page.evaluate(async () => {
      const rec = await fetch("/api/session/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hardware_id: "e2e-claude-resume-guard" }),
      });
      const { devices } = await rec.json();
      const known = (devices ?? []).find((d: { match: string }) => d.match === "hardware");
      if (!known) return { error: "device not recognised" };

      const res = await fetch("/api/session/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ device_id: known.device.id, hardware_id: "e2e-claude-resume-guard" }),
      });
      const body = await res.json();
      return {
        hasJoinCode: "join_code" in (body.family ?? {}),
        hasIsKiosk: "is_kiosk" in (body.device ?? {}),
      };
    });

    expect(payload.error, `recognise failed: ${payload.error}`).toBeUndefined();
    expect(payload.hasJoinCode, "the family code is missing from a resumed session").toBe(true);
    expect(payload.hasIsKiosk, "the kiosk flag is missing from a resumed session").toBe(true);
  });
});
