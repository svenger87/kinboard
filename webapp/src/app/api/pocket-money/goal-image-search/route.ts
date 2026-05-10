import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/pocket-money/goal-image-search?q=lego
// Pass-through to the existing item_catalog table. Returns
// { results: [{ name, image_url, source }, ...] }.
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = createAdminClient();
  const { data, error } = await (supabase as any)
    .from("item_catalog")
    .select("name, image_url, source")
    .ilike("name", `%${q}%`)
    .not("image_url", "is", null)
    .order("name", { ascending: true })
    .limit(15);

  if (error) {
    console.error("[pocket-money] image search:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ results: data ?? [] });
}
