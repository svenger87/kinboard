import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { getMergedSetting } from "@/lib/integration-secrets";
import { logApiError } from "@/lib/api-error";
import { readEnergyStatus } from "@/lib/integration-energy-status";
import type { HomeAssistantSettings } from "@/types/home-assistant";
import { energySensorIds, homeAssistantBase } from "@/lib/integration-energy";

export const dynamic = "force-dynamic";

/**
 * Every sensor selected in Kinboard's energy settings — power, energy today
 * and battery charge — and nothing else: the IDs come only from the settings,
 * only `sensor.*` ones, and one `GET /api/states` is filtered down to them.
 * `solar_power` and `solar_energy_today` keep their original shape for
 * clients written against the solar-only response.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "energy:read", async (context) => {
    try {
      const settings = await getMergedSetting<HomeAssistantSettings>(context.familyId, "home_assistant");
      const config = settings?.energy_config;
      if (!settings?.url || !settings.access_token || !config) {
        return NextResponse.json({ error: "Energy is not configured", code: "not_found" }, { status: 404 });
      }

      // Not configured is permanent until someone changes settings, so it is
      // 404 rather than 503: `unavailable` tells a client to retry.
      const ids = energySensorIds(config);
      if (ids.size === 0) {
        return NextResponse.json({ error: "No energy sensors are configured", code: "not_found" }, { status: 404 });
      }

      if (!homeAssistantBase(settings.url)) {
        return NextResponse.json({ error: "Invalid Home Assistant URL", code: "not_found" }, { status: 404 });
      }

      return NextResponse.json(await readEnergyStatus(context.familyId, ids, { loadSettings: async () => settings }));
    } catch (err) {
      await logApiError("integration/energy/current", err);
      return NextResponse.json({ error: "Could not read Home Assistant energy sensors", code: "upstream_unavailable" }, { status: 502 });
    }
  });
}
