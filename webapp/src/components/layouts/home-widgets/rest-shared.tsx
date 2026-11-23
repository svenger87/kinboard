"use client";

import { forwardRef, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import type { HomeLayoutItem } from "@/lib/layouts/types";

/**
 * Helpers for the "rest" group of Home widgets in a box (RFC-022 §3.1): the
 * fixed kinds (week overview, schedule, vehicles, stonks, creatures, photos,
 * timers, media) and the pocket-money value. A fixed widget has a layout of
 * its own that fits its box and drops detail as the box shrinks, rather than
 * overflowing it; these are the pieces they share.
 */

/** The person a per-child widget is for (RFC-022 §3.1: `options.personId`), or none. */
export function personIdOf(item: Pick<HomeLayoutItem, "options">): string | undefined {
  const id = item.options?.personId;
  return typeof id === "string" && id ? id : undefined;
}

/** A touch target on Home: at least 48px both ways, whatever the box's text size (§3.3). */
export const TOUCH = "min-h-[48px] min-w-[48px]";

/**
 * The richest arrangement that fits: `steps` arrangements, 0 the richest, and
 * the first one whose content does not overflow `ref` (an overflow-hidden
 * element whose content keeps its natural size) is the one returned. Measured
 * from what is rendered, like ListBox and useFitToBox, so every text size and
 * every engine counts the same; the steps are tried in layout effects, before
 * the browser paints, so a box never shows an arrangement that overflows.
 *
 * Starts again from the richest whenever `deps` change (the box, the data,
 * the step count) or a web font swaps in. Keep `deps` to what changes the
 * layout -- not a ticking clock -- so a running timer does not re-fit every
 * second on the Pi.
 */
export function useShrinkStep(ref: RefObject<HTMLElement | null>, steps: number, deps: unknown[]): number {
  const [step, setStep] = useState(0);
  const reset = useRef(false);

  useLayoutEffect(() => {
    reset.current = true;
    setStep(0);
    let live = true;
    document.fonts?.ready
      .then(() => {
        if (!live) return;
        reset.current = true;
        setStep(0);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, ...deps]);

  // After every render, deliberately: the step only ever moves forward and
  // stops at the last, so the chain ends after at most `steps` renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (reset.current) {
      // This commit carried the reset: measure on the next one, at step 0.
      reset.current = false;
      if (step !== 0) return;
    }
    const el = ref.current;
    if (!el || step >= steps - 1) return;
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
      setStep((s) => Math.min(s + 1, steps - 1));
    }
  });

  return Math.min(step, Math.max(0, steps - 1));
}

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
 * so the arrangements are measured at the box's own size first.
 */
export function CapFit({ box, active, deps, children }: { box: { width: number; height: number }; active: boolean; deps: unknown[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pad = boxPadding(box);
  const fit = useFitToBox(ref, { width: box.width - 2 * pad, height: box.height - 2 * pad }, [active, ...deps]);
  const [cap, setCap] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (el) setCap(parseFloat(getComputedStyle(el).fontSize) || null);
  }, [box.width, box.height]);
  const size = active && fit !== null && cap !== null ? Math.min(fit, cap) : undefined;
  return (
    <div ref={ref} className={active ? "w-fit max-w-none shrink-0" : "min-w-0"} style={size ? { fontSize: size } : undefined} data-cap-fit={active || undefined}>
      {children}
    </div>
  );
}

/** The card's padding: it follows the box, not the text, so a small box keeps its room for content. */
export function boxPadding(box: { width: number; height: number }): number {
  return Math.max(6, Math.min(16, Math.round(Math.min(box.width, box.height) * 0.08)));
}

/**
 * A Home widget's card, filling its box exactly: the app's card (light and
 * dark from the theme), clipped, with the padding of boxPadding. The ref is
 * what useShrinkStep measures, so the content inside must keep its natural
 * size (no flex-shrink to nothing) for an overflow to show.
 */
export const BoxCard = forwardRef<
  HTMLDivElement,
  { box: { width: number; height: number }; className?: string; children: ReactNode; testId?: string; step?: number }
>(function BoxCard({ box, className, children, testId, step }, ref) {
  return (
    <Card
      ref={ref}
      className={cn("accent-border-top flex size-full flex-col overflow-hidden", className)}
      style={{ padding: boxPadding(box) }}
      data-fills-box
      data-testid={testId}
      data-step={step}
    >
      {children}
    </Card>
  );
});

/**
 * A card's heading: its icon and title, linking to the widget's page as the
 * card titles do today. The link is the whole row and at least 48px tall.
 */
export function BoxHeader({
  icon: Icon,
  title,
  href,
  ariaLabel,
  right,
}: {
  icon: LucideIcon;
  title: string;
  href?: string;
  ariaLabel?: string;
  right?: ReactNode;
}) {
  const inner = (
    <>
      <span className="icon-badge shrink-0 !p-[0.3em]">
        <Icon className="size-[1em]" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0 truncate font-display font-semibold leading-tight">{title}</span>
    </>
  );
  return (
    <div className="flex shrink-0 items-center gap-[0.4em]" data-box-header>
      {href ? (
        <Link
          href={href}
          aria-label={ariaLabel}
          className={`flex min-h-[48px] min-w-0 flex-1 items-center gap-[0.5em] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
        >
          {inner}
        </Link>
      ) : (
        <div className="flex min-h-[48px] min-w-0 flex-1 items-center gap-[0.5em]">{inner}</div>
      )}
      {right != null && <div className="flex shrink-0 items-center gap-[0.3em]">{right}</div>}
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
      className="flex min-h-[48px] shrink-0 items-center text-[0.8em] font-medium text-muted-foreground hover:text-foreground"
      data-testid="box-more"
    >
      {t("more", { count })}
    </Link>
  );
}

/**
 * What a widget shows when its feature is off or has nothing yet: the
 * dashboard's discover card, as a box. The whole box is one link to where
 * it is set up, so it is a target of any size; the description goes first
 * when the box is small.
 */
export function SetUpBox({
  box,
  icon: Icon,
  title,
  description,
  href,
  testId,
}: {
  box: { width: number; height: number };
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  testId?: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const step = useShrinkStep(ref, 2, [box.width, box.height, title, description]);
  return (
    <Link
      ref={ref}
      href={href}
      className="flex size-full items-start gap-[0.6em] overflow-hidden rounded-2xl border border-dashed border-month-primary/30 bg-month-primary/5 text-card-foreground"
      style={{ padding: boxPadding(box) }}
      data-testid={testId ?? "box-set-up"}
      data-step={step}
    >
      <span className="shrink-0 rounded-lg bg-month-primary/10 p-[0.35em]">
        <Icon className="size-[1em] text-month-primary" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.85em] font-medium">{title}</span>
        {step === 0 && <span className="text-[0.7em] leading-snug text-muted-foreground">{description}</span>}
      </span>
    </Link>
  );
}
