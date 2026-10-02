"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Clock,
  Calculator,
  BookOpen,
  BarChart3,
  Calendar,
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
  Ruler,
  Compass,
  Triangle,
  Microscope,
  Brain,
  Lightbulb,
  BookMarked,
  Pen,
  PenTool,
  FileText,
  Newspaper,
  Library,
  Scroll,
  Quote,
  MessageCircle,
  MapPin,
  Mountain,
  Trees,
  Castle,
  Building,
  Flag,
  Flower2,
  Heart,
  Eye,
  Ear,
  Hand,
  Droplets,
  Waves,
  Footprints,
  Bike,
  Target,
  Trophy,
  Medal,
  Award,
  Guitar,
  Piano,
  Drum,
  Headphones,
  Mic,
  Paintbrush,
  Brush,
  Scissors,
  Drama,
  Camera,
  Film,
  Computer,
  Cpu,
  Code,
  Terminal,
  Binary,
  Database,
  Gamepad2,
  Scale,
  Users,
  HelpCircle,
  Sparkles,
  Utensils,
  Home,
  Shirt,
  Hammer,
  Wrench,
  Cog,
  Box,
  Sun,
  Moon,
  Star,
  Cloud,
  Wind,
  Flame,
  Zap,
  Rainbow,
  Rocket,
  Plane,
  Car,
  Bus,
  Train,
  Ship,
  Puzzle,
  Blocks,
  Gift,
  Key,
  Shield,
  Swords,
  Megaphone,
  Info,
  Backpack,
  PartyPopper,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/person-avatar";
import { ChecklistItem } from "@/components/checklist-item";
import { ErrorState } from "@/components/error-state";
import { personText } from "@/lib/person-color";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { useSchedules, usePeople, useSubjects, useSetting, useKeyboardShortcuts, useSwipeNavigation } from "@/hooks";
import type { Person, Subject } from "@/types/database";
import { DEFAULT_PACK_ITEMS, type PackItemConfig } from "@/lib/schedule-pack-items";
import { useTimeFormat } from "@/hooks/use-time-format";
import { useSchoolBreaks } from "@/hooks/use-school-days";
import { addDays, toLocalDateKey } from "@/lib/local-date";
import { dayOfWeekOf, nextSchoolDay, NEXT_SCHOOL_DAY_HORIZON, schoolDayStatusOn, type SchoolDayStatus } from "@/lib/school-day-rule";
import { holidayEndPattern, keyToDate } from "@/lib/holiday-entries";
import { getDateFnsLocale } from "@/lib/date-fns-locale";

interface TimeSlot {
  period: number;
  start: string;
  end: string;
  subject: string;
  room?: string;
}

// Day-of-week keys (Mon-Fri). Resolved through next-intl at render time.
const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

// Icon name to Lucide component mapping
const ICON_MAP: Record<string, LucideIcon> = {
  Calculator, Ruler, Compass, Triangle, Atom, FlaskConical, Microscope, Brain, Lightbulb,
  BookOpen, BookMarked, Pen, PenTool, Languages, FileText, Newspaper, Library, Scroll, Quote, MessageCircle,
  Globe, MapPin, Mountain, Trees, Clock, Landmark, Castle, Building, Flag,
  Leaf, Flower2, Heart, Eye, Ear, Hand, Droplets, Waves,
  Dumbbell, Footprints, Bike, Target, Trophy, Medal, Award,
  Music, Guitar, Piano, Drum, Headphones, Mic, Palette, Paintbrush, Brush, Scissors, Drama, Camera, Film,
  Computer, Cpu, Code, Terminal, Binary, Database, Gamepad2,
  Church, Scale, Users, HelpCircle, Sparkles,
  Utensils, Home, Shirt, Hammer, Wrench, Cog, Box,
  Sun, Moon, Star, Cloud, Wind, Flame, Zap, Rainbow,
  Rocket, Plane, Car, Bus, Train, Ship,
  Puzzle, Blocks, Gift, Key, Shield, Swords, Megaphone, Info, GraduationCap,
};

// Default color for subjects not in database
const DEFAULT_COLOR = "#6b7280";

