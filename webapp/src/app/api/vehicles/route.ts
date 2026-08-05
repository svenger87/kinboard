import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { VehicleInsert } from "@/types/database";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

// As with tickers: /api/vehicles/[id] checks ownership, the collection did
// not, so listing or adding to another family's garage only needed its id.
// GET /api/vehicles?family_id=X
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const familyId = request.nextUrl.searchParams.get("family_id");
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("family_id", familyId)
    .order("position", { ascending: true });

  if (error) {
    console.error("[vehicles] list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ vehicles: data ?? [] });
}

// POST /api/vehicles  body: VehicleInsert
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as Partial<VehicleInsert>;
  if (!body.family_id || !body.vendor || !body.nickname) {
    return NextResponse.json(
      { error: "family_id, vendor, nickname are required" },
      { status: 400 },
    );
  }

  if (!familyMatchesSession(auth.session, body.family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (body.vendor !== "tesla" && body.vendor !== "generic-ev") {
    return NextResponse.json({ error: "unknown vendor" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // New rows go to the end of the position list. Read max(position) for
  // the family; default to -1 so first insert lands at 0.
  const { data: maxRow } = await supabase
    .from("vehicles")
    .select("position")
    .eq("family_id", body.family_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (maxRow?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("vehicles")
    .insert({
      family_id: body.family_id,
      vendor: body.vendor,
      nickname: body.nickname,
      color: body.color ?? null,
      config: body.config ?? {},
      position: nextPosition,
    })
    .select()
    .single();

  if (error) {
    console.error("[vehicles] insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ vehicle: data }, { status: 201 });
}
