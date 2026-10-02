"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, PresenceContext, useReducedMotion } from "framer-motion";
import { useKioskMode } from "@/hooks";

export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const { isKioskMode } = useKioskMode();

  // Reduced motion: no animation. Kiosk: opacity-only (ARM GPU).
  // Otherwise: 320ms fade + 8px y-rise.
  const yEnter = reduce || isKioskMode ? 0 : 8;
  const duration = reduce ? 0 : 0.32;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: reduce ? 1 : 0, y: yEnter }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: reduce ? 1 : 0, y: 0 }}
        transition={{ duration, ease: [0.2, 0.6, 0.2, 1] }}
      >
        {/* The page fades as a whole, so nothing inside it takes part in the
            route's exit. A Reorder.Item is a layout component: it registers
            with the nearest presence and, on the way out, never reports that
            it is done. With mode="wait" the old page's fade-out then finished
            but the next page's wrapper never mounted, and the new route
            rendered inside the old one at opacity 0 -- after leaving Settings
            -> Widgets or Settings -> Navigation, every page was blank until a
            reload. Cutting the context here keeps anything on a page from
            holding up navigation. */}
        <PresenceContext.Provider value={null}>{children}</PresenceContext.Provider>
      </motion.div>
    </AnimatePresence>
  );
}
