"use client";

import { useQuery } from "@tanstack/react-query";

export interface PushResetDevice {
  id: string;
  name: string;
}

/**
 * The family's devices that need push turned on again after the server's push
 * key changed (RFC-023 §6.4); empty when there are none.
 */
export function usePushReset(enabled = true) {
  return useQuery({
    queryKey: ["push-reset"],
    enabled,
    queryFn: async (): Promise<PushResetDevice[]> => {
      const r = await fetch("/api/notifications/push-reset");
      if (!r.ok) return [];
      const body = (await r.json()) as { devices?: PushResetDevice[] };
      return Array.isArray(body.devices) ? body.devices : [];
    },
    // Short: a device that turned push on again elsewhere should drop off soon.
    staleTime: 30 * 1000,
    retry: 1,
  });
}
