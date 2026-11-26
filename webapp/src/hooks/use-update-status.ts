"use client";

import { useQuery } from "@tanstack/react-query";
import type { UpdateStatus } from "@/lib/update-status";

/** What the last automatic update did (RFC-023 §4.11.4); null when there is no record. */
export function useUpdateStatus() {
  return useQuery({
    queryKey: ["update-status"],
    queryFn: async (): Promise<UpdateStatus | null> => {
      const r = await fetch("/api/update-status");
      if (!r.ok) return null;
      const body = (await r.json()) as { status?: UpdateStatus | null };
      return body.status ?? null;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
