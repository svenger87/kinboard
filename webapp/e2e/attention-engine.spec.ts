import { test, expect } from "@playwright/test";
import { evaluate, resolveDayContext, localMinutes } from "../src/lib/attention/engine";
import { RULES, RULES_BY_ID } from "../src/lib/attention/rules";
import type { Signals } from "../src/lib/attention/types";

/**
 * The Heute-Motor's exit criteria, as tests.
 *
 * "Rules reproducibly testable; same data → same items" is the first one, and
 * it is a property of the design rather than of any single rule — so it is
 * checked here against the whole engine, not rule by rule.
 *
 * Pure functions, no stack: this runs in CI's stack-free specs job.
 */

const TZ = "Europe/Berlin";

/** A Berlin wall-clock time, as an instant. */
function at(iso: string): Date {
  return new Date(iso);
}

function signals(overrides: Partial<Signals> = {}): Signals {
  return {
    now: at("2026-08-10T06:00:00+02:00"), // Monday morning
    timeZone: TZ,
    events: [],
    todos: [],
    lessons: [],
    meals: [],
    birthdays: [],
    shoppingItemCount: 0,
    ...overrides,
  };
}

test.describe("day contexts", () => {
  test("the plan's ranges, in the family's timezone", () => {
    expect(resolveDayContext(at("2026-08-10T06:00:00+02:00"), TZ)).toBe("morning");
    expect(resolveDayContext(at("2026-08-10T15:00:00+02:00"), TZ)).toBe("afternoon");
    expect(resolveDayContext(at("2026-08-10T19:00:00+02:00"), TZ)).toBe("evening");
    expect(resolveDayContext(at("2026-08-10T23:30:00+02:00"), TZ)).toBe("quiet");
  });

  test("the middle of the day is quiet, not a fourth rush", () => {
    // 09:00-14:00 belongs to nobody. Stretching the ranges to cover every
    // minute would mean something is always urgent, which is how a display
    // becomes wallpaper.
    expect(resolveDayContext(at("2026-08-10T11:00:00+02:00"), TZ)).toBe("quiet");
  });

  test("a family's morning does not move with the clocks", () => {
    // Same wall-clock time, opposite sides of the DST change. Arithmetic on a
    // fixed UTC offset would put one of these in the wrong context.
    expect(localMinutes(at("2026-08-10T07:30:00+02:00"), TZ)).toBe(7 * 60 + 30);
    expect(localMinutes(at("2026-01-12T07:30:00+01:00"), TZ)).toBe(7 * 60 + 30);
  });
});

test.describe("determinism", () => {
  test("the same data produces the same items", () => {
    const input = signals({
      now: at("2026-08-10T19:00:00+02:00"),
      lessons: [
        { personId: "p1", personName: "Henrik", dayOfWeek: 2, period: 1, subject: "Sport", packList: ["Sportzeug"] },
      ],
      todos: [
        { id: "t1", title: "Müll", dueDate: at("2026-08-09T12:00:00+02:00"), completed: false, personId: null, personName: null },
      ],
    });

    const a = evaluate(input, RULES);
    const b = evaluate(input, RULES);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
  });

  test("the order does not depend on the order the rules were declared", () => {
    const input = signals({
      now: at("2026-08-10T19:00:00+02:00"),
      lessons: [
        { personId: "p1", personName: "Henrik", dayOfWeek: 2, period: 1, subject: "Sport", packList: ["Sportzeug"] },
      ],
      todos: [
        { id: "t1", title: "Müll", dueDate: at("2026-08-09T12:00:00+02:00"), completed: false, personId: null, personName: null },
      ],
    });

    const forwards = evaluate(input, RULES).map((i) => i.key);
    const backwards = evaluate(input, [...RULES].reverse()).map((i) => i.key);
    expect(backwards).toEqual(forwards);
  });

  test("an item's key survives time passing", () => {
    // The acknowledgement a family makes at 07:00 has to still apply at 07:01,
    // which it only does if the key does not contain the countdown.
    const event = {
      id: "e1",
      title: "Physio",
      startAt: at("2026-08-10T06:30:00+02:00"),
      endAt: at("2026-08-10T07:30:00+02:00"),
      allDay: false,
      location: null,
      personId: null,
      personName: null,
    };
    const first = evaluate(signals({ now: at("2026-08-10T06:00:00+02:00"), events: [event] }), RULES);
    const later = evaluate(signals({ now: at("2026-08-10T06:10:00+02:00"), events: [event] }), RULES);

    expect(first.map((i) => i.key)).toEqual(later.map((i) => i.key));
    // ...while the wording still moves.
    expect(first[0].detail).not.toBe(later[0].detail);
  });
});

