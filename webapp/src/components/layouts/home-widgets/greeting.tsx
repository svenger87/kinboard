"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Greeting, getGreetingKey } from "@/components/widgets/greeting";
import { withClock, type ClockNow } from "@/components/widgets/clock";
import { HOME_VALUE_EM, HomeValueFrame, useCappedFit } from "./frame";
import type { HomeWidgetProps } from "./shared";

function HomeGreetingFace({ item, box, editing, now }: HomeWidgetProps & { now: ClockNow }) {
  const t = useTranslations("clock");
  const frame = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Measured again when the words change (morning to forenoon), not every minute.
  const words = t(getGreetingKey(now.date.getHours()));
  const { size, shrunk, dropped } = useCappedFit(frame, ref, box, HOME_VALUE_EM.greeting, [words]);
  // Never drawn below the meta role's size: too small a box shows no greeting.
  return (
    <HomeValueFrame item={item} fitted={size !== null} editing={editing} testId="home-widget-greeting" frameRef={frame} shrunk={dropped ? undefined : shrunk}>
      <div ref={ref} className="block w-fit shrink-0" style={size ? { fontSize: size, visibility: dropped ? "hidden" : undefined } : undefined} data-dropped={dropped || undefined}>
        <Greeting scaled />
      </div>
    </HomeValueFrame>
  );
}

/** The greeting in a box (RFC-022 §3.2): "Good morning" and so on, at the box's text size, smaller only in too small a box. */
export const HomeGreetingWidget = withClock<HomeWidgetProps>(HomeGreetingFace);
