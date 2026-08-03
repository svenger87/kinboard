import { test, expect } from "@playwright/test";
import {
  layoutDayEvents,
  visibleHourRange,
  type LayoutableEvent,
} from "../src/lib/calendar-layout";

/**
 * Pure-logic regression tests for the week view's overlap layout.
 *
 * No browser and no running stack — these exercise the algorithm
 * directly. They live here because Playwright is the project's only test
 * runner; the CI e2e job runs this file alongside the smoke suite.
 *
 * The bug being guarded: every timed event used to be positioned
 * `left-1 right-1`, so two events at the same time rendered exactly on
 * top of each other and one was invisible.
 */

type TestEvent = LayoutableEvent & { id: string };

const at = (hour: number, minute = 0) => new Date(2026, 7, 3, hour, minute, 0, 0);

const event = (
  id: string,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
): TestEvent => ({
  id,
  start: at(startHour, startMinute),
  end: at(endHour, endMinute),
});

function byId(events: TestEvent[]) {
  return Object.fromEntries(
    layoutDayEvents(events).map((placement) => [placement.event.id, placement]),
  );
}

/** Any two events overlapping in time must not overlap horizontally. */
function findVisualOverlap(events: TestEvent[]): string | null {
  const placements = layoutDayEvents(events);
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i];
      const b = placements[j];
      if (!(a.event.start < b.event.end && b.event.start < a.event.end)) continue;
      const horizontallyOverlapping =
        a.left < b.left + b.width - 1e-9 && b.left < a.left + a.width - 1e-9;
      if (horizontallyOverlapping) return `${a.event.id} vs ${b.event.id}`;
    }
  }
  return null;
}

test.describe("week view event layout", () => {
  test("two events at the same time sit side by side", () => {
    const events = [event("a", 10, 0, 11, 0), event("b", 10, 0, 11, 0)];
    const placed = byId(events);

    expect(placed.a.width).toBeCloseTo(0.5);
    expect(placed.b.width).toBeCloseTo(0.5);
    expect(placed.a.left).toBeCloseTo(0);
    expect(placed.b.left).toBeCloseTo(0.5);
    expect(findVisualOverlap(events)).toBeNull();
  });

  test("three overlapping events split into thirds, longest on the left", () => {
    const events = [
      event("long", 9, 0, 12, 0),
      event("mid", 10, 0, 11, 0),
      event("late", 10, 30, 11, 30),
    ];
    const placed = byId(events);

    expect(placed.mid.width).toBeCloseTo(1 / 3);
    expect(placed.long.left).toBeCloseTo(0);
    expect(findVisualOverlap(events)).toBeNull();
  });

  test("a non-overlapping event keeps the full column width", () => {
    const events = [
      event("a", 9, 0, 10, 0),
      event("b", 9, 30, 10, 30),
      event("alone", 14, 0, 15, 0),
    ];
    const placed = byId(events);

    expect(placed.alone.width).toBeCloseTo(1);
    expect(placed.alone.left).toBeCloseTo(0);
  });

  test("sequential events reuse a column instead of adding one", () => {
    const events = [
      event("morning", 9, 0, 10, 0),
      event("later", 10, 0, 11, 0),
      event("spanning", 9, 0, 11, 0),
    ];
    const placed = byId(events);

    expect(placed.morning.left).toBeCloseTo(placed.later.left);
    expect(placed.spanning.left).not.toBeCloseTo(placed.morning.left);
    expect(findVisualOverlap(events)).toBeNull();
  });

  test("short events are split when their minimum rendered height collides", () => {
    // Five minutes apart, but both render at the 24px floor — so they
    // collide on screen even though their times don't strictly overlap.
    const colliding = [event("a", 10, 0, 10, 5), event("b", 10, 10, 10, 15)];
    const placedColliding = byId(colliding);
    expect(placedColliding.a.width).toBeCloseTo(0.5);

    // An hour apart: no collision, both keep full width.
    const separate = [event("a", 10, 0, 10, 5), event("b", 11, 0, 11, 5)];
    const placedSeparate = byId(separate);
    expect(placedSeparate.a.width).toBeCloseTo(1);
    expect(placedSeparate.b.width).toBeCloseTo(1);
  });

  test("a pile-up in one cluster does not shrink an unrelated cluster", () => {
    const events = [
      event("a", 9, 0, 10, 0),
      event("b", 9, 0, 10, 0),
      event("c", 9, 0, 10, 0),
      event("afternoon", 15, 0, 16, 0),
    ];
    expect(byId(events).afternoon.width).toBeCloseTo(1);
  });

  test("layout does not depend on input order", () => {
    // Equal start and equal duration: without a stable tiebreak these
    // would swap columns whenever the events query returned them in a
    // different order.
    const events = [event("a", 10, 0, 11, 0), event("b", 10, 0, 11, 0)];
    const forward = layoutDayEvents(events).map((p) => [p.event.id, p.left]);
    const reversed = layoutDayEvents([...events].reverse()).map((p) => [
      p.event.id,
      p.left,
    ]);

    expect(forward).toEqual(reversed);
  });

  test("an empty day produces no placements", () => {
    expect(layoutDayEvents([])).toEqual([]);
  });
});

test.describe("week view hour range", () => {
  test("defaults to 6:00–22:00", () => {
    expect(visibleHourRange([])).toEqual({ startHour: 6, endHour: 22 });
  });

  test("widens for an early event that would otherwise render off-grid", () => {
    expect(visibleHourRange([event("early", 5, 30, 6, 30)]).startHour).toBe(5);
  });

  test("widens for a late event that would otherwise be invisible", () => {
    expect(visibleHourRange([event("late", 22, 0, 23, 30)]).endHour).toBe(24);
  });

  test("an event ending exactly on the boundary needs no extra row", () => {
    expect(visibleHourRange([event("evening", 21, 0, 22, 0)]).endHour).toBe(22);
  });

  test("midday events leave the default range alone", () => {
    expect(visibleHourRange([event("lunch", 12, 0, 13, 0)])).toEqual({
      startHour: 6,
      endHour: 22,
    });
  });
});
