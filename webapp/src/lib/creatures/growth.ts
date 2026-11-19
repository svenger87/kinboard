/**
 * The family's own growth (Settings -> Creatures -> Growing): how many earned
 * task points each stage needs, stored as the setting `growth_points` (seven
 * numbers, stages 2 to 8) and read with readGrowthPoints() in
 * lib/pocket-money/points.ts. Only creatures growing with points follow it;
 * one growing with pocket money follows the balance as before.
 *
 * Changing the numbers never makes a creature smaller: before new numbers are
 * saved, every creature growing with points gets the stage it shows now as
 * its floor (best_tier, which the points stage never goes below and which only
 * ever rises), so raising a threshold leaves it where it is until the child's
 * points pass the next one. Lowering one lets creatures grow at once.
 */

import { readGrowthPoints } from "@/lib/pocket-money/points";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { creatureStage, type AccountLike, type CreatureLike } from "./stage";

// The admin client is untyped for these tables, as in the other routes.
type Db = any;

/** The family's points thresholds: its own, or the standard ones. */
export async function growthPointsFor(db: Db, familyId: string): Promise<ReadonlyArray<number>> {
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", SETTINGS_KEYS.growthPoints)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return readGrowthPoints(data?.value);
}

export interface GrowingCreature {
  personId: string;
  creature: CreatureLike;
  account: AccountLike | null;
  earnedPoints: number;
}

/**
 * The floors to write so nobody shrinks when the thresholds change: for each
 * creature whose stage under the new thresholds would be lower than it is
 * now, the stage it is at now. One growing with money never qualifies: its
 * stage is the balance's, whatever the points thresholds.
 */
export function floorsToKeep(
  creatures: ReadonlyArray<GrowingCreature>,
  before: ReadonlyArray<number>,
  after: ReadonlyArray<number>,
): Array<{ personId: string; tier: number }> {
  const floors: Array<{ personId: string; tier: number }> = [];
  for (const c of creatures) {
    const now = creatureStage({ ...c, pointThresholds: before }).tier;
    const then = creatureStage({ ...c, pointThresholds: after }).tier;
    if (then < now) floors.push({ personId: c.personId, tier: now });
  }
  return floors;
}
