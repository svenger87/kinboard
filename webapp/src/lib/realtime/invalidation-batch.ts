import type { InvalidateQueryFilters, QueryClient } from "@tanstack/react-query";

/**
 * Change events, turned into as few refetches as they mean.
 *
 * The live-update stream delivers one event per changed row, and a sync can
 * change hundreds of rows at once. Invalidating per event refetched each list
 * once per row — and, with React Query's default `cancelRefetch`, cancelled
 * the refetch already under way every time, so on a slow screen nothing ever
 * finished. Measured on production: one 362-row Google sync made a single
 * Home screen fire 1,494 requests in twenty seconds.
 *
 * Here each key is invalidated once per burst: the first event starts a short
 * wait, events for the same key during it add nothing, and the batch goes out
 * when the burst pauses — or after `maxWaitMs` at the latest, so a steady
 * stream still shows its changes. A refetch already running is left to finish.
 *
 * Only `invalidateQueries` goes through here. Anything that has to read the
 * cache at the moment of the event (a creature cheering for a ticked task)
 * still uses the real client.
 */
export interface InvalidationBatch {
  invalidateQueries(filters: InvalidateQueryFilters): void;
  /** Drop what is pending (the stream closed, the family changed). */
  dispose(): void;
}

export function invalidationBatch(
  client: QueryClient,
  { delayMs = 300, maxWaitMs = 1500 }: { delayMs?: number; maxWaitMs?: number } = {},
): InvalidationBatch {
  const pending = new Map<string, InvalidateQueryFilters>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstAt = 0;

  const flush = () => {
    timer = null;
    firstAt = 0;
    const batch = [...pending.values()];
    pending.clear();
    for (const filters of batch) void client.invalidateQueries(filters, { cancelRefetch: false });
  };

  return {
    invalidateQueries(filters) {
      // A predicate has no key to collapse on; it is rare (a resync), so it
      // goes out at once, after whatever is already waiting.
      if (filters.predicate) {
        if (timer) clearTimeout(timer);
        flush();
        void client.invalidateQueries(filters, { cancelRefetch: false });
        return;
      }
      const { queryKey, exact, type, refetchType } = filters;
      pending.set(JSON.stringify([queryKey ?? null, exact ?? null, type ?? null, refetchType ?? null]), filters);

      const now = Date.now();
      if (!timer) firstAt = now;
      else clearTimeout(timer);
      timer = setTimeout(flush, Math.max(0, Math.min(delayMs, firstAt + maxWaitMs - now)));
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}
