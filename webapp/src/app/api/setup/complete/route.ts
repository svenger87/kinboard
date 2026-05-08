import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// NOTE: `as never` cast on setup_completed is working around stale
// database.types.ts — the column was added by migration_setup_completed.sql
// but types haven't been regenerated yet. Drop the cast after the next
// `npm run db:generate` against a live stack.

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const familyId = body?.family_id;
  if (!familyId || typeof familyId !== "string") {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("families")
    .update({ setup_completed: true } as never)
    .eq("id", familyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
