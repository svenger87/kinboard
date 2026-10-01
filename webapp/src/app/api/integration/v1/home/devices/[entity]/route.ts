import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { getHomeDevice } from "@/lib/home/devices";
import { liveHomeDeps } from "@/lib/home/live";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/home/devices/{entity}
 *
 * One catalogue device. `{entity}` is decoded and checked against
 * `ENTITY_ID` before any lookup; malformed, not in this family's catalogue
 * and nonexistent all answer the same 404. Family scope comes only from the
 * token (`context.familyId`). Logic in `lib/home/devices.ts`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params;
  return withIntegrationAuth(request, "home:read", async (context) => {
    try {
      const result = await getHomeDevice(context.familyId, entity, liveHomeDeps);
      return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
      await logApiError("integration/home/devices/get", err);
      return NextResponse.json({ error: "Could not read the device", code: "internal_error" }, { status: 500 });
    }
  });
}
