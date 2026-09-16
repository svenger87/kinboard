import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

const BUCKET = "family-photos";

/**
 * Remove one photo from the library.
 *
 * The row is looked up by id *and* family before anything is deleted: the id
 * comes from the caller, and service_role bypasses RLS, so the family check
 * here is the only thing standing between a guessed uuid and somebody else's
 * photograph.
 *
 * Objects go first and the row second. The other order can leave a row
 * pointing at nothing, which the library would render as a broken image
 * forever; this order can at worst leave an unreferenced object, which costs
 * disk and shows nobody anything.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const familyId = request.nextUrl.searchParams.get("family_id");

  if (!familyId) return NextResponse.json({ error: "family_id_required" }, { status: 400 });
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();

   
  const { data: row, error: readError } = await (supabase as any)
    .from("family_photos")
    .select("id, storage_path, thumbnail_path")
    .eq("id", id)
    .eq("family_id", familyId)
    .maybeSingle();

  if (readError) {
    console.error("[photos] delete lookup failed:", readError);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  // Deliberately indistinguishable from "not yours": a 404 either way tells a
  // caller nothing about whether the id exists in another family.
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const objects = [row.storage_path, row.thumbnail_path].filter(
    (p: string | null): p is string => !!p,
  );
  const { error: storageError } = await supabase.storage.from(BUCKET).remove(objects);
  if (storageError) {
    console.error("[photos] object removal failed:", storageError);
    return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  }

   
  const { error: deleteError } = await (supabase as any)
    .from("family_photos")
    .delete()
    .eq("id", id)
    .eq("family_id", familyId);

  if (deleteError) {
    console.error("[photos] row delete failed:", deleteError);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
