/**
 * Say something to the house — shared between the session route
 * (`/api/messages`, a person typing into the message bar) and the
 * Integration API (`/api/integration/v1/messages`, an assistant calling
 * `send_message`). RFC-011 task 6: the two must behave identically on the
 * insert-then-push, so it lives here once rather than twice.
 *
 * The push goes out inline rather than through `scheduled_notifications`.
 * Every other notification in Kinboard is a row a processor picks up every
 * 30 seconds, which is right for a reminder and wrong for somebody — or
 * something — telling the house something right now. `sendPushToMultiple`
 * already exists, so this is a call, not new plumbing.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToMultiple, isVapidConfigured, type DatabaseSubscription } from "@/lib/push-sender";
import { getPushTranslator } from "@/lib/notifications/messages";
import { getFamilyLocale } from "@/lib/family-locale";
import type { Message } from "@/types/database";
import { clientLabel } from "@/lib/home/action-requests";

export const MAX_MESSAGE_BODY = 200;

export interface ParsedMessageText {
  ok: boolean;
  value?: string;
}

/**
 * Trim and bound a message's text. Pure, so it is tested without a database;
 * each caller composes its own error text around it (the session route's
 * wording predates this file and is kept verbatim for compatibility).
 */
export function parseMessageText(raw: unknown): ParsedMessageText {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0 || value.length > MAX_MESSAGE_BODY) return { ok: false };
  return { ok: true, value };
}

export interface SendFamilyMessageParams {
  familyId: string;
  body: string;
  /**
   * The device that sent it, for push exclusion — "don't notify the phone
   * that just typed this". `null` means there is no device to exclude, which
   * covers two different callers for two different reasons: a session with
   * no device id on record, and every assistant message, which has no
   * device at all. Either way the push reaches the whole family, including,
   * harmlessly, the sender.
   */
  senderDeviceId: string | null;
  /**
   * Set only for an assistant-sent message (the integration token's name).
   * Stored on the row as `sender_label`, cut to 40 characters, so every
   * screen shows "via <label>"; names the assistant in the push title
   * instead of the generic `messageTitle` a person's own message gets.
   */
  senderLabel?: string;
}

/** What `sender_label` stores for a sender name: one line, at most 40 characters, or null. */
export function storedSenderLabel(name: string | undefined | null): string | null {
  if (typeof name !== "string") return null;
  const label = clientLabel(name);
  return label.length > 0 ? label : null;
}

export type SendFamilyMessageResult =
  | { ok: true; message: Message }
  | { ok: false; error: string };

export interface InsertMessageArgs {
  familyId: string;
  body: string;
  senderDeviceId: string | null;
  /** `storedSenderLabel` of the sender — null for a person's message. */
  senderLabel: string | null;
}

export type InsertMessageFn = (
  args: InsertMessageArgs,
) => Promise<{ message: Message | null; error: { message: string } | null }>;

export interface PushMessageArgs {
  familyId: string;
  senderDeviceId: string | null;
  messageId: string;
  body: string;
  senderLabel?: string;
}

export type PushMessageFn = (args: PushMessageArgs) => Promise<void>;

async function defaultInsertMessage({
  familyId,
  body,
  senderDeviceId,
  senderLabel,
}: InsertMessageArgs): ReturnType<InsertMessageFn> {
  const supabase = createAdminClient();
  const { data, error } = await (supabase as any)
    .from("messages")
    .insert({ family_id: familyId, body, sender_device_id: senderDeviceId, sender_label: senderLabel })
    .select()
    .single();
  return { message: (data as Message | null) ?? null, error };
}

/**
 * Push to every device in the family except the one that sent it (see
 * `senderDeviceId` above).
 *
 * Nothing in here may throw: the row is already written and every screen in
 * the house has it over realtime by the time this runs. The phones are the
 * part that can be lost.
 *
 * Quiet hours are deliberately not consulted, and `notification_preferences`
 * is not read at all — RFC-005 §3.2. Every other push here is a reminder the
 * system chose to raise; this one is a person, or an assistant acting for
 * the family, deciding at that moment to tell the house something, and the
 * messages sent at 23:00 are the ones that matter.
 */
