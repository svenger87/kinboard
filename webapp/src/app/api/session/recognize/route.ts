import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { hitLimit, clientIp, sessionAttemptLimit } from "@/lib/rate-limit";

/**
 * "Is this device one we have seen before?" — asked by /join, before anyone is
 * authenticated.
 *
 * This used to be two PostgREST queries straight from the browser. Row-level
 * security landed in 1.6.0 and the anon key stopped being able to read
 * `devices`, so both have returned 401 ever since: quick rejoin has been dead
 * for that whole time, and the only visible trace was a pair of console errors
 * on the join screen.
 *
 * It cannot be fixed by loosening RLS. `devices` joins to `families`, and
 * families hold join codes; a policy that let an anonymous caller read devices
 * would let them enumerate households. So the lookup moves here, where the
 * service role can read it and this route decides what an unauthenticated
 * caller is allowed to be told.
 *
 * WHAT IT ANSWERS WITH
 *
 * The family's *name* and the device's *name*, and nothing else. Not the join
 * code, not the family id, not the other devices. Enough to render "Sign back
 * in — the Möller family, Kitchen display", which is the whole point, and
 * useless to somebody who is fishing.
 *
 * Only the saved random hardware ID is accepted. A browser fingerprint is
 * predictable and cannot be used to look up a family or device.
 */

interface RecognizeBody {
  hardware_id?: string;
}

export interface RecognizedDeviceSummary {
  device: { id: string; name: string; last_seen: string | null };
  family: { name: string };
  match: "hardware";
}

export async function POST(request: NextRequest) {
  const limited = hitLimit(`recognize:${clientIp(request)}`, sessionAttemptLimit(20), 60_000);
  if (limited.limited || hitLimit("global:recognize", sessionAttemptLimit(100), 60_000).limited) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  let body: RecognizeBody;
  try {
    body = (await request.json()) as RecognizeBody;
  } catch {
    body = {};
  }

  const hardwareId = body.hardware_id?.trim();
  if (!hardwareId) {
    return NextResponse.json({ devices: [] }, { headers: { "Cache-Control": "no-store, private" } });
  }

  const supabase = createAdminClient();
  let best: RecognizedDeviceSummary | null = null;

  // The device's own id first: it is the strong signal, and a match here means
  // storage was never cleared.
  if (hardwareId) {
    const { data } = await supabase
      .from("devices")
      .select("id, name, last_seen, families(name)")
      .eq("hardware_id", hardwareId)
      .limit(1);

    for (const row of (data ?? []) as unknown as {
      id: string;
      name: string;
      last_seen: string | null;
      families: { name: string } | null;
    }[]) {
      if (!row.families) continue;
      best = {
        device: { id: row.id, name: row.name, last_seen: row.last_seen },
        family: { name: row.families.name },
        match: "hardware",
      };
    }
  }

  // Still a list: the join page renders zero or one card, and a shape that can
  // say "none" without a null check is easier to be careful with.
  return NextResponse.json(
    { devices: best ? [best] : [] },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
