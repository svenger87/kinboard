"use client";

import { useCallback, type ReactNode } from "react";
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
