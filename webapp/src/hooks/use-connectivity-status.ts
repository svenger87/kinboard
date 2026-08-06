"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

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
 */
export function useErroredQueryCount(): number {
  const queryClient = useQueryClient();
  const [count, setCount] = useState(0);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const read = () => {
      const n = cache
        .getAll()
        .filter((q) => q.state.status === "error" && q.getObserversCount() > 0).length;
      setCount(n);
    };
    read();
    const unsubscribe = cache.subscribe(read);
    return () => unsubscribe();
  }, [queryClient]);

  return count;
}
