import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { UUID } from "@/lib/home/action-requests";
import type { RpcClient } from "@/lib/pocket-money/booking";
import { requestRedemption } from "@/lib/pocket-money/rewards";

export const dynamic = "force-dynamic";

/*
 * REMOVE in the release after RFC-017 step 1. Kept for one release so a
 * screen still running the previous bundle keeps working: it names the
 * child's pocket-money account, and a request now belongs to the child, so
 * the account is looked up in the session's family and the request made for
 * its child, exactly as POST /api/rewards/redemptions makes it. A child's own
 * request, so no PIN -- the decision on it needs one.
 */

/** POST /api/pocket-money/accounts/[id]/redemptions  body: { reward_id } */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { reward_id?: unknown } | null;
  if (typeof body?.reward_id !== "string" || body.reward_id.length === 0) {
    return NextResponse.json({ error: "reward_id required" }, { status: 400 });
  }
  if (!UUID.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = createAdminClient() as any;
  const { data: account, error } = await db
    .from("pocket_money_accounts")
    .select("person_id")
    .eq("id", id)
    .eq("family_id", auth.session.familyId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await requestRedemption(db as RpcClient, {
    familyId: auth.session.familyId,
    personId: account.person_id,
    rewardId: body.reward_id,
    deviceId: auth.session.deviceId,
  });
  return NextResponse.json(result.body, { status: result.status });
}
