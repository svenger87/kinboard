import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/db/server";
import { logApiError } from "@/lib/api-error";
import { familyTimeZone } from "@/lib/family-time";
import { resolveOpenWeatherKey } from "@/lib/api-keys";
import { readFamilyWeather, type WeatherIo } from "@/lib/integration-weather";

export const dynamic = "force-dynamic";

function liveWeatherIo(familyId: string): WeatherIo {
  const db = createAdminClient();
  return {
    setting: async (key) => {
      const { data, error } = await (db as any)
        .from("settings")
        .select("value")
        .eq("family_id", familyId)
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return data?.value ?? null;
    },
    timeZone: () => familyTimeZone(familyId, db),
    // The family's own key from Settings, else the server's (lib/api-keys.ts).
    apiKey: () => resolveOpenWeatherKey(familyId),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
  };
}

/**
 * GET /api/integration/v1/weather
 *
 * The family's weather: current conditions, a daily forecast on the family's
 * calendar (YYYY-MM-DD in its time zone) with min/max, condition and chance of
 * rain, and today's 3-hour steps — for the location, units and language chosen
 * in Kinboard, from the same provider requests and cache as the Weather widget
 * (lib/integration-weather.ts). No location chosen or no API key on the server
 * is a 404 with reason `weather_not_configured`, never a 500.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      const result = await readFamilyWeather(liveWeatherIo(context.familyId));
      if (result.status === 502) await logApiError("integration/weather", result.cause);
      return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
      await logApiError("integration/weather", err);
      return NextResponse.json({ error: "Could not read the weather", code: "internal_error" }, { status: 500 });
    }
  });
}
