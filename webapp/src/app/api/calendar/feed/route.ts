import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getStoredSecrets, upsertSecrets } from "@/lib/integration-secrets";
import { buildIcsCalendar, ExportEvent } from "@/lib/ics-export";

// Outbound ICS calendar feed (Milestone C Task 2). GET is unauthenticated
// by device/join-code — it's meant to be pasted into Google/Apple/Outlook
// calendar apps — so the secret rotatable token IS the access control.
// Never leak whether a family exists: absent/mismatched token both 401
// with an identical body.
export async function GET(request: NextRequest) {
  const familyId = request.nextUrl.searchParams.get("family_id");
  const token = request.nextUrl.searchParams.get("token");

  if (!familyId || !token) {
    return new NextResponse("Not found", { status: 401 });
  }

  const stored = await getStoredSecrets(familyId, "calendar_feed");
  const storedToken = typeof stored?.token === "string" ? stored.token : null;
  if (!storedToken || !timingSafeTokenEqual(token, storedToken)) {
    return new NextResponse("Not found", { status: 401 });
  }

  const supabase = createAdminClient();
  const db = supabase as any;

  const { data: family } = await db
    .from("families")
    .select("name")
    .eq("id", familyId)
    .maybeSingle();

  const rows = await fetchAll(db, (q, from, to) =>
    q
      .from("events")
      .select("*, calendar:calendars!inner(family_id,name)")
      .eq("calendar.family_id", familyId)
      .range(from, to)
  );

  const events: ExportEvent[] = rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    start_at: row.start_at as string,
    end_at: row.end_at as string,
    all_day: !!row.all_day,
  }));

  const ics = buildIcsCalendar(events, (family?.name as string | undefined) ?? "Kinboard");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=kinboard.ics",
    },
  });
}

// POST /api/calendar/feed { family_id } → generates/rotates the secret
// token and returns the absolute subscribe URL. Rotating invalidates any
// previously issued link (old token no longer matches what's stored).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const familyId = body?.family_id;

  if (!familyId || typeof familyId !== "string") {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }

  const token = crypto.randomBytes(24).toString("hex");

  try {
    await upsertSecrets(familyId, "calendar_feed", { token });
  } catch (err) {
    console.error("calendar feed: failed to store token:", err);
    return NextResponse.json({ error: "Failed to create feed link" }, { status: 500 });
  }

  const url = new URL("/api/calendar/feed", request.nextUrl.origin);
  url.searchParams.set("family_id", familyId);
  url.searchParams.set("token", token);

  return NextResponse.json({ url: url.toString() });
}

function timingSafeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Supabase selects cap at 1000 rows by default. Page through in fixed-size
// windows so large families' feeds export completely. Mirrors the helper
// in src/app/api/export/route.ts.
const PAGE_SIZE = 1000;

async function fetchAll(
  db: any,
  build: (
    db: any,
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build(db, from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}
