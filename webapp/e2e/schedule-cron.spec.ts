import { test, expect } from "@playwright/test";
import { nextCronTime, nextRun, normaliseSchedule, parseSchedule, type Schedule } from "../src/lib/schedule/cron";
import { JOBS } from "../src/lib/schedule/jobs";

/**
 * The internal scheduler's clock maths (RFC-023 §4.5): ofelia's syntax, its
 * next-run times, all in UTC (decided §11.1b). Every fixed-time job must fire
 * at the same UTC instant whatever the server's TZ, and across the days a
 * local clock jumps.
 */

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const cron = (spec: string) => parseSchedule(spec) as Extract<Schedule, { kind: "cron" }>;

/** The next `n` run times after `fromIso`. */
function runs(spec: string, fromIso: string, n: number): string[] {
  const s = parseSchedule(spec);
  const out: string[] = [];
  let planned = at(fromIso);
  for (let i = 0; i < n; i++) {
    planned = nextRun(s, planned, planned);
    out.push(iso(planned));
  }
  return out;
}

/** Runs `fn` with the process's TZ set, then restores it. Node re-reads TZ on assignment. */
function inZone<T>(tz: string, fn: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

// The days a local clock jumps, 2026: EU spring/autumn, US spring/autumn, and
// Lord Howe's half-hour shift.
const DST_DAYS = [
  { zone: "Europe/Berlin", from: "2026-03-28T12:00:00Z" },
  { zone: "Europe/Berlin", from: "2026-10-24T12:00:00Z" },
  { zone: "America/New_York", from: "2026-03-07T12:00:00Z" },
  { zone: "America/New_York", from: "2026-10-31T12:00:00Z" },
  { zone: "Australia/Lord_Howe", from: "2026-04-04T12:00:00Z" },
];

test.describe("fixed times are UTC, across DST changes", () => {
  test("the zone is really in effect while these run (not vacuous)", () => {
    const offset = (tz: string) => inZone(tz, () => new Date(at("2026-07-01T00:00:00Z")).getTimezoneOffset());
    expect(offset("Europe/Berlin")).toBe(-120);
    expect(offset("America/New_York")).toBe(240);
  });

  for (const { zone, from } of DST_DAYS) {
    test(`todo-reminders fires at 08:00 UTC, 24 h apart, in ${zone} from ${from.slice(0, 10)}`, () => {
      const got = inZone(zone, () => runs("0 0 8 * * *", from, 3));
      const day = at(from.slice(0, 10) + "T08:00:00Z");
      expect(got).toEqual([1, 2, 3].map((d) => iso(day + d * 86_400_000)));
    });
  }

  test("every fixed-time job gives the same instants whatever the server's TZ", () => {
    const fixed = JOBS.filter((j) => !j.schedule.startsWith("@"));
    expect(fixed.length).toBe(10);
    for (const job of fixed) {
      const utc = inZone("UTC", () => runs(job.schedule, "2026-03-28T00:00:00Z", 30));
      for (const zone of ["Europe/Berlin", "America/New_York", "Australia/Lord_Howe", "Asia/Kolkata"]) {
        expect(inZone(zone, () => runs(job.schedule, "2026-03-28T00:00:00Z", 30)), `${job.name} in ${zone}`).toEqual(utc);
      }
    }
  });

  test("today's fixed-time jobs at their UTC times", () => {
    const from = "2026-11-26T00:00:00Z";
    const first = (spec: string) => runs(spec, from, 1)[0];
    expect(first("0 0 8 * * *")).toBe("2026-11-26T08:00:00.000Z"); // todo-reminders
    expect(first("0 0 7 * * *")).toBe("2026-11-26T07:00:00.000Z"); // birthday-reminders
    expect(first("0 0 18 * * *")).toBe("2026-11-26T18:00:00.000Z"); // meal-prep-reminders
    expect(first("0 20 3 * * *")).toBe("2026-11-26T03:20:00.000Z"); // extend-event-series
    expect(first("0 30 0 * * *")).toBe("2026-11-26T00:30:00.000Z"); // accrue-interest
    expect(first("0 30 3 * * *")).toBe("2026-11-26T03:30:00.000Z"); // purge-recycle-bin
    expect(first("0 45 3 * * *")).toBe("2026-11-26T03:45:00.000Z"); // purge-domain-events
    expect(runs("0 15,45 * * * *", "2026-11-26T10:20:00Z", 3)).toEqual([
      "2026-11-26T10:45:00.000Z",
      "2026-11-26T11:15:00.000Z",
      "2026-11-26T11:45:00.000Z",
    ]);
  });
});

test.describe("next-run edges", () => {
  test("strictly after: a job due now is next due on its following slot", () => {
    expect(iso(nextCronTime(cron("0 0 * * * *"), at("2026-11-26T10:00:00.000Z")))).toBe("2026-11-26T11:00:00.000Z");
    expect(iso(nextCronTime(cron("0 0 8 * * *"), at("2026-11-26T08:00:00.500Z")))).toBe("2026-11-27T08:00:00.000Z");
    expect(iso(nextCronTime(cron("0 0 8 * * *"), at("2026-11-26T07:59:59.999Z")))).toBe("2026-11-26T08:00:00.000Z");
  });

  test("across the year end and a leap day", () => {
    expect(runs("0 30 0 * * *", "2026-12-31T23:00:00Z", 1)).toEqual(["2027-01-01T00:30:00.000Z"]);
    expect(runs("0 0 0 29 2 *", "2026-03-01T00:00:00Z", 1)).toEqual(["2028-02-29T00:00:00.000Z"]);
  });

  test("day-of-month and day-of-week: both restricted means either", () => {
    // 2026-12: the 1st is a Tuesday; Mondays are 7, 14, …
    expect(runs("0 0 0 1 * 1", "2026-11-30T12:00:00Z", 3)).toEqual([
      "2026-12-01T00:00:00.000Z",
      "2026-12-07T00:00:00.000Z",
      "2026-12-14T00:00:00.000Z",
    ]);
    // One of them `*`: both must match (Mondays only).
    expect(runs("0 0 0 * * mon", "2026-11-30T12:00:00Z", 2)).toEqual(["2026-12-07T00:00:00.000Z", "2026-12-14T00:00:00.000Z"]);
  });

  test("a date that never comes is refused", () => {
    expect(() => nextCronTime(cron("0 0 0 30 2 *"), at("2026-01-01T00:00:00Z"))).toThrow(/never fires/);
  });

  test("steps and ranges", () => {
    expect(runs("*/20 * * * * *", "2026-11-26T10:00:05Z", 3)).toEqual([
      "2026-11-26T10:00:20.000Z",
      "2026-11-26T10:00:40.000Z",
      "2026-11-26T10:01:00.000Z",
    ]);
    expect(runs("0 0 9-11/2 * * *", "2026-11-26T00:00:00Z", 3)).toEqual([
      "2026-11-26T09:00:00.000Z",
      "2026-11-26T11:00:00.000Z",
      "2026-11-27T09:00:00.000Z",
    ]);
  });
});

test.describe("@every counts from the start and never catches up", () => {
  const start = at("2026-11-26T10:00:07Z");

  test("the first run is one interval after the start, then on that cadence", () => {
    expect(runs("@every 30s", iso(start), 3)).toEqual([
      "2026-11-26T10:00:37.000Z",
      "2026-11-26T10:01:07.000Z",
      "2026-11-26T10:01:37.000Z",
    ]);
    expect(runs("@every 24h", iso(start), 1)).toEqual(["2026-11-27T10:00:07.000Z"]);
  });

  test("after sleeping through slots, the next one is after now, on the cadence", () => {
    const s = parseSchedule("@every 30s");
    const planned = start + 30_000;
    const now = planned + 10 * 60_000 + 5_000; // 10 min 5 s late
    const next = nextRun(s, planned, now);
    expect(next).toBeGreaterThan(now);
    expect(next - now).toBeLessThanOrEqual(30_000);
    expect((next - start) % 30_000).toBe(0);
  });

  test("a fixed-time job overdue by days is next due at its next slot, not once per missed day", () => {
    const s = parseSchedule("0 0 8 * * *");
    expect(iso(nextRun(s, at("2026-11-20T08:00:00Z"), at("2026-11-26T10:00:00Z")))).toBe("2026-11-27T08:00:00.000Z");
  });
});

test.describe("syntax", () => {
  test("normalised spellings", () => {
    expect(normaliseSchedule("@every 15m")).toBe("@every 900s");
    expect(normaliseSchedule("@every 1h30m")).toBe("@every 5400s");
    expect(normaliseSchedule("@every 500ms")).toBe("@every 1s");
    expect(normaliseSchedule("0 0 08 * * ?")).toBe(normaliseSchedule("0  0 8 * * *"));
    expect(normaliseSchedule("@daily")).toBe(normaliseSchedule("0 0 0 * * *"));
    expect(normaliseSchedule("@hourly")).toBe(normaliseSchedule("0 0 * * * *"));
    expect(normaliseSchedule("0 0 0 * JAN-MAR MON")).toBe(normaliseSchedule("0 0 0 * 1-3 1"));
    expect(normaliseSchedule("0 15,45 * * * *")).not.toBe(normaliseSchedule("0 15 * * * *"));
  });

  for (const bad of ["0 8 * * *", "0 0 8 * * * *", "0 0 24 * * *", "0 60 * * * *", "0 0 0 * * 7", "*/0 * * * * *", "@every", "@every 5x", "@often"]) {
    test(`refuses "${bad}"`, () => {
      expect(() => parseSchedule(bad)).toThrow();
    });
  }
});
