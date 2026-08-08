import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { readCurrentVersion } from "@/lib/app-version";
import { currentEventCursor } from "@/lib/integration-store";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/info — identify the instance and the token.
 *
 * The first call the Home Assistant config flow makes, and it answers the
 * three questions a setup screen has to answer before it can say anything
 * useful:
 *
 *   - is this actually a Kinboard, and a new enough one?  -> version
 *   - which family did this token join?                   -> family_id/name
 *   - what is this token allowed to do?                   -> scopes
 *
 * That last one is why scopes are returned rather than merely enforced. It
 * lets the config flow tell someone up front that their token cannot create
 * tasks, instead of accepting the setup and failing on a service call weeks
 * later with a 403 they have no way to interpret.
 *
 * `cursor` is here so a fresh consumer can start from the current head rather
 * than replaying a month of retained history on first connect.
 *
 * Requires only family:read — the floor. A token that cannot read the family
 * has nothing to configure.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    const supabase = createAdminClient();

    const { data: family, error } = await (supabase as any)
      .from("families")
      .select("id, name")
      .eq("id", context.familyId)
      .maybeSingle();

    if (error) {
      await logApiError("integration/info", error);
      return NextResponse.json({ error: "Could not read the family" }, { status: 500 });
    }

    return NextResponse.json({
      version: await readCurrentVersion(),
      family_id: context.familyId,
      family_name: family?.name ?? null,
      token_name: context.name,
      scopes: context.scopes,
      cursor: await currentEventCursor(context.familyId),
    });
  });
}