// Pack items type and defaults

// Safely parse time_slots JSON from database into typed array
function parseTimeSlots(slots: unknown): TimeSlot[] {
  if (!Array.isArray(slots)) return [];
  return slots as TimeSlot[];
}

function getIconByName(iconName: string | null): LucideIcon {
  if (!iconName) return GraduationCap;
  return ICON_MAP[iconName] || GraduationCap;
}

export default function SchedulePage() {
  // Period times are stored as "HH:MM" and were printed raw, so they stayed
  // 24-hour whatever Settings → Design said (issue #244). Same renderer the
  // weather widget uses for sunrise and sunset.
  const { formatWallClock } = useTimeFormat();
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("schedule");
  // The day-off and next-school-day wording is the timetable widget's own.
  const tWidget = useTranslations("scheduleWidget");
  const locale = useLocale();
  const router = useRouter();
  const DAYS = [
    t("days.monday"),
    t("days.tuesday"),
    t("days.wednesday"),
    t("days.thursday"),
    t("days.friday"),
  ];

  const [currentTime, setCurrentTime] = useState(new Date());
  const { data: people, isLoading: loadingPeople } = usePeople();
  const { data: subjects } = useSubjects();
  const { data: packItemsSetting } = useSetting<PackItemConfig[]>("schedule_pack_items", DEFAULT_PACK_ITEMS);
  const packItems = packItemsSetting || DEFAULT_PACK_ITEMS;

  // Get color from DB subject, fallback to default
  const getSubjectColor = useCallback((subjectName: string): string => {
    const subject = subjects?.find((s) => s.name === subjectName);
    return subject?.color || DEFAULT_COLOR;
  }, [subjects]);

  // Get icon from DB subject, fallback to default
  const getSubjectIcon = useCallback((subjectName: string): LucideIcon => {
    const subject = subjects?.find((s) => s.name === subjectName);
    return getIconByName(subject?.icon || null);
  }, [subjects]);

  // Get children only - memoized to avoid re-creating the array every render
  const children = useMemo(() => people?.filter((p) => p.is_child) || [], [people]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  // Pack checklist is intentionally session-local (ephemeral): you tick items as
  // you pack for tomorrow; it resets on reload. No DB persistence by design.
  const [packedKeys, setPackedKeys] = useState<Set<string>>(new Set());
  const togglePacked = useCallback((key: string) => {
    setPackedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Auto-select first child
  useEffect(() => {
    if (children.length > 0 && !selectedChildId) {
      setSelectedChildId(children[0].id);
    }
  }, [children, selectedChildId]);

  // Reset the ephemeral pack-check state when switching child.
  useEffect(() => {
    setPackedKeys(new Set());
  }, [selectedChildId]);

  const selectedChild = children.find((c) => c.id === selectedChildId);
  const { data: schedules, isLoading: loadingSchedules, error: schedulesError } = useSchedules(selectedChildId || undefined);

  // Update time every minute
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Which days have no school: the same rule (lib/school-day-rule.ts), fed the
  // same rows, as the timetable widget and the server's "school tomorrow".
  // The device's local date, as the rest of the page uses. The week shown is
  // this one on a weekday and the coming one at the weekend (the one the pack
  // list and the preview already point at), so the breaks start at its Monday
  // and reach as far as the next school day can be.
  const jsDay = currentTime.getDay();
  const todayKey = toLocalDateKey(currentTime);
  const isWeekday = jsDay >= 1 && jsDay <= 5;
  const weekMonday = isWeekday ? addDays(todayKey, 1 - jsDay) : addDays(todayKey, jsDay === 6 ? 2 : 1);
  const { breaks, isLoading: loadingBreaks } = useSchoolBreaks(
    isWeekday ? weekMonday : todayKey,
    addDays(todayKey, NEXT_SCHOOL_DAY_HORIZON),
  );
  const today = schoolDayStatusOn(todayKey, breaks);
  // A holiday or a school break today, named; null on a school day or an ordinary weekend.
  const todayOff = today.reason === "holiday" ? today : null;
  // The visible week, Monday to Friday, with the days that have no school.
  const weekStatus: SchoolDayStatus[] = DAYS.map((_, i) => schoolDayStatusOn(addDays(weekMonday, i), breaks));

  // Today's column (0 = Monday … 4 = Friday), or -1: a weekend, or a day off,
  // whose lessons are not on today and must not be highlighted as current.
  const currentDayIndex = today.school_day ? jsDay - 1 : -1;

  // Check if current time is within a period
  const getCurrentPeriodForDay = (dayIndex: number) => {
    if (dayIndex !== currentDayIndex) return null;

    const timeNow = `${currentTime.getHours().toString().padStart(2, "0")}:${currentTime.getMinutes().toString().padStart(2, "0")}`;
    // Database stores 1-based days, so add 1 to match
    const daySchedule = schedules?.find((s) => s.day_of_week === dayIndex + 1);
    const slots = parseTimeSlots(daySchedule?.time_slots);

    for (const slot of slots) {
      if (timeNow >= slot.start && timeNow <= slot.end) {
        return slot.period;
      }
    }
    return null;
  };

  // Build schedule grid (memoized to avoid recomputation on every render)
  const { maxPeriods, grid } = useMemo(() => {
    if (!schedules) return { maxPeriods: 0, grid: {} as Record<number, Record<number, TimeSlot>> };

    let maxPeriods = 0;
    const grid: Record<number, Record<number, TimeSlot>> = {};

    for (const schedule of schedules) {
      // Database stores 1-based days (Monday=1), convert to 0-based for grid
      const dayIndex = schedule.day_of_week - 1;
      const slots = parseTimeSlots(schedule.time_slots);

      if (!grid[dayIndex]) grid[dayIndex] = {};

      for (const slot of slots) {
        grid[dayIndex][slot.period] = slot;
        if (slot.period > maxPeriods) maxPeriods = slot.period;
      }
    }

    return { maxPeriods, grid };
  }, [schedules]);

  // Subject statistics for the week (memoized)
  const subjectStats = useMemo(() => {
    if (!schedules || maxPeriods === 0) return [];

    const counts: Record<string, number> = {};
    for (let d = 0; d < 5; d++) {
      const daySlots = grid[d] || {};
      for (const slot of Object.values(daySlots)) {
        counts[slot.subject] = (counts[slot.subject] || 0) + 1;
      }
    }

    // Sort by count descending
    return Object.entries(counts)
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count);
  }, [schedules, grid, maxPeriods]);

  const totalPeriods = useMemo(() =>
    subjectStats.reduce((sum, s) => sum + s.count, 0),
    [subjectStats]
  );

  // The next day there is school and this child has lessons, by the widget's
  // rule: past the weekend, and past every public holiday, school break and
  // holiday-calendar day. Both the pack list and the preview are for that
  // day, so on the Friday before the autumn break they say "Tue 27 Oct"
  // rather than asking to pack for a Monday nobody is at school.
  const hasLessons = (dow: number) =>
    !!schedules?.some((s) => s.day_of_week === dow && Array.isArray(s.time_slots) && s.time_slots.length > 0);
  const next = schedules?.length ? nextSchoolDay(todayKey, breaks, { hasLessons }) : null;
  // How to name it, as before for an ordinary weekend ("Monday", from Friday
  // to Sunday) or tomorrow, and by its date when days off lie in between.
  const nextIsComingMonday =
    !!next && next.weekday === "monday" && (jsDay === 5 || !isWeekday) && next.date <= addDays(todayKey, 3);
  const nextKind: "tomorrow" | "monday" | "date" | null = !next
    ? null
    : nextIsComingMonday
      ? "monday"
      : next.date === addDays(todayKey, 1)
        ? "tomorrow"
        : "date";
  const nextDateLabel = next
    ? format(keyToDate(next.date), holidayEndPattern(locale), { locale: getDateFnsLocale(locale) })
    : "";
  // Grid column of that day (0 = Monday); -1 when there is none in sight.
  const reminderTargetDay = next ? dayOfWeekOf(next.date) - 1 : -1;
  const reminderDayLabel = reminderTargetDay >= 0 ? DAYS[reminderTargetDay] : "";

  const packReminders = useMemo(() => {
    const slots = grid[reminderTargetDay] || {};
    const subjectNames = new Set<string>();
    for (const slot of Object.values(slots)) {
      subjectNames.add(slot.subject);
    }

    const reminders: { subject: string; items: string[]; icon: LucideIcon; color: string }[] = [];
    for (const name of Array.from(subjectNames)) {
      const match = packItems.find((pi) =>
        name.toLowerCase().includes(pi.subject.toLowerCase())
      );
      if (match) {
        reminders.push({
          subject: name,
          items: match.items,
          icon: getSubjectIcon(name),
          color: getSubjectColor(name),
        });
      }
    }

    return reminders;
  }, [grid, reminderTargetDay, packItems, getSubjectIcon, getSubjectColor]);

  // Loading state. Waiting for the holidays too: lessons highlighted first and
  // a day off a moment later would flash a timetable nobody has today.
  if (loadingPeople || loadingSchedules || loadingBreaks) {
    return (
      <main id="main-content" className="min-h-page relative overflow-hidden">
        <div className="page-gradient" />
        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
          <PageHeader
            icon={GraduationCap}
            title={t("title")}
            backHref="/"
            className="mb-8"
            subtitle={<Skeleton className="h-4 w-24" />}
          />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </main>
    );
  }

  // Error state
  if (schedulesError) {
    return (
      <main id="main-content" className="min-h-page relative overflow-hidden">
        <div className="page-gradient" />
        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
          <PageHeader
            icon={GraduationCap}
            title={t("title")}
            backHref="/"
            className="mb-8"
          />
          <ErrorState
            title={t("errorTitle")}
            message={schedulesError.message}
          />
        </div>
      </main>
    );
  }

  // No children configured
  if (children.length === 0) {
    return (
      <main id="main-content" className="min-h-page relative overflow-hidden">
        <div className="page-gradient" />
        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
          <PageHeader
            icon={GraduationCap}
            title={t("title")}
            subtitle={t("subtitleOverview")}
            backHref="/"
            className="mb-8"
          />

          <EmptyState
            icon={GraduationCap}
            title={t("noChildrenTitle")}
            description={t("noChildrenDescription")}
            action={{ label: t("noChildrenAction"), onClick: () => router.push("/settings/people") }}
          />
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-page relative overflow-hidden">
      <div className="page-gradient" />

      <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
        <PageHeader
          icon={GraduationCap}
          title={t("title")}
          subtitle={
            todayOff
              ? todayOff.holiday || tWidget("noSchoolToday")
              : isWeekday
                ? DAYS[jsDay - 1]
                : t("subtitleWeekend")
          }
          backHref="/"
          className="mb-8"
          actions={
            <>
              {children.length > 1 && (
                <ToggleGroup
                  type="single"
                  variant="pill"
                  value={selectedChildId || ""}
                  onValueChange={(value) => { if (value) setSelectedChildId(value); }}
                  className="flex-wrap justify-end gap-1.5"
                  aria-label={t("childSelectorAria")}
                >
                  {children.map((child) => (
                    <ToggleGroupItem
                      key={child.id}
                      value={child.id}
                      className="h-11 gap-2 rounded-full px-3"
                    >
                      <PersonAvatar
                        name={child.name}
                        color={child.color}
                        avatarUrl={child.avatar_url}
                        size={24}
                      />
                      <span className="hidden sm:inline">{child.name}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
              {children.length === 1 && selectedChild && (
                <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
                  <PersonAvatar
                    name={selectedChild.name}
                    color={selectedChild.color}
                    avatarUrl={selectedChild.avatar_url}
                    size={24}
                  />
                  <span className="text-sm font-medium">{selectedChild.name}</span>
                </div>
              )}
            </>
          }
        />

        {/* A day off today: named, instead of a progress strip through lessons nobody has */}
        {todayOff && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="mb-4"
          >
            <Card className="overflow-hidden" data-day-off={todayOff.date}>
              <div className="p-4 flex items-center gap-3">
                <PartyPopper className="size-6 shrink-0 text-primary/60" strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className="font-medium break-words">{todayOff.holiday || tWidget("noSchoolToday")}</p>
                  {todayOff.holiday ? (
                    <p className="text-sm text-muted-foreground">{tWidget("noSchoolToday")}</p>
                  ) : null}
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Today's Progress Strip */}
        {currentDayIndex >= 0 && maxPeriods > 0 && (() => {
          const todaySlots = Array.from({ length: maxPeriods }, (_, i) => i + 1)
            .map((period) => grid[currentDayIndex]?.[period])
            .filter(Boolean);

          if (todaySlots.length === 0) return null;

          const currentPeriod = getCurrentPeriodForDay(currentDayIndex);
          const timeStr = `${currentTime.getHours().toString().padStart(2, "0")}:${currentTime.getMinutes().toString().padStart(2, "0")}`;
          const firstSlot = todaySlots[0];
          const lastSlot = todaySlots[todaySlots.length - 1];
          const isBeforeSchool = firstSlot && timeStr < firstSlot.start;
          const isAfterSchool = lastSlot && timeStr > lastSlot.end;

          // Calculate completed periods
          const completedPeriods = todaySlots.filter((slot) =>
            slot && timeStr > slot.end
          ).length;
          const progress = isAfterSchool ? 100 : isBeforeSchool ? 0 :
            Math.round((completedPeriods + (currentPeriod ? 0.5 : 0)) / todaySlots.length * 100);

          // Find the current or next lesson
          const currentLesson = currentPeriod
            ? todaySlots.find((s) => s?.period === currentPeriod)
            : null;
          const nextLesson = !isAfterSchool
            ? todaySlots.find((s) => s && timeStr < s.start)
            : null;

          return (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="mb-4"
            >
              <Card className="overflow-hidden">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  {/* Current/Next lesson info */}
                  <div className="flex-1 min-w-0">
                    {isAfterSchool ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs bg-emerald-500/15 text-emerald-400 border-0">
                          {t("endOfSchool")}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {t("endOfSchoolMessage", { count: todaySlots.length })}
                        </span>
                      </div>
                    ) : isBeforeSchool ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {t("beforeSchool")}
                        </Badge>
                        {firstSlot && (
                          <span className="text-sm text-muted-foreground">
                            {t("firstLessonAt", { time: formatWallClock(firstSlot.start) })}
                          </span>
                        )}
                      </div>
                    ) : currentLesson ? (
                      <div className="flex items-center gap-2">
                        <div
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-medium"
                          style={{
                            backgroundColor: `${getSubjectColor(currentLesson.subject)}20`,
                            color: personText(getSubjectColor(currentLesson.subject)),
                          }}
                        >
                          {(() => {
                            const Icon = getSubjectIcon(currentLesson.subject);
                            return <Icon className="size-3.5" />;
                          })()}
                          {currentLesson.subject}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {t("periodWithTime", { period: currentLesson.period, start: formatWallClock(currentLesson.start), end: formatWallClock(currentLesson.end) })}
                        </span>
                        {nextLesson && (
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            &middot; {t("afterCurrent", { subject: nextLesson.subject })}
                          </span>
                        )}
                      </div>
                    ) : nextLesson ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {t("breakBadge")}
                        </Badge>
                        <span className="text-base text-muted-foreground">
                          {t.rich("nextPeriod", {
                            subject: nextLesson.subject,
                            time: formatWallClock(nextLesson.start),
                            bold: (chunks) => (
                              <span className="font-medium text-foreground">{chunks}</span>
                            ),
                          })}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {/* Progress indicator */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {completedPeriods}/{todaySlots.length}
                    </span>
                    <div
                      className="w-24 h-1.5 rounded-full bg-muted/40 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={completedPeriods}
                      aria-valuemin={0}
                      aria-valuemax={todaySlots.length}
                      aria-label={t("progressAria", { completed: completedPeriods, total: todaySlots.length })}
                    >
                      <motion.div
                        className="h-full rounded-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })()}

        {/* Schedule Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          {maxPeriods === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title={t("noScheduleMessage")}
              action={{ label: t("noScheduleAction"), onClick: () => router.push("/settings/schedule"), variant: "outline" }}
            />
          ) : (
            <>
              {/* Mobile: Day-by-day vertical view */}
              <div className="md:hidden flex flex-col gap-4">
                {DAYS.map((day, dayIndex) => {
                  const isToday = dayIndex === currentDayIndex;
                  const off = weekStatus[dayIndex]?.reason === "holiday" ? weekStatus[dayIndex] : null;
                  const daySlots = Array.from({ length: maxPeriods }, (_, i) => i + 1)
                    .map((period) => ({ period, slot: grid[dayIndex]?.[period] }))
                    .filter(({ slot }) => !!slot);

                  if (daySlots.length === 0) return null;

                  return (
                    <Card
                      key={day}
                      className={`overflow-hidden ${isToday ? "ring-2 ring-primary/50" : ""}`}
                      data-week-day={weekStatus[dayIndex]?.date}
                      data-week-day-off={off ? "true" : undefined}
                    >
                      <div className={`px-4 py-2.5 border-b border-border/50 ${isToday ? "bg-primary/10" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-medium text-sm ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                            {day}
                          </span>
                          {isToday && (
                            <Badge variant="secondary" className="text-3xs px-1.5">{t("todayBadge")}</Badge>
                          )}
                          {off && (
                            <Badge variant="secondary" className="text-3xs px-1.5 min-w-0 max-w-[65%] gap-1">
                              <PartyPopper className="size-3 shrink-0" strokeWidth={1.75} />
                              <span className="truncate">{off.holiday || t("noSchool")}</span>
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className={`divide-y divide-border/30 ${off ? "opacity-50" : ""}`}>
                        {daySlots.map(({ period, slot }) => {
                          if (!slot) return null;
                          const isCurrentPeriod = getCurrentPeriodForDay(dayIndex) === period;
                          const SubjectIcon = getSubjectIcon(slot.subject);
                          const color = getSubjectColor(slot.subject);

                          return (
                            <motion.div
                              key={period}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: period * 0.04 }}
                              className={`flex items-center gap-3 px-4 py-3 ${
                                isCurrentPeriod ? "bg-primary/10" : ""
                              }`}
                            >
                              <div className="text-xs text-muted-foreground w-10 shrink-0 text-center">
                                <div className="font-medium tabular-nums">{period}.</div>
                                <div className="text-3xs tabular-nums">{formatWallClock(slot.start)}</div>
                              </div>
                              <div
                                className="flex-1 flex items-center gap-2 p-2.5 rounded-lg"
                                style={{
                                  backgroundColor: `${color}15`,
                                  borderLeft: `3px solid ${color}`,
                                }}
                              >
                                <SubjectIcon className="size-4 shrink-0" strokeWidth={1.75} style={{ color: personText(color) }} />
                                <span className="font-medium text-sm" style={{ color: personText(color) }}>
                                  {slot.subject}
                                </span>
                                {isCurrentPeriod && (
                                  <Badge
                                    className="ml-auto text-3xs px-1.5 py-0"
                                    style={{ backgroundColor: color }}
                                  >
                                    {t("nowBadge")}
                                  </Badge>
                                )}
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}
              </div>

              {/* Desktop: Full week grid table */}
              <Card className="overflow-hidden hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="p-3 text-left text-xs font-medium text-muted-foreground border-b border-border/50 w-20">
                          <Clock className="size-4" />
                        </th>
                        {DAYS.map((day, index) => {
                          const off = weekStatus[index]?.reason === "holiday" ? weekStatus[index] : null;
                          return (
                            <th
                              key={day}
                              data-week-day={weekStatus[index]?.date}
                              data-week-day-off={off ? "true" : undefined}
                              className={`p-3 text-center text-sm font-medium border-b border-border/50 ${
                                index === currentDayIndex
                                  ? "text-primary bg-primary/5"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {day}
                              {off && (
                                <span className="mt-0.5 flex items-center justify-center gap-1 text-3xs font-normal">
                                  <PartyPopper className="size-3 shrink-0" strokeWidth={1.75} />
                                  <span className="truncate">{off.holiday || t("noSchool")}</span>
                                </span>
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: maxPeriods }, (_, i) => i + 1).map((period) => {
                        // Get time from any day that has this period
                        let periodTime = "";
                        for (let d = 0; d < 5; d++) {
                          const slot = grid[d]?.[period];
                          if (slot) {
                            periodTime = formatWallClock(slot.start);
                            break;
                          }
                        }

                        return (
                          <tr key={period} className="border-b border-border/30 last:border-0">
                            <td className="p-3 text-xs text-muted-foreground align-top">
                              <div className="font-medium tabular-nums">{period}.</div>
                              <div className="text-3xs tabular-nums">{periodTime}</div>
                            </td>
                            {Array.from({ length: 5 }, (_, dayIndex) => {
                              const slot = grid[dayIndex]?.[period];
                              const isCurrentPeriod = getCurrentPeriodForDay(dayIndex) === period;
                              const isToday = dayIndex === currentDayIndex;
                              const isOff = weekStatus[dayIndex]?.reason === "holiday";

                              return (
                                <td
                                  key={dayIndex}
                                  className={`p-2 align-top ${
                                    isToday ? "bg-primary/5" : ""
                                  } ${isOff ? "opacity-50" : ""}`}
                                >
                                  {slot ? (
                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.9 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      transition={{ delay: dayIndex * 0.05 + period * 0.02 }}
                                      className={`p-3 rounded-lg transition-all ${
                                        isCurrentPeriod ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                                      }`}
                                      style={{
                                        backgroundColor: `${getSubjectColor(slot.subject)}15`,
                                        borderLeft: `3px solid ${getSubjectColor(slot.subject)}`,
                                      }}
                                    >
                                      <div className="flex items-center gap-1.5 mb-0.5">
                                        {(() => {
                                          const SubjectIcon = getSubjectIcon(slot.subject);
                                          return (
                                            <SubjectIcon
                                              className="size-3.5 shrink-0"
                                              strokeWidth={1.75}
                                              style={{ color: personText(getSubjectColor(slot.subject)) }}
                                            />
                                          );
                                        })()}
                                        <span
                                          className="font-medium text-sm truncate"
                                          style={{ color: personText(getSubjectColor(slot.subject)) }}
                                        >
                                          {slot.subject}
                                        </span>
                                      </div>
                                      {slot.room && (
                                        <div className="text-3xs text-muted-foreground">
                                          {t("roomLabel", { room: slot.room })}
                                        </div>
                                      )}
                                      {isCurrentPeriod && (
                                        <Badge
                                          className="mt-1 text-3xs px-1.5 py-0"
                                          style={{ backgroundColor: getSubjectColor(slot.subject) }}
                                        >
                                          {t("nowBadge")}
                                        </Badge>
                                      )}
                                    </motion.div>
                                  ) : (
                                    <div
                                      className="h-full min-h-[3.25rem] rounded-lg border border-dashed border-border/60"
                                      aria-label={t("freePeriodAria")}
                                    />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </motion.div>

        {/* Pack for tomorrow — interactive, session-local checklist (ephemeral by design) */}
        {maxPeriods > 0 && next && packReminders.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-6"
          >
            <Card className="overflow-hidden">
              <div className="bg-gradient-to-br from-primary to-primary/80 px-4 py-4 text-primary-foreground">
                <div className="flex items-center gap-2">
                  <Backpack className="size-5" strokeWidth={1.75} />
                  <h2 className="text-lg font-semibold" data-pack-for={next?.date}>
                    {nextKind === "monday"
                      ? t("packForMonday")
                      : nextKind === "tomorrow"
                        ? t("packForTomorrow")
                        : t("packForDate", { date: nextDateLabel })}
                  </h2>
                </div>
                <p className="text-kiosk-label mt-1 text-primary-foreground/80">
                  {nextKind === "monday"
                    ? t("packListMonday")
                    : nextKind === "tomorrow"
                      ? t("packListTomorrow", { day: reminderDayLabel })
                      : t("packListDate", { date: nextDateLabel })}
                </p>
              </div>
              <CardContent className="space-y-2 p-4 pt-4">
                {packReminders.flatMap((reminder) =>
                  reminder.items.map((item) => {
                    const key = `${reminder.subject}:${item}`;
                    return (
                      <ChecklistItem
                        key={key}
                        checked={packedKeys.has(key)}
                        onCheckedChange={() => togglePacked(key)}
                        color={reminder.color}
                        label={item}
                        meta={
                          <span className="text-xs font-medium" style={{ color: personText(reminder.color) }}>
                            {reminder.subject}
                          </span>
                        }
                      />
                    );
                  })
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Tomorrow's Schedule Preview */}
        {maxPeriods > 0 && next && (() => {
          // The next school day this child has lessons, as the pack list above.
          const targetDay = reminderTargetDay;
          const tomorrowSlots = Array.from({ length: maxPeriods }, (_, i) => i + 1)
            .map((period) => grid[targetDay]?.[period])
            .filter(Boolean) as TimeSlot[];

          if (tomorrowSlots.length === 0) return null;

          return (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mt-6"
            >
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-4 text-primary" strokeWidth={1.75} />
                    <h2 className="text-xl font-medium" data-next-school-day={next.date}>
                      {nextKind === "monday"
                        ? t("tomorrowMonday")
                        : nextKind === "tomorrow"
                          ? t("tomorrowDay", { day: reminderDayLabel })
                          : tWidget("nextSchoolDayOn", { date: nextDateLabel })}
                    </h2>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {t("tomorrowPeriodCount", { count: tomorrowSlots.length })}
                  </Badge>
                </div>
                <CardContent className="space-y-2 p-4 pt-4">
                  {tomorrowSlots.map((slot, i) => {
                    const color = getSubjectColor(slot.subject);
                    const SubjectIcon = getSubjectIcon(slot.subject);
                    return (
                      <motion.div
                        key={`${slot.period}-${slot.subject}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 + i * 0.04 }}
                        className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 elev-sm"
                        style={{ borderLeft: `3px solid ${color}` }}
                      >
                        <span className="text-xs font-bold tabular-nums" style={{ color: personText(color) }}>
                          {formatWallClock(slot.start)}
                        </span>
                        <SubjectIcon className="size-4 shrink-0" strokeWidth={1.75} style={{ color: personText(color) }} />
                        <span className="flex-1 text-sm font-semibold">{slot.subject}</span>
                      </motion.div>
                    );
                  })}
                </CardContent>
              </Card>
            </motion.div>
          );
        })()}

        {/* Weekly Subject Statistics */}
        {subjectStats.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-6"
          >
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="size-4 text-primary" strokeWidth={1.75} />
                  <h2 className="text-xl font-medium">{t("weeklyTitle")}</h2>
                </div>
                <span className="text-xs text-muted-foreground">{t("weeklyTotal", { count: totalPeriods })}</span>
              </div>
              <div className="p-4 space-y-2.5">
                {subjectStats.map((stat, i) => {
                  const color = getSubjectColor(stat.subject);
                  const SubjectIcon = getSubjectIcon(stat.subject);
                  const pct = Math.round((stat.count / totalPeriods) * 100);

                  return (
                    <motion.div
                      key={stat.subject}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.35 + i * 0.03 }}
                      className="flex items-center gap-3"
                    >
                      <div className="flex items-center gap-2 w-28 sm:w-36 shrink-0 min-w-0">
                        <SubjectIcon className="size-3.5 shrink-0" style={{ color: personText(color) }} />
                        <span className="text-xs font-medium truncate" style={{ color: personText(color) }}>
                          {stat.subject}
                        </span>
                      </div>
                      <div className="flex-1 h-5 rounded-full bg-muted/30 overflow-hidden relative">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: `${color}40` }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, delay: 0.4 + i * 0.03 }}
                        />
                        <span
                          className="absolute inset-y-0 flex items-center text-3xs font-medium px-2"
                          style={{ color: personText(color) }}
                        >
                          {stat.count}×
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </Card>
          </motion.div>
        )}

      </div>
    </main>
  );
}
