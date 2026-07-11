import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// DELETE: Permanently delete a family and all its data (DB cascades everything).
// body: { family_id, confirm_name } — confirm_name must exactly match the
// family's current name, re-verified server-side even though the UI also
// gates on it.
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { family_id, confirm_name } = body;

  if (!family_id || typeof confirm_name !== "string") {
    return NextResponse.json(
      { error: "family_id and confirm_name are required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();


  const { data: family, error: fetchError } = await (supabase as any)
    .from("families")
    .select("id, name")
    .eq("id", family_id)
    .single();

  if (fetchError || !family) {
    return NextResponse.json({ error: "Family not found" }, { status: 404 });
  }

  if (confirm_name !== family.name) {
    return NextResponse.json(
      { error: "Family name does not match" },
      { status: 400 }
    );
  }


  const { error: deleteError } = await (supabase as any)
    .from("families")
    .delete()
    .eq("id", family_id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
