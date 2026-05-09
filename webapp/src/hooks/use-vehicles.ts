import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { Vehicle, VehicleInsert } from "@/types/database";

const VEHICLES_KEY = "vehicles";

export function useVehicles() {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [VEHICLES_KEY, family?.id],
    enabled: Boolean(family?.id),
    queryFn: async (): Promise<Vehicle[]> => {
      const r = await fetch(`/api/vehicles?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`vehicles: ${r.status}`);
      const json = (await r.json()) as { vehicles: Vehicle[] };
      return json.vehicles;
    },
  });
}

export function useVehicle(id: string | undefined) {
  return useQuery({
    queryKey: [VEHICLES_KEY, "one", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<Vehicle> => {
      const r = await fetch(`/api/vehicles/${id}`);
      if (!r.ok) throw new Error(`vehicle: ${r.status}`);
      const json = (await r.json()) as { vehicle: Vehicle };
      return json.vehicle;
    },
  });
}

export function useSaveVehicle() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (
      input: { id?: string } & Partial<VehicleInsert>,
    ): Promise<Vehicle> => {
      const isUpdate = Boolean(input.id);
      const url = isUpdate ? `/api/vehicles/${input.id}` : "/api/vehicles";
      const method = isUpdate ? "PATCH" : "POST";
      const body = isUpdate
        ? input
        : { ...input, family_id: family?.id };
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error ?? `save: ${r.status}`);
      }
      const json = (await r.json()) as { vehicle: Vehicle };
      return json.vehicle;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: [VEHICLES_KEY, family?.id] });
      qc.invalidateQueries({ queryKey: [VEHICLES_KEY, "one", saved.id] });
    },
  });
}

export function useDeleteVehicle() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await fetch(`/api/vehicles/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`delete: ${r.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [VEHICLES_KEY, family?.id] });
    },
  });
}

/** For the nav-gating predicate — the registry calls this to populate
 *  the plugin's `ownDataCount` field. */
export function useVehiclesCount(): { count: number | undefined; loading: boolean } {
  const { data, isPending } = useVehicles();
  return { count: data?.length, loading: isPending };
}
