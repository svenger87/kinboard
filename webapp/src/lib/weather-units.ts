/**
 * Metric / imperial handling for the weather surfaces (issue #19).
 *
 * OpenWeatherMap takes a `units` parameter, but it does *not* convert
 * everything — which is the whole reason this module exists rather than
 * a bare pass-through:
 *
 *   | field       | metric | imperial | notes                          |
 *   |-------------|--------|----------|--------------------------------|
 *   | temperature | °C     | °F       | converted by the API           |
 *   | wind speed  | m/s    | mph      | **metric is m/s, not km/h**    |
 *   | visibility  | metres | metres   | never converted by the API     |
 *   | rain / snow | mm     | mm       | never converted by the API     |
 *
 * So metric needs a m/s → km/h step that imperial must *not* get (mph is
 * already the display unit), and visibility and precipitation have to be
 * converted by us in both systems. Getting this wrong is silent — the
 * numbers still look plausible — so the conversions live here, once,
 * next to the table that explains them.
 */

export type UnitSystem = "metric" | "imperial";

export const DEFAULT_UNIT_SYSTEM: UnitSystem = "metric";

export function isUnitSystem(value: unknown): value is UnitSystem {
  return value === "metric" || value === "imperial";
}

/** Coerce anything (a query param, a stored setting) to a valid system. */
export function toUnitSystem(value: unknown): UnitSystem {
  return isUnitSystem(value) ? value : DEFAULT_UNIT_SYSTEM;
}

/**
 * Display symbols. Not translated: these are internationally standard
 * notation, and a French user still reads "km/h" and "mph".
 */
export interface UnitLabels {
  temperature: string;
  speed: string;
  distance: string;
  precipitation: string;
}

export const UNIT_LABELS: Record<UnitSystem, UnitLabels> = {
  metric: {
    temperature: "°C",
    speed: "km/h",
    distance: "km",
    precipitation: "mm",
  },
  imperial: {
    temperature: "°F",
    speed: "mph",
    distance: "mi",
    precipitation: "in",
  },
};

export function unitLabels(system: UnitSystem): UnitLabels {
  return UNIT_LABELS[system];
}

/**
 * Wind speed from OpenWeatherMap's raw value to the display unit.
 *
 * Metric responses are metres per second, which nobody puts on a
 * dashboard, so they become km/h. Imperial responses are already mph and
 * must be left alone — multiplying them by 3.6 was the bug waiting to
 * happen here.
 */
export function windSpeedForDisplay(raw: number, system: UnitSystem): number {
  return Math.round(system === "metric" ? raw * 3.6 : raw);
}

/**
 * Visibility from metres to the display unit. OpenWeatherMap reports
 * metres regardless of the `units` parameter.
 */
export function visibilityForDisplay(metres: number, system: UnitSystem): number {
  return Math.round(system === "metric" ? metres / 1000 : metres / 1609.344);
}

/**
 * Precipitation volume from millimetres to the display unit, also
 * unconverted by the API. Kept to one decimal in metric (1.4 mm) and two
 * in imperial, because an inch is big enough that one decimal would
 * round most real rainfall to 0.0.
 */
export function precipitationForDisplay(mm: number, system: UnitSystem): number {
  if (system === "metric") return Math.round(mm * 10) / 10;
  return Math.round((mm / 25.4) * 100) / 100;
}
