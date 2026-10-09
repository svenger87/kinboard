import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import type { RpcClient } from "@/lib/pocket-money/booking";
import { removeAdjustment } from "@/lib/creatures/adjustments";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/points/adjustments/[id] -- a parent takes back an adjustment
 * they made (a typo, say). Only an adjustment: a task's points go when the
 * task is un-ticked. Behind the settings PIN, like adding one.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const result = await removeAdjustment(createAdminClient() as unknown as RpcClient, {
    familyId: auth.session.familyId,
    adjustmentId: id,
  });
  return NextResponse.json(result.body, { status: result.status });
}
