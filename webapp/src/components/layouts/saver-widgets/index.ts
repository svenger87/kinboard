import type { ComponentType } from "react";
import type { SaverWidgetKey } from "@/lib/layouts/types";
import type { SaverWidgetProps } from "./shared";
import { ClockWidget } from "./clock";
import { DateWidget } from "./date";
import { NextEventWidget } from "./next-event";
import { WeatherNowWidget } from "./weather-now";
import { ForecastWidget } from "./forecast";
import { EventsWidget } from "./events";
import { BirthdaysWidget } from "./birthdays";
import { HolidaysWidget } from "./holidays";
import { NewsWidget } from "./news";
import { LessonsWidget } from "./lessons";
import { EnergyWidget } from "./energy";
import { VehiclesWidget } from "./vehicles";
import { PhotoCountWidget } from "./photo-count";

export type { SaverWidgetProps } from "./shared";

/**
 * One component per screensaver widget (lib/layouts/widgets.ts says which
 * kind each is). Each draws inside a box it did not choose and reads the
 * screensaver's data from ScreensaverDataProvider.
 */
export const SAVER_WIDGET_COMPONENTS: Record<SaverWidgetKey, ComponentType<SaverWidgetProps>> = {
  clock: ClockWidget,
  date: DateWidget,
  nextEvent: NextEventWidget,
  weatherNow: WeatherNowWidget,
  forecast: ForecastWidget,
  events: EventsWidget,
  birthdays: BirthdaysWidget,
  holidays: HolidaysWidget,
  news: NewsWidget,
  lessons: LessonsWidget,
  energy: EnergyWidget,
  vehicles: VehiclesWidget,
  photoCount: PhotoCountWidget,
};
