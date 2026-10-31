import { test, expect } from "@playwright/test";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import { navigateCalendarDate } from "../src/lib/calendar-navigation";
import { establishSession } from "./session";

// Pure behavior guard runs without a stack; browser assertions run with one.
test("navigation moves the selected day with the displayed period", () => {
  const oct31 = new Date(2026, 9, 31);
  const november = navigateCalendarDate(oct31, "month", 1);
  expect(format(november, "yyyy-MM-dd")).toBe("2026-11-30");
  expect(format(navigateCalendarDate(november, "month", -1), "yyyy-MM-dd")).toBe("2026-10-30");
  expect(format(navigateCalendarDate(oct31, "week", 1), "yyyy-MM-dd")).toBe("2026-11-07");
});

const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

test.describe("calendar selected day", () => {
  test.skip(!FAMILY_CODE, "needs a running stack");

  test("navigation, selection, view switch, and Today keep the panel in the displayed period", async ({ page, baseURL }, testInfo) => {
    await establishSession(page, FAMILY_CODE, `calendar-selected-day-${testInfo.project.name}`);
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3000" }]);
    await page.goto("/calendar?date=2026-10-15");

    const panel = page.locator(".xl\\:col-span-1 h2");
    const label = (year: number, month: number, day: number) =>
      format(new Date(year, month - 1, day), "EEEE, d. MMMM", { locale: enUS });
    const next = page.getByRole("button", { name: "Next", exact: true });
    const previous = page.getByRole("button", { name: "Previous", exact: true });
    await expect(panel).toHaveText(label(2026, 10, 15));
    await next.click();
    await expect(panel).toHaveText(label(2026, 11, 15));
    await expect(page.getByRole("button", { name: new RegExp("^" + format(new Date(2026, 10, 15), "PPPP", { locale: enUS })) })).toHaveAttribute("aria-pressed", "true");
    await previous.click();
    await expect(panel).toHaveText(label(2026, 10, 15));

    // A directly chosen day should anchor the week when the view changes.
    await page.getByRole("button", { name: format(new Date(2026, 9, 20), "PPPP", { locale: enUS }) }).click();
    await expect(panel).toHaveText(label(2026, 10, 20));
    await page.getByRole("radio", { name: "Week", exact: true }).click();
    await expect(panel).toHaveText(label(2026, 10, 20));
    await expect(page.getByRole("button", { name: new RegExp("^" + format(new Date(2026, 9, 20), "PPPP", { locale: enUS })) })).toHaveAttribute("aria-pressed", "true");
    await next.click();
    await expect(panel).toHaveText(label(2026, 10, 27));
    await page.getByRole("radio", { name: "Month", exact: true }).click();
    await expect(panel).toHaveText(label(2026, 10, 27));
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(panel).toHaveText(format(new Date(), "EEEE, d. MMMM", { locale: enUS }));
  });
});
