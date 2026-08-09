import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { hitLimit, clientIp } from "@/lib/rate-limit";

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
 * At most **one** device, too. A browser that has joined several times leaves a
 * row behind each time, all carrying the same fingerprint — offering five
 * identical "Sign back in" cards for one physical tablet is noise, and where
 * two households' devices happen to collide it would put their names on a
 * stranger's screen. The most recently seen match is the one a person means.
 *
 * Rate-limited per IP: a fingerprint is a guessable thing, and this endpoint
 * turns a guess into a household name.
 */

interface RecognizeBody {
  hardware_id?: string;
  fingerprint?: string;
}

export interface RecognizedDeviceSummary {
  device: { id: string; name: string; last_seen: string | null };
  family: { name: string };
  /**
   * How it was matched. `hardware` is the device's own random id, which only
   * that device has; `fingerprint` is derived from the browser and is a hint,
   * not proof — /api/session/resume treats them differently.
   */
  match: "hardware" | "fingerprint";
}

export async function POST(request: NextRequest) {
  const limited = hitLimit(`recognize:${clientIp(request)}`, 20, 60_000);
  if (limited.limited) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  let body: RecognizeBody;
  try {
    body = (await request.json()) as RecognizeBody;
  } catch {
    body = {};
  }

  const hardwareId = body.hardware_id?.trim();
  const fingerprint = body.fingerprint?.trim();
  if (!hardwareId && !fingerprint) {
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

  // Then the fingerprint, which is what makes this useful after a cache clear.
  // Matched against the history as well as the current value, because a
  // browser update changes the hash and the history is how a device stays
  // recognisable across one.
  if (fingerprint && !best) {
    const { data } = await supabase
      .from("devices")
      .select("id, name, last_seen, families(name)")
      .or(`fingerprint.eq.${fingerprint},fingerprint_history.cs.{${fingerprint}}`)
      .order("last_seen", { ascending: false })
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
        match: "fingerprint",
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
