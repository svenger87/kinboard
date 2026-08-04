import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { Ticker, TickerInsert, TickerUpdate } from "@/types/database";

const TICKERS_KEY = "tickers";

export function useTickers() {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [TICKERS_KEY, family?.id],
    enabled: Boolean(family?.id),
    queryFn: async (): Promise<Ticker[]> => {
      const r = await fetch(`/api/tickers?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`tickers: ${r.status}`);
      const json = (await r.json()) as { tickers: Ticker[] };
      return json.tickers;
    },
  });
}

export function useTicker(id: string | undefined) {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [TICKERS_KEY, "one", id, family?.id],
    enabled: Boolean(id) && Boolean(family?.id),
    queryFn: async (): Promise<Ticker> => {
      const r = await fetch(`/api/tickers/${id}?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`ticker: ${r.status}`);
      const json = (await r.json()) as { ticker: Ticker };
      return json.ticker;
    },
  });
}

export function useCreateTicker() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (input: Omit<TickerInsert, "family_id">) => {
      const r = await fetch("/api/tickers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, family_id: family?.id }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `create: ${r.status}`);
      }
      const json = (await r.json()) as { ticker: Ticker };
      return json.ticker;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TICKERS_KEY, family?.id] });
    },
  });
}

export function useUpdateTicker() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async ({ id, update }: { id: string; update: TickerUpdate }) => {
      const r = await fetch(`/api/tickers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...update, family_id: family?.id }),
      });
      if (!r.ok) throw new Error(`update: ${r.status}`);
      const json = (await r.json()) as { ticker: Ticker };
      return json.ticker;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: [TICKERS_KEY, family?.id] });
      qc.invalidateQueries({ queryKey: [TICKERS_KEY, "one", saved.id, family?.id] });
    },
  });
}

export function useDeleteTicker() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/tickers/${id}?family_id=${family?.id ?? ""}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(`delete: ${r.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TICKERS_KEY, family?.id] });
    },
  });
}

export function useReorderTickers() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (items: Array<{ id: string; position: number }>) => {
      const r = await fetch("/api/tickers/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, family_id: family?.id }),
      });
      if (!r.ok) throw new Error(`reorder: ${r.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TICKERS_KEY, family?.id] });
    },
  });
}

/** For the plugin's nav-gating predicate. */
export function useTickersCount(): { count: number | undefined; loading: boolean } {
  const { data, isPending } = useTickers();
  return { count: data?.length, loading: isPending };
}
