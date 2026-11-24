"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ClockProvider, ClockTime } from "@/components/widgets/clock";
import { DateAndWeek } from "@/components/widgets/date-week";
import { Greeting } from "@/components/widgets/greeting";
import { FamilyMembers } from "@/components/widgets/family-members";
import { TodayStrip } from "@/components/widgets/today-strip";
import type { HomeLayout } from "@/hooks/use-home-layout";

interface HomeClockBlockProps {
  /** Home's compact/classic switch (per browser). */
  layout: HomeLayout;
  /** The family's "show seconds" clock setting. */
  showSeconds: boolean;
}

/**
 * The block at the top of the built-in Home: clock, date and week, greeting,
 * family members and today strip (RFC-022 §3.2).
 *
 * Each of the five is a widget of its own that renders given only its props,
 * so a designed Home can place them one by one. This is the arrangement Home
 * has always had, kept to the pixel: the spacing between them lives here, not
 * in the widgets.
 */
export function HomeClockBlock({ layout, showSeconds }: HomeClockBlockProps) {
  const t = useTranslations("dashboard");
  const compact = layout === "compact";

  return (
    // Top Section - Clock.
    // `flex-1` used to let this block absorb all spare height, which is
    // right in portrait and wrong in landscape: on a 1920x1080 panel it
    // took 47% of the height (clock + five names + one event pill) and
    // pushed the second widget row off the bottom — scrollHeight 1754 vs
    // clientHeight 1080 (audit KB-01). Capping it at 38vh on short, wide
    // viewports keeps the hero dominant without letting it crowd out the
    // family information the dashboard exists to show. Portrait is
    // deliberately untouched: it already fits.
    <section
      className={`relative z-[1] flex items-center justify-center hero-block ${compact ? "flex-col portrait:md:grid portrait:md:grid-cols-2 portrait:md:gap-6 py-4" : "flex-1 flex-col"}`}
      aria-label={t("ariaClock")}
      // Where a festival's fireworks go up (RFC-020 §3.3): over the clock in here.
      data-festival-anchor="clock"
    >
      <div className={compact ? "min-w-0 text-center" : "contents"}>
        {/* One tick for the clock, the date and the greeting. */}
        <ClockProvider showSeconds={showSeconds}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: "easeOut" }}
            role="timer"
            // NOT a live region. This value changes every 60s — every second when
            // seconds are shown — and `aria-live="polite"` made a screen reader
            // announce the time continuously, burying everything else on the page
            // (audit KB-24). The time stays available on demand via role="timer"
            // and the clock button's aria-label.
            aria-live="off"
            aria-atomic="true"
            className="flex flex-col items-center justify-center"
          >
            <ClockTime size={compact ? "lg" : "xl"} showSeconds={showSeconds} />
            <DateAndWeek className="mt-4" />
            <Greeting className="mt-2" />
          </motion.div>
        </ClockProvider>
      </div>
      <div className={compact ? "min-w-0" : "contents"}>
        <div className={compact ? "" : "mt-6 lg:mt-10"}>
          <FamilyMembers className={compact ? "flex-wrap" : ""} />
        </div>
        <div className="mt-4 mb-4 w-full lg:mb-6">
          <TodayStrip />
        </div>
      </div>
    </section>
  );
}
