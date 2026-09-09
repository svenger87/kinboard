/**
 * Displaying a Home Assistant entity the sheet has never heard of.
 *
 * RFC-008 §5. Home Assistant ships hundreds of domains and custom integrations
 * invent more, so what the detail sheet does with an *unrecognised* domain is
 * what it does most often in a real house. The rule there is to key off the
 * shape of the value rather than the domain name: a number is a number whether
 * it arrives from `sensor` or from `air_quality`, and an ISO timestamp is a
 * date whether the domain is `button` or something a neighbour wrote last
 * week.
 *
 * These helpers are pure and locale-free on purpose — they say *what* a value
 * is, the component says how to word it — so they can be tested without a
 * browser, a stack or a translation catalogue.
 */

/** What the string in `entity.state` actually is. */
export type EntityStateShape =
  /** `unavailable` or `unknown` — HA is telling us it has no value. */
  | { kind: "unavailable" }
  /** The whole string is a number. `value` is it; the unit lives elsewhere. */
  | { kind: "number"; value: number }
  /** An ISO 8601 date, time, or both. */
  | { kind: "datetime"; date: Date; parts: "date" | "time" | "datetime" }
  /** Literally `on` or `off` — the only pair HA guarantees across domains. */
  | { kind: "toggle"; on: boolean }
  /** Anything else. Render it once, unchanged. */
  | { kind: "text"; value: string };

/*
  Deliberately stricter than `parseFloat`.

  `parseFloat("2026-09-09T18:42:00+00:00")` is 2026, and `parseFloat("42 AQI")`
  is 42 — both would turn a value the household can read into a number that
  lies about what the entity said. A state is a number only when the entire
  string is one.
*/
const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** Classify `entity.state` by shape. See {@link EntityStateShape}. */
export function classifyEntityState(state: string | undefined | null): EntityStateShape {
  const raw = (state ?? "").trim();

  if (raw === "" || raw === "unavailable" || raw === "unknown") {
    return { kind: "unavailable" };
  }

  if (NUMERIC.test(raw)) {
    const value = Number(raw);
    if (Number.isFinite(value)) return { kind: "number", value };
  }

  // Checked after the numeric test only because the two can never both match;
  // the order carries no meaning beyond reading in the order RFC-008 lists.
  if (ISO_DATETIME.test(raw)) {
    const date = new Date(raw.replace(" ", "T"));
    if (!Number.isNaN(date.getTime())) return { kind: "datetime", date, parts: "datetime" };
  }
  if (ISO_DATE.test(raw)) {
    // Parsed as local midnight, not UTC: `new Date("2026-09-09")` is UTC and
    // renders as the 8th anywhere west of Greenwich.
    const [y, m, d] = raw.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (!Number.isNaN(date.getTime())) return { kind: "datetime", date, parts: "date" };
  }
  if (ISO_TIME.test(raw)) {
    const date = new Date(`1970-01-01T${raw}`);
    if (!Number.isNaN(date.getTime())) return { kind: "datetime", date, parts: "time" };
  }

  if (raw === "on" || raw === "off") return { kind: "toggle", on: raw === "on" };

  return { kind: "text", value: raw };
}

/**
 * Attributes that are plumbing: HA's own bookkeeping, or something the sheet
 * has already used to draw the header. None of them mean anything to a
 * household reading a wall panel.
 */
export const PLUMBING_ATTRIBUTES: readonly string[] = [
  "friendly_name",
  "icon",
  "supported_features",
  "entity_picture",
  "attribution",
  "editable",
  "id",
  "assumed_state",
  "restored",
];

/** True for plumbing and for anything an integration marked private with `_`. */
export function isPlumbingAttribute(key: string): boolean {
  return key.startsWith("_") || PLUMBING_ATTRIBUTES.includes(key);
}

/** What an attribute's value is, for choosing how to render the row. */
export type AttributeValueShape =
  /** One value on one line. */
  | { kind: "scalar"; value: string | number | boolean | null }
  /** A list of plain values — joined into the row. */
  | { kind: "list"; items: (string | number | boolean | null)[] }
  /** An object, or a list containing one — put behind a disclosure. */
  | { kind: "complex"; json: string };

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** Classify an attribute value. See {@link AttributeValueShape}. */
export function classifyAttributeValue(value: unknown): AttributeValueShape {
  if (value === undefined) return { kind: "scalar", value: null };
  if (isPrimitive(value)) return { kind: "scalar", value };

  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) return { kind: "list", items: value };
    return { kind: "complex", json: safeJson(value) };
  }

  return { kind: "complex", json: safeJson(value) };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // Circular, or a BigInt. Neither should reach us over JSON, but a row
    // that throws would take the whole sheet down with it.
    return String(value);
  }
}

