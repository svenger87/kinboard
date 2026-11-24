"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { valueBox } from "@/lib/layouts/grid";
import { Greeting, getGreetingKey } from "@/components/widgets/greeting";
import { withClock, type ClockNow } from "@/components/widgets/clock";
import { HomeValueFrame } from "./clock";
import type { HomeWidgetProps } from "./shared";

function HomeGreetingFace({ item, box, editing, now }: HomeWidgetProps & { now: ClockNow }) {
  const t = useTranslations("clock");
  const ref = useRef<HTMLDivElement>(null);
  // Measured again when the words change (morning to forenoon), not every minute.
  const words = t(getGreetingKey(now.date.getHours()));
  const size = useFitToBox(ref, valueBox(box, item.text), [words]);
  return (
    <HomeValueFrame item={item} fitted={size !== null} editing={editing} testId="home-widget-greeting">
      <div ref={ref} className="block w-fit shrink-0" style={size ? { fontSize: size } : undefined}>
        <Greeting scaled />
      </div>
    </HomeValueFrame>
  );
}

/** The greeting in a box (RFC-022 §3.2): "Good morning" and so on, as large as the box allows. */
export const HomeGreetingWidget = withClock<HomeWidgetProps>(HomeGreetingFace);
