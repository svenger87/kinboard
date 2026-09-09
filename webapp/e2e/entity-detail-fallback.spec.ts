import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";
import {
  classifyAttributeValue,
  classifyEntityHistory,
  classifyEntityState,
  binarySensorStateKey,
  humanizeAttributeKey,
  humanizeDomain,
  isPlumbingAttribute,
} from "../src/lib/ha-entity-display";
import {
  ALARM_FEATURE,
  CLIMATE_FEATURE,
  COVER_FEATURE,
  FAN_FEATURE,
  HUMIDIFIER_FEATURE,
  LIGHT_FEATURE,
  LOCK_FEATURE,
  MEDIA_PLAYER_FEATURE,
  VACUUM_FEATURE,
  fanPowerButtons,
  optionList,
  supportsBrightness,
  supportsColorTemp,
  supportsFeature,
} from "../src/lib/ha-features";
import { OPTIMISTIC_SETTLE_MS, POLL_MS } from "../src/lib/home-assistant-optimism";
import { DANGEROUS_ACTIONS, dangerousAction } from "../src/lib/ha-dangerous-actions";

/**
 * The detail sheet against a domain nobody has heard of — RFC-008 §5.
 *
 * Home Assistant ships hundreds of domains and custom integrations invent
 * more, so the fallback is not an edge case: it is the branch most entities in
 * a real house take. Before this, an unrecognised entity got a raw state
 * string, an empty attributes list and a 24h chart of `parseFloat` fallbacks —
 * a flat line at zero that reads exactly like a reading. That is not "no
 * support", it is a screen that looks broken.
 *
 * These assert on the shape rules rather than on a rendered page because the
 * sheet has no caller yet (RFC-008 lands it on every tile in a later step),
 * and because the rules are where the mistakes are: a timestamp that
 * `parseFloat`s to its year, an object stringified into a table row, a
 * `supported_features` bit read without knowing the domain's flag enum.
 */

test.describe("state, by the shape of the value", () => {
  test("a whole-string number is a number", () => {
    expect(classifyEntityState("42")).toEqual({ kind: "number", value: 42 });
    expect(classifyEntityState("-0.5")).toEqual({ kind: "number", value: -0.5 });
  });

  test("a timestamp is a date, not the year parseFloat finds in it", () => {
    // parseFloat("2026-09-09T18:42:00+00:00") is 2026. Rendering an entity's
    // last-pressed time as "2,026" is the exact failure this rules out.
    const shape = classifyEntityState("2026-09-09T18:42:00+00:00");
    expect(shape.kind).toBe("datetime");
    if (shape.kind === "datetime") expect(shape.parts).toBe("datetime");

    const dateOnly = classifyEntityState("2026-09-09");
    expect(dateOnly.kind).toBe("datetime");
    // Local midnight, not UTC: `new Date("2026-09-09")` renders as the 8th
    // anywhere west of Greenwich.
    if (dateOnly.kind === "datetime") expect(dateOnly.date.getDate()).toBe(9);

    const timeOnly = classifyEntityState("18:42:00");
    expect(timeOnly.kind).toBe("datetime");
    if (timeOnly.kind === "datetime") expect(timeOnly.parts).toBe("time");
  });

  test("a number with a unit stuck to it is text, not a number", () => {
    // parseFloat("42 AQI") is 42; showing 42 would drop what it measures.
    expect(classifyEntityState("42 AQI")).toEqual({ kind: "text", value: "42 AQI" });
  });

  test("on and off are the toggle pair; anything else is its own word", () => {
    expect(classifyEntityState("on")).toEqual({ kind: "toggle", on: true });
    expect(classifyEntityState("off")).toEqual({ kind: "toggle", on: false });
    expect(classifyEntityState("heat_pump")).toEqual({ kind: "text", value: "heat_pump" });
    expect(classifyEntityState("Away")).toEqual({ kind: "text", value: "Away" });
  });

  test("unavailable, unknown and empty all mean no reading", () => {
    expect(classifyEntityState("unavailable").kind).toBe("unavailable");
    expect(classifyEntityState("unknown").kind).toBe("unavailable");
    expect(classifyEntityState("").kind).toBe("unavailable");
    expect(classifyEntityState(undefined).kind).toBe("unavailable");
  });
});

test.describe("attributes", () => {
  test("plumbing stays hidden, everything else is shown", () => {
    for (const key of [
      "friendly_name", "icon", "supported_features", "entity_picture",
      "attribution", "editable", "id", "assumed_state", "restored",
      "_private_handle",
    ]) {
      expect(isPlumbingAttribute(key), key).toBe(true);
    }
    for (const key of ["current_position", "available_tones", "operation_list", "device_class"]) {
      expect(isPlumbingAttribute(key), key).toBe(false);
    }
  });

  test("a list of plain values is joined; an object goes behind a disclosure", () => {
    expect(classifyAttributeValue(["eco", "heat_pump"])).toEqual({
      kind: "list",
      items: ["eco", "heat_pump"],
    });
    // The row is the wrong place for this: `String({})` is "[object Object]"
    // and a stringified object is a line of noise as wide as the sheet.
    expect(classifyAttributeValue({ species: "Robin" }).kind).toBe("complex");
    expect(classifyAttributeValue([{ species: "Robin" }]).kind).toBe("complex");
    expect(classifyAttributeValue(48.5)).toEqual({ kind: "scalar", value: 48.5 });
  });

  test("keys read as words, in sentence case", () => {
    expect(humanizeAttributeKey("current_position")).toBe("Current position");
    expect(humanizeAttributeKey("available_tones")).toBe("Available tones");
    expect(humanizeDomain("air_quality")).toBe("Air quality");
    expect(humanizeDomain("siren")).toBe("Siren");
  });
});

test.describe("24h history, RFC-008 R3 — honest only for a number", () => {
  test("a numeric sensor is an area chart; an enum/text sensor gets no section at all", () => {
    expect(classifyEntityHistory("sensor", "21.5", { unit_of_measurement: "°C" })).toBe("area");
    // `state_class` says "this is a measurement" even before the state is read.
    expect(classifyEntityHistory("sensor", "unknown", { state_class: "measurement" })).toBe(
      "area",
    );
    // A washing-machine `device_class: enum` sensor — the state is a word,
    // not a number, and there is no state_class either.
    expect(classifyEntityHistory("sensor", "rinsing", { device_class: "enum" })).toBe("none");
  });

  test("climate and vacuum get no section — today's flat zero line is not honest", () => {
    // This is the regression the task exists to fix: `heat_cool` and
    // `docked` used to parseFloat to NaN, fall back to 0, and draw a line
    // indistinguishable from a real all-day-zero reading.
    expect(classifyEntityHistory("climate", "heat_cool")).toBe("none");
    expect(classifyEntityHistory("vacuum", "docked")).toBe("none");
  });

  test("a binary_sensor is a band, whichever way it reads", () => {
    expect(classifyEntityHistory("binary_sensor", "on")).toBe("band");
    expect(classifyEntityHistory("binary_sensor", "off")).toBe("band");
  });

  test("cover and valve are area only once they report a position", () => {
    expect(classifyEntityHistory("cover", "open", { current_position: 80 })).toBe("area");
    expect(classifyEntityHistory("cover", "open")).toBe("band");
    // 0 is a reported position, not a missing one.
    expect(classifyEntityHistory("valve", "closed", { current_position: 0 })).toBe("area");
    expect(classifyEntityHistory("valve", "closed")).toBe("band");
  });

  test("a domain the matrix has never heard of falls back to §5.4: number or nothing", () => {
    expect(classifyEntityHistory("nonstandard_domain", "42")).toBe("area");
    expect(classifyEntityHistory("nonstandard_domain", "on")).toBe("none");
    expect(classifyEntityHistory("nonstandard_domain", "some text")).toBe("none");
  });
});

