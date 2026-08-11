import { test, expect } from "@playwright/test";
import { evaluate } from "../src/lib/attention/engine";
import { RULES } from "../src/lib/attention/rules";
import { isSchoolBreakOn } from "../src/lib/attention/types";
import type { Signals } from "../src/lib/attention/types";

/**
 * School holidays silence the school-derived hints and nothing else.
 *
 * The timetable in `schedules` is per weekday, so before this the school-bag
 * hint fired every evening of the summer: Monday still has sport on it whether
 * or not anybody is going. A holiday is a date range, which no amount of
 * weekday data can express — hence a separate signal.
 *
 * The boundary cases are the point. A range is inclusive on both ends, and the
 * evening-before/morning-of split in `pack-the-school-bag` means the rule asks
 * about two different days depending on when it runs; getting either edge
 * wrong shows up as a hint on the first morning of the holidays, or silence on
 * the evening before term restarts.
 */

const TZ = "Europe/Berlin";

function signals(overrides: Partial<Signals> = {}): Signals {
  return {
    now: new Date("2026-08-10T18:00:00+02:00"), // Monday evening
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

/** Tuesday has sport, so the evening before is when the bag gets packed. */
const sportOnTuesday = [
  {
    personId: "p1",
    personName: "Mira",
    dayOfWeek: 2,
    period: 1,
    subject: "Sport",
    packList: ["Sportzeug"],
  },
];

const summer = {
  name: "Sommerferien",
  startsOn: "2026-08-11",
  endsOn: "2026-08-21",
  source: "manual" as const,
};

const idsFrom = (s: Signals) => evaluate(s, RULES).map((item) => item.ruleId);

test.describe("isSchoolBreakOn", () => {
  test("is inclusive of both ends and excludes the days either side", () => {
    expect(isSchoolBreakOn([summer], "2026-08-10")).toBeNull();
    expect(isSchoolBreakOn([summer], "2026-08-11")?.name).toBe("Sommerferien");
    expect(isSchoolBreakOn([summer], "2026-08-16")?.name).toBe("Sommerferien");
    expect(isSchoolBreakOn([summer], "2026-08-21")?.name).toBe("Sommerferien");
    expect(isSchoolBreakOn([summer], "2026-08-22")).toBeNull();
  });

  test("a calendar-derived range behaves the same as a typed one", () => {
    const fromIcs = { ...summer, source: "calendar" as const };
    expect(isSchoolBreakOn([fromIcs], "2026-08-16")?.source).toBe("calendar");
  });
});

test.describe("the school-bag hint", () => {
  test("asks on a normal Monday evening for Tuesday's sport", () => {
    const ids = idsFrom(signals({ lessons: sportOnTuesday }));
    expect(ids).toContain("pack-the-school-bag");
  });

  test("stays quiet on the evening before the holidays start", () => {
    // Monday 10th, packing for Tuesday 11th — the first day of the break.
    const ids = idsFrom(signals({ lessons: sportOnTuesday, schoolBreaks: [summer] }));
    expect(ids).not.toContain("pack-the-school-bag");
  });

  test("stays quiet on a morning inside the holidays", () => {
    const ids = idsFrom(
      signals({
        now: new Date("2026-08-11T07:00:00+02:00"), // Tuesday, first day off
        lessons: sportOnTuesday,
        schoolBreaks: [summer],
      })
    );
    expect(ids).not.toContain("pack-the-school-bag");
  });

  test("asks again on the evening before term restarts", () => {
    // Monday 24th evening, packing for Tuesday 25th — the break ended on the
    // 21st. This is the case a naive "are we in the holidays today" check gets
    // wrong in the other direction.
    const ids = idsFrom(
      signals({
        now: new Date("2026-08-24T18:00:00+02:00"),
        lessons: sportOnTuesday,
        schoolBreaks: [summer],
      })
    );
    expect(ids).toContain("pack-the-school-bag");
  });
});

test.describe("what a holiday does not silence", () => {
  test("school-tomorrow goes quiet, but an overdue task still speaks", () => {
    const overdue = [
      {
        id: "t1",
        title: "Rechnung bezahlen",
        dueDate: new Date("2026-08-05T23:59:59+02:00"),
        completed: false,
        personId: null,
        personName: null,
      },
    ];

    const term = idsFrom(signals({ lessons: sportOnTuesday, todos: overdue }));
    expect(term).toContain("school-tomorrow");

    const holiday = idsFrom(
      signals({ lessons: sportOnTuesday, todos: overdue, schoolBreaks: [summer] })
    );
    // The school hints are gone...
    expect(holiday).not.toContain("school-tomorrow");
    expect(holiday).not.toContain("pack-the-school-bag");
    // ...and the rest of the board is untouched, which is the whole point of
    // scoping the pause to school-derived rules.
    expect(holiday).toContain("overdue-tasks");
  });
});
