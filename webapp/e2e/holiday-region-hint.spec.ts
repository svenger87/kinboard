import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { answerStillHolds, evaluate } from "../src/lib/attention/engine";
import { RULES, RULES_BY_ID } from "../src/lib/attention/rules";
import type { Signals } from "../src/lib/attention/types";
import type { HolidayRegionSetting } from "../src/lib/holidays/region";
import { codeOnly } from "./source-helpers";

/** Maintainer decision: ask once, dismissibly, a family whose region nobody chose. */

const DAY = 24 * 60 * 60 * 1000;
function signals(holidayRegion: HolidayRegionSetting | null | undefined, now = "2026-10-05T19:00:00+02:00"): Signals {
  return {
    now: new Date(now), timeZone: "Europe/Berlin", events: [], todos: [], lessons: [], schoolBreaks: [],
    meals: [], birthdays: [], shoppingItemCount: 0, holidayRegion,
  };
}
const asked = (s: Signals) => evaluate(s, RULES).filter((i) => i.ruleId === "holiday-region");

test("asks a family whose migrated region nobody chose", () => {
  const items = asked(signals({ code: "DE-NI", chosen: false }));
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ key: "holiday-region", messageKey: "holiday-region.migrated", title: "Which state are you in?" });
});

test("asks a family with no region at all, in other words", () => {
  expect(asked(signals({ code: null, chosen: false }))[0]?.messageKey).toBe("holiday-region.unset");
});

test("asks once more, under its own key, when only the country was chosen (final review #6)", () => {
  // The wizard's guess saved with one tap on Next: national holidays only.
  const items = asked(signals({ code: "DE", chosen: true }));
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ key: "holiday-region-state", messageKey: "holiday-region.country", evidence: { region: "DE" } });
  expect(asked(signals({ code: "AT", chosen: true }))[0]?.key).toBe("holiday-region-state");
  // A country with no states to pick has nothing to ask.
  expect(asked(signals({ code: "NL", chosen: true }))).toEqual([]);
  for (const l of ["en", "de", "fr"]) {
    const hints = JSON.parse(readFileSync(join(process.cwd(), `messages/${l}.json`), "utf8")).attention.hints["holiday-region"];
    expect(hints.country.title, l).toBe(hints.migrated.title);
    expect(hints.country.detail, l).toBeTruthy();
  }
});

test("is quiet once chosen, when the setting can't be read, without a row, and with no state to pick", () => {
  expect(asked(signals({ code: "DE-BY", chosen: true }))).toEqual([]);
  expect(asked(signals(undefined))).toEqual([]);
  expect(asked(signals(null))).toEqual([]);
  expect(asked(signals({ code: "NL", chosen: false }))).toEqual([]);
});

test("speaks in every part of the day, so it is never resolved and re-raised at a context boundary", () => {
  expect(RULES_BY_ID["holiday-region"].contexts).toBeUndefined();
  expect(asked(signals({ code: "DE-NI", chosen: false }, "2026-10-05T11:00:00+02:00"))).toHaveLength(1);
});

test("an answer to it holds for good; any other rule's for a day", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  expect(RULES_BY_ID["holiday-region"].once).toBe(true);
  expect(answerStillHolds(RULES_BY_ID["holiday-region"], new Date(now.getTime() - 400 * DAY), now, DAY)).toBe(true);
  expect(answerStillHolds(RULES_BY_ID["school-tomorrow"], new Date(now.getTime() - 2 * DAY), now, DAY)).toBe(false);
  expect(answerStillHolds(RULES_BY_ID["school-tomorrow"], new Date(now.getTime() - DAY / 2), now, DAY)).toBe(true);
});

test("the runner applies that to every answered key", () => {
  const runner = codeOnly(readFileSync(join(process.cwd(), "src/lib/attention/runner.ts"), "utf8"));
  expect(runner).toContain("answerStillHolds(RULES_BY_ID[r.rule_id]");
  expect(runner).not.toContain('.gte("resolved_at"');
});

test("the hint links to Settings → Holidays", () => {
  const widget = readFileSync(join(process.cwd(), "src/components/widgets/attention-widget.tsx"), "utf8");
  expect(widget).toContain('"holiday-region": "/settings/holidays"');
});
