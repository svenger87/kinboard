"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Cloud, CloudLightning, CloudRain, CloudSnow, Droplets, Moon, Sun } from "lucide-react";
import { useWeatherForecast, type WeatherData } from "@/hooks/use-weather";
import { useTimeFormat } from "@/hooks/use-time-format";
import { upcomingSlots } from "@/lib/weather-effects";

/**
 * The screensaver's weather, top right: the current temperature, and with
 * Settings -> Screensaver -> Forecast on (#282) the next forecast slots beside
 * it, each with its time, an icon, the temperature and the chance of rain, so
 * a child can tell from across the room whether today is a raincoat day.
 *
 * The slots are OpenWeatherMap's, three hours apart: the free forecast has no
 * hourly steps. They come from the Weather widget's own query (same cache,
 * no extra provider calls), and move on by themselves as each slot ends.
 */
export function screensaverWeatherIcon(condition: string, icon?: string) {
  const c = condition.toLowerCase();
  if (c.includes("thunder") || c.includes("gewitter")) return CloudLightning;
  if (c.includes("snow") || c.includes("schnee")) return CloudSnow;
  if (c.includes("rain") || c.includes("regen") || c.includes("drizzle") || c.includes("niesel")) return CloudRain;
  if (c.includes("clear") || c.includes("klar") || c.includes("sun") || c.includes("sonn")) {
    // OpenWeatherMap's icon codes end in "n" at night: a clear night is a moon, not a sun.
    return icon?.endsWith("n") ? Moon : Sun;
  }
  return Cloud;
}

/** How many slots: five (fifteen hours) where there is room, three on a narrow screen. */
const SLOTS = 5;
const SLOTS_NARROW = 3;
/** At or above this chance the rain figure stands out. */
const RAIN_STANDS_OUT = 50;

export function ScreensaverWeather({
  weather,
  showForecast,
  large,
}: {
  weather: WeatherData;
  showForecast: boolean;
  large: boolean;
}) {
  const t = useTranslations("components.screensaver");
  const { formatWallClock } = useTimeFormat();
  const { data: forecast } = useWeatherForecast({ enabled: showForecast });
  const now = useMinuteClock();
  const slots = showForecast ? upcomingSlots(forecast?.hourly, now).slice(0, SLOTS) : [];
  const NowIcon = screensaverWeatherIcon(weather.conditionMain ?? weather.condition, weather.conditionIcon);

  if (slots.length === 0) return <WeatherNowChip weather={weather} />;

  const icon = large ? "size-9" : "size-7";
  const temp = large ? "text-3xl" : "text-2xl";
  const small = large ? "text-base" : "text-xs";
  return (
    <div
      className="flex items-stretch gap-1 bg-black/40 rounded-xl px-2 py-2.5 gpu-blur"
      data-testid="screensaver-forecast"
      data-slots={slots.length}
    >
      <Column label={t("forecastNow")} labelClass={small} strong>
        <NowIcon className={`${icon} text-white`} strokeWidth={1.75} />
        <span className={`font-display font-light ${temp} text-white tabular-nums leading-none`}>{Math.round(weather.temp)}°</span>
        {/* The rain row stays level across the columns: "now" has no chance, only the slots do. */}
        <span className={`${small} invisible`} aria-hidden="true">0%</span>
      </Column>
      <div className="w-px self-stretch bg-white/15 mx-1" aria-hidden="true" />
      {slots.map((slot, i) => {
        const Icon = screensaverWeatherIcon(slot.conditionMain ?? slot.condition, slot.conditionIcon);
        const wet = slot.precipProbability >= RAIN_STANDS_OUT;
        return (
          <Column
            key={slot.at ?? slot.time}
            label={formatWallClock(slot.time)}
            labelClass={small}
            className={i >= SLOTS_NARROW ? "hidden md:flex" : undefined}
          >
            <Icon className={`${icon} text-white`} strokeWidth={1.75} />
            <span className={`font-display font-light ${temp} text-white tabular-nums leading-none`}>{slot.temp}°</span>
            <span
              className={`flex items-center gap-0.5 tabular-nums ${small} ${wet ? "font-semibold text-sky-300" : "text-white/55"}`}
              data-wet={wet ? "true" : undefined}
            >
              <Droplets className={large ? "size-3.5" : "size-3"} aria-hidden="true" />
              {slot.precipProbability}%
            </span>
          </Column>
        );
      })}
    </div>
  );
}

/**
 * The weather now: an icon and the temperature on a dark chip. `scaled` draws
 * it in em of the font size around it, for a layout box that fits it.
 */
export function WeatherNowChip({ weather, scaled = false }: { weather: WeatherData; scaled?: boolean }) {
  const NowIcon = screensaverWeatherIcon(weather.conditionMain ?? weather.condition, weather.conditionIcon);
  return (
    <div
      className={
        scaled
          ? "flex items-center gap-[0.75em] bg-black/40 rounded-[0.75em] px-[1em] py-[0.625em]"
          : "flex items-center gap-3 bg-black/40 rounded-xl px-4 py-2.5"
      }
      data-testid={scaled ? undefined : "screensaver-weather"}
    >
      <NowIcon className={`${scaled ? "size-[1.75em]" : "size-7"} text-white`} strokeWidth={1.75} />
      <span className={`font-display font-light ${scaled ? "text-[1.875em]" : "text-3xl"} text-white tabular-nums leading-none`}>
        {Math.round(weather.temp)}°
      </span>
    </div>
  );
}

function Column({
  label,
  labelClass,
  strong = false,
  className,
  children,
}: {
  label: string;
  labelClass: string;
  strong?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex-col items-center gap-1.5 px-2 min-w-[3.5rem] ${className ?? "flex"}`}>
      <span className={`${labelClass} tabular-nums ${strong ? "font-semibold text-white/80" : "text-white/60"}`}>{label}</span>
      {children}
    </div>
  );
}

/** Now, to the minute, moving on by itself, so a slot that has ended drops off. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
