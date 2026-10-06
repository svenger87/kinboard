/**
 * Where the creatures live (RFC-017 §4, step 2): the rules the new surfaces
 * share -- the Rewards page's nav item, which children the widget and the
 * page show, and how far a creature is toward its next stage.
 */

import type { AvatarStage } from "@/lib/pocket-money/points";

interface CreatureLike {
  person_id: string;
  enabled?: boolean | null;
}

interface PersonLike {
  id: string;
  is_child?: boolean | null;
}

/**
 * The Rewards page appears in the navigation once a child of the family has
 * a creature switched on (RFC-017 §8.1); a family that never switches one on
 * never sees it. Hidden while the creatures load: for most families the
 * answer is no, and an item that flashes in and out is worse than one that
 * arrives a moment late.
 */
export function rewardsNavVisible(creatures: readonly CreatureLike[] | undefined): boolean {
  return Boolean(creatures?.some((c) => c.enabled !== false));
}

/**
 * The children with a creature switched on, in the family's own order (the
 * people list), each with their creature. A creature whose child is not in
 * the list -- in the recycle bin, or no longer a child -- is left out.
 */
export function creatureChildren<P extends PersonLike, C extends CreatureLike>(
  people: readonly P[] | undefined,
  creatures: readonly C[] | undefined,
): Array<{ person: P; creature: C }> {
  if (!people || !creatures) return [];
  const out: Array<{ person: P; creature: C }> = [];
  for (const person of people) {
    if (!person.is_child) continue;
    const creature = creatures.find((c) => c.person_id === person.id && c.enabled !== false);
    if (creature) out.push({ person, creature });
  }
  return out;
}

/**
 * How far the creature is from its current stage's threshold to the next
 * one, 0..100, in the stage's own unit: `value` is the points earned, or the
 * balance in cents for a creature that grows with money. 100 at the top.
 */
export function stageProgress(stage: Pick<AvatarStage, "tier" | "next" | "thresholds">, value: number): number {
  if (!stage.next) return 100;
  const from = stage.thresholds[stage.tier - 1] ?? 0;
  const span = stage.next.at - from;
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, Math.floor(((value - from) * 100) / span)));
}
