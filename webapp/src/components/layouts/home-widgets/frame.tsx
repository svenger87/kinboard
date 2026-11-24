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
 * (RFC-022), measured at M from the built-in Home: an 18px title in a 40px
 * icon badge (a 20px icon in 10px of padding), 16px padding and a 16px
 * corner, 14px body text and 13px meta text.
 *
 * Two scales, deliberately:
 *
 * - The frame is the screen's, not the box's. The title row (HomeCardHeader:
 *   icon badge, title, chevron, a count, the chips and buttons beside it),
 *   the card's padding and its corner are drawn at text M for the screen
 *   whatever the box's text size (S to XL) and whatever its size, from
 *   --kb-head-em, which LayoutGrid sets on every box alongside --kb-em. The
 *   `home-head` class makes a title row's roles read it, so two boxes side by
 *   side, one at S and one at L, have the same title row on the same line.
 *   Nothing that measures a box (useFitToBox, useBoxFontSize, CapFit,
 *   useShrinkStep) reaches it: a box too small drops content, or at the very
 *   last its title row, but never draws the title row smaller.
 * - The content follows the box's text size: rows, values and body text, in
 *   the roles in globals.css (`home-body`, `home-meta`, `home-label`,
 *   `home-value`, `home-display`; `home-title` is the title row's), named in
 *   HOME_TEXT below, from --kb-em.
 *
 * A widget's own file never sets a font size of its own, every widget with
 * a title draws it with HomeCardHeader (HomeCard, HomeSetUp), and every
 * empty, waiting or "nothing today" state is one HomeEmptyLine: the body
 * role, at the start of the line under the title (e2e/home-frame.spec.ts).
 * Only the clock block's pieces (clock, date, greeting, the members and the
 * today strip) and a photo have no title row. Touch targets stay 48px
 * whatever the text size (§3.3).
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

/** The card's padding in px, for a title row drawn at `em` px (useHeadEm, not the box's text size). */
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

/**
 * The text size (px) a title row is drawn at in the box `ref` is in: text M
 * for the screen (--kb-head-em, LayoutGrid), or the element's own font size
 * outside a layout. What a widget reckons the card's padding from (homePadPx).
 */
export function useHeadEm(ref: RefObject<HTMLElement | null>): number {
  const [em, setEm] = useState(16);
  // After every render: the element may mount only once data has arrived, and reading one style is cheap.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const px = parseFloat(style.getPropertyValue("--kb-head-em")) || parseFloat(style.fontSize);
    if (px > 0) setEm((prev) => (prev === px ? prev : px));
  });
  return em;
}

