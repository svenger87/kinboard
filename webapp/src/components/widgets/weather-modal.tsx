"use client";

import { minutesOfDayAt } from "@/lib/weather-time";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
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
  Umbrella,
  Gauge,
  Loader2,
  Shirt,
  Snowflake,
  Glasses,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { displayTempToCelsius, displayWindToKmh, type UnitSystem } from "@/lib/weather-units";
import {
  useWeather,
  useWeatherUnits,
  useWeatherForecast,
  useWeatherMapConfig,
} from "@/hooks";

const WeatherMap = dynamic(() => import("./weather-map"), {
  ssr: false,
  loading: () => (
    <div className="size-full flex items-center justify-center bg-muted rounded-lg">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  ),
});

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

type MapLayer = "precipitation" | "clouds" | "temperature" | "wind" | "pressure";

type ClothingTipKey =
  | "winterJacket"
  | "warmJacket"
  | "jacketOrSweater"
  | "lightJacketOrCardigan"
  | "longSleeveOrLightJacket"
  | "tshirt"
  | "breathable"
  | "umbrella"
  | "waterproofShoes"
  | "sunglasses"
  | "windproof";

interface ClothingTip {
  icon: typeof Shirt;
  textKey: ClothingTipKey;
  color: string;
}

// Thunderstorm deliberately NOT in the rainy set: the pre-i18n substring
// logic never matched it, and storm-day umbrella advice already comes
// from the precipitation-probability branch. Keeps advice byte-identical
// across the locale migration.
const RAINY_CONDITION_MAINS = new Set(["Rain", "Drizzle"]);
const SNOWY_CONDITION_MAINS = new Set(["Snow"]);
const CLEAR_CONDITION_MAINS = new Set(["Clear"]);

function getClothingTips(
  temp: number,
  condition: string,
  windSpeed: number,
  system: UnitSystem,
  precipProbability?: number,
  conditionMain?: string,
): ClothingTip[] {
  const tips: ClothingTip[] = [];
  let isRainy: boolean;
  let isSnowy: boolean;
  let isClear: boolean;
  if (conditionMain) {
    isRainy = RAINY_CONDITION_MAINS.has(conditionMain);
    isSnowy = SNOWY_CONDITION_MAINS.has(conditionMain);
    isClear = CLEAR_CONDITION_MAINS.has(conditionMain);
  } else {
    // Fallback for stale cached API responses without conditionMain.
    const cond = condition.toLowerCase();
    isRainy =
      cond.includes("rain") ||
      cond.includes("regen") ||
      cond.includes("drizzle") ||
      cond.includes("niesel");
    isSnowy = cond.includes("snow") || cond.includes("schnee");
    isClear = cond.includes("klar") || cond.includes("clear") || cond.includes("sonn");
  }
  const hasHighPrecip = precipProbability !== undefined ? precipProbability > 50 : isRainy;

  // Thresholds below are Celsius and km/h; the incoming values are in the
  // household's display system, so normalise before comparing. Without
  // this an imperial reading of 40 °F fell past the 25 "t-shirt" rung and
  // out of the ladder entirely.
  const tempC = displayTempToCelsius(temp, system);
  const windKmh = displayWindToKmh(windSpeed, system);

  if (tempC <= 0) {
    tips.push({ icon: Snowflake, textKey: "winterJacket", color: "#60a5fa" });
  } else if (tempC <= 5) {
    tips.push({ icon: Shirt, textKey: "warmJacket", color: "#93c5fd" });
  } else if (tempC <= 10) {
    tips.push({ icon: Shirt, textKey: "jacketOrSweater", color: "#a5b4fc" });
  } else if (tempC <= 15) {
    tips.push({ icon: Shirt, textKey: "lightJacketOrCardigan", color: "#86efac" });
  } else if (tempC <= 20) {
    tips.push({ icon: Shirt, textKey: "longSleeveOrLightJacket", color: "#fde047" });
  } else if (tempC <= 25) {
    tips.push({ icon: Shirt, textKey: "tshirt", color: "#fb923c" });
  } else {
    tips.push({ icon: Sun, textKey: "breathable", color: "#f87171" });
  }

  if (isRainy || hasHighPrecip) {
    tips.push({ icon: Umbrella, textKey: "umbrella", color: "#60a5fa" });
  }
  if (isSnowy) {
    tips.push({ icon: Snowflake, textKey: "waterproofShoes", color: "#93c5fd" });
  }
  if (tempC > 22 && isClear) {
    tips.push({ icon: Glasses, textKey: "sunglasses", color: "#fbbf24" });
  }
  if (windKmh > 30) {
    tips.push({ icon: Wind, textKey: "windproof", color: "#94a3b8" });
  }

  return tips;
}

