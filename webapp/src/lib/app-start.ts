/**
 * Is the app still on the page it was opened on? (RFC-017 §8.2)
 *
 * A child's own device opens on their Rewards page instead of the dashboard
 * (lib/device-owner.ts). That is about *opening* the app -- a cold start, the
 * installed app's start_url, a reload -- and not about the Home button: a
 * child who taps Home wants the dashboard, and must get it, or the dashboard
 * could never be reached from that device at all.
 *
 * So the dashboard asks this, rather than "am I on /": the route the document
 * was loaded on (the navigation entry, which a client-side route change does
 * not touch) is "/", and the app has not been anywhere else since. ShellChrome
 * reports every route change through noteRoute(); the first one that is not
 * the document's own route ends the start for the life of the page.
 */

let leftStart = false;

/** The path the document itself was loaded on; null outside a browser. */
export function documentStartPath(): string | null {
  if (typeof window === "undefined") return null;
  let url = window.location.href;
  try {
    const entry = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
    if (entry?.name) url = entry.name;
  } catch {
    // No navigation timing: the current address is the start until a route change says otherwise.
  }
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** Called on every route change. The first route that is not the document's own ends the start. */
export function noteRoute(pathname: string): void {
  if (leftStart) return;
  const start = documentStartPath();
  if (start !== null && pathname !== start) leftStart = true;
}

/** True while the app is still on the route it was opened on, and that route is the dashboard. */
export function isAppStartAtDashboard(): boolean {
  if (leftStart) return false;
  return documentStartPath() === "/";
}

/** For tests. */
export function resetAppStart(): void {
  leftStart = false;
}
