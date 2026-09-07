"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

/**
 * Counts data queries currently in an error state.
 *
 * The dashboard needs a single, page-level answer to "is the backend actually
 * reachable?". Individual widgets each know their own query failed, but none of
 * them could tell that *everything* had failed — so a total outage rendered as a
 * page full of independently-plausible empty states rather than one clear
 * problem (audit KB-05).
 *
 * Deliberately counts only settled errors, so a single flaky request or a
 * realtime reconnect does not raise a banner. The caller decides the threshold.
 *
 * `useSyncExternalStore`, not `useState` + `useEffect`. The query cache notifies
 * its subscribers *synchronously*, and one of the things that notifies it is a
 * component mounting an observer — which happens during that component's
 * render. Calling `setCount` from the subscription therefore set state on
 * whoever owns this hook in the middle of somebody else's render:
 *
 *   Cannot update a component (`ConnectivityBanner`) while rendering a
 *   different component (`ScheduleWidget`).
 *
 * That is what `useSyncExternalStore` exists for: React drives the read itself
 * and schedules the update rather than being told about it mid-render.
 */
function countErroredQueries(queryClient: QueryClient): number {
  return queryClient
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.status === "error" && q.getObserversCount() > 0).length;
}

export function useErroredQueryCount(): number {
  const queryClient = useQueryClient();

  const subscribe = useCallback(
    (onStoreChange: () => void) => queryClient.getQueryCache().subscribe(onStoreChange),
    [queryClient],
  );

  const getSnapshot = useCallback(() => countErroredQueries(queryClient), [queryClient]);

  // The server renders no query cache, and a banner that flashed on hydration
  // and vanished would be worse than one that arrives a tick late.
  const getServerSnapshot = useCallback(() => 0, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
