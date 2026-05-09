import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ReorderItem {
  id: string;
  position: number;
}

// POST /api/tickers/reorder  body: { items: [{id, position}, ...] }
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { items?: ReorderItem[] };
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items[] required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  let updated = 0;
  for (const item of items) {
    if (!item.id || typeof item.position !== "number") continue;
    const { error } = await supabase
      .from("tickers")
      .update({ position: item.position })
      .eq("id", item.id);
    if (error) {
      console.error("[tickers] reorder error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    updated++;
  }

  return NextResponse.json({ ok: true, updated });
}
