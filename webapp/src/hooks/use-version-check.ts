"use client";

import { useQuery } from "@tanstack/react-query";

export interface VersionCheck {
  current: string;
  latest: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  updateAvailable: boolean;
  fetchedAt: string;
}

export function useVersionCheck() {
  return useQuery({
    queryKey: ["version-check"],
    queryFn: async (): Promise<VersionCheck> => {
      const r = await fetch("/api/version-check");
      if (!r.ok) throw new Error(`version-check failed: ${r.status}`);
      return r.json();
    },
    // Server caches 6h; client refetches once per session and on focus,
    // but stays fresh enough that we don't ask the server every keystroke.
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
    retry: 1,
  });
}