test("the sheet omits the history section rather than drawing a flat zero line", () => {
  const source = codeOnly(
    readFileSync(
      join(__dirname, "../src/components/home-assistant/entity-detail-sheet.tsx"),
      "utf8",
    ),
  );

  // The old hard-coded allowlist is gone — RFC-008 R3's per-domain
  // classification replaces it rather than sitting alongside it.
  expect(source).not.toContain("DOMAINS_WITH_OWN_HISTORY");
  expect(source).toContain("classifyEntityHistory(domain, entity.state, entity.attributes)");
  expect(source).toMatch(/showHistory\s*=\s*historyKind\s*!==\s*"none"/);
});

test("the fallback action is homeassistant.turn_on/off, and nothing bit-gated", () => {
  /*
    The per-domain controls moved to `entity-actions.tsx` when RFC-008 §4.1
    landed — the sheet dispatches, the components decide. The fallback moved
    with them, so this reads `FallbackActions` rather than the sheet's own
    `default:`; the claim is unchanged.
  */
  const source = codeOnly(
    readFileSync(
      join(__dirname, "../src/components/home-assistant/entity-actions.tsx"),
      "utf8",
    ),
  );
  const start = source.indexOf("function FallbackActions(");
  expect(start).toBeGreaterThan(-1);
  const fallback = source.slice(start, source.indexOf("\nfunction ", start + 1));

  // The one service pair HA guarantees for anything with on/off semantics.
  expect(fallback).toContain('domain: "homeassistant"');
  expect(fallback).toContain('service: isOn ? "turn_off" : "turn_on"');

  // `supported_features` is an IntFlag whose meaning belongs to the domain, so
  // a bit test here would offer buttons that do something else entirely.
  expect(fallback).not.toContain("supported_features");
});

/* ────────────────────────────────────────────────────────────────────────
   Per-domain controls — RFC-008 §4.1 (phase one of §4.5).

   The failure this whole document exists to prevent is a button that looks
   like it works and silently does nothing: a wrong service name, or a bit
   read from the wrong domain's IntFlag. Both are invisible at review — the
   code compiles, the button renders, the POST returns 200 for an entity
   Home Assistant simply cannot do that to.

   So these check the two things a running stack cannot: that every feature
   bit still matches the number the matrix took from `home-assistant/core`,
   and that the source names the services the matrix names and none of the
   ones it excludes.
   ──────────────────────────────────────────────────────────────────────── */

const actionsSource = codeOnly(
  readFileSync(join(__dirname, "../src/components/home-assistant/entity-actions.tsx"), "utf8"),
);

/** The matrix itself, whitespace around `=` normalised (`EFFECT = 4` → `EFFECT=4`). */
const matrix = readFileSync(
  join(__dirname, "../../docs/rfc/008-entity-detail-coverage.md"),
  "utf8",
).replace(/\s*=\s*/g, "=");

test.describe("supported_features, bit by bit", () => {
  test("every constant is the number RFC-008 §4.1 read off home-assistant/core", () => {
    const tables: [string, Record<string, number>][] = [
      ["light", LIGHT_FEATURE],
      ["fan", FAN_FEATURE],
      ["cover", COVER_FEATURE],
      ["lock", LOCK_FEATURE],
      ["media_player", MEDIA_PLAYER_FEATURE],
      ["climate", CLIMATE_FEATURE],
      ["vacuum", VACUUM_FEATURE],
      ["alarm_control_panel", ALARM_FEATURE],
      ["humidifier", HUMIDIFIER_FEATURE],
    ];

    for (const [domain, table] of tables) {
      for (const [name, bit] of Object.entries(table)) {
        // Every bit is a single bit — a two-bit "flag" is a typo that would
        // pass `& bit` for two unrelated features.
        expect(Number.isInteger(Math.log2(bit)), `${domain}.${name}=${bit}`).toBe(true);
        // …and the matrix still says that number for that name.
        expect(matrix, `${domain}.${name}`).toContain(`${name}=${bit}`);
      }
    }
  });

  test("the same number means different things in different domains", () => {
    // 4 is EFFECT on a light, DIRECTION on a fan, SET_POSITION on a cover,
    // VOLUME_SET on a speaker, TARGET_HUMIDITY on a thermostat and PAUSE on a
    // vacuum. This is why the fallback case never tests a bit.
    expect(LIGHT_FEATURE.EFFECT).toBe(4);
    expect(FAN_FEATURE.DIRECTION).toBe(4);
    expect(COVER_FEATURE.SET_POSITION).toBe(4);
    expect(MEDIA_PLAYER_FEATURE.VOLUME_SET).toBe(4);
    expect(CLIMATE_FEATURE.TARGET_HUMIDITY).toBe(4);
    expect(VACUUM_FEATURE.PAUSE).toBe(4);
  });

  test("a missing supported_features is zero, not permission", () => {
    expect(supportsFeature(undefined, COVER_FEATURE.SET_POSITION)).toBe(false);
    expect(supportsFeature({}, COVER_FEATURE.SET_POSITION)).toBe(false);
    // HA sends it as a number; a string that happens to look like one is not
    // a bitmask and must not be treated as one.
    expect(supportsFeature({ supported_features: "15" }, COVER_FEATURE.SET_POSITION)).toBe(false);
    expect(supportsFeature({ supported_features: 15 }, COVER_FEATURE.SET_POSITION)).toBe(true);
    // 11 = OPEN|CLOSE|STOP — a garage door that cannot be told a percentage.
    expect(supportsFeature({ supported_features: 11 }, COVER_FEATURE.SET_POSITION)).toBe(false);
    expect(supportsFeature({ supported_features: 11 }, COVER_FEATURE.STOP)).toBe(true);
  });

  test("a speaker that cannot skip has no skip bit set", () => {
    // 16389 = PLAY|PAUSE|VOLUME_SET. The two the sheet must not offer:
    const radio = { supported_features: 16389 };
    expect(supportsFeature(radio, MEDIA_PLAYER_FEATURE.NEXT_TRACK)).toBe(false);
    expect(supportsFeature(radio, MEDIA_PLAYER_FEATURE.PREVIOUS_TRACK)).toBe(false);
    expect(supportsFeature(radio, MEDIA_PLAYER_FEATURE.PLAY)).toBe(true);
  });

  test("light brightness is not a bit — RFC-008 R2", () => {
    expect(supportsBrightness({ supported_color_modes: ["onoff"] })).toBe(false);
    expect(supportsBrightness({ supported_color_modes: [] })).toBe(false);
    expect(supportsBrightness({})).toBe(false);
    expect(supportsBrightness({ supported_color_modes: ["brightness"] })).toBe(true);
    expect(supportsBrightness({ supported_color_modes: ["color_temp", "hs"] })).toBe(true);

    expect(supportsColorTemp({ supported_color_modes: ["color_temp", "hs"] })).toBe(true);
    expect(supportsColorTemp({ supported_color_modes: ["hs"] })).toBe(false);
    expect(supportsColorTemp({})).toBe(false);
  });

  test("an option list an integration built badly is no picker, not a crash", () => {
    expect(optionList(["eco", "boost"])).toEqual(["eco", "boost"]);
    expect(optionList(undefined)).toEqual([]);
    expect(optionList("eco")).toEqual([]);
    expect(optionList([{ name: "eco" }, "boost", "", null])).toEqual(["boost"]);
  });
});

