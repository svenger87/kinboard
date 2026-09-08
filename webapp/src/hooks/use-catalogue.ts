"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { CatalogueItem } from "@/types/database";

const KEY = "catalogue";

/**
 * A stable empty array.
 *
 * `useQuery`'s `data` is undefined until it resolves, and a `= []` default in
 * a destructure is a fresh array every render — which turns any effect or
 * memo keyed on it into one that fires every render. That pegged a tab here
 * once.
 */
const EMPTY: CatalogueItem[] = [];

/**
 * Drop the row from the cache rather than trusting a refetch to return a list
 * without it. `invalidateQueries` is deduped against whatever fetch is already
 * in flight, and on a family board something usually is.
 */
function forget(qc: QueryClient, familyId: string | undefined, id: string) {
  qc.setQueryData<CatalogueItem[]>([KEY, familyId], (old) => old?.filter((x) => x.id !== id));
  void qc.invalidateQueries({ queryKey: [KEY, familyId] });
}

/**
 * Thrown by `useAddCatalogueItem` when the server rejected the add because
 * this entity/builtin key is already catalogued. Kept as its own class,
 * rather than a generic `Error`, so the screen can tell "you already have
 * that device" apart from any other failure.
 */
export class CatalogueDuplicateError extends Error {
  constructor() {
    super("catalogue add: duplicate entity");
    this.name = "CatalogueDuplicateError";
  }
}

export function useCatalogue() {
  const { family } = useFamilyStore();
  const query = useQuery({
    queryKey: [KEY, family?.id],
    enabled: Boolean(family?.id),
    queryFn: async (): Promise<CatalogueItem[]> => {
      const r = await fetch(`/api/catalogue?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`catalogue: ${r.status}`);
      return ((await r.json()) as { items: CatalogueItem[] }).items;
    },
  });
  return { ...query, data: query.data ?? EMPTY };
}

export function useAddCatalogueItem() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (body: {
      kind: CatalogueItem["kind"];
      entity_id?: string;
      builtin_key?: string;
      name: string;
      room?: string;
      image_url?: string;
    }): Promise<CatalogueItem> => {
      const r = await fetch("/api/catalogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family!.id, ...body }),
      });
      if (!r.ok) {
        if (r.status === 409) throw new CatalogueDuplicateError();
        throw new Error(`catalogue add: ${r.status}`);
      }
      return ((await r.json()) as { item: CatalogueItem }).item;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}

export function useUpdateCatalogueItem() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      room?: string;
      image_url?: string;
      position?: number;
    }): Promise<CatalogueItem> => {
      const r = await fetch(`/api/catalogue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family!.id, ...patch }),
      });
      if (!r.ok) throw new Error(`catalogue update: ${r.status}`);
      return ((await r.json()) as { item: CatalogueItem }).item;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}

/**
 * Offer to fill in `room` for catalogue rows that don't have one yet, from
 * Home Assistant's areas — RFC-006 §3.3. A button someone presses, not a
 * sync: never called automatically, and the route itself never touches a
 * room that is already set.
 */
export function useImportCatalogueRooms() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (): Promise<{ updated: number; rooms: string[] }> => {
      const r = await fetch("/api/catalogue/import-rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family!.id }),
      });
      if (!r.ok) throw new Error(`catalogue import-rooms: ${r.status}`);
      return r.json();
    },
    onSuccess: (result) => {
      if (result.updated > 0) void qc.invalidateQueries({ queryKey: [KEY, family?.id] });
    },
  });
}

export function useDeleteCatalogueItem() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await fetch(`/api/catalogue/${id}?family_id=${family!.id}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(`catalogue delete: ${r.status}`);
    },
    onSuccess: (_data, id) => forget(qc, family?.id, id),
  });
}
