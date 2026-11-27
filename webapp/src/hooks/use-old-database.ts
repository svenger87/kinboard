"use client";

import { useQuery } from "@tanstack/react-query";
import type { OldDatabaseStatus } from "@/lib/aio-old-database";

/** The database folder a PostgreSQL upgrade kept in the all-in-one image (RFC-024 §4.3); null when there is none to show. */
export function useOldDatabase() {
  return useQuery({
    queryKey: ["old-database"],
    queryFn: async (): Promise<OldDatabaseStatus | null> => {
      const r = await fetch("/api/old-database");
      if (!r.ok) return null;
      const body = (await r.json()) as { oldDatabase?: OldDatabaseStatus | null };
      return body.oldDatabase ?? null;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
