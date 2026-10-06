/**
 * The creature shop's one write (RFC-017 §5): a child buys an item with
 * their task points. purchase_person_point_item() in
 * docker/migration_zzzzzzzzz_point_purchases.sql does every check under the
 * child's lock; this turns its answer into an HTTP one. The price comes from
 * the catalogue (lib/pocket-money/creatures/shop.ts), never from the request.
 * A parent can refund a purchase (refundPurchase, behind the settings PIN).
 * The client is a parameter so a spec can hand it the real admin client.
 */

import { UUID } from "@/lib/home/action-requests";
import type { RpcClient } from "@/lib/pocket-money/booking";
import { shopItem } from "@/lib/pocket-money/creatures/shop";

type Answer = { status: number; body: Record<string, unknown> };

export async function buyItem(
  client: RpcClient,
  input: { familyId: string; personId: string; itemId: unknown },
): Promise<Answer> {
  if (!UUID.test(input.personId)) return { status: 404, body: { error: "not found" } };
  const item = shopItem(input.itemId);
  // A retired item stays owned and worn, but is no longer for sale.
  if (!item || item.retired) return { status: 404, body: { error: "no_item" } };
  const { data, error } = await client.rpc("purchase_person_point_item", {
    p_family_id: input.familyId,
    p_person_id: input.personId,
    p_item_id: item.id,
    p_cost: item.cost,
  });
  if (error) return { status: 500, body: { error: error.message } };
  const answer = data as { ok?: unknown; error?: unknown; purchase?: unknown; balance?: unknown; pending?: unknown } | null;
  if (answer?.ok === true) return { status: 201, body: { purchase: answer.purchase, balance: answer.balance } };
  switch (answer?.error) {
    case "not_found": return { status: 404, body: { error: "not found" } };
    case "no_creature": return { status: 409, body: { error: "no_creature" } };
    case "shop_off": return { status: 409, body: { error: "shop_off" } };
    case "already_owned": return { status: 409, body: { error: "already_owned" } };
    case "insufficient_points":
      return { status: 409, body: { error: "insufficient_points", balance: answer.balance, pending: answer.pending } };
    default: return { status: 500, body: { error: "unexpected answer from purchase_person_point_item" } };
  }
}

/**
 * A parent's refund: refund_person_point_purchase(), as an HTTP answer. The
 * route checks the settings PIN before it gets here.
 */
export async function refundPurchase(
  client: RpcClient,
  input: { familyId: string; purchaseId: string },
): Promise<Answer> {
  if (!UUID.test(input.purchaseId)) return { status: 404, body: { error: "not found" } };
  const { data, error } = await client.rpc("refund_person_point_purchase", {
    p_family_id: input.familyId,
    p_purchase_id: input.purchaseId,
  });
  if (error) return { status: 500, body: { error: error.message } };
  const answer = data as { ok?: unknown; error?: unknown; refunded?: unknown; balance?: unknown } | null;
  if (answer?.ok === true) return { status: 200, body: { refunded: answer.refunded, balance: answer.balance } };
  if (answer?.error === "not_found") return { status: 404, body: { error: "not found" } };
  return { status: 500, body: { error: "unexpected answer from refund_person_point_purchase" } };
}
