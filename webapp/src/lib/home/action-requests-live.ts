/**
 * The real table, PIN check, Home Assistant, pocket-money booking and push behind
 * `lib/home/action-requests.ts`.
 *
 * Every write is a single PostgREST UPDATE filtered on the expected current
 * status (and, when deciding, on `expires_at`), so two screens racing to
 * approve cannot both win — Postgres serialises the two UPDATEs on the row,
 * and the second one matches nothing.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { familyHasPin, verifySettingsPin } from "@/lib/settings-pin";
import { callHaService } from "@/lib/home/ha-client";
import { catalogueEntity } from "@/lib/home/catalogue";
import { childPocketMoneyAccount, liveBookPocketMoney } from "@/lib/pocket-money/children";
import { sendPushToMultiple, isVapidConfigured, type DatabaseSubscription } from "@/lib/push-sender";
import { getPushTranslator, getTranslator } from "@/lib/notifications/messages";
import { getFamilyLocale } from "@/lib/family-locale";
import { CONFIRM_MAX_PENDING, confirmationBudget, hitConfirmLimit, type Budget } from "@/lib/integration-limits";
import {
  describeRequest,
  type ActionRequestRow,
  type ActionRequestStore,
  type ActionTranslator,
  type DecideDeps,
  type PushRequest,
} from "@/lib/home/action-requests";

const TABLE = "assistant_action_requests";
const MAX_PENDING = 20;

const db = () => createAdminClient() as any;

export const liveActionStore: ActionRequestStore = {
  async insert(row) {
    const { data, error } = await db().from(TABLE).insert(row).select("*").single();
    if (error || !data) throw new Error(`Failed to store the action request: ${error?.message ?? "no row"}`);
    return data as ActionRequestRow;
  },

  async get(id, familyId) {
    const { data, error } = await db().from(TABLE).select("*").eq("id", id).eq("family_id", familyId).maybeSingle();
    if (error) throw new Error(`Failed to read the action request: ${error.message}`);
    return (data as ActionRequestRow | null) ?? null;
  },

  async listPending(familyId) {
    const { data, error } = await db()
      .from(TABLE)
      .select("*")
      .eq("family_id", familyId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(MAX_PENDING);
    if (error) throw new Error(`Failed to list action requests: ${error.message}`);
    return (data ?? []) as ActionRequestRow[];
  },

  async transition(id, familyId, from, patch, unexpiredAt) {
    let query = db().from(TABLE).update(patch).eq("id", id).eq("family_id", familyId).eq("status", from);
    if (unexpiredAt) query = query.gt("expires_at", unexpiredAt);
    const { data, error } = await query.select("*");
    if (error) throw new Error(`Failed to update the action request: ${error.message}`);
    return ((data ?? []) as ActionRequestRow[])[0] ?? null;
  },

  async tokenActive(tokenId, familyId) {
    if (!tokenId) return false;
    const { data, error } = await db()
      .from("integration_tokens")
      .select("id, family_id, revoked_at")
      .eq("id", tokenId)
      .maybeSingle();
    // Unreadable is not "active": fail closed.
    if (error) throw new Error(`Failed to read the assistant's token: ${error.message}`);
    return !!data && data.family_id === familyId && !data.revoked_at;
  },
};

/**
 * Push to every phone of the family, quiet hours or not — RFC-011 Task 9
 * amendment F: a door that wants unlocking cannot wait for the morning. The
 * notification opens `/assistant-actions/{id}`. Never throws.
 */
export async function pushActionRequest(request: PushRequest): Promise<void> {
  try {
    if (!isVapidConfigured()) return;
    const { data: subs, error } = await db()
      .from("push_subscriptions")
      .select("*")
      .eq("family_id", request.familyId)
      .eq("is_active", true);
    if (error) {
      console.error("[assistant-actions] could not list subscriptions:", error);
      return;
    }
    if (!subs || subs.length === 0) return;

    const locale = await getFamilyLocale(request.familyId);
    const t = getTranslator(locale, "assistantActions") as unknown as ActionTranslator;
    const title = describeRequest(t, request.request);
    await sendPushToMultiple(subs as DatabaseSubscription[], {
      title,
      body: getPushTranslator(locale)("assistantActionBody"),
      tag: `assistant-action-${request.requestId}`,
      url: `/assistant-actions/${request.requestId}`,
    });
  } catch (err) {
    console.error("[assistant-actions] push failed:", err);
  }
}

export const liveDecideDeps: DecideDeps = {
  store: liveActionStore,
  hasPin: (familyId) => familyHasPin(familyId),
  verifyPin: (familyId, pin) => verifySettingsPin(familyId, pin),
  callHaService: (familyId, domain, service, entityId, data) =>
    callHaService(familyId, domain, service, entityId, data),
  catalogueEntity: (familyId, entityId) => catalogueEntity(familyId, entityId),
  pocketMoneyAccount: (familyId, personId) => childPocketMoneyAccount(familyId, personId),
  bookPocketMoney: (input) => liveBookPocketMoney(input),
};

/**
 * May this assistant ask the family for one more confirmation? Counts its
 * pending requests of every kind — a pocket-money booking and a door unlock
 * share the same budget (at most 2 waiting, 5 per 10 minutes per token,
 * `lib/integration-limits.ts`), because both light up every screen in the
 * house. Spends the budget when it says yes; throws when unreadable.
 */
export async function liveConfirmationBudget(familyId: string, tokenId: string): Promise<Budget> {
  const now = new Date();
  const { data, error } = await db()
    .from(TABLE)
    .select("expires_at")
    .eq("family_id", familyId)
    .eq("token_id", tokenId)
    .eq("status", "pending")
    .gt("expires_at", now.toISOString())
    .limit(CONFIRM_MAX_PENDING);
  if (error) throw new Error(`Failed to count pending requests: ${error.message}`);
  const expiries = ((data ?? []) as { expires_at: string }[]).map((r) => r.expires_at);
  return confirmationBudget(expiries, now, () => hitConfirmLimit(tokenId));
}
