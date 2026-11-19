"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { valueBox } from "@/lib/layouts/grid";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { WeatherNowChip } from "@/components/screensaver-weather";
import { NotSetUp, ValueFrame, type SaverWidgetProps } from "./shared";

/** The weather now: the built-in screensaver's chip (icon and temperature), fitted to the box. */
export function WeatherNowWidget({ item, box, editing }: SaverWidgetProps) {
  const { weather, weatherFailed } = useScreensaverDataContext();
  const t = useTranslations("components.layouts");
  const ref = useRef<HTMLDivElement>(null);
  const size = useFitToBox(ref, valueBox(box, item.text), [weather?.temp, weather?.conditionIcon]);
  // null: the server has no weather service. Loading, or a location the
  // service cannot find, leaves no data.
  if (weather === null) return editing ? <NotSetUp text={t("notSetUp.weatherNow")} /> : null;
  if (!weather) return weatherFailed && editing ? <NotSetUp text={t("weatherFailed")} /> : null;
  return (
    <ValueFrame fitted={size !== null}>
      <div ref={ref} className="block w-fit shrink-0" style={size ? { fontSize: size } : undefined}>
        <WeatherNowChip weather={weather} scaled />
      </div>
    </ValueFrame>
  );
}
