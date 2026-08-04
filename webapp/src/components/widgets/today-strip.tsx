"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { format, startOfDay, endOfDay, isAfter } from "date-fns";
import { useTranslations } from "next-intl";
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

  const { data: events } = useEvents(startISO, endISO);
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
      className="scrollbar-hide flex w-full items-center [justify-content:safe_center] gap-3 overflow-x-auto px-1 py-1"
      role="status"
      aria-label={t("ariaLabel")}
    >
      {timedToday.length > 0 ? (
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
