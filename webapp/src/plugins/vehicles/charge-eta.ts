/**
 * How long until the car finishes charging.
 *
 * Home Assistant's Tesla integrations do not agree on what this sensor holds.
 * `tesla_custom` and `tesla_fleet` expose the moment charging completes, as a
 * `device_class: timestamp` whose state is an ISO datetime:
 *
 *   sensor.model_y_zeit_zum_vollstandigen_aufladen = "2026-08-08T12:51:36+00:00"
 *
 * TeslaMate and hand-rolled template sensors expose a duration instead, in
 * minutes or in hours depending on which field they mirror — the Tesla API's
 * own `time_to_full_charge` is in hours.
 *
 * Everything else in the driver reads entity states with `parseFloat`, which on
 * that ISO string returns **2026** — the year. Displayed as minutes that became
 * "~33h 46min" on a car that was 108 minutes from full. This resolver exists so
 * the value is read as what it actually is.
 */

export interface ChargeEtaEntity {
  state: string;
  attributes?: {
    device_class?: string;
    unit_of_measurement?: string;
  };
}

/** States Home Assistant uses for "no reading", none of them numbers. */
const NO_READING = ["unknown", "unavailable", "none", ""];

/** An ISO-8601 datetime, which is what a timestamp sensor's state looks like. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * Minutes remaining until the charge completes, or 0 when that is unknowable.
 *
 * `now` is injectable so the timestamp branch can be tested without freezing
 * the clock.
 */
export function minutesToFullCharge(
  entity: ChargeEtaEntity | undefined,
  now: number = Date.now(),
): number {
  const raw = entity?.state?.trim();
  if (!raw || NO_READING.includes(raw.toLowerCase())) return 0;

  // A completion time rather than a duration.
  if (entity?.attributes?.device_class === "timestamp" || ISO_DATETIME.test(raw)) {
    const target = Date.parse(raw);
    if (Number.isNaN(target)) return 0;
    // Past deadlines mean the charge finished (or the sensor is stale). Either
    // way there is nothing to count down to, and a negative number would render
    // as a nonsense "~-3min".
    return Math.max(0, Math.round((target - now) / 60_000));
  }

  const value = Number.parseFloat(raw);
  if (Number.isNaN(value) || value <= 0) return 0;

  // A bare number is a duration, and the unit says which. Hours are the Tesla
  // API's own convention; anything else is treated as minutes, which is what
  // TeslaMate reports. A duration sensor with no unit at all is ambiguous and
  // read as minutes rather than guessed at.
  const unit = entity?.attributes?.unit_of_measurement?.trim().toLowerCase();
  if (unit === "h" || unit === "hr" || unit === "hrs" || unit === "hours") {
    return Math.round(value * 60);
  }
  return Math.round(value);
}
