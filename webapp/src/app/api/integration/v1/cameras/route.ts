import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/server";
import { readCameraRefs } from "@/lib/camera-takeover";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/cameras
 *
 * The family's cameras as `show_camera` takes them (#335): id and name, and
 * nothing else. A camera's stream URL names the household's network and
 * often carries its credentials, so it never leaves the server; seeing which
 * cameras exist is `family:read`, like the rest of what the family has set up.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      const cameras = await readCameraRefs(createAdminClient(), context.familyId);
      return NextResponse.json({ cameras });
    } catch (err) {
      await logApiError("integration/cameras", err);
      return NextResponse.json(
        { error: "the cameras could not be read", code: "internal_error" },
        { status: 500 },
      );
    }
  });
}
