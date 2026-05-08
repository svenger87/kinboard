import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const familyId = body?.family_id;
  if (!familyId || typeof familyId !== "string") {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();
   
  const { error } = await (supabase as any)
    .from("families")
    .update({ setup_completed: true })
    .eq("id", familyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
