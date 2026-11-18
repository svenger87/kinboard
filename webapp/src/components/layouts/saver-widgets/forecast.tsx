"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useScreensaverDataContext } from "@/components/layouts/screensaver-data-context";
import { forecastSlotsFor, ScaledForecast, SCALED_FORECAST_EM_HEIGHT } from "@/components/screensaver-weather";
import { NotSetUp, type SaverWidgetProps } from "./shared";

/**
 * The weather now and the next forecast slots, as the built-in screensaver's
 * forecast strip, centred in its box. Sized in em of the box's text size,
 * made smaller only where the box is too short for the strip; as many slots
 * as the box is wide enough for (none: the weather now alone).
 */
export function ForecastWidget({ item, box, editing }: SaverWidgetProps) {
  const { weather, weatherFailed } = useScreensaverDataContext();
  const t = useTranslations("components.layouts");
  const root = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ font: number; slots: number } | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const base = parseFloat(getComputedStyle(el).fontSize);
    if (!(base > 0) || box.width <= 0 || box.height <= 0) return;
    const font = Math.min(base, box.height / SCALED_FORECAST_EM_HEIGHT);
    const slots = forecastSlotsFor(box.width, font);
    setFit((prev) => (prev && prev.font === font && prev.slots === slots ? prev : { font, slots }));
  }, [box.width, box.height, item.text, weather]);

  // null: the server has no weather service. Loading, or a location the
  // service cannot find, leaves no data.
  if (weather === null) return editing ? <NotSetUp text={t("notSetUp.forecast")} /> : null;
  if (!weather) return weatherFailed && editing ? <NotSetUp text={t("weatherFailed")} /> : null;
  return (
    <div ref={root} className="flex size-full items-center justify-center" style={fit ? undefined : { visibility: "hidden" }}>
      <div style={fit ? { fontSize: fit.font } : undefined}>
        <ScaledForecast weather={weather} slots={fit?.slots ?? 0} />
      </div>
    </div>
  );
}
