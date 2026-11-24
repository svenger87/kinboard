"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CloudOff, CloudSun } from "lucide-react";
import { useWeather, useWeatherForecast } from "@/hooks";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { WeatherModal } from "@/components/widgets/weather-modal";
import { weatherIcon } from "@/components/widgets/weather";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HOME_TARGET_H, HomeCardFrame } from "./upcoming-events";
import { useBoxFontSize } from "./clock";
import type { HomeWidgetProps } from "./shared";

/** A forecast day's width and the row's height, in em of the box's text size. */
const DAY_EM = 3.4;
const ROW_EM = 4.2;
/** The value needs at least this much height (em) left above the forecast row. */
const VALUE_MIN_EM = 2.6;

/** The size of an element's content box, followed as it resizes. */
function useElementSize(ref: RefObject<HTMLElement | null>, present: boolean) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setSize(null);
      return;
    }
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, present]);
  return size;
}

/**
 * The weather in a box (RFC-022 §3.1, value + fixed): the weather now --
 * icon, temperature, condition and the day's high and low -- as large as the
 * box allows, and the forecast row under it only when the box is wide and
 * tall enough for its days at the box's text size. Tapping the card opens
 * the weather dialog, over the layout, as the Weather card does.
 */
export function HomeWeatherWidget({ box, editing }: HomeWidgetProps) {
  const t = useTranslations("weather");
  const [open, setOpen] = useState(false);
  const { data: weather, isPending, error } = useWeather();
  const { data: forecast } = useWeatherForecast();

  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLButtonElement>(null);
  const value = useRef<HTMLDivElement>(null);
  const cap = useBoxFontSize(root, box);
  const area = useElementSize(body, !!weather);

  // As many of the next six days as fit across, when the box is tall enough
  // to keep the value readable above them.
  const days = forecast?.daily?.slice(1, 7) ?? [];
  const fitDays =
    cap !== null && area !== null && area.height >= (ROW_EM + VALUE_MIN_EM) * cap
      ? Math.min(days.length, Math.floor(area.width / (DAY_EM * cap)))
      : 0;
  const shownDays = fitDays >= 3 ? days.slice(0, fitDays) : [];
  const rowH = shownDays.length > 0 && cap !== null ? ROW_EM * cap : 0;
  const valueArea = area ? { width: area.width, height: Math.max(0, area.height - rowH) } : { width: 0, height: 0 };
  const size = useFitToBox(value, valueArea, [weather?.temp, weather?.condition, weather?.high, weather?.low]);

  let content: ReactNode = null;
  // As the Weather card decides (#513): `isPending`, since the query waits
  // for the location and units and is pending, not loading, until then; and
  // a failed refresh keeps the last reading rather than showing the error.
  if (!weather && isPending) {
    content = <p className="text-[0.8em] text-muted-foreground" aria-busy="true">{t("loadingAria")}</p>;
  } else if (!weather && !error) {
    // The server has no weather key: say so, with the way to set it up.
    content = (
      <div className="flex size-full items-center justify-center">
        <Link
          href="/settings/weather"
          title={t("notConfiguredTitle")}
          className={`${HOME_TARGET_H} inline-flex max-w-full items-center gap-[0.4em] rounded-[0.5em] px-[0.6em] text-[0.75em] font-medium text-primary hover:bg-accent/50`}
        >
          <CloudOff className="size-[1.2em] shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="truncate">{t("notConfiguredAction")}</span>
        </Link>
      </div>
    );
  } else if (!weather) {
    content = (
      <div className="flex size-full items-center justify-center gap-[0.4em] text-center">
        <CloudOff className="size-[1.2em] shrink-0 text-destructive" strokeWidth={1.75} aria-hidden="true" />
        <p className="truncate text-[0.8em] text-muted-foreground">{t("errorTitle")}</p>
      </div>
    );
  }

  const Icon = weather ? weatherIcon(weather.conditionMain ?? weather.condition, weather.conditionIcon) : CloudSun;

  return (
    <div ref={root} className="size-full">
      <HomeCardFrame icon={CloudSun} title={t("title")} onOpen={weather ? () => setOpen(true) : undefined} openLabel={t("detailsAria")} editing={editing} testId="home-widget-weather">
        {content ?? (weather && (
          <button
            ref={body}
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("detailsAria")}
            data-forecast-days={shownDays.length}
            className="flex size-full min-h-[48px] flex-col overflow-hidden rounded-[0.5em] text-left"
          >
            <div className="flex min-h-0 w-full flex-1 items-center justify-center">
              <div
                ref={value}
                className="flex w-fit shrink-0 items-center gap-[0.3em]"
                style={size !== null ? { fontSize: size } : { visibility: "hidden" }}
              >
                <Icon className="size-[0.9em] shrink-0 text-primary" strokeWidth={1.5} aria-hidden="true" />
                <div className="flex flex-col">
                  <span className="font-display text-[1em] font-light leading-none tracking-tight tabular-nums">{weather.temp}°</span>
                  <span className="mt-[0.1em] whitespace-nowrap text-[0.22em] font-medium text-muted-foreground">
                    {weather.condition}
                    {/* Number check: 0° is falsy, and freezing is where the range matters most. */}
                    {weather.high !== undefined && weather.low !== undefined && (
                      <span className="tabular-nums"> · {weather.high}° / {weather.low}°</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
            {shownDays.length > 0 && (
              <div
                data-testid="home-weather-forecast"
                className="flex w-full shrink-0 items-center justify-between border-t border-border/30"
                style={{ height: rowH }}
              >
                {shownDays.map((day) => {
                  const DayIcon = weatherIcon(day.conditionMain ?? day.condition, day.conditionIcon);
                  return (
                    <div key={day.date} className="flex flex-1 flex-col items-center gap-[0.15em]">
                      <span className="text-[0.65em] text-muted-foreground">{day.dayName}</span>
                      <DayIcon className="size-[1.1em] text-primary/70" strokeWidth={1.75} aria-hidden="true" />
                      <span className="whitespace-nowrap text-[0.65em] tabular-nums">
                        <span className="font-medium">{day.tempMax}°</span>
                        <span className="text-muted-foreground"> {day.tempMin}°</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </button>
        ))}
      </HomeCardFrame>
      {/* Over the layout, not inside the box (RFC-022 §3.3). The dialog's
          rain chances are tooltips, which need a provider above them. */}
      <TooltipProvider>
        <WeatherModal open={open} onOpenChange={setOpen} />
      </TooltipProvider>
    </div>
  );
}
