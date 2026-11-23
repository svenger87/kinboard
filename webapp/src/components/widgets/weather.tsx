"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Wind,
  Droplets,
  Thermometer,
  Sunrise,
  Sunset,
  CloudOff,
  CloudSun,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWeather, useWeatherForecast, useWeatherUnits } from "@/hooks";
import { rainChanceShown } from "@/lib/rain-chance";
import { useTimeFormat } from "@/hooks/use-time-format";
import { WeatherModal } from "./weather-modal";
import { WidgetCard } from "@/components/widget-card";
import { weatherIcon } from "@/lib/weather-icon";

// The shared condition-to-icon table, for anything that draws this card's sky
// elsewhere (the RFC-022 weather box) and would otherwise keep its own copy.
export { weatherIcon };

interface WeatherProps {
  className?: string;
}

/*
 * The loading, unconfigured and error states keep the card's own header (icon
 * badge, title, accent border) like every other Home card's. They used to be a
 * bare Card with no title, so while the weather loaded or when it failed, Home
 * showed one headerless box among titled ones, and the skeleton was a
 * different height from the card that replaced it.
 */
function WeatherSkeleton({ className = "" }: { className?: string }) {
  const t = useTranslations("weather");
  return (
    <div aria-label={t("loadingAria")} aria-busy="true" className="h-full">
      <WidgetCard icon={CloudSun} title={t("title")} className={`h-full ${className}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <Skeleton className="size-10 rounded-xl" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </WidgetCard>
    </div>
  );
}

// OPENWEATHERMAP_API_KEY unset: the route returns { configured: false } and
// useWeather resolves to null (not an error). Surface an actionable CTA that
// deep-links to the weather settings instead of a dead "No data" string.
function WeatherNotConfigured({ className = "" }: { className?: string }) {
  const t = useTranslations("weather");
  return (
    <WidgetCard icon={CloudSun} title={t("title")} className={`h-full ${className}`}>
      <div className="flex flex-col items-center justify-center text-center py-2">
        <CloudOff className="size-8 mb-2 text-primary/60" strokeWidth={1.75} aria-hidden="true" />
        <p className="text-sm font-medium">{t("notConfiguredTitle")}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          {t("notConfiguredDescription")}
        </p>
        <Button variant="outline" asChild className="mt-3 min-h-11">
          <Link href="/settings/weather">{t("notConfiguredAction")}</Link>
        </Button>
      </div>
    </WidgetCard>
  );
}

/*
 * The server's message is English and for a log ("Failed to fetch weather
 * data"); it was printed under the title as it came, so a German or French
 * Home showed it untranslated. The one case a person can act on, a location
 * the provider doesn't know, gets its own sentence and a way to fix it.
 */
function WeatherError({ error, className = "" }: { error: Error | null; className?: string }) {
  const t = useTranslations("weather");
  const locationNotFound = error?.message === "Location not found";
  return (
    <WidgetCard icon={CloudSun} title={t("title")} className={`h-full ${className}`}>
      <div className="flex flex-col items-center justify-center text-center py-2" role="status">
        <CloudOff className="size-8 mb-2 text-destructive/60" strokeWidth={1.75} aria-hidden="true" />
        <p className="text-sm font-medium">{t("errorTitle")}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          {locationNotFound ? t("errorLocationNotFound") : t("errorRetrying")}
        </p>
        {locationNotFound && (
          <Button variant="outline" asChild className="mt-3 min-h-11">
            <Link href="/settings/weather">{t("errorLocationAction")}</Link>
          </Button>
        )}
      </div>
    </WidgetCard>
  );
}

export function Weather({ className = "" }: WeatherProps) {
  const t = useTranslations("weather");
  const [modalOpen, setModalOpen] = useState(false);
  const { data: weatherData, isPending, error, dataUpdatedAt } = useWeather();
  const { labels: unitLabels } = useWeatherUnits();
  const { data: forecast } = useWeatherForecast();
  // Sunrise and sunset arrive as "HH:mm" at the weather location — the server
  // works them out there and cannot know this household's clock setting.
  // `formatTime` is for "as of", which is an instant on this screen's clock.
  const { formatWallClock, formatTime } = useTimeFormat();

  // `isPending`, not `isLoading`: the query is held back until the location
  // and unit settings have loaded, and a held-back query is pending but not
  // loading. Asking `isLoading` fell through to "Weather not set up" for that
  // moment on every Home load, flashing the setup prompt at configured homes.
  if (!weatherData && isPending) {
    return <WeatherSkeleton className={className} />;
  }

  // null data without an error means the server reported configured:false
  // (no API key). Distinguish that from a real fetch error.
  if (!weatherData && !error) {
    return <WeatherNotConfigured className={className} />;
  }

  // Only when there is nothing to show. A refetch that fails keeps the last
  // reading (React Query holds on to it), and that is still the right thing
  // on a wall display: it used to swap ten minutes old weather for an error
  // card at the first network blip, until the next good fetch.
  if (!weatherData) {
    return <WeatherError error={error} className={className} />;
  }
  // The last refetch failed, so the reading on screen is getting old: say from when.
  const asOf = error ? formatTime(dataUpdatedAt) : null;

  const WeatherIcon = weatherIcon(weatherData.conditionMain ?? weatherData.condition, weatherData.conditionIcon);

  // Get next 6 days forecast (skip today, show rest of the week)
  const upcomingDays = forecast?.daily?.slice(1, 7) || [];

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <WidgetCard
          icon={CloudSun}
          title={t("title")}
          onClick={() => setModalOpen(true)}
          className={`h-full ${className}`}
          headerRight={asOf && (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums"
              data-testid="weather-stale"
              title={t("staleAria", { time: asOf })}
            >
              <CloudOff className="size-3.5" aria-hidden="true" />
              <span aria-hidden="true">{t("staleAsOf", { time: asOf })}</span>
              <span className="sr-only">{t("staleAria", { time: asOf })}</span>
            </span>
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help shrink-0">
                    <WeatherIcon className="size-10 text-primary" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{weatherData.condition}</p>
                </TooltipContent>
              </Tooltip>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="font-display text-5xl font-light tracking-tight tabular-nums whitespace-nowrap">
                    {weatherData.temp}°
                  </p>
                  {/* Number check, not truthiness: 0° is falsy, so at
                      exactly freezing this row vanished — the one
                      temperature where the day's range matters most. */}
                  {weatherData.high !== undefined && weatherData.low !== undefined && (
                    <div className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                      <span className="sr-only">{t("highLowLabel", { high: weatherData.high, low: weatherData.low })}</span>
                      <span aria-hidden="true">
                        <span className="text-foreground/70">{weatherData.high}°</span>
                        {" / "}
                        <span>{weatherData.low}°</span>
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-sm font-medium text-muted-foreground">{weatherData.condition}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 text-right min-w-0">
              {/* A long place name ("Garmisch-Partenkirchen") truncates inside
                  its badge instead of pushing the temperature out of the card. */}
              <Badge variant="neutral" className="font-medium max-w-full min-w-0" title={weatherData.location}>
                <span className="truncate">{weatherData.location}</span>
              </Badge>
              <div className="flex flex-col gap-1 text-sm text-muted-foreground tabular-nums">
                <span className="flex items-center justify-end gap-1 whitespace-nowrap">
                  <Droplets className="size-3" aria-hidden="true" />
                  <span aria-hidden="true">{weatherData.humidity}%</span>
                  <span className="sr-only">{t("humidityLabel", { value: weatherData.humidity })}</span>
                </span>
                <span className="flex items-center justify-end gap-1 whitespace-nowrap">
                  <Wind className="size-3" aria-hidden="true" />
                  <span aria-hidden="true">{weatherData.windSpeed} {unitLabels.speed}</span>
                  <span className="sr-only">{t("windLabel", { value: weatherData.windSpeed, unit: unitLabels.speed })}</span>
                </span>
                {/* Same trap: "feels like 0°" disappeared entirely. */}
                {weatherData.feelsLike !== undefined && (
                  <span className="flex items-center justify-end gap-1 whitespace-nowrap">
                    <Thermometer className="size-3" aria-hidden="true" />
                    {t("feelsLike", { temp: weatherData.feelsLike })}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Mini Forecast */}
          {upcomingDays.length > 0 && (
            <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-border/30">
              {upcomingDays.map((day) => {
                const DayIcon = weatherIcon(day.conditionMain ?? day.condition, day.conditionIcon);
                // Every day shows its chance, 0% included (lib/rain-chance.ts).
                const showRain = rainChanceShown(day.precipProbability);
                const isHighRain = day.precipProbability > 40;
                return (
                  <Tooltip key={day.date}>
                    <TooltipTrigger asChild>
                      <div className="flex flex-col items-center gap-1 flex-1 min-w-0 cursor-help">
                        <span className="text-xs text-muted-foreground">{day.dayName}</span>
                        <DayIcon className="size-5 text-primary/70" strokeWidth={1.75} aria-hidden="true" />
                        <div className="text-xs tabular-nums whitespace-nowrap">
                          <span className="sr-only">{t("highLowLabel", { high: day.tempMax, low: day.tempMin })}</span>
                          <span className="font-medium" aria-hidden="true">{day.tempMax}°</span>
                          <span className="text-muted-foreground" aria-hidden="true"> {day.tempMin}°</span>
                        </div>
                        {showRain && (
                          <span // Was text-blue-400/50 — a raw palette colour at half opacity, which
                          // measured 2.61:1 in dark and 1.53:1 in light, the lowest-contrast
                          // element on the dashboard (audit KB-47). The semantic token
                          // follows light/dark, and full opacity carries the contrast.
                          className={`flex items-center gap-0.5 text-xs tabular-nums ${isHighRain ? "text-weather-rain font-semibold" : "text-weather-rain/80"}`}>
                            <Droplets className="size-2.5" aria-hidden="true" />
                            {day.precipProbability}%
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t("forecastTooltip", { condition: day.condition, percent: day.precipProbability })}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}

          {/* Sun times */}
          {weatherData.sunrise && weatherData.sunset && (
            <div className={`flex items-center justify-center gap-6 ${upcomingDays.length > 0 ? "mt-3 pt-3" : "mt-4 pt-4"} border-t border-border/30`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help tabular-nums">
                    <Sunrise className="size-3.5 text-weather-sunrise" aria-hidden="true" />
                    <span aria-hidden="true">{formatWallClock(weatherData.sunrise)}</span>
                    <span className="sr-only">{t("sunriseLabel", { time: formatWallClock(weatherData.sunrise) })}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("sunriseTooltip")}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help tabular-nums">
                    <Sunset className="size-3.5 text-weather-sunset" aria-hidden="true" />
                    <span aria-hidden="true">{formatWallClock(weatherData.sunset)}</span>
                    <span className="sr-only">{t("sunsetLabel", { time: formatWallClock(weatherData.sunset) })}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("sunsetTooltip")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </WidgetCard>
        <WeatherModal open={modalOpen} onOpenChange={setModalOpen} />
      </motion.div>
    </TooltipProvider>
  );
}
