"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Clock,
  Calculator,
  BookOpen,
  Languages,
  Dumbbell,
  Music,
  Palette,
  Atom,
  FlaskConical,
  Leaf,
  Landmark,
  Globe,
  Church,
  PartyPopper,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSchedules, usePeople } from "@/hooks";

interface TimeSlot {
  period: number;
  start: string;
  end: string;
  subject: string;
  room?: string;
}

interface ScheduleWidgetProps {
  personId?: string;
  className?: string;
}

// Subject colors and icons
const SUBJECT_CONFIG: Record<string, { color: string; icon: LucideIcon }> = {
  Mathe: { color: "#3b82f6", icon: Calculator },
  Mathematik: { color: "#3b82f6", icon: Calculator },
  Deutsch: { color: "#ef4444", icon: BookOpen },
  Englisch: { color: "#f97316", icon: Languages },
  Sport: { color: "#22c55e", icon: Dumbbell },
  Musik: { color: "#a855f7", icon: Music },
  Kunst: { color: "#ec4899", icon: Palette },
  Physik: { color: "#06b6d4", icon: Atom },
  Chemie: { color: "#84cc16", icon: FlaskConical },
  Bio: { color: "#10b981", icon: Leaf },
  Biologie: { color: "#10b981", icon: Leaf },
  Geschichte: { color: "#8b5cf6", icon: Landmark },
  Erdkunde: { color: "#14b8a6", icon: Globe },
  Geographie: { color: "#14b8a6", icon: Globe },
  Religion: { color: "#f59e0b", icon: Church },
  Ethik: { color: "#f59e0b", icon: Church },
  default: { color: "#6b7280", icon: GraduationCap },
};

function getSubjectColor(subject: string): string {
  return SUBJECT_CONFIG[subject]?.color || SUBJECT_CONFIG.default.color;
}

function getSubjectIcon(subject: string): LucideIcon {
  return SUBJECT_CONFIG[subject]?.icon || SUBJECT_CONFIG.default.icon;
}

function getCurrentPeriod(schedule: TimeSlot[]): number | null {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  for (const slot of schedule) {
    if (currentTime >= slot.start && currentTime <= slot.end) {
      return slot.period;
    }
  }
  return null;
}

function getPeriodProgress(slot: TimeSlot): number {
  const now = new Date();
  const [startH, startM] = slot.start.split(":").map(Number);
  const [endH, endM] = slot.end.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const total = endMinutes - startMinutes;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((nowMinutes - startMinutes) / total) * 100));
}

function getRemainingMinutes(slot: TimeSlot): number {
  const now = new Date();
  const [endH, endM] = slot.end.split(":").map(Number);
  const endMinutes = endH * 60 + endM;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, endMinutes - nowMinutes);
}

function getNextPeriod(schedule: TimeSlot[]): TimeSlot | null {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  const upcoming = schedule
    .filter((slot) => slot.start > currentTime)
    .sort((a, b) => a.start.localeCompare(b.start));

  return upcoming[0] || null;
}

