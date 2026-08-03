"use client";

import { useEffect, useState } from "react";

/**
 * Phone-sized viewport check, used to suppress surfaces that only make
 * sense on the wall-mounted display.
 *
 * The breakpoint matches Tailwind's `md` (768px), which is the same
 * boundary every layout in the app already switches on — so "handheld"
 * here means exactly the widths where the mobile layout is in effect.
 *
 * Deliberately viewport-based rather than user-agent based: a phone in
 * landscape, a small floating window and a narrow split-screen all break
 * a full-bleed layout the same way, and none of them are the 15-inch
 * kitchen panel the screensaver was designed for.
 */
const HANDHELD_QUERY = "(max-width: 767px)";

export function useIsHandheld(): boolean {
  // Starts false so server render and first paint agree. Anything gated
  // on this is time-delayed (the screensaver needs an idle timeout to
  // elapse first), so the one-frame correction after mount is never
  // visible.
  const [isHandheld, setIsHandheld] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const query = window.matchMedia(HANDHELD_QUERY);
    const sync = () => setIsHandheld(query.matches);

    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return isHandheld;
}
