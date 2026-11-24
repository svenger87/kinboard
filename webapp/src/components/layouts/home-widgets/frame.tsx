"use client";

import { forwardRef, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { alignOf } from "@/lib/layouts/align";
import type { HomeLayoutItem } from "@/lib/layouts/types";
import { cn } from "@/lib/utils";

/**
 * The one frame and the one type scale of every Home widget in a box
 * (RFC-022). Everything here follows the box's text size (S to XL, the
 * box's font size, which LayoutGrid also hands down as --kb-em in px), and
 * at M it is today's Home card, measured from the built-in Home: an 18px
 * title in a 40px icon badge (a 20px icon in 10px of padding), 16px
 * padding and a 16px corner, 14px body text and 13px meta text.
 *
 * Text sizes are the roles in globals.css (`home-title`, `home-body`,
 * `home-meta`, `home-label`, `home-value`, `home-display`), named in HOME_TEXT
 * below; a widget's own file never sets a font size of its own
 * (e2e/home-frame.spec.ts), so two boxes at the same text size look alike.
 * Touch targets stay 48px whatever the text size (§3.3).
 */

/** The text roles, as class names. */
export const HOME_TEXT = {
  /** A card's title: 18px at M (today's text-lg). */
  title: "home-title",
  /** Entries, empty lines, set-up hints: 14px at M (text-sm). */
  body: "home-body",
  /** Times, counts, second lines: 13px at M (text-xs on a wall). */
  meta: "home-meta",
  /** Small capitals: weekday heads, units, badges: 13px at M, the smallest text on a wall (KB-56). */
  label: "home-label",
  /** A figure that stands out in a card: 24px at M. */
  value: "home-value",
  /** The one large figure of a card (a temperature, a charge): 36px at M. */
  display: "home-display",
} as const;

/** A card's icon: 20px at M (size-5). */
export const HOME_ICON = "home-icon";

/**
 * The smallest a line of text is ever drawn, in em of the box's text: the
 * meta role. A widget fitting its content to a box smaller than its
 * minimum leaves a line out rather than draw it below this
 * (e2e/home-frame.spec.ts checks every text on screen).
 */
export const HOME_TEXT_FLOOR_EM = 0.72;

/** Sizes of the value widgets, in em of the box's text: today's Home's date (15px) and greeting (16px) under 18px titles. */
export const HOME_VALUE_EM = { date: 0.83, greeting: 0.89 } as const;

/** The card's padding, corner and the gap under its title row, in em: 16px at M, as today's cards. */
export const HOME_PAD_EM = 0.89;

/**
 * A text field in a dialog a widget opens over the layout: the app's own
 * 16px (no zoom on a phone), not the box's scale, since the dialog is not in the box.
 */
export const HOME_DIALOG_INPUT = "text-base";

/** A touch target's height: 48px at least, whatever the text size. */
export const HOME_TARGET_H = "min-h-[48px]";

/** The card's padding in px for a box drawn at `em` px. */
export function homePadPx(em: number): number {
  return Math.round(HOME_PAD_EM * em);
}

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

/** The icon in its badge, as today's cards draw it. */
export function HomeIconBadge({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-[0.67em] bg-primary/10 p-[0.56em] text-primary", className)}>
      <Icon className={HOME_ICON} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

/**
 * A card's title row: icon badge, title, then an optional badge (a count)
 * and a chevron when it leads somewhere; `right` sits after it (the header's
 * own buttons, a "+n"). The row is a link to `href`, a button running
 * `onOpen`, or plain; at least 48px tall either way.
 */
export function HomeCardHeader({
  icon,
  title,
  href,
  onOpen,
  openLabel,
  badge,
  right,
}: {
  icon: LucideIcon;
  title: string;
  href?: string;
  onOpen?: () => void;
  /** The title target's accessible name, when it says more than the title. */
  openLabel?: string;
  badge?: ReactNode;
  right?: ReactNode;
}) {
  const inner = (
    <>
      <HomeIconBadge icon={icon} />
      <span className={`${HOME_TEXT.title} min-w-0 truncate text-left font-display font-semibold leading-tight`}>{title}</span>
      {badge != null && <span className="shrink-0">{badge}</span>}
      {(href || onOpen) && <ChevronRight className="size-[0.89em] shrink-0 text-muted-foreground" aria-hidden="true" />}
    </>
  );
  // The row is as tall as the icon badge (40px at M, as today's cards); its
  // 48px target reaches 4px into the card's padding above and below.
  const row = `${HOME_TARGET_H} -my-[4px] flex min-w-0 flex-1 items-center gap-[0.67em] rounded-[0.5em]`;
  const live = `${row} transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`;
  return (
    <header className="flex shrink-0 items-center gap-[0.3em]" data-box-header>
      {href ? (
        <Link href={href} aria-label={openLabel} className={live} data-home-list-title>
          {inner}
        </Link>
      ) : onOpen ? (
        <button type="button" onClick={onOpen} aria-label={openLabel} className={live} data-home-list-title>
          {inner}
        </button>
      ) : (
        <div className={row} data-home-list-title>
          {inner}
        </div>
      )}
      {right != null && <div className="flex shrink-0 items-center gap-[0.3em]">{right}</div>}
    </header>
  );
}

/** Today's card surface, corner and padding, for a widget whose whole box is one link (pocket money) and so cannot nest HomeCard's own. */
export const HOME_CARD_SURFACE =
  "accent-border-top overflow-hidden rounded-[0.89em] border border-border bg-card p-[0.89em] text-card-foreground elev-md";
/** The card's corner alone (a photo filling its box, a link around a card). */
export const HOME_CARD_CORNER = "rounded-[0.89em]";

export interface HomeCardProps {
  /** With an icon and a title the card draws its title row (HomeCardHeader) and puts `children` in a body under it. */
  icon?: LucideIcon;
  title?: string;
  href?: string;
  onOpen?: () => void;
  openLabel?: string;
  badge?: ReactNode;
  right?: ReactNode;
  /** In the designer the card is inert: arranging a box must not tick anything off or open anything. */
  editing?: boolean;
  testId?: string;
  /** A fixed widget's arrangement (useShrinkStep), for the probes. */
  step?: number;
  /** A list card (data-home-list). */
  list?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * The card every Home widget fills its box with: today's card surface (the
 * app's card, border, shadow and accent line), its corner and padding,
 * clipped to the box. The ref is the card itself, which a fixed widget's
 * useShrinkStep measures; without a title row the children are its direct
 * content and must keep their natural size for an overflow to show.
 */
export const HomeCard = forwardRef<HTMLDivElement, HomeCardProps>(function HomeCard(
  { icon, title, href, onOpen, openLabel, badge, right, editing, testId, step, list, className, bodyClassName, children },
  ref,
) {
  const header = icon && title != null;
  return (
    <div
      ref={ref}
      data-testid={testId}
      data-home-card
      data-home-list={list || undefined}
      data-fills-box
      data-step={step}
      inert={editing || undefined}
      className={cn(HOME_CARD_SURFACE, "flex size-full flex-col gap-[0.56em]", className)}
    >
      {header ? (
        <>
          <HomeCardHeader icon={icon} title={title} href={href} onOpen={onOpen} openLabel={openLabel} badge={badge} right={right} />
          <div className={cn("flex min-h-0 flex-1 flex-col", bodyClassName)}>{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
});

/**
 * What a widget shows when its feature is off or has nothing yet: today's
 * discover card, as a box. The whole box is one link to where it is set
 * up, so it is a target of any size; the description goes when the box is
 * too small for it. Body and meta text, as every card.
 */
export const HomeSetUp = forwardRef<
  HTMLAnchorElement,
  { icon: LucideIcon; title: string; description: string; href: string; testId?: string; compact?: boolean }
>(function HomeSetUp({ icon: Icon, title, description, href, testId, compact }, outer) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const step = useShrinkStep(ref, compact ? 1 : 2, [title, description]);
  const short = compact || step > 0;
  return (
    <Link
      ref={(el) => {
        ref.current = el;
        if (typeof outer === "function") outer(el);
        else if (outer) outer.current = el;
      }}
      href={href}
      className="flex size-full items-start gap-[0.67em] overflow-hidden rounded-[0.89em] border border-dashed border-month-primary/30 bg-month-primary/5 p-[0.89em] text-card-foreground"
      data-testid={testId ?? "box-set-up"}
      data-step={short ? 1 : 0}
    >
      <span className="shrink-0 rounded-[0.67em] bg-month-primary/10 p-[0.56em]">
        <Icon className={`${HOME_ICON} text-month-primary`} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`${HOME_TEXT.title} truncate font-display font-semibold leading-tight`}>{title}</span>
        {!short && <span className={`${HOME_TEXT.meta} leading-snug text-muted-foreground`}>{description}</span>}
      </span>
    </Link>
  );
});

/**
 * A Home value widget's frame (clock, date, greeting): the value placed
 * across the box as alignOf says, centred vertically, hidden until it has
 * been fitted once so it does not flash at the box's own size first. In the
 * designer the value is inert, so arranging a box opens no popover.
 */
export function HomeValueFrame({
  item,
  fitted,
  editing,
  testId,
  frameRef,
  shrunk,
  children,
}: {
  item: HomeLayoutItem;
  fitted: boolean;
  editing?: boolean;
  testId: string;
  /** The frame itself: its font size is the box's text size. */
  frameRef?: RefObject<HTMLDivElement | null>;
  /** Drawn smaller than its text size, because the box is too small for it (data-fit, for the probes). */
  shrunk?: boolean;
  children: ReactNode;
}) {
  const align = alignOf(item);
  const justify = align === "end" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <div
      ref={frameRef}
      data-testid={testId}
      data-align={align}
      data-fit={shrunk === undefined ? undefined : shrunk ? "shrunk" : "full"}
      inert={editing || undefined}
      className={`flex size-full items-center ${justify} text-foreground`}
      style={fitted ? undefined : { visibility: "hidden" }}
    >
      {children}
    </div>
  );
}

/**
 * The font size (px) the box was given (its text size, S to XL), read from
 * what is rendered. A fixed widget is drawn at that size and only made
 * smaller when the box is too small for it.
 */
export function useBoxFontSize(ref: RefObject<HTMLElement | null>, box: { width: number; height: number }): number | null {
  const [px, setPx] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setPx(parseFloat(getComputedStyle(el).fontSize) || null);
  }, [ref, box.width, box.height]);
  return px;
}

/**
 * A value drawn at its text size, `em` of the box's (Home's date and
 * greeting, as today's Home draws them under the clock), made smaller only
 * when the box is too small for it. Returns the font size to draw at (null
 * until measured) and whether it had to shrink.
 */
export function useCappedFit(
  frame: RefObject<HTMLElement | null>,
  target: RefObject<HTMLElement | null>,
  box: { width: number; height: number },
  em: number,
  deps: unknown[],
): { size: number | null; shrunk: boolean; dropped: boolean } {
  const cap = useBoxFontSize(frame, box);
  const fit = useFitToBox(target, box, [cap, ...deps]);
  if (fit === null || cap === null) return { size: null, shrunk: false, dropped: false };
  const want = cap * em;
  // A pixel or two under is not "shrunk": a box may come up a pixel short (stepsFor), and fitting rounds down.
  // Below the meta role's size the line is not drawn at all (`dropped`).
  return { size: Math.min(fit, want), shrunk: fit < want * 0.95, dropped: fit < cap * HOME_TEXT_FLOOR_EM };
}
