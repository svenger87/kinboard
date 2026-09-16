import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { establishSession } from "./session";

/**
 * Title-based person mapping rules are not a Google feature.
 *
 * `caldav-sync.ts:145` and `ics-sync.ts:107` call the same
 * `matchPersonForEvent` as `google/sync/route.ts:303`, against the same
 * family-wide list — both read `mapping_rules` off the `google_calendar`
 * settings row. So a CalDAV or `.ics` household's events are coloured by
 * those rules exactly like a Google household's.
 *
 * The editor for them, however, sat inside `{isConnected && (` on the Google
 * settings page: the engine honoured rules that the people relying on it had
 * no way to write. CalDAV is the option the docs recommend to anyone outside
 * the Google ecosystem, so this was aimed squarely at them.
 *
 * Nothing else was in the way — `/api/settings` answers a missing row with
 * `{ value: null }` and a 200 rather than a 404, and the Test button's
 * sample titles come from `useEvents`, which is provider-agnostic.
 */

const source = readFileSync("src/app/settings/google/page.tsx", "utf8");

/** The span of the `{isConnected && (...)}` block, by character offset. */
const connectedBlock = (() => {
  const start = source.indexOf("{isConnected && (");
  expect(start, "could not find the isConnected gate — did it move?").toBeGreaterThan(-1);
  // The fragment is closed by the first `)}` sitting at the block's own
  // indentation; anything deeper belongs to something nested inside it.
  const close = source.indexOf("\n          )}", start);
  expect(close, "could not find the end of the isConnected gate").toBeGreaterThan(-1);
  return { start, end: close };
})();

test("the mapping rule editor is not gated behind a Google connection", () => {
  const marker = source.indexOf("{/* Person Mapping Rules */}");
  expect(marker, "could not find the mapping rules block — did it move?").toBeGreaterThan(-1);

  const gated = marker > connectedBlock.start && marker < connectedBlock.end;
  expect(
    gated,
    "the mapping rule editor renders only when Google is connected, so a " +
      "CalDAV- or ICS-only family cannot create a rule — while caldav-sync " +
      "and ics-sync go on applying rules they cannot see or change",
  ).toBe(false);
});

test("the Google calendar list IS still gated — ungating went no further", () => {
  // The guard above must not be satisfiable by deleting the gate wholesale:
  // picking which Google calendars to sync is meaningless without Google.
  const marker = source.indexOf("{/* Sync Status */}");
  expect(marker, "could not find the sync status block — did it move?").toBeGreaterThan(-1);
  expect(marker).toBeGreaterThan(connectedBlock.start);
  expect(marker).toBeLessThan(connectedBlock.end);
});

const FAMILY_CODE = process.env.FAMILY_CODE;

test.describe("in the browser", () => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE");

  test("a family with no Google account can still reach the rule editor", async ({ page }) => {
    await establishSession(page, FAMILY_CODE!, "claude-mapping");
    await page.goto("/settings/google", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    // Not connected: the connect prompt is what a fresh family sees.
    await expect(page.getByRole("button", { name: /add rule/i }).first()).toBeVisible();
  });
});
