import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom, rowInFamily } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

/**
 * "Got it" — or, on the sender's own screen, "Withdraw". Same two columns
 * either way; only the wording differs, so there is one route.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const payload = (await request.json()) as { family_id?: string };
  const familyId = familyIdFrom(request, payload);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  if (!(await rowInFamily(supabase, "messages", id, familyId))) {
    return NextResponse.json({ error: "no such message" }, { status: 404 });
  }

  /*
    `.is("acknowledged_at", null)` is what makes the first tap win. Two people
    tapping "Got it" on two panels within the same second is a normal thing to
    happen in a house, and the second must not overwrite who actually saw it
    first. The update then matches no row, which is not an error — the second
    tapper gets the acknowledged message back, not a failure.
  */
  const { error } = await supabase
    .from("messages")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by_device_id: auth.session.deviceId,
    })
    .eq("id", id)
    .eq("family_id", familyId)
    .is("acknowledged_at", null);

  if (error) {
    console.error("[messages] acknowledge error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data, error: readError } = await supabase
    .from("messages")
    .select("*")
    .eq("id", id)
    .eq("family_id", familyId)
    .single();

  if (readError || !data) {
    console.error("[messages] re-read error:", readError);
    return NextResponse.json({ error: "could not read the message back" }, { status: 500 });
  }
  return NextResponse.json({ message: data });
}
