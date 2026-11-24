import type { ComponentType } from "react";
import type { HomeWidgetKey } from "@/lib/layouts/types";
import type { HomeWidgetProps } from "./shared";
import { WeekOverviewHomeWidget } from "./week-overview";
import { ScheduleHomeWidget } from "./schedule";
import { VehiclesHomeWidget } from "./vehicles";
import { StonksHomeWidget } from "./stonks";
import { PocketMoneyHomeWidget } from "./pocket-money";
import { CreaturesHomeWidget } from "./creatures";
import { PhotosHomeWidget } from "./photos";
import { TimersHomeWidget } from "./timers";
import { MediaHomeWidget } from "./media";

/**
 * Fixed and value widgets (RFC-022 §3.1): weekOverview, schedule, vehicles,
 * stonks, pocketMoney, creatures, photos, timers, media. A fixed one has a
 * layout of its own that drops detail as its box shrinks (useShrinkStep in
 * rest-shared.tsx); pocket money grows with its box (useFitToBox). Each
 * reuses its dashboard card's logic, exported from that card's file.
 */
export const REST_WIDGETS: Partial<Record<HomeWidgetKey, ComponentType<HomeWidgetProps>>> = {
  weekOverview: WeekOverviewHomeWidget,
  schedule: ScheduleHomeWidget,
  vehicles: VehiclesHomeWidget,
  stonks: StonksHomeWidget,
  pocketMoney: PocketMoneyHomeWidget,
  creatures: CreaturesHomeWidget,
  photos: PhotosHomeWidget,
  timers: TimersHomeWidget,
  media: MediaHomeWidget,
};
