"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Wind,
  Droplets,
  Thermometer,
  Sunrise,
  Sunset,
  CloudOff,
  CloudSun,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
import { WeatherModal } from "./weather-modal";
import { WidgetCard } from "@/components/widget-card";

interface WeatherProps {
  className?: string;
}

const weatherIcons: Record<string, typeof Sun> = {
  clear: Sun,
  klar: Sun,
  sunny: Sun,
  sonnig: Sun,
  clouds: Cloud,
  cloudy: Cloud,
  bewölkt: Cloud,
  rain: CloudRain,
  regen: CloudRain,
  drizzle: CloudRain,
  nieselregen: CloudRain,
  snow: CloudSnow,
  schnee: CloudSnow,
  thunderstorm: CloudLightning,
  gewitter: CloudLightning,
  wind: Wind,
  nebel: Cloud,
  dunst: Cloud,
};

function getWeatherIcon(condition: string) {
  const normalizedCondition = condition.toLowerCase();
  for (const [key, Icon] of Object.entries(weatherIcons)) {
    if (normalizedCondition.includes(key)) {
      return Icon;
    }
  }
  return Cloud;
}

function WeatherSkeleton() {
  const t = useTranslations("weather");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-xl" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="flex flex-col gap-2 text-right">
            <Skeleton className="h-4 w-20 ml-auto" />
            <Skeleton className="h-3 w-24 ml-auto" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// OPENWEATHERMAP_API_KEY unset: the route returns { configured: false } and
// useWeather resolves to null (not an error). Surface an actionable CTA that
// deep-links to the weather settings instead of a dead "No data" string.
function WeatherNotConfigured() {
  const t = useTranslations("weather");
  return (
    <Card className="h-full">
      <CardContent className="p-6">
        <div className="flex flex-col items-center justify-center text-center py-4">
          <div className="p-3 rounded-xl bg-primary/10 mb-3">
            <CloudOff className="size-10 text-primary" strokeWidth={1.75} />
          </div>
          <p className="text-sm font-medium">{t("notConfiguredTitle")}</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            {t("notConfiguredDescription")}
          </p>
          <Button variant="secondary" size="sm" asChild className="mt-3">
            <Link href="/settings/weather">{t("notConfiguredAction")}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WeatherError({ error }: { error: string }) {
  const t = useTranslations("weather");
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-col items-center justify-center text-center py-4">
          <div className="p-3 rounded-xl bg-destructive/10 mb-3">
            <CloudOff className="size-10 text-destructive" strokeWidth={1.75} />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("errorTitle")}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">{error}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function Weather({ className = "" }: WeatherProps) {
  const t = useTranslations("weather");
  const [modalOpen, setModalOpen] = useState(false);
  const { data: weatherData, isLoading, error } = useWeather();
  const { labels: unitLabels } = useWeatherUnits();
  const { data: forecast } = useWeatherForecast();

  if (isLoading) {
    return <WeatherSkeleton />;
  }

  // null data without an error means the server reported configured:false
  // (no API key). Distinguish that from a real fetch error.
  if (!weatherData && !error) {
    return <WeatherNotConfigured />;
  }

  if (error || !weatherData) {
    return <WeatherError error={error?.message || t("errorFallback")} />;
  }

  const WeatherIcon = getWeatherIcon(weatherData.conditionMain ?? weatherData.condition);

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
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    <WeatherIcon className="size-10 text-primary" strokeWidth={1.75} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{weatherData.condition}</p>
                </TooltipContent>
              </Tooltip>
              <div>
                <div className="flex items-baseline gap-2">
                  <p className="font-display text-5xl font-light tracking-tight tabular-nums">
                    {weatherData.temp}°
                  </p>
                  {/* Number check, not truthiness: 0° is falsy, so at
                      exactly freezing this row vanished — the one
                      temperature where the day's range matters most. */}
                  {weatherData.high !== undefined && weatherData.low !== undefined && (
                    <div className="text-sm text-muted-foreground tabular-nums">
                      <span className="text-foreground/70">{weatherData.high}°</span>
                      {" / "}
                      <span>{weatherData.low}°</span>
                    </div>
                  )}
                </div>
                <p className="text-sm font-medium text-muted-foreground">{weatherData.condition}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 text-right">
              <Badge variant="neutral" className="font-medium">{weatherData.location}</Badge>
              <div className="flex flex-col gap-1 text-sm text-muted-foreground tabular-nums">
                <span className="flex items-center justify-end gap-1"><Droplets className="size-3" />{weatherData.humidity}%</span>
                <span className="flex items-center justify-end gap-1"><Wind className="size-3" />{weatherData.windSpeed} {unitLabels.speed}</span>
                {/* Same trap: "feels like 0°" disappeared entirely. */}
                {weatherData.feelsLike !== undefined && (
                  <span className="flex items-center justify-end gap-1"><Thermometer className="size-3" />{t("feelsLike", { temp: weatherData.feelsLike })}</span>
                )}
              </div>
            </div>
          </div>

          {/* Mini Forecast */}
          {upcomingDays.length > 0 && (
            <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-border/30">
              {upcomingDays.map((day) => {
                const DayIcon = getWeatherIcon(day.conditionMain ?? day.condition);
                const showRain = day.precipProbability > 0;
                const isHighRain = day.precipProbability > 40;
                return (
                  <Tooltip key={day.date}>
                    <TooltipTrigger asChild>
                      <div className="flex flex-col items-center gap-1 flex-1 cursor-help">
                        <span className="text-xs text-muted-foreground">{day.dayName}</span>
                        <DayIcon className="size-5 text-primary/70" strokeWidth={1.75} />
                        <div className="text-xs">
                          <span className="font-medium">{day.tempMax}°</span>
                          <span className="text-muted-foreground"> {day.tempMin}°</span>
                        </div>
                        {showRain && (
                          <span // Was text-blue-400/50 — a raw palette colour at half opacity, which
                          // measured 2.61:1 in dark and 1.53:1 in light, the lowest-contrast
                          // element on the dashboard (audit KB-47). The semantic token
                          // follows light/dark, and full opacity carries the contrast.
                          className={`flex items-center gap-0.5 text-xs ${isHighRain ? "text-weather-rain font-semibold" : "text-weather-rain/80"}`}>
                            <Droplets className="size-2.5" />
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
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help">
                    <Sunrise className="size-3.5 text-weather-sunrise" />
                    {weatherData.sunrise}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("sunriseTooltip")}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help">
                    <Sunset className="size-3.5 text-weather-sunset" />
                    {weatherData.sunset}
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
