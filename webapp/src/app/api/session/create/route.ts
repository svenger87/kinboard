import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { mintFamilyToken } from "@/lib/family-jwt";
import { generateJoinCode } from "@/lib/utils";
import { hitLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Create a family, register this device as its first, and start a session.
 *
 * The counterpart to /api/session/join, and it has to move server-side for
 * the same reason: with row-level security on, `anon` cannot insert into
 * `families` — the policy checks a family claim the caller doesn't have yet,
 * and couldn't have, since the family doesn't exist.
 *
 * Without this, a fresh install could not get past its own first screen.
 */
export async function POST(request: NextRequest) {
  let body: { familyName?: string; deviceName?: string; hardwareId?: string; fingerprint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const familyName = body.familyName?.trim();
  const hardwareId = body.hardwareId?.trim();

  if (!familyName || !hardwareId) {
    return NextResponse.json({ error: "familyName and hardwareId are required" }, { status: 400 });
  }

  // Creating a family inserts a families + devices + device_sessions row and
  // burns join-code generation. Tighter than join: nobody legitimately creates
  // families in a loop.
  const ip = clientIp(request);
  const limit = hitLimit(`create:ip:${ip}`, 5, 60_000);
  if (limit.limited) {
    return NextResponse.json(
      { error: "too many attempts, slow down" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  const supabase = createAdminClient();

  // join_code is UNIQUE; retry on collision rather than failing the setup.
  // Same pattern as useCreateFamily and the import route.
  let family: { id: string } | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 5 && !family; attempt++) {
    const { data, error } = await supabase
      .from("families")
      .insert({ name: familyName, join_code: generateJoinCode() })
      .select()
      .single();

    if (!error) {
      family = data as { id: string };
      break;
    }
    // 23505 is unique_violation — a code collision, worth retrying.
    if ((error as { code?: string }).code !== "23505") {
      lastError = error.message;
      break;
    }
  }

  if (!family) {
    return NextResponse.json(
      { error: lastError ?? "could not create family" },
      { status: 500 },
    );
  }

  const userAgent = request.headers.get("user-agent");

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .insert({
      family_id: family.id,
      name: body.deviceName?.trim() || "First device",
      hardware_id: hardwareId,
      fingerprint: body.fingerprint ?? null,
      user_agent: userAgent,
    })
    .select()
    .single();

  if (deviceError) {
    return NextResponse.json({ error: "could not register device" }, { status: 500 });
  }

  const sessionToken = await createSession({
    familyId: family.id,
    deviceId: (device as { id: string }).id,
    userAgent,
  });
  // Best effort, same as the join route: a token that can't be minted must not
  // stop a family being created.
  let familyToken: { token: string; expiresAt: number } | null = null;
  try {
    familyToken = mintFamilyToken(family.id);
  } catch (err) {
    console.error("[session/create] could not mint a family token:", err);
  }

  const response = NextResponse.json(
    {
      family,
      device,
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
