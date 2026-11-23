import type { ComponentType } from "react";
import type { HomeWidgetKey } from "@/lib/layouts/types";
import type { HomeWidgetProps } from "./shared";

/** List widgets (RFC-022 §3.1): tasks, shopping, mealPlan, notes, messages, birthday, holidays, wasteCollection, countdown. Filled in group by group; a key missing here is not placeable yet. */
export const LISTS_WIDGETS: Partial<Record<HomeWidgetKey, ComponentType<HomeWidgetProps>>> = {};
