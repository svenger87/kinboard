/**
 * Reads `/energy/current` from Home Assistant: one `GET /api/states`, filtered
 * to the `sensor.*` IDs configured in Kinboard's energy settings (read up to
 * ha-client's HA_STATES_MAX_BYTES, 16 MiB). Separate from
 * `integration-energy.ts` because `ha-client` imports that module.
 */

import { getHaStates, type HaIo } from "@/lib/home/ha-client";
import { buildEnergyStatus, type EnergyField, type EnergyStatus } from "@/lib/integration-energy";

export async function readEnergyStatus(
  familyId: string,
  ids: ReadonlyMap<EnergyField, string>,
  io: HaIo = {},
  now: () => Date = () => new Date(),
): Promise<EnergyStatus> {
  const states = await getHaStates(familyId, [...new Set(ids.values())], io);
  return buildEnergyStatus(ids, states, now());
}
