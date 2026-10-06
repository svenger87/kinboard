"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const HIGHLIGHT = "settings-anchor-highlight";
const HIGHLIGHT_MS = 2000;
/**
 * Pages draw their sections once their data arrives; wait this long for one.
 * Two seconds was not enough on a cold load — the section arrived after the
 * hook had given up and the page simply sat at the top — and a wall tablet
 * is slower than the machine that measured it.
 */
const FIND_FOR_MS = 5000;

/**
 * Opens the settings section a URL points at: on a route change, and on
 * `hashchange` for a section of the page already open, it finds
 * `[data-setting="<hash>"]`, scrolls it under the fixed header and rings it
 * briefly. Sections often render only after their data has loaded, so the
 * lookup retries every frame for up to five seconds before giving up quietly.
 */
export function useSettingsAnchor() {
  const pathname = usePathname();

  useEffect(() => {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lit: Element | null = null;

    const unlight = () => {
      clearTimeout(timer);
      lit?.classList.remove(HIGHLIGHT);
      lit = null;
    };

    const open = () => {
      cancelAnimationFrame(frame);
      let anchor = "";
      try {
        anchor = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return; // A malformed hash (%E0%A4%A) names no section; leave the page as it is.
      }
      if (!anchor) return;
      const selector = `[data-setting="${CSS.escape(anchor)}"]`;
      const started = performance.now();

      const find = () => {
        const el = document.querySelector(selector);
        if (!el) {
          if (performance.now() - started < FIND_FOR_MS) frame = requestAnimationFrame(find);
          return;
        }
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
        unlight();
        // Restart the animation when the same section is opened twice running.
        el.classList.remove(HIGHLIGHT);
        void (el as HTMLElement).offsetWidth;
        el.classList.add(HIGHLIGHT);
        lit = el;
        timer = setTimeout(unlight, HIGHLIGHT_MS);
      };
      find();
    };

    open();
    window.addEventListener("hashchange", open);
    return () => {
      window.removeEventListener("hashchange", open);
      cancelAnimationFrame(frame);
      unlight();
    };
  }, [pathname]);
}
