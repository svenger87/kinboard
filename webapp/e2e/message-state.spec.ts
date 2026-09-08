import { test, expect } from "@playwright/test";
import { messageState, TAKEOVER_MS } from "../src/lib/message-state";
import type { Message } from "../src/types/database";

const at = (iso: string, ack: string | null = null): Message => ({
  id: "m1",
  family_id: "f1",
  body: "back by 6",
  sender_device_id: "d1",
  acknowledged_at: ack,
  acknowledged_by_device_id: ack ? "d2" : null,
  created_at: iso,
});

const T0 = "2026-09-08T12:00:00.000Z";
const plus = (ms: number) => new Date(Date.parse(T0) + ms);

test.describe("messageState", () => {
  test("takes the board the instant it arrives", () => {
    expect(messageState(at(T0), plus(0))).toBe("takeover");
  });

  test("still has the board one millisecond before the minute is up", () => {
    expect(messageState(at(T0), plus(TAKEOVER_MS - 1))).toBe("takeover");
  });

  test("gives the board back exactly on the minute", () => {
    expect(messageState(at(T0), plus(TAKEOVER_MS))).toBe("waiting");
  });

  test("waits, however long it has been", () => {
    expect(messageState(at(T0), plus(6 * 60 * 60 * 1000))).toBe("waiting");
  });

  test("an acknowledged message is done even inside its minute", () => {
    // Acknowledgement must beat the clock. If elapsed time were checked first,
    // a message somebody already dealt with could take over a board whose
    // clock disagrees — the alarm nobody set.
    expect(messageState(at(T0, T0), plus(1000))).toBe("done");
  });

  test("an acknowledged message stays done once it is old", () => {
    expect(messageState(at(T0, T0), plus(10 * 60 * 1000))).toBe("done");
  });

  test("the takeover is one minute", () => {
    expect(TAKEOVER_MS).toBe(60_000);
  });
});
