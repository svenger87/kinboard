import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

interface ReorderItem {
  id: string;
  position: number;
}

// POST /api/tickers/reorder  body: { items: [{id, position}, ...] }
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { items?: ReorderItem[]; family_id?: string };
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items[] required" }, { status: 400 });
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  // Without this the route updated any row whose id was supplied, using
  // the service-role client — so a caller who knew a ticker's UUID could
  // reorder another family's watchlist. RLS is off, so the filter here is
  // the only thing standing between the two.
  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();

  let updated = 0;
  for (const item of items) {
    if (!item.id || typeof item.position !== "number") continue;
    const { error } = await supabase
      .from("tickers")
      .update({ position: item.position })
      .eq("id", item.id)
      .eq("family_id", familyId);
    if (error) {
      console.error("[tickers] reorder error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    updated++;
  }

  return NextResponse.json({ ok: true, updated });
}
