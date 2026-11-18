"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * The font size (px) at which `target` just fits a box of `box` size, in both
 * width and height; null before the first measurement.
 *
 * Same rules as useFitToWidth: text scales linearly with its font size, so the
 * size it renders at now and the size it measures now give the size that fits,
 * size × box ÷ measured, whichever axis is tighter. Read from what is rendered,
 * never from a probe, and in layout pixels, so a scaled-down canvas fits the
 * same. The target must measure as its content (inline-block or w-fit), not
 * as the box it sits in. It is observed too, so a web font
 * swapping in measures again. Measured again whenever `deps` change.
 */
/**
 * The size to render next, given the one rendered and the one that fits now.
 * Growing by a single pixel is ignored, so the size cannot flip between two
 * values at a boundary (n fits, n + 1 measures one pixel too big, back to n).
 * Shrinking always happens: keeping a size one pixel too large let the date
 * run 8px out of its box on a 1920px screen, cut off by the box.
 */
export function nextFitSize(prev: number | null, fit: number): number {
  return prev !== null && fit === prev + 1 ? prev : fit;
}

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
      // The layout size, not getBoundingClientRect: inside the designer's
      // canvas, which is scaled down with a transform, the rect is the scaled
      // size and the text would be fitted that many times too large. The
      // computed width and height keep fractions; offsetWidth/Height (whole
      // pixels) are the fallback for an element whose computed size is auto.
      const style = getComputedStyle(el);
      const current = parseFloat(style.fontSize);
      const nowW = parseFloat(style.width) || el.offsetWidth;
      const nowH = parseFloat(style.height) || el.offsetHeight;
      if (!(current > 0) || nowW <= 0 || nowH <= 0) return;
      const fit = Math.floor(Math.min((current * width) / nowW, (current * height) / nowH));
      if (fit < 1) return;
      setSize((prev) => nextFitSize(prev, fit));
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
