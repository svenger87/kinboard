import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import { getHaStates } from "@/lib/home/ha-client";
import { listVehicleStatuses, type VehicleDeps, type VehicleRow } from "@/lib/vehicles/status";

export const dynamic = "force-dynamic";

const liveVehicleDeps: VehicleDeps = {
  loadVehicles: async (familyId) => {
    const { data, error } = await (createAdminClient() as any)
      .from("vehicles")
      .select("id, family_id, vendor, nickname, config")
      .eq("family_id", familyId)
      .order("position", { ascending: true })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as VehicleRow[];
  },
  getHaStates: (familyId, entityIds) => getHaStates(familyId, entityIds),
};

/**
 * GET /api/integration/v1/vehicles
 *
 * The family's cars — charge level, range, charging status, a few comfort
 * and security readings — read live from Home Assistant, the same entities
 * the vehicle cards show. Never a location: see `lib/vehicles/status.ts`.
 * Home Assistant failing makes each car `available: false` with a reason;
 * it never fails the request.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "vehicles:read", async (context) => {
    try {
      return NextResponse.json(await listVehicleStatuses(context.familyId, liveVehicleDeps));
    } catch (err) {
      await logApiError("integration/vehicles", err);
      return NextResponse.json({ error: "Could not read the vehicles", code: "internal_error" }, { status: 500 });
    }
  });
}