type ComfortKey =
  | "icy"
  | "veryCold"
  | "cold"
  | "cool"
  | "fresh"
  | "pleasant"
  | "warm"
  | "hot"
  | "veryHot";

function getComfortLevel(
  feelsLike: number,
  system: UnitSystem,
): { labelKey: ComfortKey; color: string; position: number } {
  // Same story as the clothing ladder: metric rungs, so normalise first.
  // 68 °F used to land past the 30 rung and render a red "very hot".
  const fl = displayTempToCelsius(feelsLike, system);
  if (fl <= -5) return { labelKey: "icy", color: "#60a5fa", position: 5 };
  if (fl <= 0) return { labelKey: "veryCold", color: "#93c5fd", position: 15 };
  if (fl <= 5) return { labelKey: "cold", color: "#a5b4fc", position: 25 };
  if (fl <= 10) return { labelKey: "cool", color: "#86efac", position: 35 };
  if (fl <= 15) return { labelKey: "fresh", color: "#4ade80", position: 45 };
  if (fl <= 20) return { labelKey: "pleasant", color: "#22c55e", position: 55 };
  if (fl <= 25) return { labelKey: "warm", color: "#fbbf24", position: 70 };
  if (fl <= 30) return { labelKey: "hot", color: "#fb923c", position: 85 };
  return { labelKey: "veryHot", color: "#ef4444", position: 95 };
}

interface WeatherModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WeatherModal({ open, onOpenChange }: WeatherModalProps) {
  const t = useTranslations("weather");
  const { data: currentWeather } = useWeather();
  const { labels: unitLabels, system } = useWeatherUnits();
  const { data: forecast } = useWeatherForecast();
  const { data: mapConfig, isLoading: mapLoading } = useWeatherMapConfig();

