import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

/**
 * A bounded, newest-first view for assistants; deleted notes stay hidden.
 *
 * Its own scope rather than `family:read`: notes hold whatever a family writes
 * down, and every Home Assistant token already carries `family:read`. Folding
 * notes into it would hand all of those tokens the household's notes without
 * anyone having ticked a box.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "notes:read", async (context) => {
    try {
      const supabase = createAdminClient();
      const { data, error } = await (supabase as any)
        .from("notes")
        .select("id, content, pinned, person_id, created_at, updated_at")
        .eq("family_id", context.familyId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return NextResponse.json({ notes: data ?? [] });
    } catch (err) {
      await logApiError("integration/notes", err);
      return NextResponse.json({ error: "Could not read notes", code: "internal_error" }, { status: 500 });
    }
  });
}
