import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { getMergedSetting } from "@/lib/integration-secrets";
import { logApiError } from "@/lib/api-error";
import type { HomeAssistantSettings } from "@/types/home-assistant";
import { homeAssistantBase, solarSensorIds } from "@/lib/integration-energy";

export const dynamic = "force-dynamic";

type Reading = {
  value: number | null;
  unit: string | null;
  entity_id: string;
  observed_at: string | null;
};

/** Only sensor IDs selected in Kinboard's energy settings can be queried. */
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
      const sensors = solarSensorIds(config);
      if (!sensors.power && !sensors.energyToday) {
        return NextResponse.json({ error: "Solar sensors are not configured", code: "not_found" }, { status: 404 });
      }

      const base = homeAssistantBase(settings.url);
      if (!base) {
        return NextResponse.json({ error: "Invalid Home Assistant URL", code: "not_found" }, { status: 404 });
      }
      const read = async (id: string): Promise<Reading> => {
        const endpoint = new URL(`${base.pathname.replace(/\/$/, "")}/api/states/${encodeURIComponent(id)}`, base);
        const response = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${settings.access_token}` },
          signal: AbortSignal.timeout(8_000),
          cache: "no-store",
          redirect: "error",
        });
        if (!response.ok) throw new Error(`Home Assistant returned ${response.status}`);
        const state = await response.json() as {
          state?: string;
          attributes?: { unit_of_measurement?: string };
          last_updated?: string;
        };
        const value = state.state === undefined ? NaN : Number(state.state);
        return {
          entity_id: id,
          value: Number.isFinite(value) ? value : null,
          unit: state.attributes?.unit_of_measurement ?? null,
          observed_at: state.last_updated ?? null,
        };
      };

      const [power, energyToday] = await Promise.all([
        sensors.power ? read(sensors.power) : null,
        sensors.energyToday ? read(sensors.energyToday) : null,
      ]);
      return NextResponse.json({ solar_power: power, solar_energy_today: energyToday, fetched_at: new Date().toISOString() });
    } catch (err) {
      await logApiError("integration/energy/current", err);
      return NextResponse.json({ error: "Could not read Home Assistant energy sensors", code: "upstream_unavailable" }, { status: 502 });
    }
  });
}
