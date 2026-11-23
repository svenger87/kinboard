import type { ComponentType } from "react";
import type { HomeWidgetKey } from "@/lib/layouts/types";
import type { HomeWidgetProps } from "./shared";
import { TasksHomeWidget } from "./tasks";
import { ShoppingHomeWidget } from "./shopping";
import { MealPlanHomeWidget } from "./meal-plan";
import { NotesHomeWidget } from "./notes";
import { MessagesHomeWidget } from "./messages";
import { BirthdayHomeWidget } from "./birthday";
import { HolidaysHomeWidget } from "./holidays";
import { WasteCollectionHomeWidget } from "./waste-collection";
import { CountdownHomeWidget } from "./countdown";

/**
 * List widgets (RFC-022 §3.1): tasks, shopping, mealPlan, notes, messages,
 * birthday, holidays, wasteCollection, countdown. Each shows as many whole
 * entries as its box fits and ends in "+n" (list-shared.tsx), keeps its
 * touch targets at 48px or more, and reuses its Home card's logic.
 */
export const LISTS_WIDGETS: Partial<Record<HomeWidgetKey, ComponentType<HomeWidgetProps>>> = {
  tasks: TasksHomeWidget,
  shopping: ShoppingHomeWidget,
  mealPlan: MealPlanHomeWidget,
  notes: NotesHomeWidget,
  messages: MessagesHomeWidget,
  birthday: BirthdayHomeWidget,
  holidays: HolidaysHomeWidget,
  wasteCollection: WasteCollectionHomeWidget,
  countdown: CountdownHomeWidget,
};
