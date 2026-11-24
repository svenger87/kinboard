"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isRemoteImage } from "@/lib/recipe-image-keep";

/**
 * Rows whose picture still lives on someone else's server are brought onto
 * ours, in the background, the first time a page shows them
 * (lib/recipe-image-keep.ts says why).
 *
 * One at a time, each row once per page load: a page of forty recipes is
 * forty small requests in a row, not forty downloads at once. A row whose
 * picture could not be fetched keeps its address and is shown from there,
 * as before.
 */
const asked = new Set<string>();
let chain: Promise<void> = Promise.resolve();

export function useKeepRemoteImages(
  kind: "recipe" | "device" | "shopping" | "goal",
  rows: readonly { id: string; image_url?: string | null }[] | null | undefined,
  /** Query keys to refetch once something was kept. */
  invalidate: readonly unknown[],
): void {
  const queryClient = useQueryClient();
  const pending = (rows ?? []).filter((row) => isRemoteImage(row.image_url) && !asked.has(`${kind}:${row.id}`)).map((row) => row.id);
  const signature = pending.join(",");

  useEffect(() => {
    if (!signature) return;
    let keptAny = false;
    for (const id of signature.split(",")) {
      if (asked.has(`${kind}:${id}`)) continue;
      asked.add(`${kind}:${id}`);
      chain = chain.then(async () => {
        try {
          const response = await fetch("/api/recipes/keep-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, kind }),
          });
          if (response.ok && ((await response.json()) as { kept?: boolean }).kept) keptAny = true;
        } catch {
          // Offline or unreachable: asked again on the next page load.
          asked.delete(`${kind}:${id}`);
        }
      });
    }
    void chain.then(() => {
      if (keptAny) void queryClient.invalidateQueries({ queryKey: invalidate });
    });
    // `invalidate` is a literal at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, kind, queryClient]);
}
