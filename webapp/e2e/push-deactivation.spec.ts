import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Deactivation used to be a boolean, set for *any* 4xx. That reads
 * backwards: a 400 or 401 from a push service is nearly always a complaint
 * about our request — a mistyped VAPID key, a bad payload — not news that
 * the device is gone. Since every subscription goes out with the same keys,
 * one such mistake unsubscribed every device in the family at once,
 * silently, with no way back but re-enabling notifications by hand on each.
 *
 * These reimplement the batch rule against the same table of status codes,
 * plus a source check that the shipped file still classifies them that way.
 */

type Verdict = "gone" | "suspect" | false;

function classify(statusCode: number | undefined): Verdict {
  if (statusCode === 404 || statusCode === 410) return "gone";
  if (statusCode === 401 || statusCode === 403) return false;
  if (statusCode === 413 || statusCode === 429) return false;
  if (statusCode && statusCode >= 400 && statusCode < 500) return "suspect";
  return false;
}

/** The rule sendPushToMultiple applies. */
function batchDeactivations(outcomes: Array<number | undefined | "ok">): number {
  const sent = outcomes.filter((o) => o === "ok").length;
  const verdicts = outcomes
    .filter((o): o is number | undefined => o !== "ok")
    .map((o) => classify(o));
  const gone = verdicts.filter((v) => v === "gone").length;
  const suspect = verdicts.filter((v) => v === "suspect").length;
  return gone + (sent > 0 ? suspect : 0);
}

test("the codes that mean the subscription is gone still deactivate", () => {
  expect(classify(404)).toBe("gone");
  expect(classify(410)).toBe("gone");
  expect(batchDeactivations([404, 410, "ok"])).toBe(2);
  // Even alone, with nothing sent, a 410 is definitive.
  expect(batchDeactivations([410])).toBe(1);
});

test("bad VAPID keys no longer wipe every device", () => {
  // The scenario: keys rotated wrong, so every device gets 401.
  expect(classify(401)).toBe(false);
  expect(classify(403)).toBe(false);
  expect(batchDeactivations([401, 401, 401, 401])).toBe(0);
});

test("a batch-wide 400 is treated as our bug, not four dead devices", () => {
  expect(batchDeactivations([400, 400, 400, 400])).toBe(0);
});

test("an ambiguous 4xx is trusted when other devices in the batch went through", () => {
  // One device failing 400 while three succeed really is that device.
  expect(batchDeactivations([400, "ok", "ok", "ok"])).toBe(1);
});

test("transient failures never deactivate", () => {
  for (const code of [429, 413, 500, 502, 503, 504, undefined]) {
    expect(classify(code), String(code)).toBe(false);
  }
  expect(batchDeactivations([500, 503, undefined])).toBe(0);
  // A rate-limited batch keeps everyone, even mixed with successes.
  expect(batchDeactivations([429, 429, "ok"])).toBe(0);
});

test("the shipped sender classifies these the same way", () => {
  const source = readFileSync(
    join(__dirname, "..", "src", "lib", "push-sender.ts"),
    "utf8",
  );
  // 401/403 must not deactivate.
  const authBlock = source.slice(source.indexOf("statusCode === 401"));
  expect(authBlock.slice(0, 600)).toContain("shouldDeactivate: false");
  // The generic 4xx must be suspect, not an outright deactivation.
  const genericBlock = source.slice(source.indexOf("statusCode >= 400"));
  expect(genericBlock.slice(0, 400)).toContain('shouldDeactivate: "suspect"');
  // And the batch must gate suspects on at least one success.
  expect(source).toContain("if (sent > 0)");
});

test("the test-send button only deactivates on a definitive code", () => {
  const source = readFileSync(
    join(__dirname, "..", "src", "app", "api", "notifications", "send-test", "route.ts"),
    "utf8",
  );
  expect(source).toContain('result.shouldDeactivate === "gone"');
});
