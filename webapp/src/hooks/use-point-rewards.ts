"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { isPinRequired, relockSettings } from "@/lib/pin-session";
import type { PointAwardRow, PointPurchase, PointRedemption, PointReward } from "@/types/database";
import { useTodoPoints } from "./use-todo-points";
import { pointsTotal } from "@/lib/todo-points";
import { pointTotals, type PointTotals } from "@/lib/pocket-money/points";
import { ownedSet } from "@/lib/pocket-money/creatures/shop";

/**
 * The rewards catalogue, the children's requests and their shop purchases (discussion #349; core
 * since RFC-017, per child, no pocket-money account needed).
 * Read straight from the tables (family-scoped RLS, live through realtime);
 * every write goes through a server route, which checks the settings PIN for
 * the catalogue and for a decision.
 */

export const POINT_REWARDS_KEY = "point-rewards";
export const POINT_REDEMPTIONS_KEY = "point-redemptions";
export const POINT_PURCHASES_KEY = "point-purchases";
export const POINT_ADJUSTMENTS_KEY = "point-adjustments";

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

/** Everything the family's children bought in the creature shop, newest first (RFC-017 §5). */
export function usePointPurchases() {
  const familyId = useFamilyStore((s) => s.family?.id);
  return useQuery({
    queryKey: [POINT_PURCHASES_KEY, familyId],
    enabled: Boolean(familyId),
    queryFn: async (): Promise<PointPurchase[]> => {
      const { data, error } = await (createClient() as any)
        .from("point_purchases")
        .select("*")
        .eq("family_id", familyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PointPurchase[];
    },
  });
}

const NOTHING: ReadonlySet<string> = new Set();

/**
 * What each child owns from the shop, for drawing their creature: pass
 * `ownedFor(personId)` to readLook, which draws only owned items. Until the
 * purchases have loaded it is the empty set, so nothing bought is drawn
 * rather than something not bought; `ready` says when it is the real answer.
 */
export function useOwnedItems(): { ready: boolean; ownedFor: (personId: string) => ReadonlySet<string> } {
  const { data, isSuccess } = usePointPurchases();
  const byPerson = new Map<string, PointPurchase[]>();
  for (const p of data ?? []) byPerson.set(p.person_id, [...(byPerson.get(p.person_id) ?? []), p]);
  return {
    ready: isSuccess,
    ownedFor: (personId) => (byPerson.has(personId) ? ownedSet(byPerson.get(personId)) : NOTHING),
  };
}

/** A child buys an item for their creature: no PIN, their own points. */
export function useBuyItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ personId, itemId }: { personId: string; itemId: string }) => {
      const r = await fetch(`/api/creatures/${personId}/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });
      if (!r.ok) throw await failure(r, "buy");
      return ((await r.json()) as { purchase: PointPurchase }).purchase;
    },
    // A refused purchase changed nothing, but the screen's balance or shop
    // switch may be stale: refetch either way.
    onSettled: () => qc.invalidateQueries({ queryKey: [POINT_PURCHASES_KEY] }),
  });
}

/**
 * A parent refunds a purchase: the points come back and a worn item comes
 * off. Needs the settings PIN.
 */
export function useRefundPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (purchaseId: string) => {
      const r = await fetch(`/api/creatures/purchases/${purchaseId}`, { method: "DELETE" });
      if (!r.ok) throw await failure(r, "refund");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [POINT_PURCHASES_KEY] });
      // The look may have lost the item.
      qc.invalidateQueries({ queryKey: ["creatures"] });
    },
  });
}

/**
 * The points parents added or removed by hand (discussion #349), newest
 * first. They are rows of todo_point_awards, so every total already counts
 * them; this is the list a parent reads and can take one back from.
 */
export function usePointAdjustments() {
  const familyId = useFamilyStore((s) => s.family?.id);
  return useQuery({
    queryKey: [POINT_ADJUSTMENTS_KEY, familyId],
    enabled: Boolean(familyId),
    queryFn: async (): Promise<PointAwardRow[]> => {
      const { data, error } = await (createClient() as any)
        .from("todo_point_awards")
        .select("*")
        .eq("family_id", familyId)
        .eq("kind", "adjustment")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PointAwardRow[];
    },
  });
}

/** Every query a change to a child's points moves. */
function useInvalidatePoints() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [POINT_ADJUSTMENTS_KEY] });
    qc.invalidateQueries({ queryKey: ["todo-point-awards"] });
  };
}

/** A parent adds (positive) or removes (negative) a child's points. Needs the settings PIN. */
export function useAdjustPoints() {
  const invalidate = useInvalidatePoints();
  return useMutation({
    mutationFn: async (input: { personId: string; points: number; note?: string }) => {
      const r = await fetch("/api/points/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: input.personId, points: input.points, note: input.note ?? null }),
      });
      if (!r.ok) throw await failure(r, "adjust");
    },
    onSettled: invalidate,
  });
}

/** A parent takes back an adjustment. Needs the settings PIN. */
export function useRemoveAdjustment() {
  const invalidate = useInvalidatePoints();
  return useMutation({
    mutationFn: async (adjustmentId: string) => {
      const r = await fetch(`/api/points/adjustments/${adjustmentId}`, { method: "DELETE" });
      if (!r.ok) throw await failure(r, "remove_adjustment");
    },
    onSettled: invalidate,
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
  const purchases = usePointPurchases();
  const awardRows = awards.data ?? [];
  const redemptionRows = redemptions.data ?? [];
  const purchaseRows = purchases.data ?? [];
  return {
    ready: awards.isSuccess && redemptions.isSuccess && purchases.isSuccess,
    // Per child (RFC-017): the awards, the requests and the purchases are all
    // the person's.
    totalsFor: (personId) =>
      pointTotals(
        pointsTotal(awardRows, personId),
        redemptionRows.filter((r) => r.person_id === personId),
        purchaseRows.filter((p) => p.person_id === personId),
      ),
  };
}
