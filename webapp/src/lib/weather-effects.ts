/**
 * Weather effects on Home: which ones the current weather calls for, from
 * the family's settings (Settings -> Weather). Pure; the overlay that draws
 * them is components/weather-effects.tsx.
 *
 * Thresholds are stored in metric (°C, km/h) whatever the family's units, so
 * switching units never changes what they mean; the settings page shows and
 * takes them in the family's units.
 */
import type { UnitSystem } from "@/lib/weather-units";

export const WEATHER_EFFECTS = ["snow", "rain", "storm", "freezing", "wind", "fog", "heat"] as const;
export type WeatherEffect = (typeof WEATHER_EFFECTS)[number];

export type EffectIntensity = "subtle" | "normal";

export interface WeatherEffectsSettings {
  enabled: boolean;
  intensity: EffectIntensity;
  /** Compare the "feels like" temperature instead of the measured one. */
  useFeelsLike: boolean;
  /** At or below this, °C: frost at the edges. */
  freezingAtC: number;
  /** At or above this, °C: heat shimmer. */
  heatAtC: number;
  /** At or above this, km/h: wind. */
  windAtKmh: number;
  /** At or above this chance of rain, percent (the forecast's next few hours): rain. */
  rainChanceAt: number;
  /** Each effect can be switched off on its own. */
  effects: Record<WeatherEffect, boolean>;
}

export const DEFAULT_WEATHER_EFFECTS: WeatherEffectsSettings = {
  enabled: false,
  intensity: "subtle",
  useFeelsLike: false,
  freezingAtC: 0,
  heatAtC: 32,
  windAtKmh: 30,
  rainChanceAt: 50,
  effects: { snow: true, rain: true, storm: true, freezing: true, wind: true, fog: true, heat: true },
};

/** The bounds a threshold is held to: °C, km/h, or a percent chance. */
export const THRESHOLD_BOUNDS = {
  freezingAtC: { min: -40, max: 15 },
  heatAtC: { min: 15, max: 55 },
  windAtKmh: { min: 5, max: 150 },
  // 1, not 0: at 0% it would rain on Home whatever the forecast.
  rainChanceAt: { min: 1, max: 100 },
} as const;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A stored value (anything, from any version) as complete, valid settings. */
export function normalizeWeatherEffects(value: unknown): WeatherEffectsSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_WEATHER_EFFECTS;
  const threshold = (key: keyof typeof THRESHOLD_BOUNDS) =>
    finite(v[key]) ? clamp(v[key] as number, THRESHOLD_BOUNDS[key].min, THRESHOLD_BOUNDS[key].max) : d[key];
  const stored = (v.effects && typeof v.effects === "object" ? v.effects : {}) as Record<string, unknown>;
  const effects = Object.fromEntries(
    WEATHER_EFFECTS.map((e) => [e, typeof stored[e] === "boolean" ? stored[e] : d.effects[e]]),
  ) as Record<WeatherEffect, boolean>;
  return {
    enabled: v.enabled === true,
    intensity: v.intensity === "normal" ? "normal" : "subtle",
    useFeelsLike: v.useFeelsLike === true,
    freezingAtC: threshold("freezingAtC"),
    heatAtC: threshold("heatAtC"),
    windAtKmh: threshold("windAtKmh"),
    rainChanceAt: threshold("rainChanceAt"),
    effects,
  };
}

/* Units: the weather arrives in the family's units (°C or °F, km/h or mph). */
export const toCelsius = (t: number, units: UnitSystem) => (units === "imperial" ? ((t - 32) * 5) / 9 : t);
export const fromCelsius = (c: number, units: UnitSystem) => (units === "imperial" ? (c * 9) / 5 + 32 : c);
export const toKmh = (s: number, units: UnitSystem) => (units === "imperial" ? s * 1.609344 : s);
export const fromKmh = (k: number, units: UnitSystem) => (units === "imperial" ? k / 1.609344 : k);

/** A threshold as the settings page shows it: whole numbers in the family's units (a chance is a percent in any). */
export function displayThreshold(key: keyof typeof THRESHOLD_BOUNDS, s: WeatherEffectsSettings, units: UnitSystem): number {
  const metric = s[key];
  if (key === "rainChanceAt") return Math.round(metric);
  return Math.round(key === "windAtKmh" ? fromKmh(metric, units) : fromCelsius(metric, units));
}

/** A threshold typed in the family's units, stored in metric (held to its bounds). */
export function storedThreshold(key: keyof typeof THRESHOLD_BOUNDS, typed: number, units: UnitSystem): number {
  const metric = key === "rainChanceAt" ? typed : key === "windAtKmh" ? toKmh(typed, units) : toCelsius(typed, units);
  const { min, max } = THRESHOLD_BOUNDS[key];
  return clamp(Math.round(metric * 10) / 10, min, max);
}

/** The part of the current weather the effects read, in the family's units. */
export interface WeatherReading {
  temp: number;
  feelsLike?: number;
  windSpeed: number;
  /** OpenWeatherMap's main condition: Snow, Rain, Drizzle, Thunderstorm, Mist, Fog, Haze, Clear, Clouds... */
  conditionMain?: string;
  /**
   * The forecast's next slot (the next few hours): its chance of precipitation,
   * percent, and its main condition. OpenWeatherMap's chance is of any
   * precipitation, snow included, so it counts towards rain only when the slot
   * itself is rain, drizzle or a thunderstorm.
   */
  nextSlot?: { chance: number; conditionMain?: string };
}

/** OpenWeatherMap's forecast slots are three hours long. */
export const SLOT_MS = 3 * 60 * 60 * 1000;

