import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { listHomeDevices } from "@/lib/home/devices";
import { liveHomeDeps } from "@/lib/home/live";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/home/devices
 *
 * The family's catalogue devices (RFC-011 §4.1: catalogue only) with their
 * live state, whitelisted attributes, and the actions an assistant may run
 * on each. All logic is in `lib/home/devices.ts`.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "home:read", async (context) => {
    try {
      const result = await listHomeDevices(context.familyId, liveHomeDeps);
      return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
      await logApiError("integration/home/devices", err);
      return NextResponse.json({ error: "Could not read the devices", code: "internal_error" }, { status: 500 });
    }
  });
}
