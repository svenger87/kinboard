import type { ComponentType } from "react";
import type { HomeWidgetKey } from "@/lib/layouts/types";
import type { HomeWidgetProps } from "./shared";
import { HomeClockWidget } from "./clock";
import { HomeDateWidget } from "./date";
import { HomeGreetingWidget } from "./greeting";
import { HomeFamilyMembersWidget } from "./family-members";
import { HomeTodayStripWidget } from "./today-strip";
import { HomeUpcomingEventsWidget } from "./upcoming-events";
import { HomeWeatherWidget } from "./weather";

/**
 * The clock block, taken apart (RFC-022 §3.2): clock, date, greeting,
 * familyMembers, todayStrip; plus upcomingEvents and weather, the first
 * group §7.4 builds.
 *
 * The clock, date, greeting and today strip read one shared clock when the
 * designed Home wraps its grid in a `ClockProvider` (with the family's
 * seconds setting); each starts its own otherwise. The events come from
 * `HomeDataProvider`.
 */
export const CLOCKBLOCK_WIDGETS: Partial<Record<HomeWidgetKey, ComponentType<HomeWidgetProps>>> = {
  clock: HomeClockWidget,
  date: HomeDateWidget,
  greeting: HomeGreetingWidget,
  familyMembers: HomeFamilyMembersWidget,
  todayStrip: HomeTodayStripWidget,
  upcomingEvents: HomeUpcomingEventsWidget,
  weather: HomeWeatherWidget,
};