/**
 * The forecast slot that matters now: the one under way (started, less than
 * three hours ago), or else the next one. Picked again as time passes, so a
 * display reaches the rainy slot when it begins without asking for the
 * forecast again. A forecast without slot times (an older server) gives its
 * first slot, as before.
 */
export function currentSlot<T extends { at?: number }>(slots: readonly T[] | null | undefined, now: number): T | undefined {
  if (!slots || slots.length === 0) return undefined;
  if (slots.some((s) => typeof s.at !== "number")) return slots[0];
  const underway = [...slots].reverse().find((s) => s.at! <= now && now < s.at! + SLOT_MS);
  return underway ?? slots.find((s) => s.at! > now);
}

/**
 * The slots still to come: those starting after now, in order, for the
 * screensaver's forecast strip (the weather now stands beside them). A forecast
 * without slot times (an older server) gives all of its slots.
 */
export function upcomingSlots<T extends { at?: number }>(slots: readonly T[] | null | undefined, now: number): T[] {
  if (!slots) return [];
  if (slots.some((s) => typeof s.at !== "number")) return [...slots];
  return slots.filter((s) => s.at! > now);
}

/** A forecast slot whose precipitation is rain. */
const RAIN_SLOT = new Set(["Rain", "Drizzle", "Thunderstorm"]);

/** The effects the weather calls for, in a fixed order. */
export function activeEffects(weather: WeatherReading | null | undefined, s: WeatherEffectsSettings, units: UnitSystem): WeatherEffect[] {
  if (!s.enabled || !weather) return [];
  const on = new Set<WeatherEffect>();
  const main = weather.conditionMain ?? "";
  if (main === "Snow") on.add("snow");
  // Raining now counts as certain; otherwise the chance of rain against the family's threshold.
  if (main === "Rain" || main === "Drizzle") on.add("rain");
  const slot = weather.nextSlot;
  if (slot && RAIN_SLOT.has(slot.conditionMain ?? "") && finite(slot.chance) && slot.chance >= s.rainChanceAt) on.add("rain");
  if (main === "Thunderstorm") {
    on.add("storm");
    on.add("rain");
  }
  if (main === "Mist" || main === "Fog" || main === "Haze") on.add("fog");
  const temp = s.useFeelsLike && finite(weather.feelsLike) ? weather.feelsLike : weather.temp;
  if (finite(temp)) {
    const c = toCelsius(temp, units);
    if (c <= s.freezingAtC) on.add("freezing");
    if (c >= s.heatAtC) on.add("heat");
  }
  if (finite(weather.windSpeed) && toKmh(weather.windSpeed, units) >= s.windAtKmh) on.add("wind");
  return WEATHER_EFFECTS.filter((e) => on.has(e) && s.effects[e]);
}

/** `?weather-preview=snow,wind` on Home: effects to show for a minute, whatever the weather. */
export function parsePreview(param: string | null | undefined): WeatherEffect[] {
  if (!param) return [];
  const asked = new Set(param.split(",").map((x) => x.trim()));
  return WEATHER_EFFECTS.filter((e) => asked.has(e));
}

export const PREVIEW_MS = 60_000;

/**
 * The colours the weather effects are drawn in, for the backdrop under them.
 *
 * They were near-white everywhere, which is right on the dark theme and next
 * to invisible on a light one: the frost's crystals, rgb(240, 248, 255), are
 * 1.02:1 against linen (#F7F5EF). On a light backdrop the same shapes are drawn
 * in a cool blue-grey with a white halo; the dark theme keeps exactly the
 * colours it had. `rgb` triples are for the sprites that set their own alpha.
 */
export interface EffectPalette {
  /** The icy rim's three gradient stops: middle, 60 %, the edge. */
  frostRim: [string, string, string];
  frostCrystal: string;
  frostGlow: string;
  flake: string;
  flakeShadow: string;
  /** Distant flakes, as an rgb triple. */
  speck: string;
  dropTop: string;
  dropTip: string;
  /** Wind streaks, as an rgb triple. */
  gust: string;
  splash: string;
  /** Fog's drifting mist, as an rgb triple. */
  mist: string;
}

const DARK_BACKDROP: EffectPalette = {
  frostRim: ["rgba(215, 235, 255, 0)", "rgba(215, 235, 255, 0.10)", "rgba(225, 242, 255, 0.45)"],
  frostCrystal: "rgb(240, 248, 255)",
  frostGlow: "rgba(190, 220, 255, 0.8)",
  flake: "rgba(255, 255, 255, 0.95)",
  flakeShadow: "rgba(40, 70, 110, 0.45)",
  speck: "255, 255, 255",
  dropTop: "190, 215, 240",
  dropTip: "215, 235, 255",
  gust: "225, 232, 240",
  splash: "rgb(205, 225, 245)",
  mist: "215, 220, 228",
};

const LIGHT_BACKDROP: EffectPalette = {
  frostRim: ["rgba(110, 140, 180, 0)", "rgba(110, 140, 180, 0.08)", "rgba(100, 132, 172, 0.32)"],
  frostCrystal: "rgb(84, 116, 152)",
  frostGlow: "rgba(255, 255, 255, 0.85)",
  flake: "rgba(255, 255, 255, 0.95)",
  flakeShadow: "rgba(30, 55, 90, 0.8)",
  speck: "135, 155, 185",
  dropTop: "90, 120, 160",
  dropTip: "70, 105, 150",
  gust: "120, 135, 155",
  splash: "rgb(90, 122, 160)",
  mist: "165, 175, 190",
};

export function effectPalette(dark: boolean): EffectPalette {
  return dark ? DARK_BACKDROP : LIGHT_BACKDROP;
}
