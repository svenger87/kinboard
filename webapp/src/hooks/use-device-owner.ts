"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { isPinRequired, relockSettings } from "@/lib/pin-session";
import { isAppStartAtDashboard } from "@/lib/app-start";
import { mayStartElsewhere, startRouteFor } from "@/lib/device-owner";
import { queryKeys } from "./use-supabase-queries";
import { useCreatures } from "./use-creatures";
import type { Device } from "@/types/database";

/**
 * Say who a device belongs to (RFC-017 §8.2), or nobody. A parent's setting
 * under Settings -> Devices: PATCH /api/devices/[id] checks the settings PIN,
 * and is the only way to write it (the browser roles cannot write the column).
 */
export function useSetDeviceOwner() {
  const qc = useQueryClient();
  const familyId = useFamilyStore((s) => s.family?.id);
  return useMutation({
    mutationFn: async ({ id, personId }: { id: string; personId: string | null }) => {
      const r = await fetch(`/api/devices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: personId }),
      });
      if (!r.ok) {
        if (await isPinRequired(r)) {
          relockSettings();
          throw new Error("pin_required");
        }
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `device: ${r.status}`);
      }
      return ((await r.json()) as { device: Device }).device;
    },
    onSuccess: (device) => {
      if (familyId) qc.invalidateQueries({ queryKey: queryKeys.devices(familyId) });
      // The device this screen runs on: its store copy at once (the heartbeat
      // would bring it within a minute anyway).
      const { device: current, setDevice } = useFamilyStore.getState();
      if (current?.id === device.id) setDevice(device);
    },
  });
}

const noSubscribe = () => () => {};
const serverStart = () => false;

/**
 * The dashboard's half of a child's own device (RFC-017 §8.2): when the app
 * was opened on the dashboard (lib/app-start.ts) on a non-kiosk device that
 * belongs to a child with a creature, go to that child's Rewards page.
 *
 * "wait" while the dashboard should hold its first paint -- a device that
 * belongs to someone, at the start, with the creatures still loading -- so a
 * child's phone does not flash the family dashboard on its way to the
 * creature. Every other device answers "show" straight away: the family's
 * screens and every kiosk are untouched by this.
 */
export function useStartRedirect(): "show" | "wait" {
  const router = useRouter();
  const device = useFamilyStore((s) => s.device);
  const atStart = useSyncExternalStore(noSubscribe, isAppStartAtDashboard, serverStart);
  const owned = atStart && mayStartElsewhere(device);
  const { data: creatures, isPending, isError } = useCreatures();
  const target = owned ? startRouteFor(device, creatures) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (target) return "wait";
  if (owned && isPending && !isError) return "wait";
  return "show";
}
