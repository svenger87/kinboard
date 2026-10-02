import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { resolveRegion, type HolidayRegionSetting } from "@/lib/holidays/region";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

/**
 * The only writer of `holiday_region` (RFC-014 §4.2; plan ruling 20).
 * Picking or keeping a region records that someone in the family chose it.
 * The family comes from the session, never from the body.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const familyId = auth.session.familyId;

  const body = await request.json().catch(() => null);
  const resolved = resolveRegion(typeof body?.code === "string" ? body.code : null);
  if (!resolved) {
    return NextResponse.json({ error: "code must be an offered region", code: "invalid_request" }, { status: 400 });
  }

  const region: HolidayRegionSetting = { code: resolved.code, chosen: true };
  const { error } = await (createAdminClient() as any)
    .from("settings")
    .upsert({ family_id: familyId, key: SETTINGS_KEYS.holidayRegion, value: region }, { onConflict: "family_id,key" });
  if (error) {
    await logApiError("holidays/region", error);
    return NextResponse.json({ error: "could not save the region" }, { status: 500 });
  }

  return NextResponse.json({ region });
}
