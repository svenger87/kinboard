import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import type { RpcClient } from "@/lib/pocket-money/booking";
import { buyItem } from "@/lib/creatures/purchases";

export const dynamic = "force-dynamic";

/**
 * POST /api/creatures/[personId]/purchases  body: { item_id }
 *
 * A child buys something for their creature in the shop (RFC-017 §5), with
 * their own task points. A session is enough, no settings PIN: like asking
 * for a reward it is the child's own action, and a parent's say is the Shop
 * switch under Settings -> Creatures & rewards, which the database checks.
 *
 * The price is the catalogue's (lib/pocket-money/creatures/shop.ts); a price
 * in the body is ignored. purchase_person_point_item() refuses it when the
 * child has no creature switched on, the shop is off, the item is already
 * theirs, or their balance less what is waiting for a parent does not cover
 * it -- all under the child's lock, so two taps never pay twice.
 *
 * Buying does not put the item on: wearing it is a look change, PATCH
 * /api/creatures/[personId], which takes only owned items.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { item_id?: unknown } | null;
  if (typeof body?.item_id !== "string" || body.item_id.length === 0) {
    return NextResponse.json({ error: "item_id required" }, { status: 400 });
  }

  const result = await buyItem(createAdminClient() as unknown as RpcClient, {
    familyId: auth.session.familyId,
    personId,
    itemId: body.item_id,
  });
  return NextResponse.json(result.body, { status: result.status });
}
