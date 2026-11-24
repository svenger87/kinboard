"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import type { HomeLayoutItem } from "@/lib/layouts/types";
import { HOME_TEXT_FLOOR_EM } from "./frame";

/**
 * Helpers for the "rest" group of Home widgets in a box (RFC-022 §3.1): the
 * fixed kinds (week overview, schedule, vehicles, stonks, creatures, photos,
 * timers, media) and the pocket-money value. A fixed widget has a layout of
 * its own that fits its box and drops detail as the box shrinks, rather than
 * overflowing it; these are the pieces they share. Their card, title row
 * and set-up prompt are frame.tsx's, as every Home widget's.
 */

/** The person a per-child widget is for (RFC-022 §3.1: `options.personId`), or none. */
export function personIdOf(item: Pick<HomeLayoutItem, "options">): string | undefined {
  const id = item.options?.personId;
  return typeof id === "string" && id ? id : undefined;
}

/** A touch target on Home: at least 48px both ways, whatever the box's text size (§3.3). */
export const TOUCH = "min-h-[48px] min-w-[48px]";

export { useShrinkStep } from "./frame";

/** The box's text size in px (its font size, set by LayoutGrid from the item's S–XL); 16 until measured. */
export function useEm(ref: RefObject<HTMLElement | null>): number {
  const [em, setEm] = useState(16);
  // After every render: the element may mount only once data has arrived
  // (a widget shows a placeholder first), and reading one style is cheap.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px > 0) setEm((prev) => (prev === px ? prev : px));
  });
  return em;
}

/**
 * The last resort of a fixed widget whose barest arrangement still does not
 * fit (a figure at XL in a minimum box): its content drawn smaller, never
 * larger than the box's text size. Off (`active` false) it changes nothing,
 * so the arrangements are measured at the box's own size first. It fits the
 * room its parent leaves it (the card's body, under the title row), so the
 * title row is never part of what shrinks.
 */
export function CapFit({ box, active, deps, children }: { box: { width: number; height: number }; active: boolean; deps: unknown[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    setCap(parseFloat(getComputedStyle(el).fontSize) || null);
    setRoom((prev) => (prev.width === el.clientWidth && prev.height === el.clientHeight ? prev : { width: el.clientWidth, height: el.clientHeight }));
  }, [box.width, box.height, active]);
  const fit = useFitToBox(ref, { width: room.width - 1, height: room.height - 1 }, [active, cap, ...deps]);
  const size = active && fit !== null && cap !== null ? Math.min(fit, cap) : undefined;
  // The text roles read --kb-em, so it shrinks with the content; but never
  // below the meta role's size at the box's: then the content is left out.
  const dropped = size !== undefined && cap !== null && size < cap * HOME_TEXT_FLOOR_EM;
  const style = size ? ({ fontSize: size, "--kb-em": `${size}px`, visibility: dropped ? "hidden" : undefined } as CSSProperties) : undefined;
  return (
    <div ref={ref} className={active ? "w-fit max-w-none shrink-0" : "min-w-0"} style={style} data-cap-fit={active || undefined}>
      {children}
    </div>
  );
}

/** "+n more" under a list the box cannot hold, linking to the widget's page (§3.3). */
export function MoreLink({ count, href }: { count: number; href: string }) {
  const t = useTranslations("components.layouts");
  if (count <= 0) return null;
  return (
    <Link
      href={href}
      className="home-body flex min-h-[48px] shrink-0 items-center font-medium text-muted-foreground hover:text-foreground"
      data-testid="box-more"
    >
      {t("more", { count })}
    </Link>
  );
}
