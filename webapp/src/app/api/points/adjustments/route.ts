import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import type { RpcClient } from "@/lib/pocket-money/booking";
import { addAdjustment } from "@/lib/creatures/adjustments";

export const dynamic = "force-dynamic";

/**
 * POST /api/points/adjustments -- a parent adds or removes a child's points
 * by hand (discussion #349), from Settings -> Creatures & rewards.
 * Body: { person_id, points (non-zero, -10000..10000), note? }.
 *
 * Parental: the settings PIN, checked here on the server, since a child's own
 * screen must not be able to give itself points. Family-scoped by the
 * session's family.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const result = await addAdjustment(createAdminClient() as unknown as RpcClient, {
    familyId: auth.session.familyId,
    personId: body?.person_id,
    points: body?.points,
    note: body?.note,
  });
  return NextResponse.json(result.body, { status: result.status });
}
