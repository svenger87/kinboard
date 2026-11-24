"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { HOME_TARGET } from "@/lib/layouts/widgets";
import { DateAndWeek } from "@/components/widgets/date-week";
import { withClock, type ClockNow } from "@/components/widgets/clock";
import { HOME_VALUE_EM, HomeValueFrame, useCappedFit } from "./frame";
import type { HomeWidgetProps } from "./shared";

function HomeDateFace({ item, box, editing, now }: HomeWidgetProps & { now: ClockNow }) {
  const frame = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  // The day changes the text, and so its width; a minute tick that does not
  // change the day measures nothing.
  const day = now.date.toDateString();
  // A box flatter than a touch target (a layout saved before the minimums
  // followed the pixels) gets the week as a plain badge: a 48px button
  // there would leave the date no room and shrink it to nothing.
  // A pixel short of the target still holds it (boxes may come up a pixel short, stepsFor).
  const flat = box.height < HOME_TARGET - 1;
  // Never drawn below the meta role's size: in a box too small for that, the
  // week badge goes first, then the date itself.
  const [noWeek, setNoWeek] = useState(false);
  useLayoutEffect(() => setNoWeek(false), [box.width, box.height, day]);
  const { size, shrunk, dropped } = useCappedFit(frame, ref, box, HOME_VALUE_EM.date, [day, flat, noWeek]);
  useLayoutEffect(() => {
    if (dropped && !noWeek) setNoWeek(true);
  }, [dropped, noWeek]);
  const gone = dropped && noWeek;
  return (
    <HomeValueFrame item={item} fitted={size !== null} editing={editing} testId="home-widget-date" frameRef={frame} shrunk={gone ? undefined : shrunk}>
      <div ref={ref} className="block w-fit shrink-0" style={size ? { fontSize: size, visibility: gone ? "hidden" : undefined } : undefined} data-dropped={gone || undefined}>
        <DateAndWeek scaled target={!flat} week={!noWeek} />
      </div>
    </HomeValueFrame>
  );
}

/**
 * The date and week in a box (RFC-022 §3.2): weekday, day and month with the
 * week number beside them, at the box's text size as on today's Home, and
 * smaller only when the box is too small. The week opens its popover as on
 * the built-in Home.
 */
export const HomeDateWidget = withClock<HomeWidgetProps>(HomeDateFace);
