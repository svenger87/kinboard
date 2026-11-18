"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Font sizes (px) that make each of `targets` exactly as wide as the content
 * box of `box`, each capped by its own `max(boxWidth)`; null while `enabled`
 * is off or before the first measurement. A cap gets the box's width and
 * may read anything else it needs, such as the viewport's height.
 *
 * Measured, not computed from character counts: the clock's digits and the
 * date's words have the display font's own widths, and a date's length changes
 * from day to day. Text scales linearly with its font size, so one measurement
 * at a known size gives the size that fits. Measured again when the box
 * resizes, when the web font arrives, and whenever `deps` change (the minute,
 * the date).
 */
export function useFitToWidth(
  box: RefObject<HTMLElement | null>,
  targets: { ref: RefObject<HTMLElement | null>; max?: (width: number) => number }[],
  enabled: boolean,
  deps: unknown[],
): number[] | null {
  const [sizes, setSizes] = useState<number[] | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!enabled || !el) {
      setSizes(null);
      return;
    }
    const PROBE = 100;
    const measure = () => {
      const style = getComputedStyle(el);
      const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (width <= 0) return;
      const next = targets.map(({ ref, max }) => {
        const t = ref.current;
        if (!t) return 0;
        const before = t.style.fontSize;
        t.style.fontSize = `${PROBE}px`;
        const natural = t.getBoundingClientRect().width;
        t.style.fontSize = before;
        if (natural <= 0) return 0;
        const fit = Math.floor((PROBE * width) / natural);
        return max ? Math.min(fit, Math.floor(max(width))) : fit;
      });
      setSizes((prev) => (prev && prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // A cap may read the viewport's height, which can change with the width unchanged.
    window.addEventListener("resize", measure);
    let live = true;
    document.fonts?.ready.then(() => live && measure()).catch(() => undefined);
    return () => {
      live = false;
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // `targets` is a fresh array each render; its refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, box, ...deps]);

  return enabled ? sizes : null;
}

/** Whether the media query matches, kept current. False on the server and before mounting. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}
