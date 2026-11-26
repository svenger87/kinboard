import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { isInstallOperator } from "@/lib/install-operator";
import { readInstanceKey, writeInstanceKey } from "@/lib/instance-settings";
import { INSTANCE_FIRST_RUN_KEY, firstRunRecord } from "@/lib/first-run";

// Marks the setup wizard finished. Small, but it writes to another family's
// row if you let it name one, so it takes the same session check as the rest.
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const familyId = body?.family_id;
  if (!familyId || typeof familyId !== "string") {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
   
  const { error } = await (supabase as any)
    .from("families")
    .update({ setup_completed: true })
    .eq("id", familyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Finishing the wizard also closes the install's own steps (RFC-024 §8),
  // in case the operator left them by a link rather than by Continue or Skip.
  // Best effort: the family's own record above is what this route promises.
  try {
    if ((await isInstallOperator(familyId)) && !(await readInstanceKey(INSTANCE_FIRST_RUN_KEY))) {
      await writeInstanceKey(INSTANCE_FIRST_RUN_KEY, firstRunRecord(familyId, new Date()));
    }
  } catch (err) {
    console.error("setup/complete: could not record the install's first run:", err);
  }

  return NextResponse.json({ ok: true });
}
