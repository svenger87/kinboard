"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { isPinRequired, relockSettings } from "@/lib/pin-session";
import type { InstanceValueSource } from "@/lib/first-run";

/**
 * The install's own settings (RFC-024 §8) through /api/setup/instance: the
 * address calendar links use, and the contact push services are given.
 * Only the install's operator gets anything but `{ operator: false }`.
 */
export interface InstanceSetup {
  operator: boolean;
  firstRunDone?: boolean;
  firstRunMine?: boolean;
  siteUrl?: { value: string | null; source: InstanceValueSource };
  pushContact?: { value: string | null; source: InstanceValueSource };
  pushReady?: boolean;
}

const KEY = "instance-setup";

export function useInstanceSetup() {
  const { family } = useFamilyStore();
  return useQuery<InstanceSetup>({
    queryKey: [KEY, family?.id],
    enabled: !!family?.id,
    queryFn: async () => {
      const r = await fetch("/api/setup/instance", { cache: "no-store" });
      // An error is "not the operator": the wizard then shows the family's
      // steps only, which is never wrong for an existing install.
      if (!r.ok) return { operator: false };
      return r.json();
    },
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function useSaveInstanceSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { site_url?: string | null; vapid_subject?: string | null }) => {
      const r = await fetch("/api/setup/instance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!r.ok) {
        if (await isPinRequired(r)) {
          relockSettings();
          throw new Error("pin_required");
        }
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${r.status}`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** The install's steps were seen; they are not offered again. */
export function useFinishInstanceSteps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/setup/instance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "done" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
