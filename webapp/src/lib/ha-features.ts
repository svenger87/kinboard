/**
 * `supported_features` — one bit at a time, per domain.
 *
 * RFC-008 R2. Every number below was read off the matrix in
 * `docs/rfc/008-entity-detail-coverage.md` §4.1, which in turn was read off
 * `home-assistant/core@dev`. They are *not* interchangeable between domains:
 * `4` is `EFFECT` on a light, `SET_POSITION` on a cover, `VOLUME_SET` on a
 * speaker and `PAUSE` on a vacuum. That is the whole reason the sheet's
 * fallback case never tests a bit — without knowing which enum a domain uses,
 * a bit test offers a button that does something else entirely.
 *
 * A missing `supported_features` attribute is 0: offer only the domain's
 * ungated services.
 */

/** `LightEntityFeature`. Brightness and colour temperature are **not** here — see {@link supportsBrightness}. */
export const LIGHT_FEATURE = {
  EFFECT: 4,
} as const;

/** `FanEntityFeature`. */
export const FAN_FEATURE = {
  SET_SPEED: 1,
  OSCILLATE: 2,
  DIRECTION: 4,
  PRESET_MODE: 8,
  TURN_OFF: 16,
  TURN_ON: 32,
} as const;

/** `CoverEntityFeature`. `SPEED = 256` is left out — new and near-unimplemented. */
export const COVER_FEATURE = {
  OPEN: 1,
  CLOSE: 2,
  SET_POSITION: 4,
  STOP: 8,
  OPEN_TILT: 16,
  CLOSE_TILT: 32,
  STOP_TILT: 64,
  SET_TILT_POSITION: 128,
} as const;

/** `LockEntityFeature`. `lock` and `unlock` are ungated; only the latch has a bit. */
export const LOCK_FEATURE = {
  OPEN: 1,
} as const;

/**
 * `MediaPlayerEntityFeature`.
 *
 * The six the RFC excludes (`SEEK = 2`, `PLAY_MEDIA = 512`,
 * `BROWSE_MEDIA = 131072`, `GROUPING = 524288`, `MEDIA_ANNOUNCE = 1048576`,
 * `SEARCH_MEDIA = 4194304`) are absent rather than defined-and-unused: an
 * unused constant reads like an oversight, and RFC-003 owns media browsing.
 */
export const MEDIA_PLAYER_FEATURE = {
  PAUSE: 1,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  SELECT_SOURCE: 2048,
  STOP: 4096,
  PLAY: 16384,
  SHUFFLE_SET: 32768,
  SELECT_SOUND_MODE: 65536,
  REPEAT_SET: 262144,
} as const;

/** `ClimateEntityFeature`. The mode buttons come from `hvac_modes`, not from a bit. */
export const CLIMATE_FEATURE = {
  TARGET_TEMPERATURE: 1,
  TARGET_TEMPERATURE_RANGE: 2,
  TARGET_HUMIDITY: 4,
  FAN_MODE: 8,
  PRESET_MODE: 16,
  SWING_MODE: 32,
  TURN_OFF: 128,
  TURN_ON: 256,
  SWING_HORIZONTAL_MODE: 512,
} as const;

/**
 * `VacuumEntityFeature`.
 *
 * `TURN_ON = 1`, `TURN_OFF = 2` and `STATUS = 128` are deprecated on
 * `StateVacuumEntity` and deliberately absent; `SEND_COMMAND = 256`,
 * `MAP = 2048` and `CLEAN_AREA = 16384` take vendor-specific payloads.
 */
export const VACUUM_FEATURE = {
  PAUSE: 4,
  STOP: 8,
  RETURN_HOME: 16,
  FAN_SPEED: 32,
  LOCATE: 512,
  CLEAN_SPOT: 1024,
  START: 8192,
} as const;

/**
 * `AlarmControlPanelEntityFeature`.
 *
 * `alarm_disarm` has no bit at all — it is always available. `TRIGGER = 8` is
 * excluded outright (RFC-008 §6): a panic button any passer-by can press.
 */
export const ALARM_FEATURE = {
  ARM_HOME: 1,
  ARM_AWAY: 2,
  ARM_NIGHT: 4,
  ARM_CUSTOM_BYPASS: 16,
  ARM_VACATION: 32,
} as const;

/** `HumidifierEntityFeature`. On/off and `set_humidity` are ungated. */
export const HUMIDIFIER_FEATURE = {
  MODES: 1,
} as const;

/**
 * Does this entity report the given bit?
 *
 * The bit must come from the constant table for the entity's *own* domain.
 */
export function supportsFeature(
  attributes: Record<string, unknown> | undefined,
  bit: number,
): boolean {
  const raw = attributes?.supported_features;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return false;
  return (raw & bit) !== 0;
}

/**
 * A light can be dimmed — RFC-008 R2, and not a feature bit.
 *
 * Brightness support is `supported_color_modes` being anything other than
 * exactly `["onoff"]`. A light that reports no colour modes at all reports no
 * dimming either, so the slider stays off rather than sending a `brightness`
 * the bulb will ignore.
 */
export function supportsBrightness(attributes: Record<string, unknown> | undefined): boolean {
  const modes = attributes?.supported_color_modes;
  if (!Array.isArray(modes) || modes.length === 0) return false;
  return modes.some((mode) => mode !== "onoff");
}

/** A light has a white-temperature channel: `color_temp` in `supported_color_modes`. */
export function supportsColorTemp(attributes: Record<string, unknown> | undefined): boolean {
  const modes = attributes?.supported_color_modes;
  return Array.isArray(modes) && modes.includes("color_temp");
}

/**
 * An attribute that should be a list of options, as a list of options.
 *
 * `effect_list`, `preset_modes`, `hvac_modes` and friends are author-defined
 * and arrive from whatever integration built them; one that is missing, empty
 * or full of objects means "no picker", not a crash.
 */
export function optionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/**
 * Whether a fan offers a power button, and which halves of it.
 *
 * `FanEntityFeature.TURN_ON = 32` and `TURN_OFF = 16` only arrived in Home
 * Assistant 2024.8. An integration written before that migration — and there
 * are plenty still running — sets **neither**, while `fan.turn_on` and
 * `fan.turn_off` have always existed as services for it. Gating strictly on the
 * bits therefore hands the household a fan with a speed slider, a preset
 * picker, and no way to switch it off, which reads as a bug in Kinboard rather
 * than as an honest report of what the fan can do.
 *
 * So: **neither bit set means "old, assume both"**, and both bits set means
 * both. Exactly one bit is the case that is *not* loosened — an entity that
 * says it can turn off but not on is making a specific claim, and is believed.
 *
 * This is deliberately more permissive than RFC-008 §4.1's Gate column, which
 * describes current Home Assistant rather than the fleet. Do not "fix" it back
 * to a plain `supportsFeature` pair.
 */
export function fanPowerButtons(attributes: Record<string, unknown> | undefined): {
  on: boolean;
  off: boolean;
} {
  const on = supportsFeature(attributes, FAN_FEATURE.TURN_ON);
  const off = supportsFeature(attributes, FAN_FEATURE.TURN_OFF);
  if (!on && !off) return { on: true, off: true };
  return { on, off };
}
