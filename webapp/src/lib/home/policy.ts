/**
 * What an assistant may do in the home — RFC-011 §4.
 *
 * This is the boundary between a language model and a household's devices,
 * so it is written as an allowlist and fails closed: a domain, a service or a
 * data key that is not named below is refused, and nothing is inferred.
 *
 * - **The domain comes from the entity id**, never from the caller. The
 *   service is a bare name (`turn_on`), so `homeassistant.turn_on` — Home
 *   Assistant's generic pair, which forwards to any domain — cannot be reached
 *   at all, and neither can any other domain smuggled in through the service.
 * - **Data is rebuilt, not passed through.** Only keys a service declares are
 *   copied, each after its validator; anything else is `invalid_data`. The
 *   targeting keys (`entity_id`, `area_id`, …) are refused outright — the
 *   server adds the entity id itself — and so is `code`: an assistant neither
 *   holds nor relays alarm or lock codes.
 * - **Sensitive** means the action waits for a family member to confirm it
 *   with the settings PIN on a Kinboard screen. Locks, alarm panels, scenes,
 *   scripts, buttons, sirens, mowers and helper toggles (`input_boolean`)
 *   always are — a scene or a script can unlock, disarm or open, and a
 *   helper toggle can drive any automation. A switch is too, **unless** Home
 *   Assistant reports its `device_class` as `outlet`: a switch can be a
 *   garage relay or an alarm, an outlet is a plug. A switch that is really a
 *   lamp can be shown as a light with "Show as" in Home Assistant; it then
 *   becomes a `light.*` entity and no longer asks. A cover is sensitive too, **unless** Home
 *   Assistant reports its `device_class` as one of the plainly harmless
 *   window coverings (awning, blind, curtain, damper, shade, shutter).
 *   Default-deny: garage, gate, door, window, any value we do not know, and
 *   no device class at all all ask first — garage openers often report
 *   `door` or nothing. A household can mark an unclassified blind with
 *   "Show as" in Home Assistant. The caller reads the device class live and
 *   passes it in; this module never guesses it from the entity's name.
 *
 * Pure: no I/O, no server-only imports — the Playwright specs import it.
 * Every entry of `DANGEROUS_ACTIONS` (RFC-008, `ha-dangerous-actions.ts`) is
 * either sensitive here or not allowed; `e2e/home-policy.spec.ts` holds that.
 */

export type HomeDecision =
  | { ok: true; sensitive: boolean; data: Record<string, unknown> }
  | { ok: false; reason: "not_allowed" | "invalid_data" };

export interface DataField {
  readonly required: boolean;
  /** Returns the value to send, or `undefined` if it is not acceptable. */
  readonly parse: (value: unknown) => unknown;
}

export interface ServiceSpec {
  /**
   * `always`, `never`, or unless the device class says it is harmless:
   * a plain window covering (covers) or an outlet (switches).
   */
  readonly sensitive: "always" | "never" | "unless_blind" | "unless_outlet";
  readonly fields: Readonly<Record<string, DataField>>;
  /** Groups of keys of which at most one may be present. */
  readonly exclusive?: readonly (readonly string[])[];
}

/** HA's entity id shape: lowercase domain, a dot, lowercase object id. */
export const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
const MAX_ENTITY_ID = 255;
const SERVICE_NAME = /^[a-z_]+$/;

/**
 * Keys never accepted in service data, whatever a spec says. Targeting keys
 * would let the call reach a different entity than the one checked; `code`
 * would make the assistant a carrier of alarm and lock codes.
 */
export const FORBIDDEN_DATA_KEYS: ReadonlySet<string> = new Set([
  "entity_id",
  "area_id",
  "device_id",
  "floor_id",
  "label_id",
  "code",
]);

// ── validators ──────────────────────────────────────────────────────────────

function int(min: number, max: number): (v: unknown) => unknown {
  return (v) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined);
}

function num(min: number, max: number): (v: unknown) => unknown {
  return (v) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
}

