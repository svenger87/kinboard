"use client";

import { useRef } from "react";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { valueBox } from "@/lib/layouts/grid";
import { DateAndWeek } from "@/components/widgets/date-week";
import { withClock, type ClockNow } from "@/components/widgets/clock";
import { HomeValueFrame } from "./clock";
import type { HomeWidgetProps } from "./shared";

function HomeDateFace({ item, box, editing, now }: HomeWidgetProps & { now: ClockNow }) {
  const ref = useRef<HTMLDivElement>(null);
  // The day changes the text, and so its width; a minute tick that does not
  // change the day measures nothing.
  const day = now.date.toDateString();
  const size = useFitToBox(ref, valueBox(box, item.text), [day]);
  return (
    <HomeValueFrame item={item} fitted={size !== null} editing={editing} testId="home-widget-date">
      <div ref={ref} className="block w-fit shrink-0" style={size ? { fontSize: size } : undefined}>
        <DateAndWeek scaled />
      </div>
    </HomeValueFrame>
  );
}

/**
 * The date and week in a box (RFC-022 §3.2): weekday, day and month with the
 * week number beside them, as large as the box allows. The week opens its
 * popover as on the built-in Home.
 */
export const HomeDateWidget = withClock<HomeWidgetProps>(HomeDateFace);