/**
 * `current_position` → `Current position`.
 *
 * Sentence case, not Title Case: these are HA's own snake_case identifiers and
 * capitalising every word ("Current Position") reads like a form label from
 * 1998. Only the first letter is touched, so `PM2.5` stays as its author wrote
 * it.
 */
export function humanizeAttributeKey(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * `air_quality` → `Air quality`.
 *
 * The fallback for `domainLabels`, which names 21 domains out of the hundreds
 * that exist. A domain nobody translated is still a word; showing "Unknown"
 * (or the raw id) where "Air quality" would do is a gap the household can see.
 */
export function humanizeDomain(domain: string): string {
  return humanizeAttributeKey(domain);
}

/**
 * What the 24h history section should draw, per RFC-008 R3.
 *
 * `/api/homeassistant/history` maps every sample through `parseFloat` and,
 * on `NaN`, falls back to `state === "on" ? 1 : 0` — right for a numeric
 * sensor, and a flat line at zero for everything else that looks exactly
 * like a reading (a `climate` history of `heat_cool`, a vacuum's `docked`).
 * That route is not this function's to fix (other callers depend on it); the
 * fix is choosing, per domain, whether the resulting series is honest:
 *
 * - `"area"` — a continuous numeric series worth a chart.
 * - `"band"` — a binary/low-cardinality series where a step timeline is
 *   meaningful (the on/off 1-and-0 the route already emits).
 * - `"none"` — no meaningful chart. The caller omits the section entirely
 *   rather than draw the zero line.
 */
export type HistoryKind = "area" | "band" | "none";

/**
 * Domains whose §4 verdict is `band` outright — no attribute or state check
 * needed beyond the domain name.
 */
const BAND_DOMAINS: readonly string[] = [
  "binary_sensor", "switch", "light", "input_boolean", "fan", "lock",
  "humidifier", "siren", "remote", "schedule",
];

/** Domains whose §4 verdict is `area` outright. */
const AREA_DOMAINS: readonly string[] = [
  "number", "input_number", "counter", "air_quality",
];

/**
 * Domains whose §4 verdict is `none` outright — controllable but with a
 * state that is an enum, a timestamp, or otherwise not a series (§4.1–§4.3).
 * `sensor` is handled separately below; it is the one domain the matrix
 * cannot decide from the name alone.
 */
const NONE_DOMAINS: readonly string[] = [
  "media_player", "climate", "vacuum", "water_heater", "lawn_mower",
  "alarm_control_panel", "scene", "script", "automation", "button",
  "input_button", "select", "input_select", "timer", "date", "time",
  "datetime", "input_datetime", "text", "input_text", "update", "person",
  "device_tracker", "weather", "sun", "calendar", "event", "image", "zone",
  "camera",
];

/** Classify what the 24h history section should draw. See {@link HistoryKind}. */
export function classifyEntityHistory(
  domain: string,
  state: string | undefined | null,
  attributes: Record<string, unknown> = {},
): HistoryKind {
  if (BAND_DOMAINS.includes(domain)) return "band";
  if (AREA_DOMAINS.includes(domain)) return "area";
  if (NONE_DOMAINS.includes(domain)) return "none";

  // `cover`/`valve` share one shape: positioned covers/valves are a
  // continuous 0–100 series, unpositioned ones are on/off.
  if (domain === "cover" || domain === "valve") {
    return attributes.current_position !== undefined ? "area" : "band";
  }

  if (domain === "sensor") {
    // §4.3 — the one domain a name alone cannot decide: chart it when
    // `state_class` says it is a measurement, or when the state itself
    // parses as a number (an `enum` or text sensor does neither).
    if (attributes.state_class != null) return "area";
    return classifyEntityState(state).kind === "number" ? "area" : "none";
  }

  if (domain === "group") {
    // §4.2 — "band when on/off"; a group of mixed non-toggle members has no
    // series worth drawing.
    return classifyEntityState(state).kind === "toggle" ? "band" : "none";
  }

  // A domain the matrix has never heard of (including the ones §4.4
  // deliberately excludes from the sheet's own actions, e.g. `todo`). §5.4:
  // chart only when the state itself parses as a number — reuse the same
  // judgement the shape-based fallback already makes.
  return classifyEntityState(state).kind === "number" ? "area" : "none";
}

/**
 * Which `binarySensorState` key says what this binary sensor is reporting.
 *
 * RFC-008 R5 and §4.3. `on`/`off` is HA's own vocabulary, not the
 * household's: a door sensor is Open or Closed, a smoke detector is "Smoke!"
 * or "No smoke", and a `battery` sensor reading "On" is telling somebody their
 * battery is *low* in the least helpful way available. The 17 device classes
 * below are the ones `homeAutomation.binarySensorState` has words for; a class
 * outside the list falls back to plain `on`/`off`, which is still correct —
 * just not specific.
 *
 * Several classes deliberately share a pair: `window` and `garage_door` read
 * the same as `door`, `occupancy` as `presence`, `water` as `moisture`,
 * `power` as `plug`, and `safety` as `problem`.
 */
export function binarySensorStateKey(
  deviceClass: string | undefined,
  state: string,
): string {
  const isOn = state === "on";

  switch (deviceClass) {
    case "door":
    case "garage_door":
    case "window":
      return isOn ? "doorOpen" : "doorClosed";
    case "motion":
      return isOn ? "motionOn" : "motionOff";
    case "occupancy":
    case "presence":
      return isOn ? "presenceOn" : "presenceOff";
    case "moisture":
    case "water":
      return isOn ? "moistureOn" : "moistureOff";
    case "smoke":
      return isOn ? "smokeOn" : "smokeOff";
    case "gas":
      return isOn ? "gasOn" : "gasOff";
    case "carbon_monoxide":
      return isOn ? "coOn" : "coOff";
    case "lock":
      return isOn ? "lockOn" : "lockOff";
    case "heat":
      return isOn ? "heatOn" : "heatOff";
    case "cold":
      return isOn ? "coldOn" : "coldOff";
    case "plug":
    case "power":
      return isOn ? "plugOn" : "plugOff";
    case "light":
      return isOn ? "lightOn" : "lightOff";
    case "sound":
      return isOn ? "soundOn" : "soundOff";
    case "vibration":
      return isOn ? "vibrationOn" : "vibrationOff";
    case "battery":
      return isOn ? "batteryOn" : "batteryOff";
    case "safety":
    case "problem":
      return isOn ? "problemOn" : "problemOff";
    case "tamper":
      return isOn ? "tamperOn" : "tamperOff";
    default:
      return isOn ? "on" : "off";
  }
}

/**
 * RFC-008 R1 — the domains whose *resting* state is legitimately `unknown`.
 *
 * The reading gate (`unavailable` / `unknown` / `""` / not in the poll at all)
 * is right for a device and wrong for these: a `button` nobody has pressed, an
 * `event` nobody has fired, an `image` with no frame yet, a `scene` after a
 * Home Assistant restart and a `date`/`time`/`datetime` with no value set all
 * report `unknown` while working perfectly. Greying them out says "not
 * reachable" about something that is merely *new*, and on a `button` it greys
 * out the only control the entity has — permanently, since the only way to
 * give it a state is to press the button that the gate has just disabled.
 *
 * `unavailable` is **not** an exception, here or anywhere: that one really does
 * mean Home Assistant cannot reach the thing.
 *
 * One list, because there are two gates — the tiles' `hasReading` in
 * `app/home-automation/page.tsx` and the sheet's dispatcher in
 * `entity-actions.tsx` — and two copies of an exception list is how one of them
 * comes to be missing `image` while the other has it.
 *
 * R1 also names `number` and `text`. They are deliberately absent: their
 * controls are a later phase, and a helper with no value yet is a case nobody
 * has looked at on a real instance. Adding them here is one line when somebody
 * has.
 */
const RESTING_UNKNOWN_DOMAINS: readonly string[] = [
  "button", "input_button", "event", "image", "scene",
  "date", "time", "datetime", "input_datetime",
];

/**
 * Is this entity resting at `unknown` rather than out of reach?
 *
 * True only for {@link RESTING_UNKNOWN_DOMAINS} and only while the state is not
 * `unavailable`. Callers use it to *skip* the reading gate, never to claim the
 * entity has a reading — it has not; it has nothing to report yet.
 */
export function isRestingUnknown(domain: string, state: string | undefined | null): boolean {
  return RESTING_UNKNOWN_DOMAINS.includes(domain) && state !== "unavailable";
}

/**
 * Which `entityDetail` key says "nothing has happened yet" for this domain.
 *
 * The condition is {@link isRestingUnknown}; this is the wording, and it is
 * separate because the two have different lifetimes. The condition is one list
 * that every gate reads. The wording is per domain and grows as RFC-008 §9's
 * copy lands: `scene` has had `neverActivated` since the sheet learned about
 * R1, and `button`, `event` and `image` will want "Not pressed yet", "Nothing
 * yet" and so on when their controls arrive. Until then `noValueYet` is the
 * honest general answer — it says the entity has nothing to report, which is
 * true of all of them, rather than "Not reachable", which is true of none.
 *
 * One function rather than a conditional at each caller: the tile and the sheet
 * must not be able to describe the same scene two different ways, which is what
 * they did before this existed.
 */
export function restingUnknownCopyKey(domain: string): string {
  return domain === "scene" ? "neverActivated" : "noValueYet";
}