function oneOf(values: readonly string[]): (v: unknown) => unknown {
  return (v) => (typeof v === "string" && values.includes(v) ? v : undefined);
}

function bool(v: unknown): unknown {
  return typeof v === "boolean" ? v : undefined;
}

// Printable text only: no control characters, no line breaks.
const CONTROL = /[\u0000-\u001f\u007f]/;
function text(maxLength: number): (v: unknown) => unknown {
  return (v) =>
    typeof v === "string" && v.length > 0 && v.length <= maxLength && !CONTROL.test(v) ? v : undefined;
}

function rgb(v: unknown): unknown {
  if (!Array.isArray(v) || v.length !== 3) return undefined;
  const channel = int(0, 255);
  // Array.from visits holes (as undefined), so `[1, , 3]` is refused; `map` would skip them.
  const out = Array.from(v as unknown[], channel);
  return out.every((c) => c !== undefined) ? out : undefined;
}

const optional = (parse: (v: unknown) => unknown): DataField => ({ required: false, parse });
const required = (parse: (v: unknown) => unknown): DataField => ({ required: true, parse });

/** HA's `HVACMode` values. */
const HVAC_MODES = ["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"] as const;

const plain: ServiceSpec = { sensitive: "never", fields: {} };
const always: ServiceSpec = { sensitive: "always", fields: {} };
const coverMove: ServiceSpec = { sensitive: "unless_blind", fields: {} };
const outlet: ServiceSpec = { sensitive: "unless_outlet", fields: {} };
const onOffToggle = { turn_on: plain, turn_off: plain, toggle: plain };

// ── the table: RFC-011 §4, exactly ─────────────────────────────────────────

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

export const ALLOWED_SERVICES: Readonly<Record<string, Readonly<Record<string, ServiceSpec>>>> =
  deepFreeze({
    light: {
      turn_on: {
        sensitive: "never",
        fields: {
          brightness_pct: optional(int(0, 100)),
          color_temp_kelvin: optional(int(1500, 9000)),
          rgb_color: optional(rgb),
        },
        // HA rejects two colour specifications in one call.
        exclusive: [["color_temp_kelvin", "rgb_color"]],
      },
      turn_off: plain,
      toggle: plain,
    },
    // A switch can be a garage relay, a door opener or an alarm: only an outlet is harmless.
    switch: { turn_on: outlet, turn_off: outlet, toggle: outlet },
    // A helper toggle can drive any automation ("away mode", "open gate").
    input_boolean: { turn_on: always, turn_off: always, toggle: always },
    fan: {
      ...onOffToggle,
      set_percentage: { sensitive: "never", fields: { percentage: required(int(0, 100)) } },
    },
    climate: {
      set_temperature: { sensitive: "never", fields: { temperature: required(num(5, 30)) } },
      set_hvac_mode: { sensitive: "never", fields: { hvac_mode: required(oneOf(HVAC_MODES)) } },
      turn_on: plain,
      turn_off: plain,
    },
    media_player: {
      media_play: plain,
      media_pause: plain,
      media_stop: plain,
      media_next_track: plain,
      media_previous_track: plain,
      volume_set: { sensitive: "never", fields: { volume_level: required(num(0, 1)) } },
      volume_mute: { sensitive: "never", fields: { is_volume_muted: required(bool) } },
      turn_on: plain,
      turn_off: plain,
      select_source: { sensitive: "never", fields: { source: required(text(100)) } },
    },
    cover: {
      open_cover: coverMove,
      close_cover: coverMove,
      stop_cover: coverMove,
      set_cover_position: { sensitive: "unless_blind", fields: { position: required(int(0, 100)) } },
    },
    // A scene can include a lock, an alarm panel or a cover.
    scene: { turn_on: always },
    vacuum: { start: plain, pause: plain, return_to_base: plain },
    humidifier: {
      turn_on: plain,
      turn_off: plain,
      set_humidity: { sensitive: "never", fields: { humidity: required(int(0, 100)) } },
    },
    lock: { lock: always, unlock: always, open: always },
    // No `code` field, ever: see FORBIDDEN_DATA_KEYS.
    alarm_control_panel: {
      alarm_arm_home: always,
      alarm_arm_away: always,
      alarm_arm_night: always,
      alarm_disarm: always,
    },
    // A script can do anything.
    script: { turn_on: always },
    // RFC-008: a button's meaning cannot be known from the entity.
    button: { press: always },
    input_button: { press: always },
    siren: { turn_on: always, turn_off: always },
    lawn_mower: { start_mowing: always, dock: always, pause: always },
  });

