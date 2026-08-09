import { createAdminClient } from "@/lib/supabase/server";
import type { SignalHome, SignalWeather } from "./types";

/**
 * The two signals that come from outside Kinboard.
 *
 * Kept apart from signals.ts on purpose. Everything there reads the family's
 * own database and is therefore fast, always available, and impossible to
 * misconfigure. These two cross the network to a third party, can be absent
 * entirely, and can be *slow* — which on a five-minute evaluation loop is the
 * dangerous one.
 *
 * Both return undefined rather than throwing, and both are bounded by a
 * timeout. Eight of the ten shipped rules use neither, so a household with no
 * weather key and no Home Assistant must lose nothing at all.
 */

/** Short. The evaluation runs on a schedule; nothing is waiting on the answer. */
const EXTERNAL_TIMEOUT_MS = 6000;

async function readSetting<T>(familyId: string, key: string): Promise<T | null> {
  try {
    const supabase = createAdminClient();
    const { data } = await (supabase as any)
      .from("settings")
      .select("value")
      .eq("family_id", familyId)
      .eq("key", key)
      .maybeSingle();
    return (data?.value ?? null) as T | null;
  } catch {
    return null;
  }
}

/**
 * The Home Assistant token is NOT in the `home_assistant` setting.
 *
 * That setting holds the url and the dashboards; the token lives in
 * `integration_secrets`, which is revoked from the browser roles and reachable
 * only with the service role. Reading the token from the settings row — the
 * obvious guess — returns undefined and produces an adapter that silently
 * never authenticates.
 */
async function readSecret(familyId: string, key: string, field: string): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data } = await (supabase as any)
      .from("integration_secrets")
      .select("value")
      .eq("family_id", familyId)
      .eq("key", key)
      .maybeSingle();
    const value = data?.value?.[field];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Today's chance of rain, from the same forecast the weather widget shows.
 *
 * Routed through Kinboard's own forecast endpoint rather than OpenWeatherMap
 * directly, so the board and the widget cannot disagree about the weather —
 * and so the API key stays in exactly one place.
 */
export async function fetchWeather(familyId: string): Promise<SignalWeather | undefined> {
  const location = await readSetting<{ city?: string; lat?: number; lon?: number }>(
    familyId,
    "weather_location"
  );
  if (!location) return undefined;

  const params = new URLSearchParams();
  if (typeof location.lat === "number" && typeof location.lon === "number") {
    params.set("lat", String(location.lat));
    params.set("lon", String(location.lon));
  } else if (location.city) {
    params.set("city", location.city);
  } else {
    return undefined;
  }

  try {
    const base = process.env.INTERNAL_BASE_URL ?? "http://localhost:3000";
    const response = await fetch(`${base}/api/weather/forecast?${params}`, {
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return undefined;

    const body = await response.json();
    // `daily`, not `forecast`; and each day carries `condition`, not
    // `description`. Guessing either produces an adapter that returns
    // undefined forever and a rain rule that never once fires.
    const today = Array.isArray(body?.daily) ? body.daily[0] : null;
    if (!today) return undefined;

    return {
      temperatureMin: numberOrNull(today.tempMin),
      temperatureMax: numberOrNull(today.tempMax),
      precipitationChance: numberOrNull(today.precipProbability),
      condition: typeof today.condition === "string" ? today.condition : null,
    };
  } catch {
    return undefined;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Home Assistant's current states, narrowed to what a rule can use.
 *
 * A full /api/states on a real installation is hundreds of entities and a
 * megabyte of attributes; only the on/off ones are of any use to a rule about
 * doors and windows, and carrying the rest would be copied into every item's
 * evidence. Narrowed here rather than in the rule so the size is bounded
 * before it reaches memory.
 */
export async function fetchHome(familyId: string): Promise<SignalHome | undefined> {
  const settings = await readSetting<{ url?: string }>(familyId, "home_assistant");
  const url = settings?.url?.replace(/\/+$/, "");
  if (!url) return undefined;

  const token = await readSecret(familyId, "home_assistant", "access_token");
  if (!token) return undefined;

  try {
    const response = await fetch(`${url}/api/states`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return undefined;

    const body = await response.json();
    if (!Array.isArray(body)) return undefined;

    const states: Record<string, string> = {};
    const deviceClasses: Record<string, string> = {};
    for (const entity of body) {
      const id = entity?.entity_id;
      if (typeof id !== "string") continue;
      if (!id.startsWith("binary_sensor.") && !id.startsWith("input_boolean.")) continue;
      if (typeof entity.state === "string") states[id] = entity.state;
      const deviceClass = entity?.attributes?.device_class;
      if (typeof deviceClass === "string") deviceClasses[id] = deviceClass;
    }
    return { states, deviceClasses };
  } catch {
    return undefined;
  }
}
