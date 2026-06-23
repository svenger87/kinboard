"use client";

import { usePathname } from "next/navigation";
import { useKioskMode } from "@/hooks";
import { isNoNavPath } from "@/lib/constants";
import { MobileNav } from "@/components/mobile-nav";
import { DesktopNav } from "@/components/desktop-nav";
import { KioskStatusBar } from "@/components/kiosk-status-bar";

/**
 * Picks the global chrome: in kiosk mode show the top status line and NO
 * bottom navigation (navigation happens via widgets + swipe). Otherwise show
 * the mobile + desktop navs exactly as before. Routes in NO_NAV_PATHS get
 * neither.
 */
export function ShellChrome() {
  const { isKioskMode } = useKioskMode();
  const pathname = usePathname();

  if (isNoNavPath(pathname)) {
    return null;
  }

  if (isKioskMode) {
    return <KioskStatusBar />;
  }

  return (
    <>
      <MobileNav />
      <DesktopNav />
    </>
  );
}
