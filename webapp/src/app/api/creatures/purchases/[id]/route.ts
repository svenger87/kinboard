import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import type { RpcClient } from "@/lib/pocket-money/booking";
import { refundPurchase } from "@/lib/creatures/purchases";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/creatures/purchases/[id] -- a parent refunds something a child
 * bought in the creature shop (RFC-017 §5), from Settings -> Creatures &
 * rewards. Parental: the settings PIN, checked here on the server, since the
 * child's own screen can buy but must not hand its points back to itself
 * (or take a sibling's item away).
 *
 * refund_person_point_purchase() does it in one transaction under the
 * child's lock: the purchase row goes, so the points come back, and a worn
 * item comes off the creature's look. Family-scoped by the session's family.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const result = await refundPurchase(createAdminClient() as unknown as RpcClient, {
    familyId: auth.session.familyId,
    purchaseId: id,
  });
  return NextResponse.json(result.body, { status: result.status });
}
