"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { useThemeSettings } from "@/hooks/use-theme-settings";
import { valueBox } from "@/lib/layouts/grid";
import { alignOf } from "@/lib/layouts/align";
import type { HomeLayoutItem } from "@/lib/layouts/types";
import { ClockTime, withClock, type ClockNow } from "@/components/widgets/clock";
import type { HomeWidgetProps } from "./shared";

/**
 * A Home value widget's frame (clock, date, greeting): the value placed
 * across the box as alignOf says, centred vertically, hidden until it has
 * been fitted once so it does not flash at the box's own size first. The
 * screensaver's ValueFrame, on the app's theme. In the designer the value is
 * inert, so arranging a box opens no popover.
 */
export function HomeValueFrame({
  item,
  fitted,
  editing,
  testId,
  children,
}: {
  item: HomeLayoutItem;
  fitted: boolean;
  editing?: boolean;
  testId: string;
  children: ReactNode;
}) {
  const align = alignOf(item);
  const justify = align === "end" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <div
      data-testid={testId}
      data-align={align}
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

interface ClockBoxProps extends HomeWidgetProps {
  showSeconds: boolean;
}

function ClockBoxFace({ item, box, editing, showSeconds, now }: ClockBoxProps & { now: ClockNow }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useFitToBox(ref, valueBox(box, item.text), [now.hours, now.minutes, showSeconds, now.use24Hour]);
  return (
    <HomeValueFrame item={item} fitted={size !== null} editing={editing} testId="home-widget-clock">
      {/* The timer role the built-in block puts on its wrapper. NOT a live
          region: announcing every minute (or second) buried everything else
          for a screen reader (audit KB-24); the time stays available on
          demand through the role and the clock button's label. */}
      <div
        ref={ref}
        role="timer"
        aria-live="off"
        aria-atomic="true"
        // Line height 1 throughout, or the digits' line box (and with it the
        // fitted size) would be half again as tall as the digits.
        className="block w-fit shrink-0 leading-none [&_button]:block"
        style={size ? { fontSize: size } : undefined}
      >
        <ClockTime size="box" showSeconds={showSeconds} />
      </div>
    </HomeValueFrame>
  );
}

/** One tick: the Home's shared clock when it has one, else a clock of its own at the seconds setting. */
const ClockBox = withClock<ClockBoxProps>(ClockBoxFace, (p) => p.showSeconds);

/**
 * The clock in a box (RFC-022 §3.2): the time, as large as the box allows,
 * with seconds when the family has them on. Tapping it opens the date, week
 * and year detail, as on the built-in Home.
 */
export function HomeClockWidget(props: HomeWidgetProps) {
  const { showSeconds } = useThemeSettings();
  return <ClockBox {...props} showSeconds={showSeconds} />;
}
