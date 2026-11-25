import { expect, test } from "@playwright/test";
import { saverListMaxCut, saverListPlan } from "../src/lib/screensaver-fit";

/**
 * Which list gives way first when the built-in screensaver's column is
 * shorter than its lists (#282). The column is measured in the browser
 * (screensaver-no-overlap.spec.ts); the order is decided here.
 */

const totals = { events: 5, birthdays: 3, lessons: 2 };
const at = (cut: number) => saverListPlan(totals, cut);

test("nothing gives way while everything fits", () => {
  expect(at(0)).toEqual(totals);
});

test("the events give way first, down to two, then the birthdays to one", () => {
  expect(at(1)).toEqual({ events: 4, birthdays: 3, lessons: 2 });
  expect(at(3)).toEqual({ events: 2, birthdays: 3, lessons: 2 });
  expect(at(4)).toEqual({ events: 2, birthdays: 2, lessons: 2 });
  expect(at(5)).toEqual({ events: 2, birthdays: 1, lessons: 2 });
});

test("then one event, one child's lessons, and last the birthdays and the lessons go", () => {
  expect(at(6)).toEqual({ events: 1, birthdays: 1, lessons: 2 });
  expect(at(7)).toEqual({ events: 1, birthdays: 1, lessons: 1 });
  expect(at(8)).toEqual({ events: 1, birthdays: 0, lessons: 1 });
  expect(at(9)).toEqual({ events: 1, birthdays: 0, lessons: 0 });
  // The next event always stays: there is no step past this.
  expect(saverListMaxCut(totals)).toBe(9);
  expect(at(50)).toEqual(at(9));
});

test("short lists skip the steps they have no entries for", () => {
  expect(saverListMaxCut({ events: 0, birthdays: 0, lessons: 0 })).toBe(0);
  expect(saverListPlan({ events: 1, birthdays: 0, lessons: 1 }, 1)).toEqual({ events: 1, birthdays: 0, lessons: 0 });
  expect(saverListPlan({ events: 2, birthdays: 2, lessons: 0 }, 1)).toEqual({ events: 2, birthdays: 1, lessons: 0 });
});
