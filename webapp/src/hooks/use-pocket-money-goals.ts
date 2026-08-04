import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type {
  PocketMoneyGoal,
  PocketMoneyGoalInsert,
  PocketMoneyGoalUpdate,
} from "@/types/database";

const KEY = "pocket-money-goals";

export function usePocketMoneyGoals(accountId: string | undefined) {
  const { family } = useFamilyStore();
  return useQuery({
    // The family is part of the key as well as the request: these routes
    // now scope by it, so a cached result from one family must not be
    // handed to another after a switch.
    queryKey: [KEY, accountId, family?.id],
    enabled: Boolean(accountId) && Boolean(family?.id),
    queryFn: async (): Promise<PocketMoneyGoal[]> => {
      const r = await fetch(
        `/api/pocket-money/accounts/${accountId}/goals?family_id=${family!.id}`,
      );
      if (!r.ok) throw new Error(`goals: ${r.status}`);
      return ((await r.json()) as { goals: PocketMoneyGoal[] }).goals;
    },
  });
}

export function useCreatePocketMoneyGoal() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async ({
      accountId,
      input,
    }: {
      accountId: string;
      input: Omit<PocketMoneyGoalInsert, "account_id">;
    }) => {
      const r = await fetch(`/api/pocket-money/accounts/${accountId}/goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, family_id: family?.id }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `goal create: ${r.status}`);
      }
      return ((await r.json()) as { goal: PocketMoneyGoal }).goal;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, vars.accountId] });
    },
  });
}

export function useUpdatePocketMoneyGoal() {
  const { family } = useFamilyStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      accountId,
      update,
    }: {
      id: string;
      accountId: string;
      update: PocketMoneyGoalUpdate;
    }) => {
      const r = await fetch(`/api/pocket-money/goals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...update, family_id: family?.id }),
      });
      if (!r.ok) throw new Error(`goal update: ${r.status}`);
      return ((await r.json()) as { goal: PocketMoneyGoal }).goal;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, vars.accountId] });
    },
  });
}

export function useDeletePocketMoneyGoal() {
  const { family } = useFamilyStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; accountId: string }) => {
      const r = await fetch(
        `/api/pocket-money/goals/${id}?family_id=${family?.id ?? ""}`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `goal delete: ${r.status}`);
      }
      return true;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: [KEY, vars.accountId] });
    },
  });
}

interface ImageSearchResult {
  name: string;
  image_url: string;
  source: string | null;
}

export function useGoalImageSearch(query: string) {
  return useQuery({
    queryKey: ["pocket-money-image-search", query],
    enabled: query.trim().length >= 2,
    staleTime: 60_000,
    queryFn: async (): Promise<ImageSearchResult[]> => {
      const r = await fetch(`/api/pocket-money/goal-image-search?q=${encodeURIComponent(query)}`);
      if (!r.ok) throw new Error(`image search: ${r.status}`);
      return ((await r.json()) as { results: ImageSearchResult[] }).results;
    },
  });
}
