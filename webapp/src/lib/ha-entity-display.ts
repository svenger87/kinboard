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
