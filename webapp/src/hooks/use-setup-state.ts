"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";

export interface SetupState {
  setup_completed: boolean;
  has_family: boolean;
  has_people: boolean;
  has_home_assistant: boolean;
  has_weather_location: boolean;
}

export function useSetupState() {
  const { family } = useFamilyStore();
  return useQuery<SetupState>({
    queryKey: ["setup-state", family?.id],
    enabled: !!family?.id,
    queryFn: async () => {
      const r = await fetch(`/api/setup/state?family_id=${family!.id}`);
      if (!r.ok) throw new Error("failed to load setup state");
      return r.json();
    },
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function useMarkSetupCompleted() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async () => {
      if (!family?.id) throw new Error("no family");
      const r = await fetch("/api/setup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family.id }),
      });
      if (!r.ok) throw new Error("failed to mark setup completed");
      return r.json() as Promise<{ ok: true }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["setup-state"] });
    },
  });
}
