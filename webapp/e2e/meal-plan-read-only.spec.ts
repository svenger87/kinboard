import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

test.describe("meal-plan reads (#287)", () => {
  test.skip(!FAMILY_CODE, "FAMILY_CODE is needed for the authenticated meal planner");

  test("opening the dashboard and Meals page never writes a weekly plan", async ({ page }) => {
    await establishSession(page, FAMILY_CODE, "Meal Plan Read-Only Test");

    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.endsWith("/rest/v1/meal_plans") &&
        request.method() !== "GET"
      ) {
        writes.push(`${request.method()} ${request.url()}`);
      }
    });

    for (const route of ["/", "/meals"]) {
      const entriesRead = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith("/rest/v1/meal_plan_entries") &&
          response.request().method() === "GET" &&
          response.ok(),
      );
      await page.goto(route);
      await entriesRead;
      // A second render/refetch would have posted again in the original loop.
      await page.waitForTimeout(500);
    }

    expect(writes, "rendering a meal plan must not INSERT or UPDATE meal_plans").toEqual([]);
  });

  /*
    The phone's add button puts the meal on today, and the planner shows the
    week containing today -- so where today falls in that week decides where
    the new meal lands on screen. On the last day of the week it is the last
    card in the list, at the bottom of the scroll, which is where the fixed
    "Add meal" button sits. Before the page reserved room for that button the
    meal's option menu was underneath it and the click below timed out: on
    Sundays for a Monday-start family, on Saturdays for a Sunday-start one.

    So the day is pinned rather than taken from the wall clock. Sunday and
    Saturday cover the last day under either week-start setting; Wednesday is
    a day in the middle. The clock is set after the session exists: the join
    runs on the real clock, and only the planner sees the pinned day.
  */
  const pinnedDays = [
    { day: "a Sunday", at: "2026-10-04T12:00:00" },
    { day: "a Saturday", at: "2026-10-10T12:00:00" },
    { day: "a Wednesday", at: "2026-10-07T12:00:00" },
  ];

  // A run that fails before its own Delete click used to leave its note
  // behind, and the next run on that day found its note in a pile of strays:
  // the page the Sunday failure was first seen on had nine under one dinner.
  // Only this worker's own notes are removed; the other projects run at the
  // same time against the same family and their notes are not ours to delete.
  const written: string[] = [];
  test.afterEach(() => {
    for (const note of written.splice(0)) {
      execFileSync(
        "docker",
        ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c",
          `DELETE FROM meal_plan_entries WHERE note = '${note}';`],
        { encoding: "utf8" },
      );
    }
  });

  for (const { day, at } of pinnedDays) {
    test(`adding a meal still works without updating an existing week, on ${day}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await establishSession(page, FAMILY_CODE, "Meal Plan Edit Test");
      await page.clock.setFixedTime(new Date(at));
      await page.goto("/meals");

      const note = `Meal plan regression ${Date.now()}`;
      written.push(note);
      const planWrites: string[] = [];
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname.endsWith("/rest/v1/meal_plans") &&
          request.method() !== "GET"
        ) {
          planWrites.push(request.method());
        }
      });

      // The floating button, which the page renders last. An empty week also
      // shows an "Add meal" button in its empty state, and a pinned day's week
      // is usually empty.
      await page.getByRole("button", { name: "Add meal", exact: true }).last().click();
      const dialog = page.getByRole("dialog", { name: "Add meal" });
      await dialog.getByPlaceholder("e.g. Eating out, leftovers, etc.").fill(note);
      await dialog.getByRole("button", { name: "Save note" }).click();
      await expect(page.getByText(note)).toBeVisible();

      // A new week may require one INSERT. It must never UPDATE the existing
      // plan row, including during the refetch caused by the entry insert.
      expect(planWrites.every((method) => method === "POST"), planWrites.join(", ")).toBe(true);
      expect(planWrites.length).toBeLessThanOrEqual(1);

      const card = page.getByText(note).locator("xpath=ancestor::div[contains(@class,'group')][1]");
      await card.getByRole("button", { name: "Meal options" }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("alertdialog", { name: "Remove meal?" }).getByRole("button", { name: "Delete" }).click();
      await expect(page.getByText(note)).toHaveCount(0);
    });
  }
});
