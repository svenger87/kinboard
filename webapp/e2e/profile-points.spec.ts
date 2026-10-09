import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { pointsTotal, showsPoints } from "../src/lib/todo-points";

/**
 * A child's points on their profile (discussion #349): a parent asked for the
 * points to show as soon as they tap a child, instead of only on the tasks
 * page. The profile counts them exactly as the tasks page does, from the same
 * helper, and shows them only for a child who has points or a task with points.
 */

const KID = { id: "kid", is_child: true };
const PARENT = { id: "parent", is_child: false };
const awards = [
  { person_id: "kid", points: 5 },
  { person_id: "kid", points: 3 },
  { person_id: "other", points: 40 },
];

test("a child's total is the sum of their own awards only", () => {
  expect(pointsTotal(awards, "kid")).toBe(8);
  expect(pointsTotal(awards, "other")).toBe(40);
  expect(pointsTotal(awards, "nobody")).toBe(0);
  expect(pointsTotal([], "kid")).toBe(0);
});

test("a child with awards shows points, even with no task left", () => {
  expect(showsPoints(KID, awards, [])).toBe(true);
});

test("a child with a points task shows points before earning any", () => {
  expect(showsPoints(KID, [], [{ points: 5, person_id: "kid" }])).toBe(true);
  // Taking turns on it counts too: the points go to whoever's turn it is.
  expect(showsPoints(KID, [], [{ points: 5, person_id: null, rotation_person_ids: ["x", "kid"] }])).toBe(true);
});

test("a child with neither shows no points", () => {
  expect(showsPoints(KID, [], [])).toBe(false);
  expect(showsPoints(KID, [], undefined)).toBe(false);
  // Someone else's points task, or their own task without points, is not enough.
  expect(showsPoints(KID, [{ person_id: "other", points: 4 }], [{ points: 5, person_id: "other" }])).toBe(false);
  expect(showsPoints(KID, [], [{ points: 0, person_id: "kid" }])).toBe(false);
});

test("a grown-up never shows points", () => {
  expect(showsPoints(PARENT, [{ person_id: "parent", points: 9 }], [{ points: 5, person_id: "parent" }])).toBe(false);
});

test("the tasks page, the tasks widget and the profile all show what a child can spend, counted once", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
  // What a child sees next to their name is the balance -- earned, less rewards
  // and shop purchases -- not everything ever earned: a child who spent 50
  // saw those 50 still there and thought they could spend them (#349).
  for (const file of ["src/app/todos/page.tsx", "src/components/widgets/tasks-widget.tsx", "src/components/widgets/family-members.tsx"]) {
    const source = read(file);
    expect(source, file).toMatch(/totalsFor\(\w+(\.id)?\)\.balance/i);
    // No second copy of the sum to drift from the first.
    expect(source, file).not.toMatch(/award\.person_id === .*reduce/);
  }
  // The balance is the one helper's: usePointTotals sums the awards with pointsTotal.
  expect(read("src/hooks/use-point-rewards.ts")).toContain("pointsTotal(awardRows, personId)");
  expect(read("src/components/widgets/family-members.tsx")).toContain("showsPoints(selectedPerson, pointAwards, todos)");
});
