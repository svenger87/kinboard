"use client";

import { useQuery } from "@tanstack/react-query";

export interface ChangelogEntry {
  tag: string;
  name: string;
  publishedAt: string | null;
  body: string;
  /**
   * Only ever true on an instance that is itself running a pre-release —
   * the API filters release candidates out for stable installs entirely.
   */
  prerelease: boolean;
}

interface ChangelogResponse {
  releases: ChangelogEntry[];
}

export function useChangelog(enabled = true) {
  return useQuery({
    queryKey: ["changelog"],
    queryFn: async (): Promise<ChangelogResponse> => {
      const r = await fetch("/api/changelog");
      if (!r.ok) throw new Error(`changelog failed: ${r.status}`);
      return r.json();
    },
    enabled,
    // Server caches 6h; refetch at most once an hour per client.
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
    retry: 1,
  });
}
