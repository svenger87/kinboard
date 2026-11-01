import { test, expect } from "@playwright/test";
import { RealtimeHub, parseChange, type HubMessage } from "../src/lib/realtime/hub";

/**
 * The change feed's fan-out (src/lib/realtime/hub.ts), against a stand-in
 * connection: no database, no server.
 *
 * Two properties carry the whole design. A screen receives its own family's
 * changes and nobody else's — the stream is the only filter, since the
 * NOTIFY channel carries every family. And after the database connection
 * comes back, every screen is told to resync, because NOTIFY has no replay.
 */

const FAMILY_A = "aaaaaaaa-0000-0000-0000-000000000000";
const FAMILY_B = "bbbbbbbb-0000-0000-0000-000000000000";

function change(familyId: string, table = "todos", extra: Record<string, unknown> = {}) {
  return JSON.stringify({ table, op: "UPDATE", family_id: familyId, new: { id: "t1", ...extra }, old: { id: "t1" } });
}

/** A fake connection the test drives by hand. */
function fakeConnect() {
  const state = {
    attempts: 0,
    fail: false,
    notify: (_payload: string) => {},
    close: () => {},
  };
  const connect = async (h: { onNotify: (p: string) => void; onClose: () => void }) => {
    state.attempts++;
    if (state.fail) throw new Error("refused");
    state.notify = h.onNotify;
    state.close = h.onClose;
    return { ping: async () => {}, end: async () => {} };
  };
  return { state, connect };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test.describe("realtime hub", () => {
  test("a subscriber receives its own family's changes and no other family's", async () => {
    const { state, connect } = fakeConnect();
    const hub = new RealtimeHub(connect);
    const a: HubMessage[] = [];
    const b: HubMessage[] = [];
    hub.subscribe(FAMILY_A, (m) => a.push(m));
    hub.subscribe(FAMILY_B, (m) => b.push(m));
    await settle();
    expect(hub.getStatus()).toBe("listening");

    state.notify(change(FAMILY_A));
    state.notify(change(FAMILY_A, "settings", { key: "theme" }));

    expect(a).toHaveLength(2);
    expect(b).toEqual([]);
    expect(a[1]).toMatchObject({ kind: "change", change: { table: "settings", family_id: FAMILY_A, new: { key: "theme" } } });
  });

  test("a family nobody is subscribed for goes nowhere, and unsubscribing stops delivery", async () => {
    const { state, connect } = fakeConnect();
    const hub = new RealtimeHub(connect);
    const a: HubMessage[] = [];
    const off = hub.subscribe(FAMILY_A, (m) => a.push(m));
    await settle();
    state.notify(change(FAMILY_B));
    expect(a).toEqual([]);
    off();
    state.notify(change(FAMILY_A));
    expect(a).toEqual([]);
    expect(hub.subscriberCount()).toBe(0);
  });

  test("the connection is opened once, on the first subscriber", async () => {
    const { state, connect } = fakeConnect();
    const hub = new RealtimeHub(connect);
    expect(state.attempts).toBe(0);
    hub.subscribe(FAMILY_A, () => {});
    hub.subscribe(FAMILY_A, () => {});
    hub.subscribe(FAMILY_B, () => {});
    await settle();
    expect(state.attempts).toBe(1);
  });

  test("a lost connection says down, and its return asks every family to resync", async () => {
    const { state, connect } = fakeConnect();
    const hub = new RealtimeHub(connect);
    const a: HubMessage[] = [];
    const b: HubMessage[] = [];
    hub.subscribe(FAMILY_A, (m) => a.push(m));
    hub.subscribe(FAMILY_B, (m) => b.push(m));
    await settle();
    expect(a).toEqual([]); // the first connection is not a resync

    state.close();
    expect(hub.getStatus()).toBe("down");
    expect(a).toEqual([{ kind: "down" }]);
    expect(b).toEqual([{ kind: "down" }]);

    // The first retry waits 500 ms.
    await expect.poll(() => hub.getStatus(), { timeout: 3000 }).toBe("listening");
    expect(state.attempts).toBe(2);
    expect(a).toEqual([{ kind: "down" }, { kind: "resync" }]);
    expect(b).toEqual([{ kind: "down" }, { kind: "resync" }]);
  });

  test("a refused connection is retried, and a subscriber joining meanwhile is told it is down", async () => {
    const { state, connect } = fakeConnect();
    state.fail = true;
    const hub = new RealtimeHub(connect);
    hub.subscribe(FAMILY_A, () => {});
    await settle();
    expect(hub.getStatus()).toBe("down");

    const late: HubMessage[] = [];
    hub.subscribe(FAMILY_B, (m) => late.push(m));
    expect(late).toEqual([{ kind: "down" }]);

    state.fail = false;
    await expect.poll(() => hub.getStatus(), { timeout: 3000 }).toBe("listening");
    expect(state.attempts).toBeGreaterThanOrEqual(2);
  });

  test("a payload that is not a change is dropped", () => {
    expect(parseChange("not json")).toBeNull();
    expect(parseChange(JSON.stringify({ table: "todos", op: "TRUNCATE", family_id: FAMILY_A }))).toBeNull();
    expect(parseChange(JSON.stringify({ table: "todos", op: "INSERT" }))).toBeNull();
    expect(parseChange(change(FAMILY_A))).toMatchObject({ table: "todos", op: "UPDATE", family_id: FAMILY_A });
  });
});
