"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { WeatherNowChip } from "@/components/screensaver-weather";
import { NotSetUp, ValueFrame, type SaverWidgetProps } from "./shared";

/** The weather now: the built-in screensaver's chip (icon and temperature), fitted to the box. */
export function WeatherNowWidget({ box, editing }: SaverWidgetProps) {
  const { weather } = useScreensaverDataContext();
  const t = useTranslations("components.layouts");
  const ref = useRef<HTMLDivElement>(null);
  const size = useFitToBox(ref, box, [weather?.temp, weather?.conditionIcon]);
  // null: no location set (undefined is still loading, and shows nothing).
  if (weather === null) return editing ? <NotSetUp text={t("notSetUp.weatherNow")} /> : null;
  if (!weather) return null;
  return (
    <ValueFrame fitted={size !== null}>
      <div ref={ref} className="block w-fit shrink-0" style={size ? { fontSize: size } : undefined}>
        <WeatherNowChip weather={weather} scaled />
      </div>
    </ValueFrame>
  );
}