test.describe("the services each domain calls", () => {
  test("every service name is the one RFC-008 §4.1 names", () => {
    /*
      Read straight off the matrix's Actions column. A name that is only in
      one of the two places is exactly the bug: `set_cover_tilt_position`
      typed as `set_tilt_position` compiles, renders and returns 200.
    */
    const services = [
      // light
      "turn_on", "turn_off",
      // cover — the tilt trio the hooks do not wrap
      "open_cover_tilt", "close_cover_tilt", "stop_cover_tilt", "set_cover_tilt_position",
      // lock's latch
      "open",
      // media_player
      "select_sound_mode", "shuffle_set", "repeat_set",
      // climate — no hook exists for any of these
      "set_hvac_mode", "set_temperature", "set_humidity", "set_fan_mode",
      "set_preset_mode", "set_swing_mode", "set_swing_horizontal_mode",
      // vacuum
      "locate", "clean_spot",
      // alarm
      "alarm_arm_vacation", "alarm_arm_custom_bypass",
      // humidifier
      "set_mode",
      // fan
      "set_direction",
      // automation
      "trigger",
    ];
    for (const service of services) {
      expect(actionsSource, service).toContain(`"${service}"`);
      expect(matrix, service).toContain(service);
    }
  });

  test("the deliberately excluded services are nowhere in the sheet", () => {
    /*
      RFC-008 §4.1 and §8. `alarm_trigger` is a panic button any passer-by can
      press; the media ones are a file picker's worth of UI that RFC-003 owns;
      the deprecated vacuum pair does nothing on a `StateVacuumEntity`.
    */
    for (const service of [
      "alarm_trigger", "browse_media", "play_media", "media_seek", "search_media",
      "join", "unjoin", "send_command", "learn_command",
    ]) {
      expect(actionsSource, service).not.toContain(`"${service}"`);
    }
  });

  test("each domain's controls are gated on that domain's own flag table", () => {
    // A component reaching for another domain's constants is the mistake the
    // separate tables exist to make visible.
    const pairs: [string, string][] = [
      ["LightActions", "LIGHT_FEATURE"],
      ["FanActions", "FAN_FEATURE"],
      ["CoverActions", "COVER_FEATURE"],
      ["LockActions", "LOCK_FEATURE"],
      ["MediaPlayerActions", "MEDIA_PLAYER_FEATURE"],
      ["ClimateActions", "CLIMATE_FEATURE"],
      ["VacuumActions", "VACUUM_FEATURE"],
      ["AlarmActions", "ALARM_FEATURE"],
      ["HumidifierActions", "HUMIDIFIER_FEATURE"],
    ];
    const all = pairs.map(([, table]) => table);
    for (const [component, table] of pairs) {
      const start = actionsSource.indexOf(`function ${component}(`);
      expect(start, component).toBeGreaterThan(-1);
      const end = actionsSource.indexOf("\nfunction ", start + 1);
      const body = actionsSource.slice(start, end === -1 ? undefined : end);
      expect(body, `${component} gates on ${table}`).toContain(table);
      for (const other of all) {
        if (other === table) continue;
        expect(body, `${component} must not read ${other}`).not.toContain(other);
      }
    }
  });

  test("climate's mode buttons come from hvac_modes, not from a bit", () => {
    const start = actionsSource.indexOf("function ClimateActions(");
    const body = actionsSource.slice(start, actionsSource.indexOf("\nfunction ", start + 1));
    expect(body).toContain("optionList(attrs.hvac_modes)");
    // There is no HVAC_MODE bit in ClimateEntityFeature, and inventing one
    // would hide the mode buttons on every thermostat.
    expect(Object.keys(CLIMATE_FEATURE)).not.toContain("HVAC_MODE");
  });

  test("alarm_disarm has no bit, so it is never gated", () => {
    expect(Object.keys(ALARM_FEATURE)).not.toContain("DISARM");
    expect(matrix).toContain("**`alarm_disarm` has no bit** — always present");
    const start = actionsSource.indexOf("function AlarmActions(");
    const body = actionsSource.slice(start, actionsSource.indexOf("\nfunction ", start + 1));
    // The disarm button is not inside a `supportsFeature` expression. It does
    // go through the §6 confirmation, which is a different kind of gate: a
    // household is asked, not refused.
    expect(body).toMatch(
      /onClick=\{\(\) =>\s*\n\s*run\(\{ domain: "alarm_control_panel", service: "alarm_disarm", entity_id: id \}\)\s*\n\s*\}/,
    );
  });
});

