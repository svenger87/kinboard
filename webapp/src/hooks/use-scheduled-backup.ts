"use client";

import { useQuery } from "@tanstack/react-query";
import type { ScheduledBackupStatus } from "@/lib/scheduled-backup/runner";

/**
 * The all-in-one image's scheduled backups (lib/scheduled-backup/); null on a
 * compose install and for every family but the install's operator. Asked
 * again every few seconds while a backup runs, so "Back up now" shows its end.
 */
export function useScheduledBackup() {
  return useQuery({
    queryKey: ["scheduled-backup"],
    queryFn: async (): Promise<ScheduledBackupStatus | null> => {
      const r = await fetch("/api/scheduled-backup");
      if (!r.ok) return null;
      const body = (await r.json()) as { scheduledBackup?: ScheduledBackupStatus | null };
      return body.scheduledBackup ?? null;
    },
    refetchInterval: (q) => (q.state.data?.running ? 3000 : 60_000),
    staleTime: 30_000,
    retry: 1,
  });
}
