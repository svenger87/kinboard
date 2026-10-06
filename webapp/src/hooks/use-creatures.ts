"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { isPinRequired, relockSettings } from "@/lib/pin-session";
import type { Creature } from "@/types/database";
import type { GrowsWith } from "@/lib/creatures/rules";
import type { AvatarStyle } from "@/lib/pocket-money/creatures/styles";
import type { CreatureLook } from "@/lib/pocket-money/creatures/look";

/**
 * The family's creatures (RFC-017): one row per child that has one, switched
 * on or off. Read straight from the table (family-scoped RLS, live through
 * realtime); every write goes through /api/creatures, which checks the
 * settings PIN for a parent's fields and lets the child's own screen write
 * the look and the stage.
 */

export const CREATURES_KEY = "creatures";

export function useCreatures() {
  const familyId = useFamilyStore((s) => s.family?.id);
  return useQuery({
    queryKey: [CREATURES_KEY, familyId],
    enabled: Boolean(familyId),
    queryFn: async (): Promise<Creature[]> => {
      const { data, error } = await (createClient() as any)
        .from("creatures")
        .select("*")
        .eq("family_id", familyId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Creature[];
    },
  });
}

/** The child's creature when it is switched on; undefined otherwise. */
export function activeCreatureOf(creatures: readonly Creature[] | undefined, personId: string | null | undefined): Creature | undefined {
  if (!personId) return undefined;
  return creatures?.find((c) => c.person_id === personId && c.enabled);
}

/** The error a route answered with, as a code the screens translate. */
async function failure(r: Response, fallback: string): Promise<Error> {
  if (await isPinRequired(r)) {
    relockSettings();
    return new Error("pin_required");
  }
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `${fallback}: ${r.status}`);
}

export interface CreatureChange {
  enabled?: boolean;
  species?: string;
  grows_with?: GrowsWith;
  shop_enabled?: boolean;
  style?: AvatarStyle;
  look?: CreatureLook;
  best_tier?: number;
  last_seen_tier?: number;
}

function useSetCached() {
  const qc = useQueryClient();
  const familyId = useFamilyStore((s) => s.family?.id);
  return (saved: Creature) => {
    // Show the saved row at once; realtime and the refetch confirm it.
    qc.setQueryData<Creature[]>([CREATURES_KEY, familyId], (rows) => {
      if (!rows) return rows;
      const i = rows.findIndex((c) => c.person_id === saved.person_id);
      if (i === -1) return [...rows, saved];
      const next = rows.slice();
      next[i] = saved;
      return next;
    });
    qc.invalidateQueries({ queryKey: [CREATURES_KEY, familyId] });
  };
}

/** Switch a child's creature on: a new one, or the one switched off before. Needs the PIN. */
export function useSwitchOnCreature() {
  const setCached = useSetCached();
  return useMutation({
    mutationFn: async ({ personId, species }: { personId: string; species?: string }) => {
      const r = await fetch("/api/creatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: personId, ...(species ? { species } : {}) }),
      });
      if (!r.ok) throw await failure(r, "creature");
      return ((await r.json()) as { creature: Creature }).creature;
    },
    onSuccess: setCached,
  });
}

/** Change a child's creature. Parental fields need the PIN; the look and the stage do not. */
export function useUpdateCreature() {
  const setCached = useSetCached();
  return useMutation({
    mutationFn: async ({ personId, change }: { personId: string; change: CreatureChange }) => {
      const r = await fetch(`/api/creatures/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!r.ok) throw await failure(r, "creature");
      return ((await r.json()) as { creature: Creature }).creature;
    },
    onSuccess: setCached,
  });
}
