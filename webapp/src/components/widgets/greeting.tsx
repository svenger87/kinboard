"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { withClock, type ClockNow } from "@/components/widgets/clock";

type GreetingKey =
  | "greetingNight"
  | "greetingMorning"
  | "greetingForenoon"
  | "greetingMidday"
  | "greetingAfternoon"
  | "greetingEvening";

export function getGreetingKey(hour: number): GreetingKey {
  if (hour < 5) return "greetingNight";
  if (hour < 10) return "greetingMorning";
  if (hour < 12) return "greetingForenoon";
  if (hour < 14) return "greetingMidday";
  if (hour < 18) return "greetingAfternoon";
  if (hour < 22) return "greetingEvening";
  return "greetingNight";
}

export interface GreetingProps {
  /** Placement only (margins, alignment); the widget sets no outer spacing. */
  className?: string;
  /** Drawn at the font size it is given (1em) instead of Home's fixed size: for a widget fitting it to its box. */
  scaled?: boolean;
}

function GreetingFace({ className = "", scaled = false, now }: GreetingProps & { now: ClockNow }) {
  const t = useTranslations("clock");
  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.32, duration: 0.22 }}
      className={`${scaled ? "text-[1em] whitespace-nowrap" : "text-base"} text-muted-foreground/70 font-light tracking-wide ${className}`}
    >
      {t(getGreetingKey(now.date.getHours()))}
    </motion.p>
  );
}

/** Home's greeting widget: "Good morning" and so on, by the time of day. */
export const Greeting = withClock<GreetingProps>(GreetingFace);
