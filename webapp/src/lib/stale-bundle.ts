/**
 * Getting a page that is still running the previous build onto the new one.
 *
 * After a deploy, a page loaded before it still holds the old client bundle.
 * The first time it needs a chunk it has not loaded yet — usually on
 * navigating to a page it has not visited — it asks the server for a file the
 * new build does not have, gets a 404, and the bundler throws. Nothing on
 * that page can fix it: the old bundle will ask for the same missing file
 * every time. Only a full document load picks up the new build.
 *
 * Used from three places, because the error turns up in three: the window
 * listeners in chunk-error-recovery.tsx (a chunk error nothing caught), and
 * the App Router error boundaries error.tsx and global-error.tsx — which
 * catch it during navigation, so it never reaches the window listeners.
 */

const CHUNK_ERROR_PATTERNS = [
  // Turbopack, which builds production since Next 16:
  //   Error(`Failed to load chunk ${url} from module ${id}`), name "ChunkLoadError".
  // The name is checked first; this catches the message once something has
  // flattened the error to a string.
  /Failed to load chunk/i,
  // webpack
  /ChunkLoadError/i,
  /Loading chunk \d+ failed/i,
  /Loading CSS chunk \d+ failed/i,
  // A failed dynamic import(), in Chromium, Firefox and Safari wording.
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  // Deliberately not Safari's bare "Load failed": that is every failed fetch.
];

/**
 * Whether an error means "this page's bundle is out of date".
 *
 * Takes what the different sources hand over: an Error from a boundary, an
 * `ErrorEvent.error` or a rejection reason (anything at all), or a bare
 * message string.
 */
export function isChunkLoadError(err: unknown): boolean {
  if (typeof err === "string") return CHUNK_ERROR_PATTERNS.some((p) => p.test(err));
  if (!err || typeof err !== "object") return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return typeof message === "string" && CHUNK_ERROR_PATTERNS.some((p) => p.test(message));
}

/**
 * How long after one recovery another is refused.
 *
 * A reload that lands on a build which itself fails to load its chunks is a
 * broken deploy, and reloading into it again and again makes that worse. But
 * the guard must not be permanent: an installed iPhone app keeps one browsing
 * session for days, and a once-per-session flag left it unable to recover
 * from every deploy after the first (#383).
 */
export const RECOVERY_WINDOW_MS = 60_000;

const RECOVERED_AT_KEY = "kinboard-stale-bundle-recovered-at";

type StampStore = Pick<Storage, "getItem" | "setItem">;

/**
 * Take the one recovery allowed per window, or `false` when one ran too
 * recently. Records the attempt when it says yes.
 *
 * Per tab (sessionStorage), so one deploy reloads every open tab rather than
 * only the first to notice. No storage at all: allowed — one reload is still
 * better than a frozen page.
 */
export function claimRecovery(store: StampStore | null, now: number = Date.now()): boolean {
  if (!store) return true;
  try {
    const last = Number(store.getItem(RECOVERED_AT_KEY));
    // A stamp in the future is a clock that moved; don't let it lock us out.
    if (last > 0 && last <= now && now - last < RECOVERY_WINDOW_MS) return false;
    store.setItem(RECOVERED_AT_KEY, String(now));
  } catch {
    // Storage blocked: proceed, as above.
  }
  return true;
}

function sessionStore(): StampStore | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Hand the page to a service worker that is waiting to take over, and reload
 * once it has.
 *
 * Reloading straight after the message races activation: a page that reloads
 * too early is served by the old worker and comes back on the old build. If
 * activation never completes, reload anyway after 3 s rather than leave the
 * page where it was.
 */
export function reloadOntoWaitingWorker(waiting: ServiceWorker): void {
  const fallback = window.setTimeout(() => window.location.reload(), 3000);
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {
      window.clearTimeout(fallback);
      window.location.reload();
    },
    { once: true },
  );
  waiting.postMessage("skipWaiting");
}

/**
 * Reload onto the new build, unless a recovery already ran in the last
 * minute. Returns whether a reload is under way.
 *
 * Clears Cache Storage first, so the reload is not served the old chunks from
 * the service worker's cache. If a new service worker is already installed
 * and waiting, it is activated first and the reload follows it in.
 */
export function recoverFromStaleBundle(): boolean {
  if (typeof window === "undefined") return false;
  if (!claimRecovery(sessionStore())) return false;

  void (async () => {
    try {
      if (typeof caches !== "undefined") {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    } catch {
      // A cache we couldn't clear is no reason not to reload.
    }
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg?.waiting && navigator.serviceWorker.controller) {
        reloadOntoWaitingWorker(reg.waiting);
        return;
      }
    } catch {
      // Fall through to the plain reload.
    }
    window.location.reload();
  })();
  return true;
}

/**
 * When the guard has refused a recovery, the error pages fall back to their
 * retry countdown — but for a chunk error the retry has to be a full reload,
 * and a reload starts the page's module-scope budget from zero. This keeps
 * that budget across reloads, per tab, so a deploy that stays broken comes to
 * rest on the error page instead of reloading itself forever.
 */
const RETRY_BUDGET_KEY = "kinboard-stale-bundle-retries";

export function staleBundleRetryDelayMs(
  delays: readonly number[],
  resetAfterMs: number,
  now: number = Date.now(),
  store: StampStore | null = typeof window === "undefined" ? null : sessionStore(),
): number | null {
  let count = 0;
  try {
    const [n, at] = (store?.getItem(RETRY_BUDGET_KEY) ?? "").split(":").map(Number);
    if (n > 0 && now - at <= resetAfterMs) count = n;
  } catch {
    // No storage: every page load gets the first delay, as before.
  }
  return delays[count] ?? null;
}

export function noteStaleBundleRetry(
  resetAfterMs: number,
  now: number = Date.now(),
  store: StampStore | null = typeof window === "undefined" ? null : sessionStore(),
): void {
  try {
    const [n, at] = (store?.getItem(RETRY_BUDGET_KEY) ?? "").split(":").map(Number);
    const count = n > 0 && now - at <= resetAfterMs ? n : 0;
    store?.setItem(RETRY_BUDGET_KEY, `${count + 1}:${now}`);
  } catch {
    // As above.
  }
}
