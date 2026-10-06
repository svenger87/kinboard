import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import type { RpcClient } from "@/lib/pocket-money/booking";
import { decideRedemption } from "@/lib/pocket-money/rewards";
import { liveRewardNotifier } from "@/lib/notifications/rewards";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/rewards/redemptions/[id]  body: { status: "approved" | "denied" }
 *
 * A parent's decision on a child's reward request (discussion #349), checked
 * against the settings PIN on the server: a child's own screen, which can make
 * the request, must not be able to approve it. Decided in one transaction
 * (decide_point_redemption): the request must still be pending, the child's
 * decisions are queued one after the other (per child since RFC-017), and approving is refused with
 * nothing written when the points do not cover it. Approved twice at once:
 * one 200, one 409 already_decided. The deciding device is recorded. A
 * decision pushes the child's own device, when one belongs to them
 * (lib/notifications/rewards.ts).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  if (body?.status !== "approved" && body?.status !== "denied") {
    return NextResponse.json({ error: "status must be approved or denied" }, { status: 400 });
  }

  const db = createAdminClient();
  const result = await decideRedemption(db as unknown as RpcClient, {
    familyId: auth.session.familyId,
    redemptionId: id,
    decision: body.status,
    deviceId: auth.session.deviceId,
  }, liveRewardNotifier(db));
  return NextResponse.json(result.body, { status: result.status });
}
