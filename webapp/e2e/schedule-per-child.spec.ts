import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { timetabledChildren } from "../src/lib/timetabled-children";

/**
 * Discussion #264: with two kids, both Stundenpläne should be on the
 * homescreen at once — "ohne umzuschalten". The dashboard gets an option
 * that renders one Stundenplan card per child instead of the single card
 * with the manual child switcher.
 *
 * Which children get a card is the whole decision, and it is not simply
 * "everyone with is_child". Two things make it subtler:
 *
 *   - A pre-schooler has no timetable. Giving them a card means a permanent
 *     "Kein Unterricht heute" tile holding a grid cell on the wall.
 *   - `useUpsertSchedule` never deletes a row. Clearing the last lesson from
 *     a day writes `time_slots: []` and leaves the row behind, so "has a row
 *     in `schedules`" outlives having an actual timetable.
 */

const people = [
  { id: "mia", name: "Mia", is_child: true },
  { id: "ben", name: "Ben", is_child: true },
  { id: "lina", name: "Lina", is_child: true },
  { id: "mum", name: "Mum", is_child: false },
];

test("a child with lessons gets a card", () => {
  const schedules = [{ person_id: "mia", time_slots: [{ period: 1, subject: "Mathe" }] }];
  expect(timetabledChildren(people, schedules).map((c) => c.id)).toEqual(["mia"]);
});

test("a child with no schedule rows at all is left out", () => {
  const schedules = [{ person_id: "mia", time_slots: [{ period: 1, subject: "Mathe" }] }];
  expect(timetabledChildren(people, schedules).map((c) => c.id)).not.toContain("lina");
});

test("a row emptied down to no lessons does not count as a timetable", () => {
  // What `useUpsertSchedule` leaves behind when the last slot is removed.
  const schedules = [
    { person_id: "mia", time_slots: [{ period: 1, subject: "Mathe" }] },
    { person_id: "ben", time_slots: [] },
  ];
  expect(timetabledChildren(people, schedules).map((c) => c.id)).toEqual(["mia"]);
});

test("an adult with a schedule row is still not a child", () => {
  const schedules = [{ person_id: "mum", time_slots: [{ period: 1, subject: "Yoga" }] }];
  expect(timetabledChildren(people, schedules)).toEqual([]);
});

test("children keep the order they have in the family list", () => {
  const schedules = [
    { person_id: "ben", time_slots: [{ period: 2, subject: "Sport" }] },
    { person_id: "mia", time_slots: [{ period: 1, subject: "Mathe" }] },
  ];
  expect(timetabledChildren(people, schedules).map((c) => c.id)).toEqual(["mia", "ben"]);
});

test("loading state — undefined inputs yield nobody, not a crash", () => {
  expect(timetabledChildren(undefined, undefined)).toEqual([]);
  expect(timetabledChildren(people, undefined)).toEqual([]);
  expect(timetabledChildren(undefined, [])).toEqual([]);
});

/**
 * The wiring, checked at the source. Driving the dashboard for this needs a
 * seeded family with two timetabled children and both auth cookies; these
 * assertions are the cheap guard that the pieces stay connected, and the
 * real dashboard is checked in a browser before release.
 */
test.describe("wiring", () => {
  const widget = readFileSync("src/components/widgets/schedule-widget.tsx", "utf8");
  const dashboard = readFileSync("src/app/page.tsx", "utf8");

  test("a pinned card hides the child switcher instead of showing dead buttons", () => {
    // `personId = propPersonId || selectedChildId || firstChild?.id` means a
    // passed-in personId always wins, so `setSelectedChildId` from these
    // buttons changes nothing you can see. Rendering them on a pinned card
    // puts controls on the wall that do not work.
    const m = widget.match(/\{\s*(!?[A-Za-z.?\s&|]*children\.length > 1)[^}]*\?/);
    expect(m, "could not find the child-switcher condition — did it move?").toBeTruthy();
    expect(
      m![1],
      "the switcher renders purely on child count, so a card pinned with a " +
        "personId prop shows buttons that cannot change anything",
    ).toContain("propPersonId");
  });

  test("the dashboard renders one card per timetabled child", () => {
    expect(
      dashboard,
      "the dashboard never asks who has a timetable, so it cannot render a card each",
    ).toContain("timetabledChildren");
    expect(
      dashboard.match(/<ScheduleWidget[^>]*personId=/),
      "no ScheduleWidget is pinned to a child — every card would show the same one",
    ).toBeTruthy();
  });

  test("per-child mode falls back to the single card when nobody has a timetable", () => {
    // Otherwise switching the option on in a family that has not built a
    // timetable yet makes the widget vanish with no explanation.
    expect(
      dashboard,
      "no length check on the per-child list — the widget disappears instead of " +
        "falling back to the single card",
    ).toMatch(/perChildCards\.length\s*>\s*0/);
  });
});
