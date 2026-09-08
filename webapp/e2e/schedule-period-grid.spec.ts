import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { codeOnly } from "./source-helpers";
import { renderWallClock } from "../src/hooks/use-time-format";

/**
 * The school schedule's three ways of going wrong, all reported together.
 *
 * #244 — period times are stored as "HH:MM" wall-clock strings and were
 * printed straight into the page, so they stayed 24-hour however the switch
 * under Settings → Design was set. The earlier sweep for this bug class
 * (#227, #229) searched for `toLocaleTimeString` and date-fns patterns and
 * could never have matched `{slot.start}`, which is why the schedule survived
 * it. That is the lesson worth keeping: the shape to grep for is a stored
 * clock string reaching JSX, not a formatting call.
 *
 * #245 — periods are a plain array and a household can add 07:45 after 17:00.
 * Shown in insertion order that reads as broken data.
 *
 * #246 — the worst of the three. Deleting a period renumbered the survivors
 * (`updated.map((p, i) => ({ ...p, num: i + 1 }))`), and every lesson is a
 * TimeSlot carrying `period: <num>`. Deleting the 17:00 block renamed period 6
 * to 5, so the lesson stored as `period: 5` was silently redrawn against a
 * different time — and a later re-add resurrected a subject into a block
 * nobody had assigned it to.
 *
 * Verified against the running app before these were written: /settings/schedule
 * and /schedule both render 7:45 AM / 12:30 PM / 5:00 PM with the setting off,
 * in clock order, from periods stored 17:00-first; and deleting the middle
 * period leaves `[{num:1,start:"07:45"},{num:3,start:"17:00"}]` — 3 preserved,
 * not renumbered to 2.
 */

const settingsPage = codeOnly(readFileSync("src/app/settings/schedule/page.tsx", "utf8"));
const schedulePage = codeOnly(readFileSync("src/app/schedule/page.tsx", "utf8"));
const widget = codeOnly(readFileSync("src/components/widgets/schedule-widget.tsx", "utf8"));

test.describe("#246 — a period number is an identity", () => {
  test("removing a period does not renumber the survivors", () => {
    expect(
      settingsPage,
      "periods are being renumbered on delete again. Every lesson stores " +
        "`period: <num>`, so a number that moves takes somebody's timetable " +
        "with it — the subject appears against a time nobody assigned it to.",
    ).not.toMatch(/num:\s*i\s*\+\s*1/);
  });

  test("a new period takes a number never used before, not the array length", () => {
    // A number freed by a deletion must not be reissued: the new period would
    // silently adopt the lessons of the one it replaced.
    expect(settingsPage).toMatch(/reduce\(\(max, p\) => Math\.max\(max, p\.num\), 0\) \+ 1/);
  });
});

test.describe("#245 — periods read in clock order", () => {
  test("they are sorted on read and on save", () => {
    const sorts = settingsPage.match(/sort\(\(a, b\) => a\.start\.localeCompare\(b\.start\)\)/g);
    expect(
      sorts?.length,
      "periods must be sorted where they are read AND where they are saved — " +
        "on read so schedules stored before this still display correctly, on " +
        "save so the stored order settles",
    ).toBeGreaterThanOrEqual(2);
  });

  test("sorting is by start time, never by the period number", () => {
    // `num` survives deletions, so it has gaps and no chronological meaning.
    expect(settingsPage).not.toMatch(/sort\(\(a, b\) => a\.num - b\.num\)/);
  });
});

test.describe("#244 — stored clock strings are rendered for the household's setting", () => {
  /*
    The failure shape is a stored "HH:MM" reaching JSX unformatted. Matching
    that directly is what the earlier sweep missed, so it is what this asserts.

    `value={period.start}` is excluded deliberately: that is a native
    <input type="time">, which must receive the raw string. Without the
    lookbehind this rule fires on the one place the report says was correct.
  */
  const rawTimeInJsx =
    /(?<!value=)\{[a-zA-Z_]+(?:Slot|Period|Lesson|period|slot)?\.(start|end)\}/;

  for (const [name, source] of [
    ["settings/schedule/page.tsx", settingsPage],
    ["schedule/page.tsx", schedulePage],
    ["widgets/schedule-widget.tsx", widget],
  ] as const) {
    test(`${name} renders no bare clock string`, () => {
      const hit = source.match(rawTimeInJsx);
      expect(
        hit?.[0],
        `${name} prints ${hit?.[0]} straight into the page, so it stays 24-hour ` +
          `whatever the household chose. Wrap it in formatWallClock().`,
      ).toBeUndefined();
    });
  }

  test("all three files use the shared renderer", () => {
    for (const [name, source] of [
      ["settings/schedule/page.tsx", settingsPage],
      ["schedule/page.tsx", schedulePage],
      ["widgets/schedule-widget.tsx", widget],
    ] as const) {
      expect(source, `${name} should format times through useTimeFormat`).toContain(
        "formatWallClock",
      );
    }
  });

  test("the renderer turns the reported times into what the reporter expected", () => {
    // The exact values from issue #244.
    expect(renderWallClock("07:45", false)).toBe("7:45 AM");
    expect(renderWallClock("07:55", false)).toBe("7:55 AM");
    expect(renderWallClock("17:00", false)).toBe("5:00 PM");
    expect(renderWallClock("18:00", false)).toBe("6:00 PM");
    // And leaves a 24-hour household alone.
    expect(renderWallClock("17:00", true)).toBe("17:00");
  });
});

test.describe("the period editor's time inputs stay raw", () => {
  test("input type=time is not routed through the formatter", () => {
    /*
      A native time input takes and returns "HH:MM" and asks the browser to
      display it in the user's own convention — which is why the reporter found
      the editor already correct. Formatting its value would break it.
    */
    expect(settingsPage).toMatch(/type="time"[\s\S]{0,120}value=\{period\.(start|end)\}/);
    expect(settingsPage).not.toMatch(/type="time"[\s\S]{0,120}value=\{formatWallClock/);
  });
});
