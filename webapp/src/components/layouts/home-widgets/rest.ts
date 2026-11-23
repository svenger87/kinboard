import type { ComponentType } from "react";
import type { HomeWidgetKey } from "@/lib/layouts/types";
import type { HomeWidgetProps } from "./shared";

/** Fixed and value widgets (RFC-022 §3.1): weekOverview, schedule, vehicles, stonks, pocketMoney, creatures, photos, timers, media. Filled in group by group; a key missing here is not placeable yet. */
export const REST_WIDGETS: Partial<Record<HomeWidgetKey, ComponentType<HomeWidgetProps>>> = {};
