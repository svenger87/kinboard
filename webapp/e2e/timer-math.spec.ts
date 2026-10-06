import { test, expect } from "@playwright/test";
import { offsetFromDateHeader, applyOffset } from "../src/lib/server-clock";
import { endsAt, timerState, remainingSeconds } from "../src/lib/timer-math";
import type { Timer } from "../src/types/database";

/**
 * A timer is arithmetic, not a ticking process. Everything below is what the
 * countdown is; if it is wrong the panel is confidently wrong, which is worse
 * than blank.
 *
 * The clock offset exists because `started_at` is written by the server and
 * `now` is the browser's. A wall panel two minutes fast ends its timer two
 * minutes early, and this will look like dead code on any development machine
 * — all of which have correct clocks. RFC-004 §3.1.
 */

const timer = (over: Partial<Timer> = {}): Timer =>
  ({
    id: "t1",
    family_id: "f1",
    label: "pasta",
    duration_seconds: 600,
    started_at: "2026-09-08T10:00:00.000Z",
    finished_at: null,
    dismissed_at: null,
    created_at: "2026-09-08T10:00:00.000Z",
    updated_at: "2026-09-08T10:00:00.000Z",
    ...over,
  }) as Timer;

const at = (iso: string) => new Date(iso);

test.describe("offsetFromDateHeader", () => {
  test("measures how far the browser's clock is from the server's", () => {
    // Server says 10:00:00; we received it when our clock said 10:02:00.
    // We are two minutes fast, so the offset is -120000ms.
    const offset = offsetFromDateHeader(
      "Tue, 08 Sep 2026 10:00:00 GMT",
      at("2026-09-08T10:02:00.000Z"),
    );
    expect(offset).toBe(-120_000);
  });

  test("is zero when the clocks agree", () => {
    expect(
      offsetFromDateHeader("Tue, 08 Sep 2026 10:00:00 GMT", at("2026-09-08T10:00:00.000Z")),
    ).toBe(0);
  });

  test("returns null rather than guessing when there is no usable header", () => {
    // A null offset must be distinguishable from a zero one: zero means
    // "measured, and they agree", null means "we do not know".
    expect(offsetFromDateHeader(null, at("2026-09-08T10:00:00.000Z"))).toBeNull();
    expect(offsetFromDateHeader("not a date", at("2026-09-08T10:00:00.000Z"))).toBeNull();
    expect(offsetFromDateHeader("", at("2026-09-08T10:00:00.000Z"))).toBeNull();
  });
});

test.describe("applyOffset", () => {
  test("corrects a fast clock", () => {
    expect(applyOffset(at("2026-09-08T10:02:00.000Z"), -120_000).toISOString()).toBe(
      "2026-09-08T10:00:00.000Z",
    );
  });

  test("corrects a slow clock", () => {
    expect(applyOffset(at("2026-09-08T09:58:00.000Z"), 120_000).toISOString()).toBe(
      "2026-09-08T10:00:00.000Z",
    );
  });
});

test.describe("remainingSeconds", () => {
  test("counts down from the duration", () => {
    expect(remainingSeconds(timer(), at("2026-09-08T10:00:00.000Z"))).toBe(600);
    expect(remainingSeconds(timer(), at("2026-09-08T10:05:00.000Z"))).toBe(300);
  });

  test("floors at zero rather than going negative", () => {
    // A tab asleep for an hour must not report -3000 seconds; a ring drawn
    // from a negative remainder sweeps the wrong way.
    expect(remainingSeconds(timer(), at("2026-09-08T11:00:00.000Z"))).toBe(0);
  });

  test("is the full duration before the timer starts", () => {
    // A clock that has gone backwards must not report more than the duration.
    expect(remainingSeconds(timer(), at("2026-09-08T09:00:00.000Z"))).toBe(600);
  });
});

test.describe("timerState", () => {
  test("is running until the duration elapses", () => {
    expect(timerState(timer(), at("2026-09-08T10:09:59.000Z"))).toBe("running");
  });

  test("is finished once it does, even with no finished_at written yet", () => {
    // The server stamps finished_at, but the panel must go red the moment its
    // own corrected clock crosses zero rather than waiting for a round trip.
    expect(timerState(timer(), at("2026-09-08T10:10:00.000Z"))).toBe("finished");
  });

  test("stays finished until dismissed, however long that takes", () => {
    expect(timerState(timer(), at("2026-09-08T18:00:00.000Z"))).toBe("finished");
  });

  test("is dismissed once acknowledged, even if that happened early", () => {
    // Stopping a timer before it rings dismisses it; it must not later
    // resurrect into "finished" when its duration elapses.
    const stopped = timer({ dismissed_at: "2026-09-08T10:01:00.000Z" });
    expect(timerState(stopped, at("2026-09-08T10:00:30.000Z"))).toBe("dismissed");
    expect(timerState(stopped, at("2026-09-08T11:00:00.000Z"))).toBe("dismissed");
  });
});

test.describe("pausing", () => {
  test("a paused timer keeps the time it had when it was paused, long after its old end", () => {
    // 10 minutes from 10:00, paused at 10:04: six minutes left, for as long as it stays paused.
    const paused = timer({ paused_at: "2026-09-08T10:04:00.000Z" });
    expect(timerState(paused, at("2026-09-08T10:05:00.000Z"))).toBe("paused");
    expect(remainingSeconds(paused, at("2026-09-08T10:05:00.000Z"))).toBe(360);
    expect(timerState(paused, at("2026-09-08T11:30:00.000Z"))).toBe("paused");
    expect(remainingSeconds(paused, at("2026-09-08T11:30:00.000Z"))).toBe(360);
  });

  test("the time it spent paused moves its end", () => {
    // Paused for two minutes in all, then resumed: due at 10:12, not 10:10.
    const resumed = timer({ paused_seconds: 120 });
    expect(endsAt(resumed)).toBe(Date.parse("2026-09-08T10:12:00.000Z"));
    expect(timerState(resumed, at("2026-09-08T10:10:30.000Z"))).toBe("running");
    expect(remainingSeconds(resumed, at("2026-09-08T10:10:30.000Z"))).toBe(90);
    expect(timerState(resumed, at("2026-09-08T10:12:00.000Z"))).toBe("finished");
  });

  test("dismissal still wins over a pause", () => {
    const both = timer({ paused_at: "2026-09-08T10:04:00.000Z", dismissed_at: "2026-09-08T10:06:00.000Z" });
    expect(timerState(both, at("2026-09-08T10:07:00.000Z"))).toBe("dismissed");
  });

  test("a row read before the migration, with no pause columns, was never paused", () => {
    const old = timer();
    expect("paused_seconds" in old || "paused_at" in old).toBe(false);
    expect(endsAt(old)).toBe(Date.parse("2026-09-08T10:10:00.000Z"));
    expect(timerState(old, at("2026-09-08T10:05:00.000Z"))).toBe("running");
  });
});
