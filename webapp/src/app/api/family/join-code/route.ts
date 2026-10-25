import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { revokeFamilySessions } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The alphabet every join code uses: no 0/O, 1/I. */
const JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateJoinCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += JOIN_CODE_CHARS[randomInt(JOIN_CODE_CHARS.length)];
  return code;
}

/**
 * POST /api/family/join-code — rotate the family's join code and sign every
 * other device out. body: { ttl_hours?: number | null }
 *
 * The rotation used to be a browser-side UPDATE of `families.join_code` and
 * nothing more. The confirmation said "all connected devices will need to
 * rejoin"; none did. A session lives for a year and was never tied to the
 * code it joined with, so rotating after a lost phone left that phone signed
 * in. Revoking sessions needs the service role, hence a route.
 *
 * The device doing the rotation stays signed in. Gated on the settings PIN,
 * like the rest of the family settings: a child's phone must not be able to
 * sign the kitchen display out.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const body = (await request.json().catch(() => null)) as { ttl_hours?: unknown } | null;
  const ttl = body?.ttl_hours ?? null;
  if (ttl !== null && (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0 || ttl > 24 * 365)) {
    return NextResponse.json({ error: "ttl_hours must be a positive number of hours, or null" }, { status: 400 });
  }
  const expiresAt = ttl === null ? null : new Date(Date.now() + ttl * 3600e3).toISOString();

  const familyId = auth.session.familyId;
  const supabase = createAdminClient() as any;

  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await supabase
      .from("families")
      .update({ join_code: generateJoinCode(), join_code_expires_at: expiresAt })
      .eq("id", familyId)
      .select()
      .single();

    if (error && (error as { code?: string }).code === "23505") continue; // code taken, try another
    if (error || !data) {
      console.error("join-code: rotating the code failed:", error);
      return NextResponse.json({ error: "Could not rotate the join code" }, { status: 500 });
    }

    try {
      await revokeFamilySessions(familyId, { exceptSessionId: auth.session.sessionId });
    } catch (err) {
      console.error("join-code: the code was rotated, but other devices could not be signed out:", err);
      return NextResponse.json(
        { error: "The code was changed, but other devices could not be signed out", family: data },
        { status: 500 },
      );
    }
    return NextResponse.json({ family: data });
  }

  return NextResponse.json({ error: "Could not generate a unique join code" }, { status: 500 });
}
