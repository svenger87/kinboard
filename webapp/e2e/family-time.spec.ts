import { test, expect } from "@playwright/test";
import { familyDateKey } from "../src/lib/family-time";

/**
 * Pure logic — no browser, no database. `familyDateKey` answers "what day is
 * it for this family right now", which only means something once a time zone
 * is attached: the same instant is two different calendar days in Berlin and
 * Los Angeles, and a recurring task's "done for today" has to mean the
 * family's today, not the server container's.
 */

test.describe("familyDateKey", () => {
  test("rolls over to the next day in a zone ahead of UTC", () => {
    expect(familyDateKey(new Date("2026-10-01T22:30:00Z"), "Europe/Berlin")).toBe("2026-10-02");
  });

  test("stays on the same day in a zone behind UTC", () => {
    expect(familyDateKey(new Date("2026-10-01T22:30:00Z"), "America/Los_Angeles")).toBe("2026-10-01");
  });
});
