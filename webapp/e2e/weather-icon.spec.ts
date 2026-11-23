import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
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
} from "lucide-react";
import { weatherIcon } from "../src/lib/weather-icon";
import { codeOnly } from "./source-helpers";

/**
 * The Weather card and its detail view: the icon table they share, and the
 * fixes that are rules in the code rather than pixels. No stack;
 * weather-card-ui.spec.ts looks at the rendered card.
 */

const read = (file: string) => codeOnly(readFileSync(join(process.cwd(), file), "utf8"));

test("a clear night is a moon, a clear day a sun", () => {
  expect(weatherIcon("Clear", "01n")).toBe(Moon);
  expect(weatherIcon("Clear", "01d")).toBe(Sun);
  // An old cached response without an icon code keeps the day icon.
  expect(weatherIcon("Clear")).toBe(Sun);
});

test("a few clouds show the sun or moon behind them; overcast is a plain cloud", () => {
  expect(weatherIcon("Clouds", "02d")).toBe(CloudSun);
  expect(weatherIcon("Clouds", "02n")).toBe(CloudMoon);
  expect(weatherIcon("Clouds", "03n")).toBe(Cloud);
  expect(weatherIcon("Clouds", "04d")).toBe(Cloud);
});

test("each kind of weather has its own icon, by day and by night", () => {
  for (const icon of ["d", "n"]) {
    expect(weatherIcon("Rain", `10${icon}`)).toBe(CloudRain);
    expect(weatherIcon("Drizzle", `09${icon}`)).toBe(CloudDrizzle);
    expect(weatherIcon("Snow", `13${icon}`)).toBe(CloudSnow);
    expect(weatherIcon("Thunderstorm", `11${icon}`)).toBe(CloudLightning);
    for (const haze of ["Mist", "Fog", "Haze", "Smoke", "Dust"]) expect(weatherIcon(haze, `50${icon}`), haze).toBe(CloudFog);
  }
  // The localized label still works for a response without conditionMain.
  expect(weatherIcon("Leichter Regen")).toBe(CloudRain);
  expect(weatherIcon("Nebel")).toBe(CloudFog);
  expect(weatherIcon("Klar", "01n")).toBe(Moon);
});

test("the card and the detail view draw from the shared table, with the icon code", () => {
  const card = read("src/components/widgets/weather.tsx");
  const modal = read("src/components/widgets/weather-modal.tsx");
  for (const src of [card, modal]) {
    expect(src).not.toContain("const weatherIcons");
    expect(src).not.toMatch(/weatherIcon\([^,()]*\.condition\)/);
  }
  expect(card).toContain("weatherIcon(weatherData.conditionMain ?? weatherData.condition, weatherData.conditionIcon)");
  expect(card).toContain("weatherIcon(day.conditionMain ?? day.condition, day.conditionIcon)");
  expect(modal).toContain("weatherIcon(hour.conditionMain ?? hour.condition, hour.conditionIcon)");
  // Re-exported for the RFC-022 weather box, which kept a copy while it was private.
  expect(card).toContain("export { weatherIcon };");
});

test("the map moves only when its location or zoom changes, not on every render", () => {
  const map = read("src/components/widgets/weather-map.tsx");
  expect(map).toContain("}, [map, lat, lon, zoom]);");
  expect(map).not.toContain("}, [map, center, zoom]);");
});

test("the daylight label is only printed for an ordinary day", () => {
  const modal = read("src/components/widgets/weather-modal.tsx");
  expect(modal).toMatch(/\{hasNormalDay && \(\s*<span[^>]*>\s*\{t\("daylightLabel"/);
});
