/**
 * Reads `/energy/current` from Home Assistant: one `GET /api/states`,
 * filtered to the `sensor.*` IDs configured in Kinboard's energy settings
 * (read up to ha-client's HA_STATES_MAX_BYTES, 16 MiB), and — for the
 * energy-today sensors only — one statistics request from local midnight in
 * the family's time zone (lib/home/ha-statistics.ts, the same code path the
 * energy screens use). Separate from `integration-energy.ts` because
 * `ha-client` imports that module.
 */

import { getHaStates, type HaIo } from "@/lib/home/ha-client";
import { getHaStatistics, summedChange } from "@/lib/home/ha-statistics";
import { familyMidnight } from "@/lib/family-time";
import { logApiError } from "@/lib/api-error";
import {
  buildEnergyStatus, ENERGY_TODAY_FIELDS, type EnergyField, type EnergyStatus, type EnergyTodayChanges,
} from "@/lib/integration-energy";

/**
 * Today's growth of each energy-today sensor, or null when the statistics
 * could not be read. Never throws: the power readings must still come back
 * when only the statistics fail.
 */
async function todayChanges(
  familyId: string,
  ids: ReadonlyMap<EnergyField, string>,
  timeZone: string,
  now: Date,
  io: HaIo,
): Promise<EnergyTodayChanges> {
  const energyIds = [...new Set(ENERGY_TODAY_FIELDS.map((f) => ids.get(f)).filter((id): id is string => id !== undefined))];
  if (energyIds.length === 0) return new Map();
  try {
    const statistics = await getHaStatistics(familyId, energyIds, familyMidnight(now, timeZone), now, io);
    return new Map(energyIds.map((id) => [id, summedChange(statistics[id])]));
  } catch (err) {
    await logApiError("integration/energy/current statistics", err).catch(() => undefined);
    return null;
  }
}

export async function readEnergyStatus(
  familyId: string,
  ids: ReadonlyMap<EnergyField, string>,
  timeZone: string,
  io: HaIo = {},
  now: () => Date = () => new Date(),
): Promise<EnergyStatus> {
  const at = now();
  const [states, changes] = await Promise.all([
    getHaStates(familyId, [...new Set(ids.values())], io),
    todayChanges(familyId, ids, timeZone, at, io),
  ]);
  return buildEnergyStatus(ids, states, changes, at);
}
