import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { mintFamilyToken } from "@/lib/family-jwt";
import { hitLimit, clientIp } from "@/lib/rate-limit";

/**
 * Sign a recognised device back in, without making anyone find the join code.
 *
 * The other half of /api/session/recognize. It mints a real session — the same
 * one /api/session/join issues — which is what the old client-side version
 * never did: it only filled the browser's store, so even before RLS broke the
 * lookup, a "rejoined" device had no session cookie and no family token.
 *
 * THE TRUST MODEL, STATED PLAINLY
 *
 * The saved random hardware ID is required. A browser fingerprint can be
 * guessed from common device properties, so a device that lost its ID must
 * rejoin with the family code instead of receiving a session here.
 *
 * Rate-limited harder than recognition: this one issues credentials.
 */

interface ResumeBody {
  device_id?: string;
  hardware_id?: string;
}

export async function POST(request: NextRequest) {
  const limited = hitLimit(`resume:${clientIp(request)}`, 10, 60_000);
  if (limited.limited || hitLimit("global:resume", 100, 60_000).limited) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  let body: ResumeBody;
  try {
    body = (await request.json()) as ResumeBody;
  } catch {
    body = {};
  }

  const deviceId = body.device_id?.trim();
  const hardwareId = body.hardware_id?.trim();

  if (!deviceId || !hardwareId) {
    return NextResponse.json(
      { error: "device_id and hardware_id are required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data: device } = await supabase
    .from("devices")
    // The whole row on both sides, because `useRestoreSession` writes this
    // response straight into the persisted family store and nothing ever
    // refetches either object. A column left out here is gone from that
    // device until somebody types the family code in again.
    //
    // `families(id, name)` cost a household its join code: Settings renders
    // the family card from the store, so the card came up with their name and
    // a blank where the code belongs. The hand-built device object cost the
    // same wall panel its kiosk mode — `is_kiosk` drives `data-kiosk` on
    // <html>, which is what hides the body scrollbar and drives
    // useReturnToDashboard.
    //
    // A resumed session must be indistinguishable from a fresh join, and
    // /api/session/join returns both rows whole.
    .select("*, families(*)")
    .eq("id", deviceId)
    .maybeSingle();

  const row = device as unknown as
    | (Record<string, unknown> & {
        id: string;
        name: string;
        family_id: string;
        hardware_id: string | null;
        families: Record<string, unknown> | null;
      })
    | null;

  if (!row?.families) {
    return NextResponse.json({ error: "not recognised" }, { status: 404 });
  }

  // The device as the store should hold it: every column the table has, minus
  // the embedded family, which is returned separately. Spread rather than
  // named fields so a column added to `devices` later reaches the client
  // without anyone remembering to add it here — forgetting exactly that is
  // what dropped `is_kiosk`.
  const { families: _embeddedFamily, ...deviceRow } = row;

  // The claim has to hold up. A device id on its own is not enough — they are
  // uuids, but they travel in responses, and this endpoint hands out sessions.
  if (!row.hardware_id || row.hardware_id !== hardwareId) {
    return NextResponse.json({ error: "not recognised" }, { status: 403 });
  }

  const userAgent = request.headers.get("user-agent") ?? null;

  await (supabase as any)
    .from("devices")
    .update({
      last_seen: new Date().toISOString(),
      user_agent: userAgent,
    })
    .eq("id", row.id);

  const sessionToken = await createSession({
    familyId: row.family_id,
    deviceId: row.id,
    userAgent,
  });

  // Same reasoning as /api/session/join: a failure to mint here is an
  // optimisation lost, not a resume denied.
  let familyToken: { token: string; expiresAt: number } | null = null;
  try {
    familyToken = mintFamilyToken(row.family_id, row.id);
  } catch (err) {
    console.error("[session/resume] could not mint a family token:", err);
  }

  const response = NextResponse.json(
    {
      family: row.families,
      device: deviceRow,
      token: familyToken?.token ?? null,
      expiresAt: familyToken?.expiresAt ?? null,
    },
    { headers: { "Cache-Control": "no-store, private" } },
  );

  response.cookies.set(
    SESSION_COOKIE,
    sessionToken,
    sessionCookieOptions(
      request.headers.get("x-forwarded-proto") === "https" ||
        request.nextUrl.protocol === "https:",
    ),
  );

  return response;
}
