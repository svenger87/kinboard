"use client";

import { useEffect } from "react";

// Auto-reload once when the browser hits a stale-bundle chunk error,
// which happens when:
//   - the webapp container was recreated (Watchtower auto-update,
//     manual `start.sh up`, or release deploy) while a tab held the
//     old build's bootstrap.js
//   - the user clicks a route whose JS chunk was renamed by the new
//     build, so the old bootstrap requests a chunk that doesn't exist
//     in the new container (-> 404 -> ChunkLoadError)
//
// Without this, the user sees a cryptic console error and broken
// navigation. With it, they see a brief flash + a fresh load on the
// new build. The sessionStorage guard prevents reload loops if the
// reload itself produces a chunk error (would mean the deploy is
// genuinely broken, in which case looping makes it worse).

const RELOADED_KEY = "kinboard-chunk-reloaded-once";

const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk \d+ failed/i,
  /Loading CSS chunk \d+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
];

function looksLikeChunkError(message: unknown): boolean {
  if (typeof message !== "string") {
    if (message instanceof Error) message = message.message;
    else return false;
  }
  return CHUNK_ERROR_PATTERNS.some((p) => p.test(message as string));
}

export function ChunkErrorRecovery() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (looksLikeChunkError(event.error?.message ?? event.message)) {
        recoverOnce();
      }
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { message?: string } | string | undefined;
      const msg = typeof reason === "string" ? reason : reason?.message;
      if (looksLikeChunkError(msg)) {
        recoverOnce();
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

function recoverOnce() {
  try {
    if (sessionStorage.getItem(RELOADED_KEY)) return;
    sessionStorage.setItem(RELOADED_KEY, "1");
  } catch {
    // sessionStorage blocked — proceed anyway; one reload is still
    // better than a frozen UI.
  }
  // Clear the SW caches so the reload picks up the new chunks instead
  // of bouncing off the same stale ones from the cache.
  if (typeof caches !== "undefined") {
    caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .finally(() => window.location.reload());
  } else {
    window.location.reload();
  }
}
