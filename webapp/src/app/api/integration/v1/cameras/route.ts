import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/server";
import { readCameraListing } from "@/lib/camera-takeover";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/cameras
 *
 * The family's enabled cameras as `show_camera` takes them (#335): id, name,
 * and the Home Assistant doorbell that shows each one (null when none), and
 * nothing else. The Kinboard integration reads the doorbell pairs and calls
 * `show_camera` when a bell rings. A camera's stream URL names the household's
 * network and often carries its credentials, so it never leaves the server;
 * seeing which cameras exist is `family:read`, like the rest of what the
 * family has set up.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      const cameras = await readCameraListing(createAdminClient(), context.familyId);
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
