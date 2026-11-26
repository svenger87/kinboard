"use client";

import { useQuery } from "@tanstack/react-query";
import type { ComposeRevisionStatus } from "@/lib/compose-revision";

/** The install's compose.yml revision against this image's (RFC-023 §4.6); null when there is nothing to say. */
export function useComposeRevision() {
  return useQuery({
    queryKey: ["compose-revision"],
    queryFn: async (): Promise<ComposeRevisionStatus | null> => {
      const r = await fetch("/api/compose-revision");
      if (!r.ok) return null;
      const body = (await r.json()) as { revision?: ComposeRevisionStatus | null };
      return body.revision ?? null;
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}