test.describe("the state a household reads — RFC-008 R5", () => {
  test("the domains with their own vocabulary use it, not the shape fallback", () => {
    const sheet = codeOnly(
      readFileSync(
        join(__dirname, "../src/components/home-assistant/entity-detail-sheet.tsx"),
        "utf8",
      ),
    );
    for (const namespace of [
      "homeAutomation.hvacMode",
      "homeAutomation.hvacAction",
      "homeAutomation.lockState",
      "homeAutomation.coverState",
      "homeAutomation.mediaPlayerState",
      "homeAutomation.vacuumStatus",
      "homeAutomation.alarmState",
      "homeAutomation.humidifierAction",
    ]) {
      expect(sheet, namespace).toContain(`useTranslations("${namespace}")`);
    }
    // `heat_cool` renders as a word or not at all — never as the identifier.
    expect(sheet).toContain("HVAC_ACTION_KEYS.includes(action)");
    expect(sheet).toContain("HVAC_MODE_KEYS.includes(entity.state)");
  });

  test("every enum state the matrix names has a word in all three locales", () => {
    const expected: Record<string, string[]> = {
      hvacMode: ["auto", "heat", "cool", "heat_cool", "dry", "fan_only", "off"],
      hvacAction: ["heating", "cooling", "drying", "idle", "off"],
      lockState: ["locked", "unlocked", "locking", "unlocking", "jammed"],
      coverState: ["open", "opening", "closed", "closing"],
      mediaPlayerState: ["playing", "paused", "idle", "off", "standby", "buffering"],
      vacuumStatus: ["cleaning", "docked", "paused", "idle", "returning", "error"],
      alarmState: [
        "disarmed", "armed_home", "armed_away", "armed_night", "armed_vacation",
        "armed_custom_bypass", "pending", "arming", "disarming", "triggered",
      ],
      humidifierAction: ["humidifying", "drying", "idle", "off"],
    };

    for (const locale of ["en", "de", "fr"]) {
      const ha = JSON.parse(
        readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"),
      ).homeAutomation;
      for (const [namespace, keys] of Object.entries(expected)) {
        for (const key of keys) {
          const word = ha[namespace]?.[key];
          expect(typeof word, `${locale}.${namespace}.${key}`).toBe("string");
          expect(word, `${locale}.${namespace}.${key}`).not.toBe("");
          // The word must not be the identifier with the underscore left in.
          expect(word, `${locale}.${namespace}.${key}`).not.toBe(key);
        }
      }
    }
  });

  test("every attribute the curated lists name has a label in all three locales", () => {
    const sheet = readFileSync(
      join(__dirname, "../src/components/home-assistant/entity-detail-sheet.tsx"),
      "utf8",
    );
    const block = sheet.slice(
      sheet.indexOf("const ATTRIBUTE_KEYS"),
      sheet.indexOf("const DEVICE_CLASS_KEYS"),
    );
    const keys = [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(40);

    for (const locale of ["en", "de", "fr"]) {
      const attributes = JSON.parse(
        readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"),
      ).homeAutomation.entityDetail.attributes;
      for (const key of keys) {
        expect(typeof attributes[key], `${locale}.attributes.${key}`).toBe("string");
      }
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Fix round 1 — the two gates that are deliberately not a plain bit test.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("a fan's power button", () => {
  test("neither bit set means the fan predates the flags, not that it cannot be switched", () => {
    /*
      `FanEntityFeature.TURN_ON = 32` / `TURN_OFF = 16` arrived in HA 2024.8.
      An integration written before that sets neither and still answers
      `fan.turn_on` / `fan.turn_off`, so a strict bit test leaves the household
      a fan with a speed slider and no way to stop it.
    */
    expect(fanPowerButtons({})).toEqual({ on: true, off: true });
    expect(fanPowerButtons(undefined)).toEqual({ on: true, off: true });
    // 11 = SET_SPEED | OSCILLATE | PRESET_MODE — a real pre-2024.8 shape.
    expect(fanPowerButtons({ supported_features: 11 })).toEqual({ on: true, off: true });
  });

  test("exactly one bit is a specific claim, and is believed", () => {
    expect(fanPowerButtons({ supported_features: FAN_FEATURE.TURN_OFF })).toEqual({
      on: false,
      off: true,
    });
    expect(fanPowerButtons({ supported_features: FAN_FEATURE.TURN_ON })).toEqual({
      on: true,
      off: false,
    });
    // …including alongside other flags: 16|1 = TURN_OFF | SET_SPEED.
    expect(fanPowerButtons({ supported_features: 17 })).toEqual({ on: false, off: true });
  });

  test("both bits set is the modern case and offers both", () => {
    expect(fanPowerButtons({ supported_features: 63 })).toEqual({ on: true, off: true });
  });

  test("the fan component uses that rule, not a bare bit test", () => {
    // Someone reading `supportsFeature(attrs, FAN_FEATURE.TURN_ON)` here would
    // "fix" the legacy path straight back out again.
    const start = actionsSource.indexOf("function FanActions(");
    const body = actionsSource.slice(start, actionsSource.indexOf("\nfunction ", start + 1));
    expect(body).toContain("fanPowerButtons(attrs)");
    expect(body).not.toContain("FAN_FEATURE.TURN_ON");
    expect(body).not.toContain("FAN_FEATURE.TURN_OFF");
  });
});

test.describe("a binary sensor says what it is reporting", () => {
  test("the pair comes from device_class, with the documented aliases", () => {
    expect(binarySensorStateKey("motion", "on")).toBe("motionOn");
    expect(binarySensorStateKey("motion", "off")).toBe("motionOff");
    expect(binarySensorStateKey("door", "on")).toBe("doorOpen");
    // window and garage_door read as a door; occupancy as presence; water as
    // moisture; power as plug; safety as problem.
    expect(binarySensorStateKey("window", "off")).toBe("doorClosed");
    expect(binarySensorStateKey("garage_door", "on")).toBe("doorOpen");
    expect(binarySensorStateKey("occupancy", "on")).toBe("presenceOn");
    expect(binarySensorStateKey("water", "on")).toBe("moistureOn");
    expect(binarySensorStateKey("power", "off")).toBe("plugOff");
    expect(binarySensorStateKey("safety", "on")).toBe("problemOn");
    // A `battery` sensor reading "On" is telling somebody their battery is low
    // in the least helpful way available.
    expect(binarySensorStateKey("battery", "on")).toBe("batteryOn");
  });

  test("a device class nobody wrote words for still reads as on/off", () => {
    expect(binarySensorStateKey(undefined, "on")).toBe("on");
    expect(binarySensorStateKey("some_custom_class", "off")).toBe("off");
  });

  test("every key it can return exists in all three locales", () => {
    const classes = [
      undefined, "door", "garage_door", "window", "motion", "occupancy", "presence",
      "moisture", "water", "smoke", "gas", "carbon_monoxide", "lock", "heat", "cold",
      "plug", "power", "light", "sound", "vibration", "battery", "safety", "problem",
      "tamper", "an_invented_class",
    ];
    const keys = new Set(
      classes.flatMap((c) => [binarySensorStateKey(c, "on"), binarySensorStateKey(c, "off")]),
    );
    for (const locale of ["en", "de", "fr"]) {
      const table = JSON.parse(
        readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"),
      ).homeAutomation.binarySensorState;
      for (const key of keys) {
        expect(typeof table[key], `${locale}.binarySensorState.${key}`).toBe("string");
      }
    }
  });

  test("the sheet and the room tile share one mapping", () => {
    // Two copies of a 17-branch device-class switch drift, and the drift is
    // invisible: both screens keep rendering *a* word.
    const sheet = codeOnly(
      readFileSync(
        join(__dirname, "../src/components/home-assistant/entity-detail-sheet.tsx"),
        "utf8",
      ),
    );
    const tile = codeOnly(
      readFileSync(join(__dirname, "../src/components/binary-sensor-display-item.tsx"), "utf8"),
    );
    for (const source of [sheet, tile]) {
      expect(source).toContain("binarySensorStateKey(deviceClass, entity.state)");
      // …and neither keeps a private copy of the switch.
      expect(source).not.toContain('"doorOpen"');
    }
    expect(sheet).toContain('useTranslations("homeAutomation.binarySensorState")');
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Fix round 2 — four bugs that only a rendered, driven sheet showed.

   A note on what these can and cannot hold. The first one is a *drag*
   failure: a fully-controlled Radix slider with no `onValueChange` never
   fires `onValueCommit`, because `handleSlideEnd` compares the value against
   the one captured at slide start and both reads come from the same unchanged
   prop. Only the keyboard path works, so `slider.press("ArrowRight")` passes
   against completely inert drag and is worse than no guard at all.

   The honest guard is a real pointer drag against a rendered sheet, and it was
   run — eight sliders, Chromium and WebKit, with the service POST intercepted
   — but it cannot be committed yet: nothing in the app renders this sheet
   until RFC-008's `page.tsx` step, and a scratch route to hold it up is not
   something to leave in the tree. What is committed instead is the structural
   claim the drag depends on. When the sheet gets a caller, the drag belongs in
   the spec beside it.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("controls the household drags and taps", () => {
  test("the slider is not the controlled-with-no-onValueChange trap", () => {
    const start = actionsSource.indexOf("function CommitSlider(");
    expect(start).toBeGreaterThan(-1);
    const body = actionsSource.slice(start, actionsSource.indexOf("\nfunction ", start + 1));

    // `value` without `onValueChange` is inert to pointer and touch: the thumb
    // does not move and no service call is sent. Every other slider in this
    // repo pairs them (cover-card, light-control, fan-card, media-player-card)
    // or goes uncontrolled with a `key` (settings/pocket-money).
    expect(body).toContain("value={[clamped]}");
    expect(body).toContain("onValueChange={(next) => setPending(next[0])}");
    expect(body).toContain("onValueCommit=");
    // …and the local state that makes the drag observable at all.
    expect(body).toContain("usePendingNumber(value)");
  });

  test("every slider in the sheet goes through it", () => {
    // A domain that reached for the Radix primitive directly would bypass the
    // fix and be inert again, silently.
    expect(actionsSource).not.toMatch(/<Slider\b(?![\s\S]{0,400}onValueChange)/);
    const sliders = actionsSource.match(/<CommitSlider/g) ?? [];
    // brightness, colour temp, fan speed, cover position, cover tilt, volume,
    // climate humidity, humidifier humidity.
    expect(sliders.length).toBe(8);
  });

  test("the climate stepper steps from a pending value, not from the entity", () => {
    /*
      `set_temperature` returns before HA reports the new setpoint and `busy`
      clears with the POST, so three quick taps of `+` on a 20.0° thermostat
      each read `attrs.temperature` as 20.0 and all sent 20.5 — the room ends
      up half a degree warmer instead of one and a half.
    */
    const start = actionsSource.indexOf("function ClimateActions(");
    const body = actionsSource.slice(start, actionsSource.indexOf("\nfunction ", start + 1));

    expect(body).toContain("usePendingNumber(num(attrs.temperature))");
    expect(body).toContain("usePendingNumber(num(attrs.target_temp_low))");
    expect(body).toContain("usePendingNumber(num(attrs.target_temp_high))");
    // Each tap records what it asked for before the call goes out…
    for (const setter of ["setTarget(next)", "setLow(next)", "setHigh(next)"]) {
      expect(body, setter).toContain(setter);
    }
    // …and drops it again if Home Assistant refused.
    for (const revert of ["setTarget(null)", "setLow(null)", "setHigh(null)"]) {
      expect(body, revert).toContain(revert);
    }
    // The old shape — computing straight off the attribute inside the call.
    expect(body).not.toContain("clampTemp(target + direction * step) }");
  });

  test("a fan's percentage step is not rounded to an integer", () => {
    const start = actionsSource.indexOf("function FanActions(");
    const body = actionsSource.slice(start, actionsSource.indexOf("\nfunction ", start + 1));

    // 100/3 rounded to 33 caps the slider at 99, so a fan running flat out
    // read "99%". Radix takes the fraction; the commit floors it, which is
    // what `fan.set_percentage`'s own `vol.Coerce(int)` does on arrival —
    // 66.67 must reach HA as 66 (speed 2), not 67 (speed 3).
    expect(body).not.toContain("Math.round(rawStep)");
    expect(body).toContain("rawStep && rawStep > 0 ? rawStep : 1");
    expect(body).toContain("setSpeed(id, Math.floor(next))");
  });
});

test.describe("a scene nobody has activated — RFC-008 R1", () => {
  test("the shape reader still calls unknown a non-reading; the exception is at the caller", () => {
    // The rule itself is unchanged — `scene` is an exception to it, not a
    // counter-example to it.
    expect(classifyEntityState("unknown").kind).toBe("unavailable");
  });

  test("the dispatcher lets a resting-unknown scene keep its Activate button", () => {
    /*
      A scene's state is the timestamp it was last activated and HA does not
      restore it, so after a restart every scene in the house reports
      `unknown`. Gating on that greys out Activate on a working scene until
      somebody triggers it from somewhere else.
    */
    const start = actionsSource.indexOf("export function EntityActions(");
    const body = actionsSource.slice(start);
    expect(body).toContain('const restingUnknown = domain === "scene" && entity.state !== "unavailable"');
    expect(body).toContain('if (!restingUnknown && classifyEntityState(entity.state).kind === "unavailable")');
    // `unavailable` is still unreachable, for scene as for anything else.
    expect(body).toContain("<UnavailableNotice />");
  });

  test("and the sheet does not call it unreachable either", () => {
    const sheet = codeOnly(
      readFileSync(
        join(__dirname, "../src/components/home-assistant/entity-detail-sheet.tsx"),
        "utf8",
      ),
    );
    expect(sheet).toContain('domain === "scene"');
    expect(sheet).toContain('entity.state !== "unavailable"');
    expect(sheet).toContain('t("neverActivated")');
    // A screen that says "Not reachable" beside a working Activate button is
    // contradicting itself, which is what shipped before this.
    expect(sheet).toMatch(/sceneNeverActivated\s*\n?\s*\?\s*t\("neverActivated"\)/);
  });

  test("its wording exists in all three locales", () => {
    for (const locale of ["en", "de", "fr"]) {
      const detail = JSON.parse(
        readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"),
      ).homeAutomation.entityDetail;
      expect(typeof detail.neverActivated, `${locale}.neverActivated`).toBe("string");
      expect(detail.neverActivated, locale).not.toBe("");
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Fix round 3 — a refused call must not leave the panel confidently wrong.

   Same caveat as the drag guard above: the honest check is a rendered sheet
   whose states poll keeps returning the old reading while the set call fails,
   and it was run — both engines, poll and service call both intercepted and
   counted — but it needs the scratch route to stand up and so cannot be
   committed until the sheet has a caller. These hold the structure it depends
   on. No weaker behavioural test is committed in its place.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("a call Home Assistant refused", () => {
  test("the runner reports the failure rather than swallowing it", () => {
    // The runner moved into DangerousActionGate when the confirmations landed,
    // so that one place decides both "ask first?" and "did it take?". Its
    // contract did not move: a refusal is a toast and a `false`, never a
    // silent no-op.
    const start = actionsSource.indexOf("function DangerousActionGate(");
    const body = actionsSource.slice(start, actionsSource.indexOf("\nfunction ", start + 1));
    expect(body).toContain("Promise<boolean>");
    expect(body).toContain("return true");
    expect(body).toContain('toast.error(t("controlFailed"))');
    expect(body).toContain("return false");
  });

  test("the slider goes back to the reading", () => {
    /*
      Not "wait for the source to move": the light stayed at 20%, so the poll
      returns 20% again and the source never moves. The thumb would sit at the
      80% nobody achieved for as long as the panel is on, with the toast that
      explained it long gone — a wall panel stating something confidently
      about a device that never moved, which is the same defect as the lock
      this branch already fixed and worse, because nothing ever corrects it.
    */
    const start = actionsSource.indexOf("function CommitSlider(");
    const body = actionsSource.slice(start, actionsSource.indexOf("\nfunction ", start + 1));
    expect(body).toContain("onCommit: (value: number) => Promise<boolean>");
    expect(body).toMatch(/onCommit\(next\[0\]\)\.then\(\(ok\) => \{\s*\n\s*if \(!ok\) setPending\(null\);/);
  });

  test("and so do the two surfaces together", () => {
    // `page.tsx`'s tiles drop their optimistic state on failure. The sliders
    // match it deliberately: a household should not learn one rule for tiles
    // and another for sliders, so if that shape changes this should be
    // revisited rather than silently diverge.
    const page = codeOnly(
      readFileSync(join(__dirname, "../src/app/home-automation/page.tsx"), "utf8"),
    );
    expect(page).toMatch(/catch \{\s*\n\s*forget\(entityId\);\s*\n\s*toast\.error/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Fix round 4 — the third exit: a 200 that does nothing.

   A pending value ends three ways: the source moves, the call fails, or the
   settle elapses. The third is the one that is easy to forget, because it is
   the only one where *nothing happens at all* — Home Assistant accepted the
   call, returned 200, and a Zigbee bulb out of radio range never lit. The
   reading therefore never moves, and a control that waits for it reads 80%
   for a lamp that is still dim, for as long as the panel is on.

   Read the honesty note above the round-3 block: the behavioural check needs
   a rendered sheet and cannot ship yet. What follows splits into two kinds,
   and the difference matters —

   - the constant checks are **real**: one definition, derived from `POLL_MS`,
     imported by both surfaces. A second copy of the number, or a settle
     shorter than a poll, goes red here whatever the code around it looks like.
   - the source checks are **text**, and a refactor that keeps the text and
     breaks the behaviour would pass them. They are worth having as a tripwire
     and they are not worth mistaking for the browser test.
   ──────────────────────────────────────────────────────────────────────── */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test.describe("the optimistic settle — one rule, two surfaces", () => {
  test("the settle outlasts a poll, and is derived from it", () => {
    // A settle shorter than the poll would snap a control back before the
    // truth could possibly arrive, turning every merely-slow device into a
    // flicker.
    expect(OPTIMISTIC_SETTLE_MS).toBeGreaterThan(POLL_MS);
    expect(OPTIMISTIC_SETTLE_MS).toBe(POLL_MS + 5_000);
    // It also has to fit inside a household's patience.
    expect(OPTIMISTIC_SETTLE_MS).toBeLessThanOrEqual(30_000);
  });

  test("there is exactly one definition of each, and it is the shared one", () => {
    /*
      This is the guard with teeth. The tiles and the sheet must not be able to
      drift apart by someone copying the number into a second file — which is
      how the two surfaces came to disagree about the third exit in the first
      place.
    */
    const definitions = sourceFiles(join(__dirname, "../src"))
      .map((path) => [path, readFileSync(path, "utf8")] as const)
      .filter(([, source]) => /^\s*(export\s+)?const\s+OPTIMISTIC_SETTLE_MS\s*=/m.test(source))
      .map(([path]) => path.replace(/.*\/src\//, "src/"));

    expect(definitions).toEqual(["src/lib/home-assistant-optimism.ts"]);
  });

  test("both surfaces import it rather than defining their own", () => {
    for (const path of [
      "../src/app/home-automation/page.tsx",
      "../src/components/home-assistant/entity-actions.tsx",
    ]) {
      const source = readFileSync(join(__dirname, path), "utf8");
      expect(source, path).toContain('from "@/lib/home-assistant-optimism"');
      expect(source, path).not.toMatch(/const\s+OPTIMISTIC_SETTLE_MS\s*=/);
    }
  });

  test("the pending value arms it, re-arms it, and does not outlive the sheet", () => {
    // Text, not behaviour — see the note above.
    const start = actionsSource.indexOf("function usePendingNumber<");
    const body = actionsSource.slice(start, actionsSource.indexOf("\nfunction ", start + 1));

    expect(body).toContain("OPTIMISTIC_SETTLE_MS");
    expect(body).toMatch(/setTimeout\(\(\) => \{[\s\S]*?setPendingState\(null\);[\s\S]*?\}, OPTIMISTIC_SETTLE_MS\)/);
    // Re-arming: a household still moving the thumb must not be cut off by a
    // timer armed for an earlier position.
    expect(body).toMatch(/if \(settle\.current\) clearTimeout\(settle\.current\);\s*\n\s*settle\.current = null;\s*\n\s*setPendingState\(value\);/);
    // Nothing keeps firing after the sheet closes.
    expect(body).toMatch(/useEffect\(\s*\n?\s*\(\) => \(\) => \{\s*\n\s*if \(settle\.current\) clearTimeout\(settle\.current\);/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   RFC-008 §6 — the actions that ask first.

   Same caveat as the two rounds above, and for the same reason. The honest
   check is a rendered sheet with `POST /api/homeassistant/services`
   intercepted and counted: unlock asks and sends nothing when dismissed, one
   call when confirmed; the latch asks a different question; disarm names the
   panel; `lock.lock` does not ask at all; an unavailable entity offers
   nothing to ask about. All five were run against a scratch route in Chromium
   and WebKit — but the scratch route cannot ship, so they land with the
   caller. No weaker behavioural test is committed in its place.

   What is committed is the structure those five depend on, and it is worth
   more than it looks: the mechanism's whole claim is that a dangerous action
   *cannot* skip the confirmation by forgetting to write one, and that claim
   is a property of the source — one table, one runner, and no way to call a
   service that goes round either.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("dangerous actions ask first — RFC-008 §6", () => {
  test("the table is exactly the seven rows the matrix flags", () => {
    // Read off §6's own recommendation column. A row missing here is a door
    // that opens on one tap; a row invented here is friction §6 refused.
    for (const key of [
      "lock.unlock",
      "lock.open",
      "alarm_control_panel.alarm_disarm",
      "siren.turn_on",
      "button.press",
      "input_button.press",
      "update.install",
      "lawn_mower.start_mowing",
    ]) {
      expect(Object.keys(DANGEROUS_ACTIONS), key).toContain(key);
    }
    // `input_button.press` shares `button.press`'s copy, so §6's seven
    // recommendations are eight keys and no more.
    expect(Object.keys(DANGEROUS_ACTIONS)).toHaveLength(8);

    /*
      And the rows §6 argues *against*, which are as much of the decision.

      `vacuum.start` and `cover.open_cover` on a garage move real machinery,
      but visibly, slowly and reversibly from the same screen. `lock.lock`
      is the one a household meets every day: confirming your way to a locked
      door is friction with no safety benefit. `alarm_trigger` is not here
      because it is not offered anywhere at all.
    */
    for (const key of [
      "lock.lock",
      "vacuum.start",
      "cover.open_cover",
      "alarm_control_panel.alarm_arm_away",
      "alarm_control_panel.alarm_trigger",
    ]) {
      expect(Object.keys(DANGEROUS_ACTIONS), key).not.toContain(key);
    }
  });

  test("every action states its service, so none can route round the table", () => {
    /*
      This is the mechanism. `run()` takes the service call as its first
      argument — the descriptor `useCallService` would take anyway — and looks
      it up in `DANGEROUS_ACTIONS` before firing anything. An author does not
      opt in to a confirmation; they say which service they are calling,
      because that is the only way to call one, and the table decides.

      So the two things worth guarding are that the old bare-thunk form is
      gone, and that no control has its own `callService` to slip past `run`
      with. The eighth dangerous action is then unforgettable by construction:
      writing it means writing its descriptor, and its row is already there.
    */
    expect(actionsSource, "no control calls a service without declaring it")
      .not.toMatch(/\brun\(\(\) =>/);

    // One `useCallService` in the file, inside the gate. A component holding
    // its own would be a way round.
    expect(actionsSource.match(/useCallService\(\)/g) ?? []).toHaveLength(1);
    const gateStart = actionsSource.indexOf("function DangerousActionGate(");
    const gate = actionsSource.slice(gateStart, actionsSource.indexOf("\nfunction ", gateStart + 1));
    expect(gate).toContain("useCallService()");
    expect(gate).toContain("dangerousAction(call)");
  });

  test("dismissing sends nothing, and says so to a control holding a guess", () => {
    const gateStart = actionsSource.indexOf("function DangerousActionGate(");
    const gate = actionsSource.slice(gateStart, actionsSource.indexOf("\nfunction ", gateStart + 1));
    /*
      A question raised is a promise not yet settled: `fire` is unreachable
      until `onConfirm` takes the record. Dismissal — Cancel, Escape, the
      overlay, or the sheet closing underneath it — settles `false`, the same
      answer a refused call gives, so an optimistic control drops its guess
      instead of sitting on a value nobody agreed to.
    */
    expect(gate).toMatch(/if \(!action\) return fire\(call, via\);\s*\n\s*return new Promise<boolean>/);
    expect(gate).toMatch(/onOpenChange=\{\(open\) => \{[\s\S]*?take\(\)\?\.settle\(false\);/);
    expect(gate).toContain("useEffect(() => () => asked.current?.settle(false), [])");
    // Confirming is the only path to `fire`, and it takes the record first so
    // the close that follows cannot settle the same promise twice.
    expect(gate).toMatch(/const record = take\(\);\s*\n\s*if \(record\) void fire\(record\.call, record\.via\)\.then\(record\.settle\)/);
  });

  test("it is the repo's destructive dialog, not a new one", () => {
    // The recycle bin's permanent delete and the family delete already settle
    // what a confirmation looks like here: Radix's alertdialog, Cancel taking
    // focus on open, and the confirm button destructive-coloured on the far
    // side of the footer. A wall panel is exactly the place not to invent a
    // second pattern with the confirm button under the thumb.
    expect(actionsSource).toContain('import { ConfirmDestructive } from "@/components/confirm-destructive"');
    const confirmSource = codeOnly(
      readFileSync(join(__dirname, "../src/components/confirm-destructive.tsx"), "utf8"),
    );
    expect(confirmSource).toContain("<AlertDialogCancel>{t(\"cancel\")}</AlertDialogCancel>");
    expect(confirmSource).toContain("bg-destructive");
  });

  test("the three implemented rows declare the key the table is filed under", () => {
    /*
      The descriptor is what the lookup sees, so a typo in it is a
      confirmation that silently never appears — the one failure mode this
      shape has. These are the three §4.5 puts in this branch.
    */
    for (const [component, declaration] of [
      ["LockActions", 'run({ domain: "lock", service: "unlock", entity_id: id })'],
      ["LockActions", 'run({ domain: "lock", service: "open", entity_id: id })'],
      [
        "AlarmActions",
        'run({ domain: "alarm_control_panel", service: "alarm_disarm", entity_id: id })',
      ],
    ] as const) {
      const start = actionsSource.indexOf(`function ${component}(`);
      const body = actionsSource.slice(start, actionsSource.indexOf("\nfunction ", start + 1));
      expect(body, `${component} declares ${declaration}`).toContain(declaration);
    }
    // And locking declares its own service, which is deliberately not in the
    // table — the button beside unlock, with nothing to distinguish it but
    // the service name.
    const lockStart = actionsSource.indexOf("function LockActions(");
    const lockBody = actionsSource.slice(lockStart, actionsSource.indexOf("\nfunction ", lockStart + 1));
    expect(lockBody).toContain('{ domain: "lock", service: "lock", entity_id: id }');
  });

  test("the prompt can name the entity, because the sheet hands the name down", () => {
    // "Unlock Front door?", not "Are you sure?" — a household has several
    // locks and this sheet is a modal over a room full of tiles.
    const sheet = codeOnly(
      readFileSync(
        join(__dirname, "../src/components/home-assistant/entity-detail-sheet.tsx"),
        "utf8",
      ),
    );
    expect(sheet).toContain("<EntityActions entity={entity} displayName={label} />");
    const gateStart = actionsSource.indexOf("function DangerousActionGate(");
    const gate = actionsSource.slice(gateStart, actionsSource.indexOf("\nfunction ", gateStart + 1));
    expect(gate).toContain("const name = displayName || entity.name || entity.entity_id;");
    expect(gate).toContain("{ name }");
  });

  test("every row's wording exists in all three locales, and names the entity", () => {
    const rows = Object.values(DANGEROUS_ACTIONS);
    for (const locale of ["en", "de", "fr"]) {
      const ha = JSON.parse(
        readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"),
      ).homeAutomation;
      for (const { copy, confirmLabelKey } of rows) {
        const block = ha.entityDetail.confirm?.[copy];
        expect(block, `${locale}.confirm.${copy}`).toBeTruthy();
        for (const part of ["title", "body"] as const) {
          expect(typeof block[part], `${locale}.confirm.${copy}.${part}`).toBe("string");
          expect(block[part], `${locale}.confirm.${copy}.${part}`).not.toBe("");
        }
        // The whole point of the prompt: it quotes the entity.
        expect(block.title, `${locale}.confirm.${copy}.title`).toContain("{name}");

        // The confirm button reuses the label its own control already carries
        // where one exists, rather than growing a synonym beside it.
        const label = confirmLabelKey
          .split(".")
          .reduce<Record<string, unknown> | undefined>(
            (node, part) => node?.[part] as Record<string, unknown> | undefined,
            ha,
          );
        expect(typeof label, `${locale}.${confirmLabelKey}`).toBe("string");
        expect(label, `${locale}.${confirmLabelKey}`).not.toBe("");
      }
    }
  });

  test("the latch is not asked the way unlocking is", () => {
    // RFC-008 §6's reason: on many locks a thrown latch cannot be retracted
    // remotely, so locking again does not undo it. A prompt that repeated the
    // unlock wording would be telling a household the opposite.
    for (const locale of ["en", "de", "fr"]) {
      const confirm = JSON.parse(
        readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"),
      ).homeAutomation.entityDetail.confirm;
      expect(confirm.openLatch.title, locale).not.toBe(confirm.unlock.title);
      expect(confirm.openLatch.body, locale).not.toBe(confirm.unlock.body);
    }
    expect(matrix).toContain("locking again does not retract a thrown latch");
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Fix round 1 — two holes in the §6 gate, both found by review.

   The first was live and reachable: RFC-008 §4.5 leaves `siren` to the long
   tail, so a siren in the house takes §5.3's fallback, whose descriptor names
   `homeassistant.turn_on` rather than `siren.turn_on`. The row was registered;
   the lookup could not see it. One tap sounded the siren.

   The second was latent: a §6 row that announced one service from its
   descriptor and sent another through a convenience hook. Nothing pinned the
   hook, so `useLockControl.unlock` retargeted at `lock.open` would have shown
   "Unlock Front door?" over the unlock wording and thrown the latch. The fix
   is to remove the second statement rather than guard it — those rows send the
   descriptor the dialog quoted.
   ──────────────────────────────────────────────────────────────────────── */

test.describe("the lookup, and the one call it makes", () => {
  test("the generic pair resolves to the entity's own domain", () => {
    /*
      `homeassistant.turn_on` is what Home Assistant guarantees across any
      entity with on/off semantics, and what §5.3's fallback offers a domain
      nobody wrote a case for. HA forwards it to the entity's domain, so on a
      `siren` it *is* `siren.turn_on` — row four of the table, registered
      precisely so this could not happen.
    */
    expect(
      dangerousAction({
        domain: "homeassistant",
        service: "turn_on",
        entity_id: "siren.garden",
      }),
      "a siren reached through the generic pair still asks",
    ).toBe(DANGEROUS_ACTIONS["siren.turn_on"]);

    // The other pre-registered domains the fallback can reach the same way.
    expect(
      dangerousAction({ domain: "homeassistant", service: "install", entity_id: "update.core" }),
    ).toBe(DANGEROUS_ACTIONS["update.install"]);

    // And it does not invent danger where there is none: a light switched on
    // through the same pair is still a light.
    expect(
      dangerousAction({ domain: "homeassistant", service: "turn_on", entity_id: "light.hall" }),
    ).toBeUndefined();
    expect(
      dangerousAction({ domain: "homeassistant", service: "turn_off", entity_id: "siren.garden" }),
    ).toBeUndefined();
  });

  test("a literal descriptor still wins, and a missing entity id is not a crash", () => {
    expect(dangerousAction({ domain: "lock", service: "unlock", entity_id: "lock.front" })).toBe(
      DANGEROUS_ACTIONS["lock.unlock"],
    );
    expect(dangerousAction({ domain: "lock", service: "lock", entity_id: "lock.front" })).toBeUndefined();
    // `entity_id` is optional on HAServiceCall; a call without one falls back
    // to the literal lookup rather than throwing on `split`.
    expect(dangerousAction({ domain: "lock", service: "unlock" })).toBe(
      DANGEROUS_ACTIONS["lock.unlock"],
    );
    expect(dangerousAction({ domain: "homeassistant", service: "turn_on" })).toBeUndefined();
  });

  test("a §6 row sends the descriptor it was confirmed as, with no hook behind it", () => {
    /*
      Two statements of one service is a drift a source test can only pin on
      one side: the descriptor is checkable, the hook it delegates to is not.
      Drift one way and the panel confirms "Unlock" and throws the latch;
      drift the other and it fires unconfirmed. So the rows §6 names do not
      delegate at all — `run` makes the call from the object the dialog
      quoted, and there is nothing left to disagree with.

      The harmless rows keep their hooks. This walks every `run({…})` in the
      file, brace-balanced so a `service_data` object does not end the scan
      early, and asserts that the dangerous ones take no second argument.
    */
    const seen: string[] = [];
    for (let i = actionsSource.indexOf("run({"); i !== -1; i = actionsSource.indexOf("run({", i + 1)) {
      let depth = 0;
      let end = i + 3;
      for (; end < actionsSource.length; end++) {
        if (actionsSource[end] === "{") depth += 1;
        else if (actionsSource[end] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const descriptor = actionsSource.slice(i + 4, end + 1);
      const domain = descriptor.match(/domain:\s*"([a-z_]+)"/)?.[1];
      const service = descriptor.match(/service:\s*"([a-z_]+)"/)?.[1];
      if (!domain || !service) continue;
      const key = `${domain}.${service}`;
      if (!(key in DANGEROUS_ACTIONS)) continue;
      seen.push(key);
      const after = actionsSource.slice(end + 1).trimStart();
      expect(after[0], `${key} must send its own descriptor, not delegate`).toBe(")");
    }
    // The scan found something — an assertion that silently matched nothing
    // would pass against a file with no confirmations left in it at all.
    expect(seen.sort()).toEqual(["alarm_control_panel.alarm_disarm", "lock.open", "lock.unlock"]);
  });

  test("the fallback is the branch a siren actually takes today", () => {
    // Not hypothetical: §4.5 leaves `siren` to the long tail, so the
    // dispatcher has no case for it and every siren in the house lands on
    // FallbackActions with the generic pair.
    const start = actionsSource.indexOf("export function EntityActions(");
    const dispatcher = actionsSource.slice(start);
    expect(dispatcher).not.toContain('case "siren"');
    expect(dispatcher).toContain("<FallbackActions entity={entity} />");
    const fbStart = actionsSource.indexOf("function FallbackActions(");
    const fb = actionsSource.slice(fbStart, actionsSource.indexOf("\nfunction ", fbStart + 1));
    expect(fb).toContain('domain: "homeassistant"');
    expect(fb).toContain('service: isOn ? "turn_off" : "turn_on"');
  });
});
