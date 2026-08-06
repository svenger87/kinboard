"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { format, startOfDay, endOfDay, isAfter } from "date-fns";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import { useEvents, usePeople } from "@/hooks";
import { TodayStripPill } from "@/components/today-strip-pill";
import { useTimeFormat } from "@/hooks/use-time-format";

export function TodayStrip() {
  const { formatTime } = useTimeFormat();
  const t = useTranslations("todayStrip");

  // Recompute "today" every minute so a kiosk display stays correct past midnight
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = now;
  const startISO = useMemo(() => startOfDay(today).toISOString(), [today]);
  const endISO = useMemo(() => endOfDay(today).toISOString(), [today]);

  const { data: events, isError, isLoading } = useEvents(startISO, endISO);
  const { data: people } = usePeople();

  // Filter to only today's non-waste events that haven't ended
  const todayEvents = useMemo(
    () =>
      (events || [])
        .filter((e) => !e.calendar?.is_waste_collection)
        .filter((e) => {
          const end = e.end_at ? new Date(e.end_at) : new Date(e.start_at);
          return isAfter(end, new Date());
        }),
    [events]
  );

  const colorFor = (e: (typeof todayEvents)[number]) => {
    const personId = e.person_id || e.calendar?.person_id;
    const person = personId ? people?.find((p) => p.id === personId) : undefined;
    return person?.color || e.calendar?.color || "hsl(var(--primary))";
  };

  const timedToday = useMemo(
    () =>
      todayEvents
        .filter((e) => !e.all_day)
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()),
    [todayEvents]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: 0.4 }}
      // The strip scrolls horizontally with the scrollbar hidden, so on a busy
      // day the pills past the edge were unreachable-looking — DesktopNav has
      // fade indicators for exactly this and the strip had none (audit KB-36).
      // The duplication with the Termine widget is deliberate and left alone:
      // the strip is a glance, the widget is a list.
      className="scrollbar-hide relative flex w-full items-center [justify-content:safe_center] gap-3 overflow-x-auto px-1 py-1 [mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%-2rem),transparent)]"
      // Not role="status": this is standing content, not an async status
      // message, and announcing the whole strip on every event edit is noise.
      aria-label={t("ariaLabel")}
    >
      {/* "Nothing on today" is only true if we actually managed to ask. When the
          backend was failing, this rendered its confident empty copy on the wall
          and a family reading it would believe the day was clear (audit KB-05).
          Error and loading now say what they are instead. */}
      {isError ? (
        <span className="mx-auto flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          {t("loadFailed")}
        </span>
      ) : isLoading ? (
        <span className="mx-auto text-sm italic text-muted-foreground/70">
          {t("loading")}
        </span>
      ) : timedToday.length > 0 ? (
        timedToday.map((e) => (
          <TodayStripPill
            key={e.id}
            time={formatTime(new Date(e.start_at))}
            title={e.title}
            color={colorFor(e)}
          />
        ))
      ) : (
        <span className="mx-auto text-sm italic text-muted-foreground/70">
          {t("emptyState")}
        </span>
      )}
    </motion.div>
  );
}
