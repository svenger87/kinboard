"use client";

import { useEffect, useState } from "react";

/**
 * True when the page is running as an installed app rather than a browser tab.
 *
 * This matters because the shopping list ships its own manifest
 * (`/manifest-shopping.json`) scoped to `/einkaufen`. Anything that navigates
 * outside that scope drops the user out of the installed app and into the main
 * Kinboard PWA — which is exactly what a "back to the dashboard" control does
 * when there is no dashboard to go back to. Inside the installed app the
 * shopping list *is* the app, so those affordances have to disappear.
 *
 * `display-mode: standalone` covers Chrome/Edge/Android and desktop installs;
 * `navigator.standalone` is the iOS Safari equivalent, which never implemented
 * the media query. `minimal-ui` and `fullscreen` are treated as installed too:
 * they are launch modes an installed app can be given, and in all of them the
 * browser chrome that would let someone navigate back is absent.
 *
 * Starts false and resolves after mount, so server and first client render
 * agree; a launch mode cannot be known during SSR.
 */
export function useIsStandalone(): boolean {
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const queries = ["standalone", "minimal-ui", "fullscreen"].map((mode) =>
      window.matchMedia(`(display-mode: ${mode})`),
    );

    const sync = () =>
      setIsStandalone(
        queries.some((q) => q.matches) ||
          // iOS Safari, which has no display-mode support.
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
      );

    sync();
    // Desktop browsers can move a page between tab and installed window without
    // a reload, so this has to stay live rather than being read once.
    queries.forEach((q) => q.addEventListener("change", sync));
    return () => queries.forEach((q) => q.removeEventListener("change", sync));
  }, []);

  return isStandalone;
}
