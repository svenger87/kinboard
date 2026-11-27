import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { TIER_THRESHOLDS_POINTS } from "@/lib/pocket-money/types";
import { isGrowthPoints, readGrowthPoints } from "@/lib/pocket-money/points";
import { floorsToKeep, growthPointsFor, type GrowingCreature } from "@/lib/creatures/growth";

export const dynamic = "force-dynamic";

/**
 * PUT /api/creatures/growth  body: { points: [<stage 2>, ..., <stage 8>] | null }
 *
 * How many earned task points each stage needs, for the family's creatures
 * growing with points (Settings -> Creatures -> Growing). Behind the settings
 * PIN. Seven whole numbers from 1, each above the one before, or 400
 * bad_points and nothing is written; null (or the standard numbers) removes
 * the setting.
 *
 * Nobody shrinks: before the numbers are saved, each creature growing with
 * points that would show a lower stage under them gets the stage it shows now
 * as its floor (best_tier), lib/creatures/growth.ts. The saved numbers and
 * how many creatures were kept where they were are returned.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const body = (await request.json().catch(() => null)) as { points?: unknown } | null;
  if (!body || !("points" in body)) return NextResponse.json({ error: "bad_body" }, { status: 400 });
  if (body.points !== null && !isGrowthPoints(body.points)) return NextResponse.json({ error: "bad_points" }, { status: 400 });
  const after = readGrowthPoints(body.points);
  const standard = after.every((v, i) => v === TIER_THRESHOLDS_POINTS[i]);

  const familyId = auth.session.familyId;
  const db = createAdminClient() as any;
  try {
    const before = await growthPointsFor(db, familyId);
    const [{ data: creatures, error: cErr }, { data: accounts, error: aErr }] = await Promise.all([
      db.from("creatures").select("person_id, grows_with, best_tier").eq("family_id", familyId),
      db.from("pocket_money_accounts").select("person_id, balance_cents").eq("family_id", familyId),
    ]);
    if (cErr || aErr) throw new Error((cErr ?? aErr).message);
    const growing: GrowingCreature[] = [];
    for (const c of (creatures ?? []) as Array<{ person_id: string; grows_with: string; best_tier: number | null }>) {
      const { data: totals, error } = await db.rpc("point_person_totals", { p_family_id: familyId, p_person_id: c.person_id });
      if (error) throw new Error(error.message);
      const account = ((accounts ?? []) as Array<{ person_id: string; balance_cents: number }>).find((a) => a.person_id === c.person_id);
      growing.push({
        personId: c.person_id,
        creature: { grows_with: c.grows_with, best_tier: c.best_tier },
        account: account ? { balance_cents: account.balance_cents ?? 0 } : null,
        earnedPoints: Number((totals as { earned?: unknown } | null)?.earned ?? 0),
      });
    }
    // The floors first, so no screen ever reads the new numbers without them.
    const floors = floorsToKeep(growing, before, after);
    for (const f of floors) {
      const { error } = await db.from("creatures").update({ best_tier: f.tier }).eq("family_id", familyId).eq("person_id", f.personId);
      if (error) throw new Error(error.message);
    }
    const { error } = standard
      ? await db.from("settings").delete().eq("family_id", familyId).eq("key", SETTINGS_KEYS.growthPoints)
      : await db
          .from("settings")
          .upsert(
            { family_id: familyId, key: SETTINGS_KEYS.growthPoints, value: after.slice(1), updated_at: new Date().toISOString() },
            { onConflict: "family_id,key" },
          );
    if (error) throw new Error(error.message);
    return NextResponse.json({ points: standard ? null : after.slice(1), kept: floors.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "growth" }, { status: 500 });
  }
}