test.describe("a family can turn a rule off", () => {
  test("a disabled rule produces nothing", () => {
    const input = signals({
      now: at("2026-08-10T06:00:00+02:00"),
      birthdays: [{ id: "b1", name: "Nora", date: at("2026-08-10T00:00:00+02:00"), daysUntil: 0 }],
    });
    expect(evaluate(input, RULES).some((i) => i.ruleId === "birthday-today")).toBe(true);

    const off = evaluate(input, RULES, {
      ruleState: { "birthday-today": { enabled: false, config: {} } },
    });
    expect(off.some((i) => i.ruleId === "birthday-today")).toBe(false);
  });

  test("no stored state means every rule is on", () => {
    const input = signals({
      now: at("2026-08-10T06:00:00+02:00"),
      birthdays: [{ id: "b1", name: "Nora", date: at("2026-08-10T00:00:00+02:00"), daysUntil: 0 }],
    });
    expect(evaluate(input, RULES, {}).some((i) => i.ruleId === "birthday-today")).toBe(true);
  });

  test("per-family config overrides the rule's default", () => {
    const input = signals({
      now: at("2026-08-10T06:00:00+02:00"),
      birthdays: [{ id: "b1", name: "Femke", date: at("2026-08-24T00:00:00+02:00"), daysUntil: 14 }],
    });
    expect(evaluate(input, RULES).some((i) => i.ruleId === "birthday-soon")).toBe(false);

    const earlier = evaluate(input, RULES, {
      ruleState: { "birthday-soon": { enabled: true, config: { daysAhead: 14 } } },
    });
    expect(earlier.some((i) => i.ruleId === "birthday-soon")).toBe(true);
  });
});

test.describe("every item can be explained and traced", () => {
  test("each carries the rule that raised it", () => {
    const input = signals({
      now: at("2026-08-10T19:00:00+02:00"),
      lessons: [
        { personId: "p1", personName: "Henrik", dayOfWeek: 2, period: 1, subject: "Sport", packList: ["Sportzeug"] },
      ],
    });
    const items = evaluate(input, RULES);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(RULES_BY_ID[item.ruleId], `unknown rule ${item.ruleId}`).toBeTruthy();
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.evidence).toBeTruthy();
    }
  });
});

test.describe("a family without Home Assistant still gets value", () => {
  test("no weather and no home signals is silence, not an error", () => {
    const input = signals({
      now: at("2026-08-10T19:00:00+02:00"),
      lessons: [
        { personId: "p1", personName: "Henrik", dayOfWeek: 2, period: 1, subject: "Sport", packList: ["Sportzeug"] },
      ],
    });
    const items = evaluate(input, RULES);
    expect(items.some((i) => i.ruleId === "pack-the-school-bag")).toBe(true);
    expect(items.some((i) => i.ruleId === "take-an-umbrella")).toBe(false);
    expect(items.some((i) => i.ruleId === "lock-up-before-bed")).toBe(false);
  });

  test("most of the shipped rules need nothing beyond Kinboard's own data", () => {
    const needsIntegration = ["take-an-umbrella", "lock-up-before-bed"];
    expect(RULES.length).toBe(10);
    expect(RULES.filter((r) => !needsIntegration.includes(r.id)).length).toBe(8);
  });
});

test.describe("one bad rule does not take the board down", () => {
  test("a rule that throws is skipped, the rest still run", () => {
    const exploding = {
      id: "exploding",
      title: "Boom",
      description: "Throws.",
      evaluate: () => {
        throw new Error("boom");
      },
    };
    const input = signals({
      now: at("2026-08-10T06:00:00+02:00"),
      birthdays: [{ id: "b1", name: "Nora", date: at("2026-08-10T00:00:00+02:00"), daysUntil: 0 }],
    });
    const items = evaluate(input, [exploding, ...RULES]);
    expect(items.some((i) => i.ruleId === "birthday-today")).toBe(true);
    expect(items.some((i) => i.ruleId === "exploding")).toBe(false);
  });
});

test.describe("rule ids are a contract", () => {
  test("they are unique and stable-looking", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      // A family's "off" switch is stored against this string, so it has to be
      // the kind of thing nobody renames casually.
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});