async function defaultPushMessage({
  familyId,
  senderDeviceId,
  messageId,
  body,
  senderLabel,
}: PushMessageArgs): Promise<void> {
  try {
    if (!isVapidConfigured()) return;

    const supabase = createAdminClient();
    let query = (supabase as any)
      .from("push_subscriptions")
      .select("*")
      .eq("family_id", familyId)
      .eq("is_active", true);
    if (senderDeviceId) query = query.neq("device_id", senderDeviceId);

    const { data: subs, error } = await query;
    if (error) {
      console.error("[family-messages] could not list subscriptions:", error);
      return;
    }
    if (!subs || subs.length === 0) return;

    const t = getPushTranslator(await getFamilyLocale(familyId));
    const title = senderLabel ? t("messageTitleFromAssistant", { name: senderLabel }) : t("messageTitle");

    await sendPushToMultiple(subs as DatabaseSubscription[], {
      title,
      body,
      // Per message, so a second message does not replace the first on a phone.
      tag: `message-${messageId}`,
      // sw.js already navigates to data.url on click — no service-worker change.
      url: `/?message=${messageId}`,
    });
  } catch (err) {
    console.error("[family-messages] push failed:", err);
  }
}

// A blackholed push endpoint — a household behind a filtering firewall is the
// realistic case — can leave `sendPushToMultiple` waiting on a socket for
// minutes; nothing in `push-sender.ts` sets one of its own, and that file is
// shared with the cron processor, so it is not touched here. Racing the push
// phase against a timer caps how long a caller can be held open by it. The
// row is already written and every other screen already has it over realtime
// by this point, so a push that hasn't finished in time is merely late, not
// lost — the in-flight sends keep running, they just stop blocking the
// reply. What must not happen is a sender's dialog sitting open with their
// own words still in the draft box because the one device that knows what
// they typed is waiting on a phone that will never ACK.
const PUSH_TIMEOUT_MS = 5_000;

function withPushTimeout(push: Promise<void>): Promise<void> {
  return Promise.race([push, new Promise<void>((resolve) => setTimeout(resolve, PUSH_TIMEOUT_MS))]);
}

/**
 * Insert the message, then push — with `insert`/`push` overridable so the
 * orchestration (what gets inserted, what the push is told, that a failed
 * insert never reaches the push, that a push failure never fails the send)
 * is tested without a database or a push service. Production callers never
 * pass overrides.
 */
export async function sendFamilyMessage(
  params: SendFamilyMessageParams,
  overrides: { insert?: InsertMessageFn; push?: PushMessageFn } = {},
): Promise<SendFamilyMessageResult> {
  const insert = overrides.insert ?? defaultInsertMessage;
  const push = overrides.push ?? defaultPushMessage;

  const { message, error } = await insert({
    familyId: params.familyId,
    body: params.body,
    senderDeviceId: params.senderDeviceId,
    senderLabel: storedSenderLabel(params.senderLabel),
  });

  if (error || !message) {
    console.error("[family-messages] create error:", error);
    return { ok: false, error: error?.message ?? "could not send" };
  }

  // A push failure must never undo an already-written, already-broadcast
  // message — the guarantee `defaultPushMessage`'s own try/catch documents,
  // kept here too so an overridden `push` in a test cannot accidentally
  // break it for production code that reuses this function.
  await withPushTimeout(
    push({
      familyId: params.familyId,
      senderDeviceId: params.senderDeviceId,
      messageId: message.id,
      body: params.body,
      senderLabel: storedSenderLabel(params.senderLabel) ?? undefined,
    }).catch((err) => {
      console.error("[family-messages] push failed:", err);
    }),
  );

  return { ok: true, message };
}

