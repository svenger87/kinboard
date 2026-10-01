import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/people
 *
 * Names and ids, so a task can be assigned to someone — `update_task` needs
 * this to turn "give this to Mara" into a `person_id`. `family:read` rather
 * than a scope of its own: every token that can read anything about the
 * family can already see who is in it elsewhere (events, the summary).
 *
 * Only `id`, `name`, `color` and `is_child` go out. `people` also carries
 * `avatar_url` and `birth_date` — a date of birth is exactly the kind of
 * detail that does not belong on a bearer token handed to a third-party
 * assistant, and nothing an assistant tool needs asks for it.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      const { data, error } = await (createAdminClient() as any)
        .from("people")
        .select("id, name, color, is_child")
        .eq("family_id", context.familyId)
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .limit(500);
      if (error) throw error;
      return NextResponse.json({ people: data ?? [] });
    } catch (err) {
      await logApiError("integration/people", err);
      return NextResponse.json({ error: "Could not read people", code: "internal_error" }, { status: 500 });
    }
  });
}
