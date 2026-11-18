"use client";

import { useTranslations } from "next-intl";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { ScreensaverWeather } from "@/components/screensaver-weather";
import { NotSetUp, type SaverWidgetProps } from "./shared";

/**
 * The weather now and the next forecast slots: the built-in screensaver's
 * forecast strip, centred in its box. Drawn at one arrangement; the text sizes
 * L and XL draw it at the built-in's large details.
 */
export function ForecastWidget({ item, editing }: SaverWidgetProps) {
  const { weather } = useScreensaverDataContext();
  const t = useTranslations("components.layouts");
  // null: no location set (undefined is still loading, and shows nothing).
  if (weather === null) return editing ? <NotSetUp text={t("notSetUp.forecast")} /> : null;
  if (!weather) return null;
  return (
    <div className="flex size-full items-center justify-center">
      <ScreensaverWeather weather={weather} showForecast large={item.text === "L" || item.text === "XL"} />
    </div>
  );
}
