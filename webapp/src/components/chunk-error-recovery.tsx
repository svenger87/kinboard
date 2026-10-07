"use client";

import { useEffect } from "react";
import { isChunkLoadError, recoverFromStaleBundle } from "@/lib/stale-bundle";

// Reload onto the new build when a page still running the old one hits a
// chunk that no longer exists — after the webapp was recreated (a release,
// Diun's self-update, `start.sh up`) while this page held the old bundle.
//
// This catches the chunk errors nothing else did: a failed dynamic import
// outside rendering, a rejected promise. A chunk error during navigation is
// caught by the App Router error boundaries (error.tsx, global-error.tsx)
// and never reaches these listeners — they call the same recovery
// themselves. See src/lib/stale-bundle.ts for the guard against loops.

export function ChunkErrorRecovery() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) {
        recoverFromStaleBundle();
      }
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) {
        recoverFromStaleBundle();
      }
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);
  return null;
}
