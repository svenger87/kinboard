"use client";

import { useTranslations } from "next-intl";
import { Clock, Utensils, UtensilsCrossed } from "lucide-react";
import { MEAL_TYPE_COLORS, MEAL_TYPE_ICONS, usePrepTimeLabel, useTodayMeals } from "@/components/widgets/meal-plan-widget";
import type { MealType } from "@/types/database";
import { CountBadge, HOME_ROW, HomeEmptyLine, HomeList, HomeListFrame } from "./list-shared";
import type { HomeWidgetProps } from "./shared";

type Meal = ReturnType<typeof useTodayMeals>["todayMeals"][number];

const keyOf = (m: Meal) => m.id;

/** Today's meals in the order of the day, as many as fit. "+n" and the title open /meals. */
export function MealPlanHomeWidget({ editing }: HomeWidgetProps) {
  const t = useTranslations("mealPlanWidget");
  const { todayMeals, mealTypeLabels } = useTodayMeals();
  const prepTimeLabel = usePrepTimeLabel();

  const renderItem = (entry: Meal) => {
    const mealType = entry.meal_type as MealType;
    const Icon = MEAL_TYPE_ICONS[mealType] || UtensilsCrossed;
    const color = MEAL_TYPE_COLORS[mealType] || "#6b7280";
    const title = entry.recipe?.title || entry.note || mealTypeLabels[mealType];
    const prepTime = entry.recipe?.total_time_minutes;
    return (
      <>
        <div className={HOME_ROW}>
          <span className="shrink-0 rounded-[0.4em] p-[0.3em]" style={{ backgroundColor: `${color}22`, color }}>
            <Icon className="size-[0.9em]" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-[0.9em] font-medium leading-snug">{title}</p>
            <p className="flex flex-wrap items-center gap-x-[0.5em] text-[0.7em] text-muted-foreground">
              <span>{mealTypeLabels[mealType]}</span>
              {prepTime ? (
                <span className="flex items-center gap-[0.2em] tabular-nums">
                  <Clock className="size-[0.9em]" aria-hidden="true" />
                  {prepTimeLabel(prepTime)}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </>
    );
  };

  return (
    <HomeListFrame
      testId="home-widget-mealPlan"
      icon={Utensils}
      title={t("title")}
      href="/meals"
      badge={<CountBadge count={todayMeals.length} />}
      editing={editing}
    >
      <HomeList items={todayMeals} keyOf={keyOf} renderItem={renderItem} empty={<HomeEmptyLine text={t("emptyTitle")} />} href="/meals" />
    </HomeListFrame>
  );
}