/** The icon in its badge, as today's cards draw it. */
export function HomeIconBadge({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span data-home-icon className={cn("flex shrink-0 items-center justify-center rounded-[0.67em] bg-primary/10 p-[0.56em] text-primary", className)}>
      <Icon className={HOME_ICON} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

/**
 * A card's title row: icon badge, title, then an optional badge (a count)
 * and a chevron when it leads somewhere; `right` sits after it (the header's
 * own buttons, chips, a "+n"). The row is a link to `href`, a button running
 * `onOpen`, or plain (with `chevron` when the whole box around it is the
 * link); its target 48px tall either way.
 *
 * Drawn at the screen's text M whatever the box's text size (`home-head`,
 * see the top of this file), so every title row on a screen is the same:
 * the same title, icon, chevron and height, 40px at M on a 1080px short
 * side. A 48px target in `right` reaches 4px into the card's padding above
 * and below, as the title's own does, so chips or a "+" button do not make
 * one box's title row taller than its neighbour's.
 */
export function HomeCardHeader({
  icon,
  title,
  href,
  onOpen,
  openLabel,
  badge,
  right,
  chevron,
}: {
  icon: LucideIcon;
  title: string;
  href?: string;
  onOpen?: () => void;
  /** The title target's accessible name, when it says more than the title. */
  openLabel?: string;
  badge?: ReactNode;
  right?: ReactNode;
  /** A chevron on a plain row: the box around it is the link (a set-up prompt, the car). */
  chevron?: boolean;
}) {
  const inner = (
    <>
      <HomeIconBadge icon={icon} />
      <span className={`${HOME_TEXT.title} min-w-0 truncate text-left font-display font-semibold leading-tight`} data-home-title>
        {title}
      </span>
      {badge != null && <span className="shrink-0">{badge}</span>}
      {(href || onOpen || chevron) && <ChevronRight className="size-[0.89em] shrink-0 text-muted-foreground" aria-hidden="true" />}
    </>
  );
  // The row is as tall as the icon badge (40px at M, as today's cards); its
  // 48px target reaches 4px into the card's padding above and below.
  const row = `${HOME_TARGET_H} -my-[4px] flex min-w-0 flex-1 items-center gap-[0.67em] rounded-[0.5em]`;
  const live = `${row} transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`;
  return (
    <header className="home-head flex shrink-0 items-center gap-[0.3em]" data-box-header>
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
      {right != null && <div className="-my-[4px] flex shrink-0 items-center gap-[0.3em]">{right}</div>}
    </header>
  );
}

/**
 * Today's card surface, corner and padding. The padding and corner are the
 * title row's scale (globals.css `home-card-pad`, `home-card-corner`), so a
 * title row sits as far in from its box's edge in every box on a screen.
 */
export const HOME_CARD_SURFACE =
  "accent-border-top home-card-corner home-card-pad overflow-hidden border border-border bg-card text-card-foreground elev-md";
/** The card's corner alone (a photo filling its box, a link around a card). */
export const HOME_CARD_CORNER = "home-card-corner";

/**
 * What a box says when it has nothing to show, is waiting, failed, or has a
 * line of its own instead of its rows ("Schule ist aus!", the weekend, a
 * holiday): one line of the body role at the start of the line under the
 * title row, muted, with an optional meta line under it. A link (`href`)
 * when it leads to where it is set up, 48px tall. Every such state of every
 * Home widget is this, so they read alike (e2e/home-frame.spec.ts).
 */
export function HomeEmptyLine({ text, sub, href, busy }: { text: string; sub?: string; href?: string; busy?: boolean }) {
  if (href) {
    return (
      <Link
        href={href}
        data-home-empty
        className={`${HOME_TARGET_H} flex shrink-0 items-center ${HOME_TEXT.body} text-muted-foreground hover:text-foreground`}
      >
        {text}
      </Link>
    );
  }
  return (
    <div data-home-empty aria-busy={busy || undefined} className={`shrink-0 py-[0.25em] ${HOME_TEXT.body} text-muted-foreground`}>
      <p className="break-words">{text}</p>
      {sub && <p className={HOME_TEXT.meta}>{sub}</p>}
    </div>
  );
}

export interface HomeCardProps {
  /** With an icon and a title the card draws its title row (HomeCardHeader) and puts `children` in a body under it. */
  icon?: LucideIcon;
  title?: string;
  href?: string;
  onOpen?: () => void;
  openLabel?: string;
  badge?: ReactNode;
  right?: ReactNode;
  /** A chevron on a plain title row: the box around the card is the link (the car, a ticker, pocket money). */
  chevron?: boolean;
  /** The title row left out, its body kept (the same elements, so nothing measured in it remounts): a box too small for both. */
  headless?: boolean;
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
  { icon, title, href, onOpen, openLabel, badge, right, chevron, headless, editing, testId, step, list, className, bodyClassName, children },
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
          {!headless && (
            <HomeCardHeader icon={icon} title={title} href={href} onOpen={onOpen} openLabel={openLabel} badge={badge} right={right} chevron={chevron} />
          )}
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
 * discover card, as a box, with the shared title row and the description
 * as the empty line under it. The whole box is one link to where it is set
 * up, so it is a target of any size; the description goes when the box is
 * too small for it.
 */
export const HomeSetUp = forwardRef<
  HTMLAnchorElement,
  { icon: LucideIcon; title: string; description: string; href: string; testId?: string; compact?: boolean }
>(function HomeSetUp({ icon, title, description, href, testId, compact }, outer) {
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
      className="home-card-corner home-card-pad flex size-full flex-col gap-[0.56em] overflow-hidden border border-dashed border-month-primary/30 bg-month-primary/5 text-card-foreground"
      data-testid={testId ?? "box-set-up"}
      data-set-up
      data-step={short ? 1 : 0}
    >
      <HomeCardHeader icon={icon} title={title} chevron />
      {!short && <HomeEmptyLine text={description} />}
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

/** The size of an element's content box, followed as it resizes. */
export function useElementSize(ref: RefObject<HTMLElement | null>, present: boolean) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setSize(null);
      return;
    }
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, present]);
  return size;
}
