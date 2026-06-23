"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bell, Settings, Sun, Cloud, CloudRain, CloudSnow, CloudLightning } from "lucide-react";
import { useWeather } from "@/hooks";

function conditionIcon(condition: string) {
  const c = condition.toLowerCase();
  if (c.includes("thunder") || c.includes("gewitter")) return CloudLightning;
  if (c.includes("snow") || c.includes("schnee")) return CloudSnow;
  if (c.includes("rain") || c.includes("regen") || c.includes("drizzle") || c.includes("niesel"))
    return CloudRain;
  if (c.includes("clear") || c.includes("klar") || c.includes("sunny") || c.includes("sonnig"))
    return Sun;
  return Cloud;
}

export function KioskStatusBar() {
  const tNav = useTranslations("nav");
  const { data: weather } = useWeather();
  const WeatherIcon = weather ? conditionIcon(weather.condition) : null;

  return (
    <div
      className="safe-area-inset fixed left-0 right-0 top-0 z-40 flex items-center justify-between gap-3 px-4 py-2"
      aria-label="Kiosk status"
    >
      {/* Left: compact weather chip — renders nothing when unconfigured/null. */}
      <div className="min-h-[44px]">
        {weather && WeatherIcon ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 elev-sm">
            <span className="icon-badge">
              <WeatherIcon className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="font-mono text-lg font-bold tabular-nums">
              {Math.round(weather.temp)}&deg;
            </span>
          </div>
        ) : null}
      </div>

      {/* Right: notifications + settings, >=44px touch targets. */}
      <div className="flex items-center gap-2">
        <Link
          href="/settings/notifications"
          aria-label={tNav("notifications")}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card elev-sm transition-colors hover:bg-accent"
        >
          <Bell className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <Link
          href="/settings"
          aria-label={tNav("settings")}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card elev-sm transition-colors hover:bg-accent"
        >
          <Settings className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
