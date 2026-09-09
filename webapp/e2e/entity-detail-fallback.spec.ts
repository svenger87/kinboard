import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
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
    // The disarm button is not inside a gate expression.
    expect(body).toMatch(/onClick=\{\(\) => run\(\(\) => disarm\(id\)\)\}/);
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
