/**
 * Reading Home Assistant entities without lying about what they say.
 *
 * The vehicle drivers used to do this inline, twice, with `parseFloat(state)`
 * and hardcoded unit labels. That was wrong in four ways at once, and an audit
 * against a real car found all four in the same card:
 *
 *   - `parseFloat` on a timestamp sensor returns the year (see charge-eta.ts)
 *   - `parseFloat("unknown")` is NaN, coerced to 0, rendered as "0 km" — a
 *     confident wrong number where there is no reading at all
 *   - the unit was hardcoded, so a car reporting `mi` or `°F` was relabelled
 *     `km` and `°C` rather than converted. The number stayed; only the label
 *     was a lie
 *   - state comparisons were case- and domain-sensitive: `=== "charging"`
 *     misses `tesla_custom`'s "Charging" and every binary_sensor's "on"
 *
 * So: a reading carries its own unit, absence is `null` rather than 0, and
 * nothing here converts between unit systems. What the car says is what the
 * dashboard shows.
 */

export interface HaEntityLike {
  state: string;
  attributes?: {
    device_class?: string;
    unit_of_measurement?: string;
    friendly_name?: string;
  };
}

/** A number and the unit the entity reported it in. */
export interface Reading {
  value: number;
  /** `null` when the entity carries no unit_of_measurement. */
  unit: string | null;
}

/** Home Assistant's ways of saying "no reading". None of them are values. */
const NO_READING = new Set(["unknown", "unavailable", "none", "null", ""]);

/** True when a state string carries no information. */
export function isMissing(state: string | null | undefined): boolean {
  return state == null || NO_READING.has(state.trim().toLowerCase());
}

/**
 * A numeric reading, or `null` when the entity is missing, unavailable or
 * simply not a number.
 *
 * Returning `null` rather than 0 is the point: callers have to decide what to
 * show for "no reading", and a dash is almost always righter than a zero.
 */
export function readNumber(entity: HaEntityLike | undefined): Reading | null {
  if (!entity || isMissing(entity.state)) return null;
  const value = Number.parseFloat(entity.state);
  if (Number.isNaN(value)) return null;
  return { value, unit: entity.attributes?.unit_of_measurement?.trim() || null };
}

/**
 * A state string, lowercased, or `null` when there is no reading.
 *
 * Lowercasing is what makes the comparisons below work across integrations:
 * `tesla_fleet` reports `charging`, `tesla_custom` reports `Charging`, and the
 * Kia/Hyundai integration reports `NOT_CHARGING`.
 */
export function readState(entity: HaEntityLike | undefined): string | null {
  if (!entity || isMissing(entity.state)) return null;
  return entity.state.trim().toLowerCase();
}

/**
 * Is the car charging?
 *
 * Handles the three shapes this arrives in:
 *   - a Tesla enum sensor: starting | charging | stopped | complete |
 *     disconnected | no_power
 *   - a binary_sensor: on | off
 *   - other vendors' free text: "Charging", "NOT_CHARGING", "AC charging",
 *     "Ladevorgang" — matched on the substring, which is why `not_charging`
 *     has to be excluded explicitly rather than by a bare `includes`
 *
 * `power` is the second opinion: a car drawing kilowatts is charging whatever
 * its state entity claims.
 */
export function isCharging(
  state: string | null,
  power?: number | null,
): boolean {
  if (power != null && power > 0) return true;
  if (!state) return false;
  const s = state.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "not_charging" || s === "no_power" || s === "disconnected") return false;
  if (s === "stopped" || s === "complete" || s === "completed") return false;
  return s === "on" || s === "starting" || s.includes("charging") || s.includes("charge");
}

/** Is the car plugged in? Distinct from charging: a full car is still plugged in. */
export function isPluggedIn(state: string | null): boolean {
  if (!state) return false;
  const s = state.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "disconnected" || s === "unplugged" || s === "off") return false;
  return s === "on" || s === "connected" || s === "plugged_in" || isCharging(s);
}

/**
 * Is it locked? `lock.*` says locked/unlocked, a binary_sensor says on/off —
 * and for a lock device class `on` means *unlocked*, which is the sort of
 * inversion worth stating rather than inferring at the call site.
 */
export function isLocked(entity: HaEntityLike | undefined): boolean | null {
  const s = readState(entity);
  if (!s) return null;
  if (s === "locked") return true;
  if (s === "unlocked") return false;
  if (entity?.attributes?.device_class === "lock") return s === "off";
  if (s === "on") return false;
  if (s === "off") return true;
  return null;
}

/**
 * Is it open? Covers `cover.*` (open/closed), binary_sensor (on = open for the
 * door/window/opening device classes) and the odd integration that reports
 * "Open"/"Geöffnet".
 */
export function isOpen(entity: HaEntityLike | undefined): boolean | null {
  const s = readState(entity);
  if (!s) return null;
  if (s === "open" || s === "opening") return true;
  if (s === "closed" || s === "closing") return false;
  if (s === "on") return true;
  if (s === "off") return false;
  return null;
}

/** Is the car awake/online? `asleep` and `offline` are both "not now". */
export function isOnline(state: string | null): boolean | null {
  if (!state) return null;
  const s = state.trim().toLowerCase();
  if (s === "online" || s === "on" || s === "driving" || s === "home") return true;
  if (s === "asleep" || s === "offline" || s === "off" || s === "sleeping") return false;
  return null;
}

/**
 * Render a reading with the unit the entity gave it.
 *
 * `dash` is what "no reading" looks like — an em dash by default, because the
 * alternative that shipped for a year was a zero.
 */
export function formatReading(
  reading: Reading | null,
  options: { digits?: number; dash?: string; locale?: string } = {},
): string {
  const { digits = 0, dash = "—", locale } = options;
  if (!reading) return dash;
  const value = reading.value.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // Degrees sit tight against the number (27.6 °C reads worse than 27.6°C);
  // everything else takes a space. Percent is tight for the same reason.
  if (!reading.unit) return value;
  if (reading.unit.startsWith("°") || reading.unit === "%") return `${value}${reading.unit}`;
  return `${value} ${reading.unit}`;
}

/** How many decimals a reading of this kind is worth showing. */
export const READING_DIGITS = {
  distance: 0,
  percent: 0,
  temperature: 1,
  power: 1,
  energy: 2,
  pressure: 1,
  voltage: 0,
  current: 0,
} as const;
