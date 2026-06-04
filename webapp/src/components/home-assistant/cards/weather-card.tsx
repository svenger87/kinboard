"use client";

import {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  Wind,
  Thermometer,
  Droplets,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

type WeatherConditionKey =
  | "clear-night" | "cloudy" | "fog" | "hail" | "lightning" | "lightning-rainy"
  | "partlycloudy" | "pouring" | "rainy" | "snowy" | "snowy-rainy"
  | "sunny" | "windy" | "windy-variant" | "exceptional";
const WEATHER_CONDITION_KEYS: readonly string[] = [
  "clear-night", "cloudy", "fog", "hail", "lightning", "lightning-rainy",
  "partlycloudy", "pouring", "rainy", "snowy", "snowy-rainy",
  "sunny", "windy", "windy-variant", "exceptional",
];

interface WeatherCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

// Get weather icon based on condition
function getWeatherIcon(condition: string) {
  switch (condition) {
    case "sunny":
    case "clear-night":
      return <Sun className="size-8" />;
    case "cloudy":
    case "partlycloudy":
      return <Cloud className="size-8" />;
    case "rainy":
    case "pouring":
      return <CloudRain className="size-8" />;
    case "snowy":
    case "snowy-rainy":
      return <CloudSnow className="size-8" />;
    case "lightning":
    case "lightning-rainy":
      return <CloudLightning className="size-8" />;
    case "fog":
    case "hail":
      return <CloudFog className="size-8" />;
    case "windy":
    case "windy-variant":
      return <Wind className="size-8" />;
    default:
      return <Sun className="size-8" />;
  }
}

export function WeatherCard({ card, entity }: WeatherCardProps) {
  const t = useTranslations("homeAutomation.cards.weather");
  const tState = useTranslations("homeAutomation.entityState");
  const tCondition = useTranslations("homeAutomation.weatherCondition");
  const locale = useLocale();
  const intlLocale = locale === "de" ? "de-DE" : locale === "fr" ? "fr-FR" : "en-US";
  const label = card.display_name || entity.name;
  const isUnavailable = entity.state === "unavailable";
  const condition = entity.state;

  // Weather attributes
  const temperature = entity.attributes.temperature as number | undefined;
  const humidity = entity.attributes.humidity as number | undefined;
  const pressure = entity.attributes.pressure as number | undefined;
  const windSpeed = entity.attributes.wind_speed as number | undefined;
  const forecast = entity.attributes.forecast as Array<{
    datetime: string;
    temperature: number;
    templow?: number;
    condition: string;
  }> | undefined;

  // Get icon color based on condition
  const getIconColor = () => {
    if (condition.includes("sunny") || condition === "clear-night") return "text-yellow-500";
    if (condition.includes("rain") || condition.includes("pouring")) return "text-blue-500";
    if (condition.includes("snow")) return "text-cyan-300";
    if (condition.includes("lightning")) return "text-yellow-400";
    return "text-gray-400";
  };

  return (
    <div
      className={`rounded-xl border p-4 transition-all bg-card hover:border-month-primary/30 ${
        isUnavailable ? "opacity-50" : ""
      }`}
    >
      {/* Header with Icon and Temperature */}
      <div className="flex items-center justify-between mb-3">
        <div className={`${getIconColor()}`}>
          {getWeatherIcon(condition)}
        </div>
        {temperature !== undefined && (
          <div className="text-right">
            <span className="text-3xl font-semibold">{Math.round(temperature)}°</span>
          </div>
        )}
      </div>

      {/* Location and Condition */}
      <div className="mb-3">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-muted-foreground">
          {isUnavailable
            ? tState("unavailable")
            : WEATHER_CONDITION_KEYS.includes(condition)
              ? tCondition(condition as WeatherConditionKey)
              : condition}
        </p>
      </div>

      {/* Weather Details */}
      <div className="grid grid-cols-2 gap-2 pt-3 border-t text-xs text-muted-foreground">
        {humidity !== undefined && (
          <div className="flex items-center gap-1">
            <Droplets className="size-3" />
            <span>{humidity}%</span>
          </div>
        )}
        {windSpeed !== undefined && (
          <div className="flex items-center gap-1">
            <Wind className="size-3" />
            <span>{windSpeed} km/h</span>
          </div>
        )}
        {pressure !== undefined && (
          <div className="flex items-center gap-1 col-span-2">
            <Thermometer className="size-3" />
            <span>{pressure} hPa</span>
          </div>
        )}
      </div>

      {/* Mini Forecast (if available and card is large) */}
      {card.size === "large" && forecast && forecast.length > 0 && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs text-muted-foreground mb-2">{t("forecastHeading")}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {forecast.slice(0, 4).map((day, index) => (
              <div
                key={index}
                className="flex flex-col items-center min-w-[48px] p-2 rounded bg-muted/50"
              >
                <span className="text-xs text-muted-foreground">
                  {new Date(day.datetime).toLocaleDateString(intlLocale, {
                    weekday: "short",
                  })}
                </span>
                <div className={`my-1 ${getIconColor()}`}>
                  {getWeatherIcon(day.condition)}
                </div>
                <span className="text-xs font-medium">{Math.round(day.temperature)}°</span>
                {day.templow !== undefined && (
                  <span className="text-[10px] text-muted-foreground">
                    {Math.round(day.templow)}°
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
