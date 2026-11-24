"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import type { LayoutItem } from "@/lib/layouts/types";
import { alignOf } from "@/lib/layouts/align";
import { SectionLabel } from "@/components/screensaver-rows";

/**
 * What every screensaver widget is given: its item on the layout, the box it
 * is drawn in (whole pixels, from LayoutGrid) and whether the designer is
 * showing it. Text sizes come from the box's font size, so sizes inside a
 * widget are in em.
 */
export interface SaverWidgetProps {
  item: LayoutItem;
  box: { width: number; height: number };
  editing?: boolean;
}

/** The one-line hint a widget shows in the designer when its feature is not set up. */
export function NotSetUp({ text }: { text: string }) {
  return (
    <div className="flex size-full items-center justify-center p-[0.5em]">
      <p className="max-w-full truncate text-[0.8em] text-white/60" title={text} data-testid="saver-widget-not-set-up">
        {text}
      </p>
    </div>
  );
}

/** The "+n more" line under a clipped list; stable, as ListBox measures again when it changes. */
export function useMoreLabel() {
  const t = useTranslations("components.layouts");
  return useCallback((count: number) => t("more", { count }), [t]);
}

/** A list widget: its heading, then the list in the rest of the box. */
export function ListFrame({ icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex size-full flex-col gap-[0.5em]">
      <SectionLabel icon={icon} label={label} scale="box" />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** A list with nothing in it. */
export function EmptyLine({ text }: { text: string }) {
  return <p className="text-[0.8em] text-white/50">{text}</p>;
}

/** Room under each row of a list (ListBox's gap is in pixels; this follows the text size). */
export function RowGap({ children }: { children: ReactNode }) {
  return <div className="pb-[0.4em]">{children}</div>;
}

/**
 * A value widget's frame: the value placed across the box as alignOf says
 * (to the edge it touches, centred, or set in the inspector), centred
 * vertically, hidden until it has been fitted once so it does not flash at
 * the box's own size first.
 */
export function ValueFrame({ item, fitted, children }: { item: LayoutItem; fitted: boolean; children: ReactNode }) {
  const align = alignOf(item);
  const justify = align === "end" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <div className={`flex size-full items-center ${justify}`} data-align={align} style={fitted ? undefined : { visibility: "hidden" }}>
      {children}
    </div>
  );
}

/**
 * The energy and Tesla card: it fills its box (so its edges are the grid's),
 * and the figures inside sit side by side in a wide, flat box and stacked
 * otherwise. They are drawn at the box's text size (S to XL) and only made
 * smaller when the box is too small for them, so a card can be as small as
 * one line of figures without running out of it.
 */
export function FittedCard({ box, deps, children }: { box: { width: number; height: number }; deps: unknown[]; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const wide = box.width >= box.height * 2;
  // The card's padding follows the box, not the text, so the room left for the figures is known before they are fitted.
  const pad = Math.max(4, Math.round(Math.min(box.width, box.height) * 0.12));
  const fit = useFitToBox(content, { width: box.width - 2 * pad, height: box.height - 2 * pad }, [wide, ...deps]);
  // The text size the box was given: the figures are never drawn larger than that.
  const [cap, setCap] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (el) setCap(parseFloat(getComputedStyle(el).fontSize) || null);
  }, [box.width, box.height]);
  const size = fit !== null && cap !== null ? Math.min(fit, cap) : null;
  return (
    <div
      ref={root}
      className="flex size-full items-center justify-center overflow-hidden rounded-[0.75em] screensaver-panel gpu-blur"
      style={{ padding: pad }}
      data-fills-box
      data-wide={wide}
    >
      <div
        ref={content}
        data-fitted-content
        className={`flex w-fit shrink-0 ${wide ? "flex-row items-center gap-[1.25em]" : "flex-col gap-[0.75em]"}`}
        style={size !== null ? { fontSize: size } : { visibility: "hidden" }}
      >
        {children}
      </div>
    </div>
  );
}
