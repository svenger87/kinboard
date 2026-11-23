import type { ComponentType } from "react";
import type { HomeWidgetKey } from "@/lib/layouts/types";
import type { HomeWidgetProps } from "./shared";

/** The clock block, taken apart (RFC-022 §3.2): clock, date, greeting, familyMembers, todayStrip; plus upcomingEvents and weather. Filled in group by group; a key missing here is not placeable yet. */
export const CLOCKBLOCK_WIDGETS: Partial<Record<HomeWidgetKey, ComponentType<HomeWidgetProps>>> = {};
