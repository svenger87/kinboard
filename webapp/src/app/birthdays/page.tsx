"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Cake,
  Plus,
  Calendar,
  Bell,
  Gift,
  PartyPopper,
  Trash2,
  Edit,
  Loader2,
} from "lucide-react";
import { GlassCard, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { BirthdayYearRing } from "@/components/birthday-year-ring";
import { PageHeader } from "@/components/page-header";
import { format, differenceInDays, differenceInYears, setYear, isPast, addYears, parseISO, startOfDay } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";

// Parse date string safely without timezone issues
// "1990-01-28" should be January 28th, not January 27th due to UTC conversion
function parseBirthdayDate(dateStr: string): Date {
  // parseISO returns UTC, but we want local date
  // Add T12:00:00 to avoid timezone edge cases
  const date = parseISO(dateStr + "T12:00:00");
  return date;
}
import {
  useBirthdays,
  useCreateBirthday,
  useUpdateBirthday,
  useDeleteBirthday,
  usePeople,
  useKeyboardShortcuts,
  useSwipeNavigation,
} from "@/hooks";
import type { Birthday } from "@/types/database";

function getNextBirthday(date: Date): Date {
  const today = startOfDay(new Date());
  const thisYearBirthday = startOfDay(setYear(date, today.getFullYear()));

  // If birthday already passed this year (not today), advance to next year
  if (differenceInDays(today, thisYearBirthday) > 0) {
    return addYears(thisYearBirthday, 1);
  }
  return thisYearBirthday;
}

function getDaysUntilBirthday(date: Date): number {
  const nextBirthday = getNextBirthday(date);
  // Use startOfDay to compare dates without time component
  return differenceInDays(startOfDay(nextBirthday), startOfDay(new Date()));
}

function getAge(date: Date): number {
  return differenceInYears(startOfDay(new Date()), startOfDay(date));
}

function getUpcomingAge(date: Date): number {
  const nextBirthday = getNextBirthday(date);
  return differenceInYears(nextBirthday, startOfDay(date));
}

function BirthdaysSkeleton() {
  return (
    <div className="divide-y divide-border">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

function CountdownRing({ days, size = 64, strokeWidth = 3, color, ariaLabel }: { days: number; size?: number; strokeWidth?: number; color: string; ariaLabel: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, 1 - days / 365);
  const offset = circumference * (1 - progress);

  return (
    <svg width={size} height={size} className="transform -rotate-90" role="img" aria-label={ariaLabel}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-white/10"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-1000"
      />
    </svg>
  );
}

export default function BirthdaysPage() {
  // Enable keyboard shortcuts and swipe navigation
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("birthdays");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) =>
      format(new Date(2000, i, 1), "MMMM", { locale: dateLocale })
    ),
    [dateLocale],
  );
  const monthsShort = useMemo(
    () => Array.from({ length: 12 }, (_, i) =>
      format(new Date(2000, i, 1), "MMM", { locale: dateLocale })
    ),
    [dateLocale],
  );

  const { data: birthdays, isLoading: loadingBirthdays, error: birthdaysError, refetch: refetchBirthdays } = useBirthdays();
  const { data: people, isLoading: loadingPeople, error: peopleError, refetch: refetchPeople } = usePeople();
  const createBirthday = useCreateBirthday();
  const updateBirthday = useUpdateBirthday();
  const deleteBirthday = useDeleteBirthday();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingBirthday, setEditingBirthday] = useState<Birthday | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDay, setFormDay] = useState("");
  const [formMonth, setFormMonth] = useState("");
  const [formYear, setFormYear] = useState("");
  const [formPersonId, setFormPersonId] = useState<string>("none");
  const [formNotifyDays, setFormNotifyDays] = useState("7");

  const isLoading = loadingBirthdays || loadingPeople;
  const error = birthdaysError || peopleError;

  const handleRetry = () => {
    if (birthdaysError) refetchBirthdays();
    if (peopleError) refetchPeople();
  };

  // Sort birthdays by days until next birthday (memoized)
  const sortedBirthdays = useMemo(() =>
    [...(birthdays || [])].sort((a, b) => {
      const dateA = parseBirthdayDate(a.date);
      const dateB = parseBirthdayDate(b.date);
      return getDaysUntilBirthday(dateA) - getDaysUntilBirthday(dateB);
    }),
    [birthdays]
  );

  const resetForm = () => {
    setFormName("");
    setFormDay("");
    setFormMonth("");
    setFormYear("");
    setFormPersonId("none");
    setFormNotifyDays("7");
  };

  const openEditDialog = (birthday: Birthday) => {
    setEditingBirthday(birthday);
    const date = parseBirthdayDate(birthday.date);
    setFormName(birthday.name);
    setFormDay(date.getDate().toString());
    setFormMonth((date.getMonth() + 1).toString());
    setFormYear(date.getFullYear().toString());
    setFormPersonId(birthday.person_id || "none");
    setFormNotifyDays(birthday.notify_days_before.toString());
  };

  const getMaxDaysInMonth = (month: number, year: number): number => {
    return new Date(year, month, 0).getDate();
  };

  const handleSave = async () => {
    if (!formName || !formDay || !formMonth) return;

    const year = formYear ? parseInt(formYear) : new Date().getFullYear();
    const month = parseInt(formMonth);
    const day = parseInt(formDay);
    const maxDays = getMaxDaysInMonth(month, year);

    if (day < 1 || day > maxDays) {
      toast.error(t("validationInvalidDate", { month: months[month - 1], maxDays }));
      return;
    }

    const dateStr = `${year}-${formMonth.padStart(2, "0")}-${formDay.padStart(2, "0")}`;

    const personId = formPersonId === "none" ? null : formPersonId;

    try {
      if (editingBirthday) {
        await updateBirthday.mutateAsync({
          id: editingBirthday.id,
          name: formName,
          date: dateStr,
          person_id: personId,
          notify_days_before: parseInt(formNotifyDays),
        });
        setEditingBirthday(null);
      } else {
        await createBirthday.mutateAsync({
          name: formName,
          date: dateStr,
          person_id: personId,
          notify_days_before: parseInt(formNotifyDays),
        });
        setIsAddOpen(false);
      }
      resetForm();
    } catch {
      toast.error(t("saveFailed"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBirthday.mutateAsync(id);
    } catch {
      toast.error(t("deleteFailed"));
    }
  };

  const getPerson = (personId?: string | null) => {
    return people?.find((p) => p.id === personId);
  };

  const isSaving = createBirthday.isPending || updateBirthday.isPending;

  // Split birthdays into upcoming (within 30 days) and later
  const upcomingBirthdays = sortedBirthdays.filter((b) => {
    const d = parseBirthdayDate(b.date);
    return getDaysUntilBirthday(d) <= 30;
  });
  const laterBirthdays = sortedBirthdays.filter((b) => {
    const d = parseBirthdayDate(b.date);
    return getDaysUntilBirthday(d) > 30;
  });

  // Group later birthdays by the month of their next birthday
  const laterByMonth = laterBirthdays.reduce<Record<number, typeof laterBirthdays>>((acc, birthday) => {
    const date = parseBirthdayDate(birthday.date);
    const nextBday = getNextBirthday(date);
    const month = nextBday.getMonth(); // 0-11
    if (!acc[month]) acc[month] = [];
    acc[month].push(birthday);
    return acc;
  }, {});

  // Sort months starting from next month after current
  const monthOrder = Object.keys(laterByMonth)
    .map(Number)
    .sort((a, b) => {
      const now = new Date().getMonth();
      const aOff = (a - now + 12) % 12;
      const bOff = (b - now + 12) % 12;
      return aOff - bOff;
    });

  // The next upcoming birthday for hero card
  const nextBirthday = sortedBirthdays.length > 0 ? sortedBirthdays[0] : null;
  const nextBirthdayDate = nextBirthday ? parseBirthdayDate(nextBirthday.date) : null;
  const nextDaysUntil = nextBirthdayDate ? getDaysUntilBirthday(nextBirthdayDate) : 0;
  const nextUpcomingAge = nextBirthdayDate ? getUpcomingAge(nextBirthdayDate) : 0;
  const nextPerson = nextBirthday ? getPerson(nextBirthday.person_id) : null;

  const getCountdownColor = (days: number) => {
    if (days === 0) return "hsl(var(--month-primary))";
    if (days <= 3) return "#f59e0b"; // amber — act now
    if (days <= 7) return "#3b82f6"; // blue — this week
    if (days <= 30) return "#64748b"; // slate — this month
    return "hsl(var(--muted-foreground))";
  };

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-screen p-4 md:p-8 safe-area-inset">
        {/* Background gradient */}
        <div className="page-gradient" />
        <div className="relative z-10 max-w-6xl mx-auto">
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <PageHeader
              icon={Cake}
              title={t("title")}
              backHref="/"
              className="mb-8"
              subtitle={
                <>
                  {t("subtitleSaved", { count: birthdays?.length || 0 })}
                  {upcomingBirthdays.length > 0 && (
                    <span className="text-month-primary"> · {t("subtitleUpcoming", { count: upcomingBirthdays.length })}</span>
                  )}
                </>
              }
              actions={
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="size-4" />
                    {t("newButton")}
                  </Button>
                </DialogTrigger>
              }
            />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("addDialogTitle")}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-4">
                  <div className="flex flex-col gap-2">
                    <Label>{t("fieldName")}</Label>
                    <Input
                      placeholder={t("namePlaceholder")}
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldDay")}</Label>
                      <Input
                        type="number"
                        min="1"
                        max="31"
                        placeholder="15"
                        value={formDay}
                        onChange={(e) => setFormDay(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldMonth")}</Label>
                      <Select value={formMonth} onValueChange={setFormMonth}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("monthPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {months.map((month, i) => (
                            <SelectItem key={i} value={(i + 1).toString()}>
                              {month}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldYearOptional")}</Label>
                      <Input
                        type="number"
                        min="1900"
                        max={new Date().getFullYear()}
                        placeholder="1985"
                        value={formYear}
                        onChange={(e) => setFormYear(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>{t("fieldPersonOptional")}</Label>
                    <Select value={formPersonId} onValueChange={setFormPersonId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("personUnassigned")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("personUnassigned")}</SelectItem>
                        {(people || []).map((person) => (
                          <SelectItem key={person.id} value={person.id}>
                            <div className="flex items-center gap-2">
                              <div
                                className="size-3 rounded-full"
                                style={{ backgroundColor: person.color }}
                              />
                              {person.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>{t("fieldReminderWithUnit")}</Label>
                    <Select value={formNotifyDays} onValueChange={setFormNotifyDays}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">{t("remind1Day")}</SelectItem>
                        <SelectItem value="3">{t("remind3Days")}</SelectItem>
                        <SelectItem value="7">{t("remind1Week")}</SelectItem>
                        <SelectItem value="14">{t("remind2Weeks")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setIsAddOpen(false); resetForm(); }}>
                    {tCommon("cancel")}
                  </Button>
                  <Button onClick={handleSave} disabled={!formName || !formDay || !formMonth || isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        {t("saving")}
                      </>
                    ) : (
                      tCommon("save")
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

          {error ? (
            <ErrorState
              onRetry={handleRetry}
              message={t("errorMessage")}
            />
          ) : isLoading ? (
            <BirthdaysSkeleton />
          ) : sortedBirthdays.length === 0 ? (
            <GlassCard>
              <CardContent className="p-0">
                <EmptyState
                  icon={Cake}
                  title={t("emptyTitle")}
                  description={t("emptyDescription")}
                  action={{
                    label: t("emptyAction"),
                    onClick: () => setIsAddOpen(true),
                  }}
                />
              </CardContent>
            </GlassCard>
          ) : (
            <>
              {/* Year-at-a-glance strip */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="mb-6"
              >
                <GlassCard className="overflow-hidden">
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <Calendar className="size-4 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("yearOverview")}
                      </span>
                    </div>
                    <div className="flex gap-1 sm:gap-1.5">
                      {Array.from({ length: 12 }, (_, month) => {
                        const now = new Date();
                        const currentMonth = now.getMonth();
                        const isCurrentMonth = month === currentMonth;
                        const birthdaysInMonth = sortedBirthdays.filter((b) => {
                          const d = parseBirthdayDate(b.date);
                          return d.getMonth() === month;
                        });
                        const hasBirthdays = birthdaysInMonth.length > 0;

                        return (
                          <Tooltip key={month}>
                            <TooltipTrigger asChild>
                              <div className="flex-1 flex flex-col items-center gap-1.5">
                                <span className={`text-[10px] sm:text-xs font-medium ${
                                  isCurrentMonth ? "text-month-primary" : "text-muted-foreground/60"
                                }`}>
                                  {monthsShort[month]}
                                </span>
                                <div className={`w-full h-1.5 rounded-full transition-colors ${
                                  isCurrentMonth
                                    ? "bg-month-primary/30"
                                    : "bg-muted/40"
                                }`}>
                                  {hasBirthdays && (
                                    <div
                                      className={`h-full rounded-full ${
                                        isCurrentMonth ? "bg-month-primary" : "bg-month-primary/60"
                                      }`}
                                      style={{ width: "100%" }}
                                    />
                                  )}
                                </div>
                                {/* Birthday dots */}
                                <div className="flex gap-0.5 justify-center min-h-[8px]">
                                  {birthdaysInMonth.slice(0, 4).map((b, i) => {
                                    const person = getPerson(b.person_id);
                                    return (
                                      <div
                                        key={b.id}
                                        className="size-1.5 sm:size-2 rounded-full"
                                        style={{
                                          backgroundColor: person?.color || "hsl(var(--month-primary))",
                                          opacity: isCurrentMonth ? 1 : 0.7,
                                        }}
                                      />
                                    );
                                  })}
                                  {birthdaysInMonth.length > 4 && (
                                    <span className="text-[8px] text-muted-foreground">+{birthdaysInMonth.length - 4}</span>
                                  )}
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <p className="font-medium">{months[month]}</p>
                              {birthdaysInMonth.length === 0 ? (
                                <p className="text-xs text-muted-foreground">{t("monthEmptyTooltip")}</p>
                              ) : (
                                birthdaysInMonth.map((b) => (
                                  <p key={b.id} className="text-xs">{b.name}</p>
                                ))
                              )}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </CardContent>
                </GlassCard>
              </motion.div>

              {/* Hero Card — Next Birthday */}
              {nextBirthday && nextBirthdayDate && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mb-6"
                >
                  <GlassCard className={`overflow-hidden ${nextDaysUntil === 0 ? "ring-2 ring-month-primary/50" : ""}`}>
                    <CardContent className="p-0">
                      <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6">
                        {/* Decorative gradient */}
                        <div
                          className="absolute inset-0 opacity-10"
                          style={{
                            background: `radial-gradient(circle at 20% 50%, ${getCountdownColor(nextDaysUntil)}, transparent 70%)`,
                          }}
                        />
                        {/* Countdown Ring */}
                        <div className="relative shrink-0">
                          <CountdownRing
                            days={nextDaysUntil}
                            size={100}
                            strokeWidth={4}
                            color={getCountdownColor(nextDaysUntil)}
                            ariaLabel={t("daysSuffix", { count: nextDaysUntil })}
                          />
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            {nextDaysUntil === 0 ? (
                              <PartyPopper className="size-8 text-month-primary" />
                            ) : (
                              <>
                                <span className="text-kiosk-hero tabular-nums" style={{ color: getCountdownColor(nextDaysUntil) }}>
                                  {nextDaysUntil}
                                </span>
                                <span className="text-kiosk-label">
                                  {t("daysUnit", { count: nextDaysUntil })}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        {/* Info */}
                        <div className="relative text-center sm:text-left flex-1">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                            {nextDaysUntil === 0 ? t("todayHero") : t("nextHero")}
                          </p>
                          <h2 className="text-2xl sm:text-3xl font-display font-light mb-1">
                            {nextBirthday.name}
                          </h2>
                          <div className="flex items-center justify-center sm:justify-start gap-3 text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <Calendar className="size-3.5" />
                              {format(nextBirthdayDate, "d. MMMM", { locale: dateLocale })}
                            </span>
                            {nextBirthdayDate.getFullYear() < new Date().getFullYear() && (
                              <Badge variant="outline" className="text-xs">
                                {t("ageTurns", { age: nextUpcomingAge })}
                              </Badge>
                            )}
                            {nextPerson && (
                              <Badge
                                variant="outline"
                                className="text-xs"
                                style={{ borderColor: nextPerson.color, color: nextPerson.color }}
                              >
                                {nextPerson.name}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {/* Gift icon */}
                        <div className="hidden sm:block relative">
                          {nextDaysUntil === 0 ? (
                            <PartyPopper className="size-12 text-month-primary/30" />
                          ) : (
                            <Gift className="size-12 text-white/10" />
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </GlassCard>
                </motion.div>
              )}

              {/* Year Ring Visualization */}
              {sortedBirthdays.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.15 }}
                  className="mb-6"
                >
                  <GlassCard>
                    <CardContent className="py-6 px-4">
                      <h3 className="text-kiosk-label mb-4 text-center">
                        {t("yearOverview")}
                      </h3>
                      <BirthdayYearRing
                        birthdays={sortedBirthdays.map((b) => {
                          const date = parseBirthdayDate(b.date);
                          const person = getPerson(b.person_id);
                          return {
                            id: b.id,
                            name: b.name,
                            date,
                            daysUntil: getDaysUntilBirthday(date),
                            color: person?.color || "hsl(var(--month-primary))",
                          };
                        })}
                      />
                    </CardContent>
                  </GlassCard>
                </motion.div>
              )}

              {/* Upcoming Section (within 30 days) */}
              {upcomingBirthdays.length > 1 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                  className="mb-6"
                >
                  <h3 className="text-kiosk-label mb-3 px-1">
                    {t("soonSection", { count: upcomingBirthdays.length })}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {upcomingBirthdays.slice(1).map((birthday, index) => {
                      const date = parseBirthdayDate(birthday.date);
                      const daysUntil = getDaysUntilBirthday(date);
                      const upcomingAge = getUpcomingAge(date);
                      const person = getPerson(birthday.person_id);
                      const isToday = daysUntil === 0;
                      const isSoon = daysUntil <= 7;

                      return (
                        <motion.div
                          key={birthday.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.2 + index * 0.05 }}
                        >
                          <GlassCard className={`group hover:bg-white/[0.06] transition-all ${isToday ? "ring-1 ring-month-primary/40" : ""}`}>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-3">
                                {/* Mini countdown ring */}
                                <div className="relative shrink-0">
                                  <CountdownRing
                                    days={daysUntil}
                                    size={48}
                                    strokeWidth={2.5}
                                    color={getCountdownColor(daysUntil)}
                                    ariaLabel={t("daysSuffix", { count: daysUntil })}
                                  />
                                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-sm font-bold tabular-nums" style={{ color: getCountdownColor(daysUntil) }}>
                                      {daysUntil}
                                    </span>
                                  </div>
                                </div>
                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">{birthday.name}</p>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{format(date, "d. MMM", { locale: dateLocale })}</span>
                                    {date.getFullYear() < new Date().getFullYear() && (
                                      <span>{t("ageTurns", { age: upcomingAge })}</span>
                                    )}
                                  </div>
                                </div>
                                {/* Actions */}
                                <div className="flex items-center gap-0.5 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-9"
                                    onClick={() => openEditDialog(birthday)}
                                    aria-label={t("editAria", { name: birthday.name })}
                                  >
                                    <Edit className="size-4" />
                                  </Button>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button variant="ghost" size="icon" className="size-9 text-destructive hover:text-destructive" aria-label={t("deleteAria", { name: birthday.name })}>
                                        <Trash2 className="size-4" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          {t("deleteDescription", { name: birthday.name })}
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() => handleDelete(birthday.id)}
                                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        >
                                          {tCommon("delete")}
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              </div>
                            </CardContent>
                          </GlassCard>
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* All Birthdays — Grouped by Month */}
              {laterBirthdays.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.25 }}
                  className="space-y-4"
                >
                  <h3 className="text-kiosk-label px-1">
                    {t("moreSection", { count: laterBirthdays.length })}
                  </h3>
                  {monthOrder.map((month, mIdx) => (
                    <motion.div
                      key={month}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 + mIdx * 0.06 }}
                    >
                      {/* Month header */}
                      <div className="flex items-center gap-3 mb-2 px-1">
                        <div className="flex items-center justify-center size-7 rounded-lg bg-month-primary/15">
                          <Cake className="size-3.5 text-month-primary" />
                        </div>
                        <span className="text-sm font-semibold text-month-primary">
                          {months[month]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t("perMonthCount", { count: laterByMonth[month].length })}
                        </span>
                        <div className="flex-1 h-px bg-border/50" />
                      </div>
                      <GlassCard>
                        <CardContent className="p-0">
                          <AnimatePresence mode="popLayout">
                            <div className="divide-y divide-border">
                              {laterByMonth[month].map((birthday, index) => {
                                const date = parseBirthdayDate(birthday.date);
                                const daysUntil = getDaysUntilBirthday(date);
                                const person = getPerson(birthday.person_id);
                                const age = getAge(date);
                                const upcomingAge = getUpcomingAge(date);

                                return (
                                  <motion.div
                                    key={birthday.id}
                                    layout
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20, scale: 0.95 }}
                                    transition={{ delay: index * 0.03 }}
                                    className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 hover:bg-white/[0.04] transition-all group"
                                  >
                                    {/* Countdown ring */}
                                    <div className="relative shrink-0">
                                      <CountdownRing
                                        days={daysUntil}
                                        size={48}
                                        strokeWidth={2.5}
                                        color={getCountdownColor(daysUntil)}
                                        ariaLabel={t("daysSuffix", { count: daysUntil })}
                                      />
                                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className="text-xs font-bold tabular-nums text-muted-foreground">
                                          {daysUntil}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-medium truncate">{birthday.name}</p>
                                        {person && (
                                          <Badge
                                            variant="outline"
                                            className="text-xs shrink-0"
                                            style={{ borderColor: person.color, color: person.color }}
                                          >
                                            {person.name}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 sm:gap-3 text-sm text-muted-foreground flex-wrap">
                                        <span className="flex items-center gap-1">
                                          <Calendar className="size-3 shrink-0" />
                                          <span className="whitespace-nowrap">
                                            {format(date, "d. MMM", { locale: dateLocale })}
                                          </span>
                                          {date.getFullYear() < new Date().getFullYear() && (
                                            <span className="text-xs">
                                              ({date.getFullYear()})
                                            </span>
                                          )}
                                        </span>
                                        {date.getFullYear() < new Date().getFullYear() && (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className="text-xs whitespace-nowrap">
                                                {t("ageTurns", { age: upcomingAge })}
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>{t("ageCurrent", { age })}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        )}
                                      </div>
                                    </div>

                                    {/* Days label */}
                                    <div className="text-right shrink-0">
                                      <p className="text-sm text-muted-foreground tabular-nums">
                                        {t("daysSuffix", { count: daysUntil })}
                                      </p>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-0.5 shrink-0 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-9"
                                        onClick={() => openEditDialog(birthday)}
                                        aria-label={t("editAria", { name: birthday.name })}
                                      >
                                        <Edit className="size-4" />
                                      </Button>
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="size-9 text-destructive hover:text-destructive"
                                            aria-label={t("deleteAria", { name: birthday.name })}
                                          >
                                            <Trash2 className="size-4" />
                                          </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              {t("deleteDescription", { name: birthday.name })}
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                                            <AlertDialogAction
                                              onClick={() => handleDelete(birthday.id)}
                                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            >
                                              {tCommon("delete")}
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </div>
                                  </motion.div>
                                );
                              })}
                            </div>
                          </AnimatePresence>
                        </CardContent>
                      </GlassCard>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </>
          )}

          {/* Edit Dialog (shared) */}
          {editingBirthday && (
            <Dialog open={!!editingBirthday} onOpenChange={(open) => !open && setEditingBirthday(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("editDialogTitle")}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-4">
                  <div className="flex flex-col gap-2">
                    <Label>{t("fieldName")}</Label>
                    <Input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldDay")}</Label>
                      <Input
                        type="number"
                        min="1"
                        max="31"
                        value={formDay}
                        onChange={(e) => setFormDay(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldMonth")}</Label>
                      <Select value={formMonth} onValueChange={setFormMonth}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {months.map((month, i) => (
                            <SelectItem key={i} value={(i + 1).toString()}>
                              {month}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldYear")}</Label>
                      <Input
                        type="number"
                        min="1900"
                        max={new Date().getFullYear()}
                        value={formYear}
                        onChange={(e) => setFormYear(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>{t("fieldPerson")}</Label>
                    <Select value={formPersonId} onValueChange={setFormPersonId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("personUnassigned")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("personUnassigned")}</SelectItem>
                        {(people || []).map((person) => (
                          <SelectItem key={person.id} value={person.id}>
                            <div className="flex items-center gap-2">
                              <div
                                className="size-3 rounded-full"
                                style={{ backgroundColor: person.color }}
                              />
                              {person.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>{t("fieldReminder")}</Label>
                    <Select value={formNotifyDays} onValueChange={setFormNotifyDays}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">{t("remind1Day")}</SelectItem>
                        <SelectItem value="3">{t("remind3Days")}</SelectItem>
                        <SelectItem value="7">{t("remind1Week")}</SelectItem>
                        <SelectItem value="14">{t("remind2Weeks")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setEditingBirthday(null); resetForm(); }}>
                    {tCommon("cancel")}
                  </Button>
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        {t("saving")}
                      </>
                    ) : (
                      tCommon("save")
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

        </div>
      </main>
    </TooltipProvider>
  );
}
