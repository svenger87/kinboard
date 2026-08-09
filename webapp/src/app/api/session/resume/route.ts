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
 * Two ways a device can be recognised, and they are not equally strong:
 *
 *   - **hardware_id** is a random value this device generated and kept. Only
 *     that device has it. Presenting it is proof enough to resume.
 *   - **fingerprint** is derived from the browser and the machine. Two similar
 *     laptops in the same household can produce the same one, and it is not
 *     secret. It is the signal that makes rejoin work after storage has been
 *     cleared — which is the entire feature — but it is a guess.
 *
 * Resuming on a fingerprint alone is therefore a deliberate trade: it is what
 * lets a family recover a wiped tablet without hunting for the code, and it
 * means somebody on a sufficiently similar device, on the same network, could
 * claim a session. That is the same trade the join code makes — Kinboard's
 * threat model is a trusted home network (see Security-and-Threat-Model) — but
 * it is written here rather than left implicit, because it is the kind of
 * decision that should be argued with rather than discovered.
 *
 * Rate-limited harder than recognition: this one issues credentials.
 */

interface ResumeBody {
  device_id?: string;
  hardware_id?: string;
  fingerprint?: string;
}

export async function POST(request: NextRequest) {
  const limited = hitLimit(`resume:${clientIp(request)}`, 10, 60_000);
  if (limited.limited) {
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
  const fingerprint = body.fingerprint?.trim();

  if (!deviceId || !hardwareId) {
    return NextResponse.json(
      { error: "device_id and hardware_id are required" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data: device } = await supabase
    .from("devices")
    .select("id, name, family_id, hardware_id, fingerprint, fingerprint_history, families(id, name)")
    .eq("id", deviceId)
    .maybeSingle();

  const row = device as unknown as
    | {
        id: string;
        name: string;
        family_id: string;
        hardware_id: string | null;
        fingerprint: string | null;
        fingerprint_history: string[] | null;
        families: { id: string; name: string } | null;
      }
    | null;

  if (!row?.families) {
    return NextResponse.json({ error: "not recognised" }, { status: 404 });
  }

  // The claim has to hold up. A device id on its own is not enough — they are
  // uuids, but they travel in responses, and this endpoint hands out sessions.
  const byHardware = row.hardware_id != null && row.hardware_id === hardwareId;
  const byFingerprint =
    !!fingerprint &&
    (row.fingerprint === fingerprint || (row.fingerprint_history ?? []).includes(fingerprint));

  if (!byHardware && !byFingerprint) {
    return NextResponse.json({ error: "not recognised" }, { status: 403 });
  }

  const userAgent = request.headers.get("user-agent") ?? null;

  // Storage was cleared, so this device now carries a new hardware id. Record
  // it, and keep the fingerprint history growing so the next browser update
  // does not lose the device again.
  const history = new Set(row.fingerprint_history ?? []);
  if (fingerprint) history.add(fingerprint);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("devices")
    .update({
      hardware_id: hardwareId,
      fingerprint: fingerprint ?? row.fingerprint,
      fingerprint_history: [...history],
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
    familyToken = mintFamilyToken(row.family_id);
  } catch (err) {
    console.error("[session/resume] could not mint a family token:", err);
  }

  const response = NextResponse.json(
    {
      family: row.families,
      device: { id: row.id, name: row.name },
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
