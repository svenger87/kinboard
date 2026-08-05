import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

// DELETE: Permanently delete a family and all its data (DB cascades everything).
// body: { family_id, confirm_name } — confirm_name must exactly match the
// family's current name, re-verified server-side even though the UI also
// gates on it.
//
// confirm_name is an "are you sure?", not a credential: it is the family's own
// name, printed on every device's screen. On its own it meant anyone who could
// guess a family id and read its name off a kiosk could delete the entire
// household from the open internet — and the id was never secret, it travels
// in localStorage, request URLs and logs. The session is the credential now;
// the name stays because typing it is how you say you meant it.
export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { family_id, confirm_name } = body;

  if (!family_id || typeof confirm_name !== "string") {
    return NextResponse.json(
      { error: "family_id and confirm_name are required" },
      { status: 400 }
    );
  }

  // Deliberately the same 401 as "no session": a session for another family
  // is, for this family's data, exactly as good as no session at all.
  if (!familyMatchesSession(auth.session, family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
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
