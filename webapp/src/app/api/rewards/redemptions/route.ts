import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import type { RpcClient } from "@/lib/pocket-money/booking";
import { requestRedemption } from "@/lib/pocket-money/rewards";
import { liveRewardNotifier } from "@/lib/notifications/rewards";

export const dynamic = "force-dynamic";

/**
 * POST /api/rewards/redemptions  body: { person_id, reward_id }
 *
 * A child's "Einlösen" (discussion #349): a pending request a parent then
 * approves or denies with the settings PIN. Needs a session only -- it is the
 * child's screen that asks -- and books nothing: no points move until a
 * parent approves. Per child since RFC-017, so no pocket-money account is
 * needed. The database refuses it when the child has no creature switched
 * on, the reward is not an active one of this family, or the balance less
 * what is already waiting does not cover it (request_person_point_redemption).
 * A request made pushes the parents' phones, this device excepted
 * (lib/notifications/rewards.ts).
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { person_id?: unknown; reward_id?: unknown } | null;
  if (typeof body?.person_id !== "string" || body.person_id.length === 0) {
    return NextResponse.json({ error: "person_id required" }, { status: 400 });
  }
  if (typeof body?.reward_id !== "string" || body.reward_id.length === 0) {
    return NextResponse.json({ error: "reward_id required" }, { status: 400 });
  }

  const db = createAdminClient();
  const result = await requestRedemption(db as unknown as RpcClient, {
    familyId: auth.session.familyId,
    personId: body.person_id,
    rewardId: body.reward_id,
    deviceId: auth.session.deviceId,
  }, liveRewardNotifier(db));
  return NextResponse.json(result.body, { status: result.status });
}
