import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { mintFamilyToken } from "@/lib/family-jwt";

export const dynamic = "force-dynamic";

/**
 * Join a family with its code, and get a session for it.
 *
 * This used to happen in the browser: useJoinFamily read `families` by
 * join_code straight from PostgREST with the anon key. Two things make that
 * untenable.
 *
 * Once row-level security is on, `anon` cannot read `families` at all — by
 * design, since that table holds the join codes. So the lookup has to move to
 * something that can, which means the service role, which means the server.
 *
 * And it should have been here regardless: validating a credential in the
 * client, against a table the client can read wholesale, is not validation.
 * Anyone could list every family and its code.
 *
 * The response sets an HttpOnly session cookie. Nothing the client can read or
 * forge — unlike `family-calendar-storage`, which is the Zustand store written
 * by document.cookie and was never a credential at all.
 */
export async function POST(request: NextRequest) {
  let body: { joinCode?: string; deviceName?: string; hardwareId?: string; fingerprint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const joinCode = body.joinCode?.trim().toUpperCase();
  const hardwareId = body.hardwareId?.trim();

  if (!joinCode || !hardwareId) {
    return NextResponse.json({ error: "joinCode and hardwareId are required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: familyRow, error: familyError } = await supabase
    .from("families")
    .select("*")
    .eq("join_code", joinCode)
    .maybeSingle();

  // One message for "no such code" and "expired code" alike: telling them
  // apart would confirm which codes exist to someone guessing.
  const rejected = NextResponse.json({ error: "invalid join code" }, { status: 401 });

  if (familyError || !familyRow) return rejected;

  const family = familyRow as { id: string; join_code_expires_at: string | null };
  if (
    family.join_code_expires_at != null &&
    new Date(family.join_code_expires_at).getTime() < Date.now()
  ) {
    return rejected;
  }

  // Re-joining from a device we already know keeps its row rather than
  // accumulating a new one per join.
  const { data: existing } = await supabase
    .from("devices")
    .select("*")
    .eq("family_id", family.id)
    .eq("hardware_id", hardwareId)
    .maybeSingle();

  const userAgent = request.headers.get("user-agent");
  let device: { id: string } | null = null;

  if (existing) {
    const row = existing as { id: string };
    await supabase
      .from("devices")
      .update({ last_seen: new Date().toISOString(), fingerprint: body.fingerprint ?? null })
      .eq("id", row.id);
    device = row;
  } else {
    const { data: created, error: deviceError } = await supabase
      .from("devices")
      .insert({
        family_id: family.id,
        name: body.deviceName?.trim() || "Unknown device",
        hardware_id: hardwareId,
        fingerprint: body.fingerprint ?? null,
        user_agent: userAgent,
      })
      .select()
      .single();
    if (deviceError) {
      return NextResponse.json({ error: "could not register device" }, { status: 500 });
    }
    device = created as { id: string };
  }

  const sessionToken = await createSession({
    familyId: family.id,
    deviceId: device?.id ?? null,
    userAgent,
  });

  // Saves the client an immediate round trip to /api/session/token — but it is
  // an optimisation, not part of joining. If minting fails (JWT_SECRET absent
  // or mismatched) the session is still valid, and the client will ask
  // /api/session/token separately. Letting this throw would turn a
  // misconfiguration into "nobody can join", which is how it first surfaced.
  let familyToken: { token: string; expiresAt: number } | null = null;
  try {
    familyToken = mintFamilyToken(family.id);
  } catch (err) {
    console.error("[session/join] could not mint a family token:", err);
  }

  const response = NextResponse.json(
    {
      family: familyRow,
      device,
      token: familyToken?.token ?? null,
      expiresAt: familyToken?.expiresAt ?? null,
    },
    { headers: { "Cache-Control": "no-store, private" } },
  );

  response.cookies.set(
    SESSION_COOKIE,
    sessionToken,
    // Secure whenever the request arrived over TLS. Behind Traefik that is the
    // forwarded proto, not the connection to the container.
    sessionCookieOptions(
      request.headers.get("x-forwarded-proto") === "https" ||
        request.nextUrl.protocol === "https:",
    ),
  );

  return response;
}
