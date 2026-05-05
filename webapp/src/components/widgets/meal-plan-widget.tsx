"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  UtensilsCrossed,
  Coffee,
  Sunset,
  Cookie,
  ChevronRight,
  Clock,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";
import { useMealPlan, getWeekStart } from "@/hooks";
import type { MealType } from "@/types/database";

interface MealPlanWidgetProps {
  className?: string;
}

const MEAL_TYPE_ICONS: Record<MealType, typeof Coffee> = {
  breakfast: Coffee,
  lunch: UtensilsCrossed,
  dinner: Sunset,
  snack: Cookie,
};

const MEAL_TYPE_COLORS: Record<MealType, string> = {
  breakfast: "#f59e0b",
  lunch: "#3b82f6",
  dinner: "#8b5cf6",
  snack: "#10b981",
};

// Ordered meal types for display
const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

function MealPlanWidgetSkeleton() {
  const t = useTranslations("mealPlanWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-5 w-28" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
      </CardContent>
    </Card>
  );
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function MealPlanWidget({ className = "" }: MealPlanWidgetProps) {
  const t = useTranslations("mealPlanWidget");
  const tMealType = useTranslations("meals.mealType");
  const mealTypeLabels: Record<MealType, string> = {
    breakfast: tMealType("breakfast"),
    lunch: tMealType("lunch"),
    dinner: tMealType("dinner"),
    snack: tMealType("snack"),
  };

  // Recompute "today" every minute so a kiosk display stays correct past midnight
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = useMemo(() => toLocalDateString(now), [now]);
  const weekStart = useMemo(() => getWeekStart(now), [now]);

  const { data, isLoading, isError } = useMealPlan(weekStart);

  // Filter entries for today
  const todayMeals = useMemo(() => {
    if (!data?.entries) return [];
    return data.entries
      .filter((entry) => entry.date === today)
      .sort((a, b) => {
        const orderA = MEAL_ORDER.indexOf(a.meal_type as MealType);
        const orderB = MEAL_ORDER.indexOf(b.meal_type as MealType);
        return orderA - orderB;
      });
  }, [data, today]);

  if (isLoading) {
    return <MealPlanWidgetSkeleton />;
  }

  if (isError) {
    return (
      <Card className={`accent-border-top ${className}`}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl font-medium">
            <span className="p-1.5 rounded-lg bg-month-primary/10">
              <UtensilsCrossed className="size-5 text-month-primary" strokeWidth={1.5} />
            </span>
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
            <UtensilsCrossed className="size-8 mb-2 text-destructive/40" />
            <p className="text-sm">{t("errorMessage")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <Card className={`accent-border-top ${className}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-xl font-medium">
                <span className="p-1.5 rounded-lg bg-month-primary/10">
                  <UtensilsCrossed className="size-5 text-month-primary" strokeWidth={1.5} />
                </span>
                {t("title")}
                {todayMeals.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-medium">
                    {todayMeals.length}
                  </Badge>
                )}
              </CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/meals"
                    className="p-1 rounded-lg hover:bg-white/5 transition-colors"
                    aria-label={t("weekplanLink")}
                  >
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("weekplanLink")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent>
            {todayMeals.length === 0 ? (
              <Link href="/meals" className="flex flex-col items-center justify-center py-4 text-muted-foreground hover:text-foreground transition-colors group">
                <UtensilsCrossed className="size-8 mb-2 text-month-primary/20 group-hover:text-month-primary/40 transition-colors" />
                <p className="text-sm">{t("emptyTitle")}</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">{t("emptyDescription")}</p>
              </Link>
            ) : (
            <div className="flex flex-col gap-2">
              {todayMeals.map((entry) => {
                const mealType = entry.meal_type as MealType;
                const Icon = MEAL_TYPE_ICONS[mealType] || UtensilsCrossed;
                const color = MEAL_TYPE_COLORS[mealType] || "#6b7280";
                const title = entry.recipe?.title || entry.note || mealTypeLabels[mealType];
                const prepTime = entry.recipe?.total_time_minutes;

                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors"
                    style={{ backgroundColor: `${color}10` }}
                  >
                    <div
                      className="p-1.5 rounded-lg shrink-0"
                      style={{ backgroundColor: `${color}20` }}
                    >
                      <Icon className="size-4" style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{title}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{mealTypeLabels[mealType]}</span>
                        {prepTime && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="size-2.5" />
                            {prepTime < 60
                              ? t("timeMinutes", { count: prepTime })
                              : prepTime % 60 > 0
                                ? t("timeHoursMinutes", { hours: Math.floor(prepTime / 60), minutes: prepTime % 60 })
                                : t("timeHoursOnly", { hours: Math.floor(prepTime / 60) })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </TooltipProvider>
  );
}
