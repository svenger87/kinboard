/**
 * What `GET /api/integration/v1/energy/current` may read from Home Assistant.
 *
 * The client names nothing: entity IDs come only from the family's energy
 * settings, and only sensors. That is what keeps an `energy:read` token from
 * becoming a way to read arbitrary Home Assistant entities.
 */

export interface SolarConfig {
  solar_power?: string | null;
  solar_energy_today?: string | null;
}

const SENSOR_ID = /^sensor\.[a-z0-9_]+$/;

export function solarSensorIds(config: SolarConfig): { power: string | null; energyToday: string | null } {
  const ok = (id: unknown): string | null => (typeof id === "string" && SENSOR_ID.test(id) ? id : null);
  return { power: ok(config.solar_power), energyToday: ok(config.solar_energy_today) };
}

/** A Home Assistant base URL we will send the token to, or null. */
export function homeAssistantBase(raw: string): URL | null {
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    return null;
  }
  return base;
}