function ScheduleWidgetSkeleton() {
  const t = useTranslations("scheduleWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="flex gap-2 mt-4">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}

export function ScheduleWidget({
  personId: propPersonId,
  className = "",
}: ScheduleWidgetProps) {
  const t = useTranslations("scheduleWidget");
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const { data: people, isLoading: loadingPeople } = usePeople();

  // Get all children for the selector
  const children = people?.filter((p) => p.is_child) || [];

  // If no personId provided, auto-select first child or use selected child
  const firstChild = children[0];
  const personId = propPersonId || selectedChildId || firstChild?.id;

  const { data: schedules, isLoading: loadingSchedules } = useSchedules(personId);

  // Update every minute
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  if (loadingSchedules || loadingPeople) {
    return <ScheduleWidgetSkeleton />;
  }

  // No child configured
  if (!personId) {
    return (
      // Deliberately NOT h-full. An unconfigured widget was taking a full grid
      // cell in prime position on the wall, and because a taller neighbour set
      // the row height it also left a ~500x230px hole beside it (audit KB-06).
      // A compact card states the same thing and lets the grid pack around it.
      <Card className={`accent-border-top ${className}`}>
        <CardContent className="flex items-center gap-3 p-4">
          <span className="icon-badge shrink-0">
            <GraduationCap className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-base font-semibold leading-tight">{t("title")}</p>
            <p className="text-xs text-muted-foreground">{t("noChildTitle")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Get the current day of week
  // JavaScript getDay(): 0=Sunday, 1=Monday...6=Saturday
  // Database day_of_week: 1=Monday, 2=Tuesday...5=Friday (1-based)
  const jsDay = currentTime.getDay();
  const dbDay = jsDay === 0 || jsDay === 6 ? -1 : jsDay; // Convert: Weekend=-1 (invalid), Monday=1, etc.

  // Find schedule for today
  const todayScheduleData = schedules?.find((s) => s.day_of_week === dbDay);
  const todaySchedule: TimeSlot[] = todayScheduleData?.time_slots
    ? (Array.isArray(todayScheduleData.time_slots)
        ? (todayScheduleData.time_slots as unknown as TimeSlot[])
        : [])
    : [];

  // Get person details
  const person = people?.find((p) => p.id === personId);
  const personName = person?.name || t("title");
  const personColor = person?.color || "#a855f7";

  const currentPeriod = getCurrentPeriod(todaySchedule);
  const nextPeriod = getNextPeriod(todaySchedule);
  const currentSlot = todaySchedule.find((s) => s.period === currentPeriod);

  // Check if school day is over
  const lastSlot = todaySchedule[todaySchedule.length - 1];
  const timeNow = `${currentTime.getHours().toString().padStart(2, "0")}:${currentTime.getMinutes().toString().padStart(2, "0")}`;
  const schoolOver = lastSlot && timeNow > lastSlot.end;

  // Weekend or no schedule (using JavaScript day)
  const isWeekend = jsDay === 0 || jsDay === 6;
  const noScheduleToday = todaySchedule.length === 0;

  return (
    <TooltipProvider>
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.4 }}
    >
      <Card className={`accent-border-top h-full ${className}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex min-w-0 items-center gap-2 font-display text-lg font-semibold">
              <span className="icon-badge shrink-0">
                <GraduationCap className="size-5 text-primary" strokeWidth={1.75} />
              </span>
              <span className="truncate">{t("title")}</span>
            </CardTitle>
            <div className="flex shrink-0 items-center gap-2">
              {children.length > 1 ? (
                <div className="flex gap-1">
                  {children.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => setSelectedChildId(child.id)}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                        child.id === personId
                          ? "font-medium"
                          : "opacity-50 hover:opacity-80"
                      }`}
                      style={{
                        borderColor: child.color || personColor,
                        color: child.color || personColor,
                        backgroundColor: child.id === personId ? `${child.color || personColor}15` : "transparent",
                      }}
                      aria-label={t("childSelectAria", { name: child.name })}
                      aria-pressed={child.id === personId}
                    >
                      {child.name}
                    </button>
                  ))}
                </div>
              ) : person ? (
                <Badge
                  variant="outline"
                  style={{ borderColor: personColor, color: personColor }}
                >
                  {personName}
                </Badge>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/schedule"
                    className="p-1 rounded-lg hover:bg-accent/50 transition-colors"
                    aria-label={t("viewAllAria")}
                  >
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("viewAllTooltip")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isWeekend ? (
            /* Weekend */
            <div className="text-center py-4">
              <PartyPopper className="size-8 mx-auto mb-2 text-primary/60" strokeWidth={1.75} />
              <p className="text-muted-foreground">{t("weekend")}</p>
            </div>
          ) : noScheduleToday ? (
            /* No schedule configured */
            <div className="text-center py-4">
              <GraduationCap className="size-8 mx-auto mb-2 text-primary/20" />
              <p className="text-muted-foreground text-sm">{t("noScheduleToday")}</p>
            </div>
          ) : schoolOver ? (
            /* School day over */
            <div className="text-center py-4">
              <PartyPopper className="size-8 mx-auto mb-2 text-primary/60" strokeWidth={1.75} />
              <p className="text-muted-foreground">{t("schoolOver")}</p>
            </div>
          ) : currentSlot ? (
            /* Currently in class */
            <div className="flex flex-col gap-4" aria-live="polite" aria-atomic="true">
              {/* Current class */}
              <div
                className="p-4 rounded-xl"
                style={{
                  backgroundColor: `${getSubjectColor(currentSlot.subject)}15`,
                  borderLeft: `4px solid ${getSubjectColor(currentSlot.subject)}`,
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge style={{ backgroundColor: getSubjectColor(currentSlot.subject) }}>
                    {t("nowBadge")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t("periodNumber", { period: currentSlot.period })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {(() => {
                    const SubjectIcon = getSubjectIcon(currentSlot.subject);
                    return <SubjectIcon className="size-5" style={{ color: getSubjectColor(currentSlot.subject) }} />;
                  })()}
                  <p className="text-xl font-medium">{currentSlot.subject}</p>
                </div>
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {currentSlot.start} - {currentSlot.end}
                  </span>
                  {currentSlot.room && <span>{t("roomLabel", { room: currentSlot.room })}</span>}
                  <span className="ml-auto tabular-nums">
                    {t("remainingMinutes", { minutes: getRemainingMinutes(currentSlot) })}
                  </span>
                </div>
                {/* Period progress bar */}
                <div className="mt-2.5 h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: getSubjectColor(currentSlot.subject) }}
                    initial={{ width: 0 }}
                    animate={{ width: `${getPeriodProgress(currentSlot)}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
              </div>

              {/* Next class */}
              {nextPeriod && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{t("afterCurrent")}</span>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const NextIcon = getSubjectIcon(nextPeriod.subject);
                      return <NextIcon className="size-4" style={{ color: getSubjectColor(nextPeriod.subject) }} />;
                    })()}
                    <span className="font-medium">{nextPeriod.subject}</span>
                    <span className="text-muted-foreground">{t("atTime", { time: nextPeriod.start })}</span>
                  </div>
                </div>
              )}
            </div>
          ) : nextPeriod ? (
            /* Before school or between classes */
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{t("nextPeriodHeading")}</p>
              <div
                className="p-4 rounded-xl"
                style={{
                  backgroundColor: `${getSubjectColor(nextPeriod.subject)}15`,
                  borderLeft: `4px solid ${getSubjectColor(nextPeriod.subject)}`,
                }}
              >
                <div className="flex items-center gap-2">
                  {(() => {
                    const NextSubjectIcon = getSubjectIcon(nextPeriod.subject);
                    return <NextSubjectIcon className="size-5" style={{ color: getSubjectColor(nextPeriod.subject) }} />;
                  })()}
                  <p className="text-xl font-medium">{nextPeriod.subject}</p>
                </div>
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {nextPeriod.start}
                  </span>
                  {nextPeriod.room && <span>{t("roomLabel", { room: nextPeriod.room })}</span>}
                </div>
              </div>

              {/* Remaining classes */}
              <div className="flex flex-wrap gap-1">
                {todaySchedule
                  .filter((s) => s.start > nextPeriod.start)
                  .slice(0, 4)
                  .map((slot) => (
                    <Badge
                      key={slot.period}
                      variant="outline"
                      className="text-xs"
                      style={{
                        borderColor: getSubjectColor(slot.subject),
                        color: getSubjectColor(slot.subject),
                      }}
                    >
                      {slot.subject}
                    </Badge>
                  ))}
              </div>
            </div>
          ) : (
            /* No schedule today */
            <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
              <BookOpen className="size-8 mb-2 text-primary/20" />
              <p className="text-sm">{t("noLessonsToday")}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
    </TooltipProvider>
  );
}

export { ScheduleWidgetSkeleton };
