import { test, expect } from "@playwright/test";
import {
  MAX_RANGE_DAYS,
  parseRange,
} from "../src/app/api/integration/v1/calendar/events/route";

/**
 * Window parsing for the calendar endpoint.
 *
 * Both bounds are caller-controlled and go straight into a range query. The
 * failure that matters is not a crash — it is a window that quietly means
 * something other than what was asked for, because a calendar showing the
 * wrong fortnight looks like Kinboard losing appointments.
 */

const iso = (s: string) => new Date(s).toISOString();

test.describe("both bounds are required", () => {
  test("a missing bound is refused rather than guessed", () => {
    // The two plausible defaults — "today" and "everything" — differ by orders
    // of magnitude in cost, so neither is a safe assumption.
    expect(parseRange(null, null)).toMatchObject({ ok: false, reason: "missing" });
    expect(parseRange(iso("2026-08-08"), null)).toMatchObject({ ok: false, reason: "missing" });
    expect(parseRange(null, iso("2026-08-09"))).toMatchObject({ ok: false, reason: "missing" });
    expect(parseRange("", "")).toMatchObject({ ok: false, reason: "missing" });
  });
});

test.describe("the window has to make sense", () => {
  test("accepts an ordinary range", () => {
    const r = parseRange(iso("2026-08-01T00:00:00Z"), iso("2026-08-31T00:00:00Z"));
    expect(r.ok).toBe(true);
    expect(r.start?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  test("refuses a reversed range instead of returning nothing", () => {
    // Returning an empty list would look like "no appointments that month",
    // which is a far worse answer than an error.
    expect(parseRange(iso("2026-08-31"), iso("2026-08-01"))).toMatchObject({
      ok: false,
      reason: "reversed",
    });
  });

  test("refuses a zero-length range", () => {
    const t = iso("2026-08-08T12:00:00Z");
    expect(parseRange(t, t)).toMatchObject({ ok: false, reason: "reversed" });
  });

  test("refuses unparseable input", () => {
    expect(parseRange("yesterday", "tomorrow")).toMatchObject({ ok: false, reason: "unparseable" });
    expect(parseRange("2026-13-45", iso("2026-08-09"))).toMatchObject({
      ok: false,
      reason: "unparseable",
    });
  });

  test("caps the width", () => {
    // Without this, one request can ask for every event ever stored.
    const start = new Date("2026-01-01T00:00:00Z");
    const justUnder = new Date(start.getTime() + (MAX_RANGE_DAYS - 1) * 86_400_000);
    const justOver = new Date(start.getTime() + (MAX_RANGE_DAYS + 1) * 86_400_000);

    expect(parseRange(start.toISOString(), justUnder.toISOString()).ok).toBe(true);
    expect(parseRange(start.toISOString(), justOver.toISOString())).toMatchObject({
      ok: false,
      reason: "too_wide",
    });
  });

  test("a year still fits, because that is a real thing to ask for", () => {
    // A calendar's year view is legitimate; the cap exists to stop scraping,
    // not to stop use.
    const r = parseRange("2026-01-01T00:00:00Z", "2026-12-31T23:59:59Z");
    expect(r.ok).toBe(true);
  });
});