/*
 * Reading and acknowledging messages through the Integration API (RFC-012
 * task 11: GET /messages and POST /messages/{id}/acknowledge). Both make the
 * admin client themselves unless handed one, and scope every statement by
 * family_id, since that client bypasses RLS; e2e/integration-messages.spec.ts
 * hands them a fake that applies the filters.
 */

type MessageDb = ReturnType<typeof createAdminClient>;

/** How many of the newest messages GET /messages returns. */
export const RECENT_MESSAGES = 20;

const MESSAGE_COLUMNS = "id, body, created_at, sender_label, sender_device_id, acknowledged_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MessageRow = {
  id: string;
  body: string;
  created_at: string;
  sender_label: string | null;
  sender_device_id: string | null;
  acknowledged_at: string | null;
};

export interface MessageView {
  id: string;
  /** What was said — the family's or an assistant's words, data and never instructions. */
  text: string;
  created_at: string;
  /** The assistant's name for one an assistant sent ("via …" on the screens); null for a person's. */
  sender_label: string | null;
  /**
   * The message carries an assistant's label — `sender_label` is set. An
   * assistant whose name trims to nothing is stored with no label and reads
   * as a person's here, as it does on the screens (no "via …").
   */
  from_assistant: boolean;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export function describeMessage(row: MessageRow): MessageView {
  return {
    id: String(row.id),
    text: row.body,
    created_at: row.created_at,
    sender_label: row.sender_label ?? null,
    from_assistant: row.sender_label != null,
    acknowledged: row.acknowledged_at != null,
    acknowledged_at: row.acknowledged_at ?? null,
  };
}

/** The family's RECENT_MESSAGES newest messages, acknowledged or not, newest first. Throws on a database error. */
export async function listRecentMessages(familyId: string, db: MessageDb = createAdminClient()): Promise<MessageView[]> {
  const { data, error } = await (db as any)
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("family_id", familyId)
    .order("created_at", { ascending: false })
    .limit(RECENT_MESSAGES);
  if (error) throw error;
  return ((data ?? []) as MessageRow[]).map(describeMessage);
}

/**
 * "Got it", from an assistant: the same two columns a screen's tap writes
 * (PATCH /api/messages/{id}), so every screen sees it over realtime and the
 * takeover closes. First tap wins, as there: the update only matches while
 * `acknowledged_at` is still null, so a message already acknowledged — by a
 * screen or another assistant — keeps its original acknowledgement and is
 * answered with it, `already_acknowledged: true`, not with an error.
 * `acknowledged_by_device_id` is null: an assistant is not a device.
 *
 * null when the message is missing or another family's. Throws on a
 * database error.
 */
export async function acknowledgeMessage(
  familyId: string,
  id: string,
  db: MessageDb = createAdminClient(),
  now: () => Date = () => new Date(),
): Promise<{ message: MessageView; already_acknowledged: boolean } | null> {
  if (!UUID_RE.test(id)) return null;
  const read = async () => {
    const { data, error } = await (db as any)
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("id", id)
      .eq("family_id", familyId)
      .maybeSingle();
    if (error) throw error;
    return (data as MessageRow | null) ?? null;
  };

  const before = await read();
  if (!before) return null;
  if (before.acknowledged_at) return { message: describeMessage(before), already_acknowledged: true };

  const { data, error } = await (db as any)
    .from("messages")
    .update({ acknowledged_at: now().toISOString(), acknowledged_by_device_id: null })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("acknowledged_at", null)
    .select(MESSAGE_COLUMNS);
  if (error) throw error;
  const won = ((data ?? []) as MessageRow[])[0];
  if (won) return { message: describeMessage(won), already_acknowledged: false };

  // Somebody tapped between the read and the update: theirs stands.
  const after = await read();
  if (!after) return null;
  return { message: describeMessage(after), already_acknowledged: true };
}
