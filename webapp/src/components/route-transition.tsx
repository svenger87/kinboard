"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
