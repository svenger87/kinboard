import { test, expect } from "@playwright/test";
import { evaluate } from "../src/lib/attention/engine";
import { RULES } from "../src/lib/attention/rules";
import type { Signals } from "../src/lib/attention/types";

/**
 * What reconciliation has to preserve.
 *
 * The runner itself talks to the database, so it is covered by running it for
 * real rather than here. What *can* be pinned without a database is the
 * property the whole design rests on: that the identity of an item is stable
 * across evaluations, because everything the family does — acknowledging,
 * snoozing, dismissing — is stored against that identity and would be lost the
 * moment it changed.
 */

const TZ = "Europe/Berlin";

function signals(overrides: Partial<Signals> = {}): Signals {
  return {
    now: new Date("2026-08-10T19:00:00+02:00"),
    timeZone: TZ,
    events: [],
    todos: [],
    lessons: [],
    schoolBreaks: [],
    meals: [],
    birthdays: [],
    shoppingItemCount: 0,
    ...overrides,
  };
}

const LESSONS = [
  { personId: "p1", personName: "Henrik", dayOfWeek: 2, period: 1, subject: "Sport", packList: ["Sportzeug"] },
];

test("an item keeps its identity as the evening wears on", () => {
  // Same situation, three evaluations twenty minutes apart. If the keys moved,
  // the runner would resolve the old row and raise a new one each time — and
  // an acknowledgement made at 19:00 would be gone by 19:20.
  const keys = ["19:00", "19:20", "19:40"].map((t) => {
    const items = evaluate(
      signals({ now: new Date(`2026-08-10T${t}:00+02:00`), lessons: LESSONS }),
      RULES
    );
    return items.map((i) => i.key).sort().join("|");
  });
  expect(new Set(keys).size).toBe(1);
});

test("a situation that ends stops being proposed, so the runner can resolve it", () => {
  const withLesson = evaluate(signals({ lessons: LESSONS }), RULES).map((i) => i.key);
  expect(withLesson).toContain("pack-the-school-bag:2026-08-11:p1");

  // The timetable changed: no lesson tomorrow. The key disappears from the
  // proposal, which is exactly the signal the runner turns into resolved_at.
  const without = evaluate(signals({ lessons: [] }), RULES).map((i) => i.key);
  expect(without).not.toContain("pack-the-school-bag:2026-08-11:p1");
});

test("the same situation on a different day is a different item", () => {
  // Otherwise "already dealt with" would silence it forever: acknowledge
  // tonight's sports kit and you would never be reminded again.
  const tonight = evaluate(signals({ lessons: LESSONS }), RULES).map((i) => i.key);
  const nextWeek = evaluate(
    signals({ now: new Date("2026-08-17T19:00:00+02:00"), lessons: LESSONS }),
    RULES
  ).map((i) => i.key);

  const pack = (ks: string[]) => ks.find((k) => k.startsWith("pack-the-school-bag:"));
  expect(pack(tonight)).toBeTruthy();
  expect(pack(nextWeek)).toBeTruthy();
  expect(pack(tonight)).not.toBe(pack(nextWeek));
});

test("every proposed item names a rule that can be switched off", () => {
  // The plan forbids a hint that cannot be explained or disabled, and the
  // runner stores rule_id for exactly that. An item whose rule is unknown
  // would be a dead end in the interface.
  const items = evaluate(signals({ lessons: LESSONS }), RULES);
  expect(items.length).toBeGreaterThan(0);
  const ids = new Set(RULES.map((r) => r.id));
  for (const item of items) expect(ids.has(item.ruleId)).toBe(true);
});
