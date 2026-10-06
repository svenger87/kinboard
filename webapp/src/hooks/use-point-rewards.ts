"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { isPinRequired, relockSettings } from "@/lib/pin-session";
import type { PointRedemption, PointReward } from "@/types/database";
import { useTodoPoints } from "./use-todo-points";
import { pointsTotal } from "@/lib/todo-points";
import { pointTotals, type PointTotals } from "@/lib/pocket-money/points";

/**
 * The rewards catalogue and the children's requests (discussion #349; core
 * since RFC-017, per child, no pocket-money account needed).
 * Read straight from the tables (family-scoped RLS, live through realtime);
 * every write goes through a server route, which checks the settings PIN for
 * the catalogue and for a decision.
 */

export const POINT_REWARDS_KEY = "point-rewards";
export const POINT_REDEMPTIONS_KEY = "point-redemptions";

export function usePointRewards() {
  const familyId = useFamilyStore((s) => s.family?.id);
  return useQuery({
    queryKey: [POINT_REWARDS_KEY, familyId],
    enabled: Boolean(familyId),
    queryFn: async (): Promise<PointReward[]> => {
      const { data, error } = await (createClient() as any)
        .from("point_rewards")
        .select("*")
        .eq("family_id", familyId)
        .order("cost_points", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PointReward[];
    },
  });
}

/** Every request of the family, newest first: pending, approved and denied. */
export function usePointRedemptions() {
  const familyId = useFamilyStore((s) => s.family?.id);
  return useQuery({
    queryKey: [POINT_REDEMPTIONS_KEY, familyId],
    enabled: Boolean(familyId),
    queryFn: async (): Promise<PointRedemption[]> => {
      const { data, error } = await (createClient() as any)
        .from("point_redemptions")
        .select("*")
        .eq("family_id", familyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PointRedemption[];
    },
  });
}

/** Requests waiting for a parent, family-wide: feeds the navigation badge. */
export function usePendingRedemptionCount(): number {
  const { data = [] } = usePointRedemptions();
  return data.filter((r) => r.status === "pending").length;
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

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [POINT_REWARDS_KEY] });
    qc.invalidateQueries({ queryKey: [POINT_REDEMPTIONS_KEY] });
  };
}

export interface RewardDraft {
  title: string;
  cost_points: number;
  icon: string | null;
  active: boolean;
}

export function useSaveReward() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, draft }: { id?: string; draft: Partial<RewardDraft> }) => {
      const r = await fetch(id ? `/api/rewards/${id}` : "/api/rewards", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!r.ok) throw await failure(r, "reward");
      return ((await r.json()) as { reward: PointReward }).reward;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteReward() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/rewards/${id}`, { method: "DELETE" });
      if (!r.ok) throw await failure(r, "delete reward");
    },
    onSuccess: invalidate,
  });
}

export function useRequestRedemption() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ personId, rewardId }: { personId: string; rewardId: string }) => {
      const r = await fetch("/api/rewards/redemptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: personId, reward_id: rewardId }),
      });
      if (!r.ok) throw await failure(r, "redeem");
      return ((await r.json()) as { redemption: PointRedemption }).redemption;
    },
    onSuccess: invalidate,
  });
}

export function useDecideRedemption() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "denied" }) => {
      const r = await fetch(`/api/rewards/redemptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw await failure(r, "decide");
    },
    // A refused approval changed nothing, but the screen may be showing a
    // stale balance: refetch either way.
    onSettled: invalidate,
  });
}

/**
 * Each child's points, from the awards the tasks page counts and the
 * requests above. `ready` is false until both have loaded: a screen must not
 * treat "not loaded yet" as "no points" -- the avatar would shrink and grow
 * back, and a celebration would fire for a stage reached long ago.
 */
export function usePointTotals(): { ready: boolean; totalsFor: (personId: string) => PointTotals } {
  const awards = useTodoPoints();
  const redemptions = usePointRedemptions();
  const awardRows = awards.data ?? [];
  const redemptionRows = redemptions.data ?? [];
  return {
    ready: awards.isSuccess && redemptions.isSuccess,
    // Per child (RFC-017): the awards and the requests are both the person's.
    totalsFor: (personId) =>
      pointTotals(
        pointsTotal(awardRows, personId),
        redemptionRows.filter((r) => r.person_id === personId),
      ),
  };
}
