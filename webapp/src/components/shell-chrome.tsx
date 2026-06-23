"use client";

import { usePathname } from "next/navigation";
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