  const [selectedLayer, setSelectedLayer] = useState<MapLayer>("precipitation");
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => setShowMap(true), 300);
      return () => clearTimeout(timer);
    } else {
      setShowMap(false);
    }
  }, [open]);

  if (!currentWeather) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <Cloud className="size-6 text-primary" strokeWidth={1.5} />
              </div>
              {t("title")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-12">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const WeatherIcon = getWeatherIcon(currentWeather.conditionMain ?? currentWeather.condition);
  const upcomingDays = forecast?.daily || [];
  const hourly = forecast?.hourly || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <WeatherIcon className="size-6 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <span className="text-xl font-display">{t("title")}</span>
                <Badge variant="outline" className="ml-2 font-normal">
                  {currentWeather.location}
                </Badge>
              </div>
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="p-6 pt-4 flex flex-col gap-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-gradient-to-br from-info/10 to-info/5 border border-info/10 rounded-xl p-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("sectionCurrent")}</h3>
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <WeatherIcon className="size-12 text-primary" strokeWidth={1.5} />
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-display font-light">{currentWeather.temp}°</span>
                    <div className="text-sm text-muted-foreground">
                      <span className="text-foreground/70">{currentWeather.high}°</span>
                      {" / "}
                      <span>{currentWeather.low}°</span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{currentWeather.condition}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border/30">
                <div className="flex items-center gap-2 text-sm">
                  <Thermometer className="size-4 text-muted-foreground" />
                  <span>{t("feelsLike", { temp: currentWeather.feelsLike })}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Droplets className="size-4 text-muted-foreground" />
                  <span>{currentWeather.humidity}%</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Wind className="size-4 text-muted-foreground" />
                  <span>{currentWeather.windSpeed} {unitLabels.speed}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t("visibility")}</span>
                  <span>{currentWeather.visibility} {unitLabels.distance}</span>
                </div>
              </div>

              <SunArc
                sunrise={currentWeather.sunrise}
                sunset={currentWeather.sunset}
                timezoneOffset={currentWeather.timezoneOffset}
              />
            </div>

            <div className="lg:col-span-2 bg-muted/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">{t("sectionMap")}</h3>
                <SegmentedControl value={selectedLayer} onValueChange={(v) => setSelectedLayer(v as MapLayer)}>
                  <SegmentedControlItem value="precipitation" className="text-xs px-2">
                    <Umbrella className="size-3 mr-1" />
                    {t("layerPrecipitation")}
                  </SegmentedControlItem>
                  <SegmentedControlItem value="clouds" className="text-xs px-2">
                    <Cloud className="size-3 mr-1" />
                    {t("layerClouds")}
                  </SegmentedControlItem>
                  <SegmentedControlItem value="temperature" className="text-xs px-2">
                    <Thermometer className="size-3 mr-1" />
                    {t("layerTemperature")}
                  </SegmentedControlItem>
                  <SegmentedControlItem value="wind" className="text-xs px-2">
                    <Wind className="size-3 mr-1" />
                    {t("layerWind")}
                  </SegmentedControlItem>
                  <SegmentedControlItem value="pressure" className="text-xs px-2">
                    <Gauge className="size-3 mr-1" />
                    {t("layerPressure")}
                  </SegmentedControlItem>
                </SegmentedControl>
              </div>

              <div className="relative h-[300px] rounded-lg overflow-hidden">
                {showMap && mapConfig && !mapLoading ? (
                  <WeatherMap
                    center={[mapConfig.center.lat, mapConfig.center.lon]}
                    zoom={mapConfig.zoom}
                    layerUrl={mapConfig.layers[selectedLayer]}
                    layerName={selectedLayer}
                  />
                ) : (
                  <div className="size-full flex items-center justify-center bg-muted">
                    <Loader2 className="size-8 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>

              <MapLegend layer={selectedLayer} />
            </div>
          </div>

          {hourly.length > 0 && (
            <div className="bg-muted/30 rounded-xl p-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("sectionHourly")}</h3>
              <HourlySparkline temps={hourly.map((h) => h.temp)} />
              <ScrollArea className="w-full">
                <div className="flex gap-3 pb-2">
                  {hourly.map((hour, index) => {
                    const HourIcon = getWeatherIcon(hour.conditionMain ?? hour.condition);
                    return (
                      <div
                        key={index}
                        className="flex flex-col items-center gap-1.5 min-w-[60px] p-2 rounded-lg bg-background/50"
                      >
                        <span className="text-xs text-muted-foreground">{hour.time}</span>
                        <HourIcon className="size-5 text-primary" strokeWidth={1.5} />
                        <span className="font-medium text-sm">{hour.temp}°</span>
                        {hour.precipProbability > 0 && (
                          <span className="text-xs text-weather-rain flex items-center gap-0.5">
                            <Droplets className="size-2.5" />
                            {hour.precipProbability}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
          )}

          <ClothingAdvisor
            temp={currentWeather.temp}
            feelsLike={currentWeather.feelsLike}
            condition={currentWeather.condition}
            conditionMain={currentWeather.conditionMain}
            windSpeed={currentWeather.windSpeed}
            precipProbability={hourly[0]?.precipProbability}
          />

          {upcomingDays.length > 0 && (() => {
            const allTemps = upcomingDays.flatMap((d) => [d.tempMin, d.tempMax]);
            const globalMin = Math.min(...allTemps);
            const globalMax = Math.max(...allTemps);
            const tempRange = globalMax - globalMin || 1;

            return (
              <div className="bg-muted/30 rounded-xl p-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("sectionForecast")}</h3>
                <div className="flex flex-col gap-2">
                  {upcomingDays.map((day, index) => {
                    const DayIcon = getWeatherIcon(day.conditionMain ?? day.condition);
                    const isToday = index === 0;
                    const barLeft = ((day.tempMin - globalMin) / tempRange) * 100;
                    const barWidth = ((day.tempMax - day.tempMin) / tempRange) * 100;

                    return (
                      <div
                        key={day.date}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${isToday ? "bg-primary/10" : "bg-background/50"}`}
                      >
                        <div className="w-12 sm:w-16 text-sm font-medium shrink-0">
                          {isToday ? t("todayLabel") : day.dayName}
                        </div>
                        <DayIcon className="size-5 text-primary shrink-0" strokeWidth={1.5} />
                        {day.precipProbability > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-0.5 text-xs text-weather-rain w-10 shrink-0">
                                <Droplets className="size-3" />
                                {day.precipProbability}%
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{t("rainProbabilityTooltip")}</p>
                              {day.rainAmount > 0 && <p>{t("rainAmount", { amount: day.rainAmount, unit: unitLabels.precipitation })}</p>}
                              {day.snowAmount > 0 && <p>{t("snowAmount", { amount: day.snowAmount, unit: unitLabels.precipitation })}</p>}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="w-10 shrink-0" />
                        )}
                        <span className="text-xs text-muted-foreground w-8 text-right tabular-nums shrink-0">
                          {day.tempMin}°
                        </span>
                        <div className="flex-1 h-1.5 bg-white/5 rounded-full relative min-w-[60px]">
                          <div
                            className="absolute inset-y-0 rounded-full"
                            style={{
                              left: `${barLeft}%`,
                              width: `${Math.max(barWidth, 4)}%`,
                              background: `linear-gradient(to right, ${tempBarColor(day.tempMin, system)}, ${tempBarColor(day.tempMax, system)})`,
                            }}
                          />
                          {isToday && (
                            <div
                              className="absolute top-1/2 -translate-y-1/2 size-2.5 rounded-full bg-white border-2 border-background elev-sm"
                              style={{
                                left: `${((currentWeather.temp - globalMin) / tempRange) * 100}%`,
                                marginLeft: "-5px",
                              }}
                            />
                          )}
                        </div>
                        <span className="text-sm font-medium w-8 tabular-nums shrink-0">
                          {day.tempMax}°
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function tempBarColor(temp: number, system: UnitSystem) {
  // Metric rungs again — in Fahrenheit every day cleared 30 and the whole
  // week rendered the same red, so the gradient carried no information.
  const c = displayTempToCelsius(temp, system);
  if (c <= 0) return "#60a5fa";
  if (c <= 10) return "#67e8f9";
  if (c <= 20) return "#86efac";
  if (c <= 30) return "#fbbf24";
  return "#f87171";
}

function SunArc({
  sunrise,
  sunset,
  timezoneOffset,
}: {
  sunrise: string;
  sunset: string;
  timezoneOffset?: number;
}) {
  const t = useTranslations("weather");
  const parseTime = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };
  const sunriseMin = parseTime(sunrise);
  const sunsetMin = parseTime(sunset);

  // sunrise/sunset arrive already converted to the weather location's
  // zone. Reading the browser's clock here compared two different
  // clocks, so a board set to a city elsewhere drew the sun at the wrong
  // point — or showed night at noon. Shift "now" the same way, falling
  // back to the browser when the server didn't send an offset.
  const nowMin = minutesOfDayAt(new Date(), timezoneOffset);

  // Guard the division: inside the polar circles a day can have no
  // sunrise or no sunset, and sunset can precede sunrise across a DST
  // boundary. dayLength <= 0 rendered NaN, and `daylightLabel` printed
  // things like "-1h 47m of daylight".
  const dayLength = sunsetMin - sunriseMin;
  const hasNormalDay = dayLength > 0;
  const progress = hasNormalDay
    ? Math.max(0, Math.min(1, (nowMin - sunriseMin) / dayLength))
    : 0;
  const isDaytime = hasNormalDay && nowMin >= sunriseMin && nowMin <= sunsetMin;

  const width = 280;
  const height = 80;
  const cx = width / 2;
  const cy = height - 8;
  const rx = 120;
  const ry = 60;

  const angle = Math.PI * (1 - progress);
  const sunX = cx + rx * Math.cos(angle);
  const sunY = cy - ry * Math.sin(angle);

  return (
    <div className="mt-4 pt-4 border-t border-border/30 flex flex-col items-center">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-[280px] h-auto">
        <line
          x1={cx - rx - 10}
          y1={cy}
          x2={cx + rx + 10}
          y2={cy}
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="1"
        />
        <path
          d={`M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        {isDaytime && (
          <path
            d={`M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${sunX} ${sunY}`}
            fill="none"
            stroke="url(#sunGradient)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
        <defs>
          <linearGradient id="sunGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
          <radialGradient id="sunGlow">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
        </defs>
        {isDaytime && <circle cx={sunX} cy={sunY} r="12" fill="url(#sunGlow)" />}
        {isDaytime && <circle cx={sunX} cy={sunY} r="5" fill="#fbbf24" />}
        {!isDaytime && (
          <circle cx={cx} cy={cy - ry * 0.3} r="4" fill="#94a3b8" opacity="0.5" />
        )}
      </svg>
      <div className="flex items-center gap-6 mt-1">
        <div className="flex items-center gap-1.5">
          <Sunrise className="size-4 text-weather-sunrise" />
          <span className="text-xs text-muted-foreground">{sunrise}</span>
        </div>
        <span className="text-xs text-muted-foreground/50">
          {t("daylightLabel", { hours: Math.floor(dayLength / 60), minutes: dayLength % 60 })}
        </span>
        <div className="flex items-center gap-1.5">
          <Sunset className="size-4 text-weather-sunset" />
          <span className="text-xs text-muted-foreground">{sunset}</span>
        </div>
      </div>
    </div>
  );
}

function HourlySparkline({ temps }: { temps: number[] }) {
  if (temps.length < 2) return null;
  const minT = Math.min(...temps);
  const maxT = Math.max(...temps);
  const range = maxT - minT || 1;
  const stepX = 76;
  const svgW = temps.length * stepX;
  const svgH = 48;
  const padY = 8;
  const points = temps.map((t, i) => {
    const x = i * stepX + stepX / 2;
    const y = padY + (1 - (t - minT) / range) * (svgH - padY * 2);
    return `${x},${y}`;
  });

  return (
    <ScrollArea className="w-full mb-2">
      <div style={{ width: svgW, minWidth: "100%" }}>
        <svg width={svgW} height={svgH} className="overflow-visible">
          <defs>
            <linearGradient id="hourly-temp-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon
            points={`${points[0].split(",")[0]},${svgH} ${points.join(" ")} ${points[points.length - 1].split(",")[0]},${svgH}`}
            fill="url(#hourly-temp-grad)"
          />
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((p, i) => {
            const [x, y] = p.split(",");
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r="3"
                fill="hsl(var(--primary))"
                opacity="0.7"
              />
            );
          })}
        </svg>
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function ClothingAdvisor({
  temp,
  feelsLike,
  condition,
  conditionMain,
  windSpeed,
  precipProbability,
}: {
  temp: number;
  feelsLike: number;
  condition: string;
  conditionMain?: string;
  windSpeed: number;
  precipProbability?: number;
}) {
  const t = useTranslations("weather");
  const { system } = useWeatherUnits();
  const tips = getClothingTips(temp, condition, windSpeed, system, precipProbability, conditionMain);
  if (tips.length === 0) return null;
  const comfort = getComfortLevel(feelsLike, system);
  const comfortLabels: Record<ComfortKey, string> = {
    icy: t("comfort.icy"),
    veryCold: t("comfort.veryCold"),
    cold: t("comfort.cold"),
    cool: t("comfort.cool"),
    fresh: t("comfort.fresh"),
    pleasant: t("comfort.pleasant"),
    warm: t("comfort.warm"),
    hot: t("comfort.hot"),
    veryHot: t("comfort.veryHot"),
  };
  const clothingLabels: Record<ClothingTipKey, string> = {
    winterJacket: t("clothing.winterJacket"),
    warmJacket: t("clothing.warmJacket"),
    jacketOrSweater: t("clothing.jacketOrSweater"),
    lightJacketOrCardigan: t("clothing.lightJacketOrCardigan"),
    longSleeveOrLightJacket: t("clothing.longSleeveOrLightJacket"),
    tshirt: t("clothing.tshirt"),
    breathable: t("clothing.breathable"),
    umbrella: t("clothing.umbrella"),
    waterproofShoes: t("clothing.waterproofShoes"),
    sunglasses: t("clothing.sunglasses"),
    windproof: t("clothing.windproof"),
  };

  return (
    <div className="bg-muted/30 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Shirt className="size-4" />
          {t("sectionClothing")}
        </h3>
        <Badge
          variant="outline"
          className="text-xs"
          style={{ borderColor: comfort.color, color: comfort.color }}
        >
          {comfortLabels[comfort.labelKey]}
        </Badge>
      </div>

      <div className="mb-4">
        <div className="relative h-2 rounded-full overflow-hidden bg-gradient-to-r from-blue-500 via-green-400 via-50% via-yellow-400 via-75% to-red-500 opacity-30" />
        <div className="relative h-2 -mt-2 rounded-full overflow-hidden">
          <div
            className="absolute top-0 -translate-x-1/2 size-3 -mt-0.5 rounded-full border-2 border-background elev-md transition-all duration-500"
            style={{ left: `${comfort.position}%`, backgroundColor: comfort.color }}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-3xs text-muted-foreground/50">
          <span>{t("comfortScaleCold")}</span>
          <span>{t("comfortScalePleasant")}</span>
          <span>{t("comfortScaleHot")}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {tips.map((tip, i) => {
          const TipIcon = tip.icon;
          return (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ backgroundColor: `${tip.color}12`, borderLeft: `3px solid ${tip.color}` }}
            >
              <TipIcon className="size-4 shrink-0" style={{ color: tip.color }} />
              <span className="text-sm">{clothingLabels[tip.textKey]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** OpenWeatherMap's wind tile scale, in m/s — the unit the tiles use. */
const WIND_STOPS_MS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];

function MapLegend({ layer }: { layer: MapLayer }) {
  const t = useTranslations("weather");
  const { system } = useWeatherUnits();
  const imperial = system === "imperial";

  // The overlay tiles come from OpenWeatherMap pre-rendered, so their
  // colours are fixed and there is no units parameter to pass — an
  // imperial household gets a metric map and that can't be helped.
  //
  // The legend underneath is ours, though, and the colour stops sit at
  // known values. Relabelling those values in °F leaves the legend
  // correct: same colours, right numbers. Reported on #19, where the
  // reasonable assumption was that the whole thing was stuck in metric.
  //
  // Wind gets the same treatment in both directions: the tiles are m/s,
  // which is not what the rest of the app shows in either system —
  // km/h in metric, mph in imperial.
  //
  // Precipitation and pressure are left alone. Inches per hour puts the
  // useful end of the scale at 0.00-0.01, which reads as nothing at all,
  // so mm/h stays the honest label.
  const legends: Record<MapLayer, { colors: string[]; labels: string[]; unit: string }> = {
    precipitation: {
      colors: ["#00000000", "#0000CD", "#0000FF", "#00FFFF", "#00FF00", "#FFFF00", "#FF7F00", "#FF0000"],
      labels: ["0", "0.1", "0.5", "1", "2", "4", "8", "16+"],
      unit: "mm/h",
    },
    clouds: {
      colors: ["#00000000", "#FFFFFF20", "#FFFFFF40", "#FFFFFF60", "#FFFFFF80", "#FFFFFFA0", "#FFFFFFC0", "#FFFFFFE0"],
      labels: ["0%", "15%", "30%", "45%", "60%", "75%", "90%", "100%"],
      unit: "",
    },
    temperature: {
      colors: ["#821692", "#0000FF", "#00BFFF", "#00FF00", "#FFFF00", "#FFA500", "#FF0000", "#8B0000"],
      labels: imperial
        // Same stops as the °C row below, converted: -40, -4, 32, 50, 68,
        // 77, 86, 104. -40 is the one place the two scales meet.
        ? ["-40°", "-4°", "32°", "50°", "68°", "77°", "86°", "104°+"]
        : ["-40°", "-20°", "0°", "10°", "20°", "25°", "30°", "40°+"],
      unit: imperial ? "F" : "C",
    },
    wind: {
      colors: ["#FFFFFF00", "#AEFFFF", "#96F7DC", "#96F7B4", "#6FF46F", "#73ED12", "#A4ED12", "#DAED12", "#EDC512", "#ED9112", "#ED6312", "#ED2912"],
      // The tile scale is m/s; these are the same stops in the unit the
      // rest of the app uses, so the legend agrees with the widget.
      labels: WIND_STOPS_MS.map((ms, i) => {
        const v = Math.round(imperial ? ms * 2.23694 : ms * 3.6);
        return i === WIND_STOPS_MS.length - 1 ? `${v}+` : `${v}`;
      }),
      unit: imperial ? "mph" : "km/h",
    },
    pressure: {
      colors: ["#0000FF", "#00BFFF", "#00FF00", "#FFFF00", "#FF7F00", "#FF0000"],
      labels: ["950", "980", "1000", "1013", "1030", "1050+"],
      unit: "hPa",
    },
  };

  const legend = legends[layer];

  return (
    <div className="mt-3 pt-3 border-t border-border/30">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("legendLabel")}{legend.unit && ` (${legend.unit})`}:</span>
        <div className="flex-1 flex items-center">
          <div
            className="flex-1 h-3 rounded-sm"
            style={{
              background: `linear-gradient(to right, ${legend.colors.join(", ")})`,
            }}
          />
        </div>
      </div>
      <div className="flex justify-between mt-1">
        {legend.labels.filter((_, i) => i % 2 === 0 || legend.labels.length <= 8).map((label, i) => (
          <span key={i} className="text-3xs text-muted-foreground">{label}</span>
        ))}
      </div>
    </div>
  );
}
