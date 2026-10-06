import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import type { RpcClient } from "@/lib/pocket-money/booking";
import { decideWithdrawal } from "@/lib/pocket-money/runs";

export const dynamic = "force-dynamic";

interface DecideBody {
  status: "approved" | "denied";
  parent_decided_by_person_id?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as Partial<DecideBody> & { family_id?: string };

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  // Approving a request moves real money out of a child's balance, so
  // this is the write that most needs the family check. RLS is off —
  // see lib/family-scope.
  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Approving or denying is the parent's decision, not the requester's — a
  // child's own device could otherwise approve the request it just made by
  // calling this route directly, skipping the settings PIN screen entirely.
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  if (body.status !== "approved" && body.status !== "denied") {
    return NextResponse.json(
      { error: "status must be approved or denied" },
      { status: 400 },
    );
  }

  // Decided in one transaction (decide_pocket_money_withdrawal, via
  // lib/pocket-money/runs.ts): the request row is locked and must still be
  // pending, the money moves through the atomic booking, a linked goal is
  // marked bought and the status is set — or nothing is. Two devices
  // approving at once: one books, the other is told already_decided. Not
  // enough money by now (the child spent it after asking): the request is
  // denied and the answer is 409 insufficient_funds_at_decide_time, as
  // before. Not found and not yours are the same 404, so ids can't be probed.
  const result = await decideWithdrawal(createAdminClient() as unknown as RpcClient, {
    familyId,
    requestId: id,
    decision: body.status,
    personId: body.parent_decided_by_person_id ?? null,
  });
  return NextResponse.json(result.body, { status: result.status });
}
