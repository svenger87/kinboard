import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
  Wind,
  type LucideIcon,
} from "lucide-react";

/**
 * The icon for a weather condition, by day or by night.
 *
 * `condition` is OpenWeatherMap's raw `main` ("Clear", "Clouds", "Rain", …),
 * which every response carries as `conditionMain`; the localized label still
 * works as a fallback for an old cached response that lacks it. `icon` is the
 * provider's icon code ("01d", "02n", …): it ends in "n" at night, so a clear
 * night is a moon rather than a sun, and "02" (a few clouds) is the cloud with
 * the sun or moon behind it rather than a plain overcast cloud.
 *
 * The Home card, its detail view and the RFC-022 weather box all draw from
 * this one table, so the same sky never gets two different icons on one screen.
 */
export function weatherIcon(condition: string, icon?: string): LucideIcon {
  const c = condition.toLowerCase();
  const night = icon?.endsWith("n") ?? false;
  const fewClouds = icon?.startsWith("02") ?? false;

  if (c.includes("thunder") || c.includes("gewitter")) return CloudLightning;
  if (c.includes("snow") || c.includes("schnee")) return CloudSnow;
  if (c.includes("drizzle") || c.includes("niesel")) return CloudDrizzle;
  if (c.includes("rain") || c.includes("regen")) return CloudRain;
  if (c.includes("clear") || c.includes("klar") || c.includes("sunny") || c.includes("sonn")) {
    return night ? Moon : Sun;
  }
  if (["mist", "fog", "haze", "smoke", "dust", "sand", "ash", "nebel", "dunst"].some((k) => c.includes(k))) {
    return CloudFog;
  }
  if (c.includes("squall") || c.includes("tornado")) return Wind;
  if (fewClouds) return night ? CloudMoon : CloudSun;
  return Cloud;
}
