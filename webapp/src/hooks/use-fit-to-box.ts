"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * The font size (px) at which `target` just fits a box of `box` size, in both
 * width and height; null before the first measurement.
 *
 * Same rules as useFitToWidth: text scales linearly with its font size, so the
 * size it renders at now and the size it measures now give the size that fits,
 * size × box ÷ measured, whichever axis is tighter. Read from what is rendered,
 * never from a probe. The target must measure as its content (inline-block or
 * w-fit), not as the box it sits in. It is observed too, so a web font
 * swapping in measures again, and a change of one pixel to a size already
 * fitted is ignored so the size cannot flip between two values at a boundary.
 * Measured again whenever `deps` change.
 */
export function useFitToBox(
  target: RefObject<HTMLElement | null>,
  box: { width: number; height: number },
  deps: unknown[],
): number | null {
  const [size, setSize] = useState<number | null>(null);
  const { width, height } = box;

  useLayoutEffect(() => {
    const el = target.current;
    if (!el || width <= 0 || height <= 0) {
      setSize(null);
      return;
    }
    const measure = () => {
      const current = parseFloat(getComputedStyle(el).fontSize);
      const rect = el.getBoundingClientRect();
      const nowW = rect.width;
      const nowH = rect.height;
      if (!(current > 0) || nowW <= 0 || nowH <= 0) return;
      const fit = Math.floor(Math.min((current * width) / nowW, (current * height) / nowH));
      if (fit < 1) return;
      setSize((prev) => (prev !== null && Math.abs(prev - fit) <= 1 ? prev : fit));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    let live = true;
    document.fonts?.ready.then(() => live && measure()).catch(() => undefined);
    return () => {
      live = false;
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, width, height, ...deps]);

  return size;
}