/**
 * The only cover device classes that move without asking. Everything else —
 * garage, gate, door, window (opening one is a way in), an unknown value or
 * none — is sensitive.
 */
const HARMLESS_COVERS: ReadonlySet<string> = new Set([
  "awning",
  "blind",
  "curtain",
  "damper",
  "shade",
  "shutter",
]);

function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function domainOf(entityId: unknown): string | null {
  if (typeof entityId !== "string" || entityId.length > MAX_ENTITY_ID || !ENTITY_ID.test(entityId)) {
    return null;
  }
  return entityId.slice(0, entityId.indexOf("."));
}

function isSensitive(spec: ServiceSpec, deviceClass: string | null): boolean {
  if (spec.sensitive === "always") return true;
  if (spec.sensitive === "never") return false;
  const dc = typeof deviceClass === "string" ? deviceClass.trim().toLowerCase() : null;
  // Default-deny: only an outlet, or a recognised window covering, is harmless.
  if (spec.sensitive === "unless_outlet") return dc !== "outlet";
  return !(dc !== null && HARMLESS_COVERS.has(dc));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateData(spec: ServiceSpec, data: unknown): Record<string, unknown> | null {
  if (data === undefined || data === null) data = {};
  if (!isPlainObject(data)) return null;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (FORBIDDEN_DATA_KEYS.has(key)) return null;
    const field = own(spec.fields, key);
    if (!field) return null;
    const value = field.parse(data[key]);
    if (value === undefined) return null;
    out[key] = value;
  }
  for (const [key, field] of Object.entries(spec.fields)) {
    if (field.required && !Object.prototype.hasOwnProperty.call(out, key)) return null;
  }
  for (const group of spec.exclusive ?? []) {
    if (group.filter((key) => Object.prototype.hasOwnProperty.call(out, key)).length > 1) return null;
  }
  return out;
}

/**
 * May an assistant run `service` on `entityId`, with `data`? And if so, does
 * a family member have to confirm it first?
 *
 * `deviceClass` is the entity's `device_class` as Home Assistant reports it
 * right now, or `null` when it has none; a cover or a switch without one is
 * sensitive.
 */
export function decideHomeAction(input: {
  entityId: string;
  service: string;
  data: unknown;
  deviceClass: string | null;
}): HomeDecision {
  const domain = domainOf(input.entityId);
  if (domain === null) return { ok: false, reason: "not_allowed" };
  if (typeof input.service !== "string" || !SERVICE_NAME.test(input.service)) {
    return { ok: false, reason: "not_allowed" };
  }
  const services = own(ALLOWED_SERVICES, domain);
  const spec = services && own(services, input.service);
  if (!spec) return { ok: false, reason: "not_allowed" };

  const data = validateData(spec, input.data);
  if (data === null) return { ok: false, reason: "invalid_data" };
  return { ok: true, sensitive: isSensitive(spec, input.deviceClass), data };
}

/** What an assistant may call on this entity, sorted by service name. */
export function allowedActionsFor(
  entityId: string,
  deviceClass: string | null,
): { service: string; sensitive: boolean }[] {
  const domain = domainOf(entityId);
  const services = domain === null ? undefined : own(ALLOWED_SERVICES, domain);
  if (!services) return [];
  return Object.entries(services)
    .map(([service, spec]) => ({ service, sensitive: isSensitive(spec, deviceClass) }))
    .sort((a, b) => (a.service < b.service ? -1 : a.service > b.service ? 1 : 0));
}
