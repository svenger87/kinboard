import { test, expect } from "@playwright/test";
import {
  MAX_MESSAGE_BODY,
  parseMessageText,
  sendFamilyMessage,
  storedSenderLabel,
  type InsertMessageFn,
  type PushMessageFn,
} from "../src/lib/family-messages";
import type { Message } from "../src/types/database";

/**
 * `sendFamilyMessage` is what `POST /api/messages` (a person) and
 * `POST /api/integration/v1/messages` (an assistant, via `send_message`)
 * both call — RFC-011 task 6. Pure logic, no stack: the database and the
 * push are both seams (`insert`/`push`), so the orchestration is tested by
 * recording what each is called with.
 */

function makeRow(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    family_id: "f1",
    body: "back by 6",
    sender_device_id: null,
    sender_label: null,
    acknowledged_at: null,
    acknowledged_by_device_id: null,
    created_at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  } as Message;
}

test.describe("parseMessageText", () => {
  test("trims and accepts 1-200 characters", () => {
    expect(parseMessageText("  back by 6  ")).toEqual({ ok: true, value: "back by 6" });
    expect(parseMessageText("a")).toEqual({ ok: true, value: "a" });
    expect(parseMessageText("a".repeat(MAX_MESSAGE_BODY))).toEqual({ ok: true, value: "a".repeat(MAX_MESSAGE_BODY) });
  });

  test("rejects empty, whitespace-only, and over-length text", () => {
    expect(parseMessageText("")).toEqual({ ok: false });
    expect(parseMessageText("   ")).toEqual({ ok: false });
    expect(parseMessageText("a".repeat(MAX_MESSAGE_BODY + 1))).toEqual({ ok: false });
  });

  test("rejects non-string input rather than coercing it", () => {
    expect(parseMessageText(undefined)).toEqual({ ok: false });
    expect(parseMessageText(null)).toEqual({ ok: false });
    expect(parseMessageText(42)).toEqual({ ok: false });
    expect(parseMessageText({ text: "hi" })).toEqual({ ok: false });
  });

  test("the bound is 200, matching the messages table's own check constraint", () => {
    expect(MAX_MESSAGE_BODY).toBe(200);
  });
});

test.describe("sendFamilyMessage", () => {
  test("inserts with the given family, body and sender device, then pushes with the new id", async () => {
    const inserted = makeRow({ id: "m-new", family_id: "fam-1", body: "soup's on", sender_device_id: "dev-1" });
    const insertCalls: unknown[] = [];
    const pushCalls: unknown[] = [];
    const insert: InsertMessageFn = async (args) => {
      insertCalls.push(args);
      return { message: inserted, error: null };
    };
    const push: PushMessageFn = async (args) => {
      pushCalls.push(args);
    };

    const result = await sendFamilyMessage(
      { familyId: "fam-1", body: "soup's on", senderDeviceId: "dev-1" },
      { insert, push },
    );

    expect(result).toEqual({ ok: true, message: inserted });
    expect(insertCalls).toEqual([{ familyId: "fam-1", body: "soup's on", senderDeviceId: "dev-1", senderLabel: null }]);
    expect(pushCalls).toEqual([{
      familyId: "fam-1", senderDeviceId: "dev-1", messageId: "m-new", body: "soup's on", senderLabel: undefined,
    }]);
  });

  test("a null senderDeviceId (no device to exclude) reaches the push unchanged, excluding nobody", async () => {
    const pushCalls: unknown[] = [];
    const insert: InsertMessageFn = async () => ({ message: makeRow({ id: "m2" }), error: null });
    const push: PushMessageFn = async (args) => {
      pushCalls.push(args);
    };

    await sendFamilyMessage({ familyId: "f1", body: "hi", senderDeviceId: null }, { insert, push });

    expect(pushCalls).toEqual([{ familyId: "f1", senderDeviceId: null, messageId: "m2", body: "hi", senderLabel: undefined }]);
  });

  test("an assistant's senderLabel reaches the push, naming it instead of the generic title", async () => {
    const pushCalls: unknown[] = [];
    const insert: InsertMessageFn = async () => ({ message: makeRow({ id: "m3" }), error: null });
    const push: PushMessageFn = async (args) => {
      pushCalls.push(args);
    };

    await sendFamilyMessage(
      { familyId: "f1", body: "dinner's ready", senderDeviceId: null, senderLabel: "Home Assistant" },
      { insert, push },
    );

    expect(pushCalls).toEqual([{
      familyId: "f1", senderDeviceId: null, messageId: "m3", body: "dinner's ready", senderLabel: "Home Assistant",
    }]);
  });

  test("ruling 11: an assistant's message stores its label (cut to 40) on the row; a person's stores null", async () => {
    const insertCalls: { senderLabel: string | null }[] = [];
    const pushCalls: { senderLabel?: string }[] = [];
    const insert: InsertMessageFn = async (args) => {
      insertCalls.push(args);
      return { message: makeRow(), error: null };
    };
    const push: PushMessageFn = async (args) => {
      pushCalls.push(args);
    };
    const long = "Claude for the whole family, connected from the laptop";
    await sendFamilyMessage({ familyId: "f1", body: "hi", senderDeviceId: null, senderLabel: long }, { insert, push });
    await sendFamilyMessage({ familyId: "f1", body: "hi", senderDeviceId: "dev-1" }, { insert, push });
    expect(insertCalls[0].senderLabel).toBe(storedSenderLabel(long));
    expect(insertCalls[0].senderLabel!.length).toBeLessThanOrEqual(40);
    expect(insertCalls[0].senderLabel!.endsWith("…")).toBe(true);
    expect(pushCalls[0].senderLabel).toBe(insertCalls[0].senderLabel);
    expect(insertCalls[1].senderLabel).toBeNull();
  });

  test("storedSenderLabel: one line, at most 40 characters, and never an empty string", () => {
    expect(storedSenderLabel("Claude")).toBe("Claude");
    expect(storedSenderLabel("  Claude\nCode ")).toBe("Claude Code");
    expect(storedSenderLabel("   ")).toBeNull();
    expect(storedSenderLabel(undefined)).toBeNull();
    expect(storedSenderLabel("z".repeat(100))!.length).toBeLessThanOrEqual(40);
  });

  test("an insert failure is reported and never reaches the push", async () => {
    const pushCalls: unknown[] = [];
    const insert: InsertMessageFn = async () => ({ message: null, error: { message: "db is down" } });
    const push: PushMessageFn = async (args) => {
      pushCalls.push(args);
    };

    const result = await sendFamilyMessage({ familyId: "f1", body: "hi", senderDeviceId: null }, { insert, push });

    expect(result).toEqual({ ok: false, error: "db is down" });
    expect(pushCalls).toEqual([]);
  });

  test("a push that throws does not fail the send — the row is already written", async () => {
    const insert: InsertMessageFn = async () => ({ message: makeRow({ id: "m4" }), error: null });
    const push: PushMessageFn = async () => {
      throw new Error("push service unreachable");
    };

    const result = await sendFamilyMessage({ familyId: "f1", body: "hi", senderDeviceId: null }, { insert, push });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message.id).toBe("m4");
  });
});
