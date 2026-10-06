"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { noteRoute } from "@/lib/app-start";
import { isNoNavPath } from "@/lib/constants";
import { MobileNav } from "@/components/mobile-nav";
import { DesktopNav } from "@/components/desktop-nav";

/**
 * Global chrome: the mobile bottom tab bar + desktop nav on every route
 * except NO_NAV_PATHS. Kiosk devices get the same navigation — the earlier
 * status-line-only kiosk treatment (no bottom nav) was dropped because the
 * kiosk needs the nav too. Kiosk optimizations (cursor-hide, wake-lock) still
 * apply via KioskProvider; they're independent of the nav chrome.
 */
export function ShellChrome() {
  const pathname = usePathname();
  // Ends the app's start on the first route change (lib/app-start.ts): a
  // child's own device opens on their Rewards page, but Home stays the
  // dashboard once they are in.
  useEffect(() => {
    noteRoute(pathname);
  }, [pathname]);

  if (isNoNavPath(pathname)) {
    return null;
  }

  return (
    <>
      <MobileNav />
      <DesktopNav />
    </>
  );
}
