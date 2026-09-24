import { expect, test } from "@playwright/test";
import { establishSession } from "./session";

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

  test("adding a meal still works without updating an existing week", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await establishSession(page, FAMILY_CODE, "Meal Plan Edit Test");
    await page.goto("/meals");

    const note = `Meal plan regression ${Date.now()}`;
    const planWrites: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.endsWith("/rest/v1/meal_plans") &&
        request.method() !== "GET"
      ) {
        planWrites.push(request.method());
      }
    });

    await page.getByRole("button", { name: "Add meal", exact: true }).click();
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
});
