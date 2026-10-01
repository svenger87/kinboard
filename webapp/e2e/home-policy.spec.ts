import { test, expect } from "@playwright/test";
import {
  ALLOWED_SERVICES,
  ENTITY_ID,
  FORBIDDEN_DATA_KEYS,
  allowedActionsFor,
  decideHomeAction,
} from "../src/lib/home/policy";
import { DANGEROUS_ACTIONS } from "../src/lib/ha-dangerous-actions";

/**
 * What an assistant may do in the home — RFC-011 §4.
 *
 * This module is the boundary between a language model and a household's
 * front door, so the tests restate the RFC's table by hand rather than reading
 * it back from the module: a row added to the policy without a row added here
 * turns the first test red, which is the point.
 *
 * Pure functions, no stack: runs in CI's stack-free specs job.
 */

type Sensitivity = "never" | "always" | "garage_or_gate";

/** RFC-011 §4, verbatim. Domain → service → sensitivity. */
const RFC_TABLE: Record<string, Record<string, Sensitivity>> = {
  light: { turn_on: "never", turn_off: "never", toggle: "never" },
  switch: { turn_on: "never", turn_off: "never", toggle: "never" },
  input_boolean: { turn_on: "never", turn_off: "never", toggle: "never" },
  fan: { turn_on: "never", turn_off: "never", toggle: "never", set_percentage: "never" },
  climate: {
    set_temperature: "never",
    set_hvac_mode: "never",
    turn_on: "never",
    turn_off: "never",
  },
  media_player: {
    media_play: "never",
    media_pause: "never",
    media_stop: "never",
    media_next_track: "never",
    media_previous_track: "never",
    volume_set: "never",
    volume_mute: "never",
    turn_on: "never",
    turn_off: "never",
    select_source: "never",
  },
  cover: {
    open_cover: "garage_or_gate",
    close_cover: "garage_or_gate",
    stop_cover: "garage_or_gate",
    set_cover_position: "garage_or_gate",
  },
  scene: { turn_on: "never" },
  vacuum: { start: "never", pause: "never", return_to_base: "never" },
  humidifier: { turn_on: "never", turn_off: "never", set_humidity: "never" },
  lock: { lock: "always", unlock: "always", open: "always" },
  alarm_control_panel: {
    alarm_arm_home: "always",
    alarm_arm_away: "always",
    alarm_arm_night: "always",
    alarm_disarm: "always",
  },
  script: { turn_on: "always" },
  button: { press: "always" },
  input_button: { press: "always" },
  siren: { turn_on: "always", turn_off: "always" },
  lawn_mower: { start_mowing: "always", dock: "always", pause: "always" },
};

/** The smallest data each service accepts — its required keys, and nothing else. */
const MINIMAL_DATA: Record<string, Record<string, unknown>> = {
  "fan.set_percentage": { percentage: 40 },
  "climate.set_temperature": { temperature: 21.5 },
  "climate.set_hvac_mode": { hvac_mode: "heat" },
  "media_player.volume_set": { volume_level: 0.3 },
  "media_player.volume_mute": { is_volume_muted: true },
  "media_player.select_source": { source: "Radio" },
  "cover.set_cover_position": { position: 50 },
  "humidifier.set_humidity": { humidity: 45 },
};

function call(entityId: string, service: string, data: unknown = {}, deviceClass: string | null = null) {
  return decideHomeAction({ entityId, service, data, deviceClass });
}

test.describe("the allowlist is RFC-011 §4, exactly", () => {
  test("same domains, same services — nothing more", () => {
    const actual = Object.fromEntries(
      Object.entries(ALLOWED_SERVICES).map(([d, s]) => [d, Object.keys(s).sort()]),
    );
    const expected = Object.fromEntries(
      Object.entries(RFC_TABLE).map(([d, s]) => [d, Object.keys(s).sort()]),
    );
    expect(actual).toEqual(expected);
  });

  for (const [domain, services] of Object.entries(RFC_TABLE)) {
    for (const [service, sensitivity] of Object.entries(services)) {
      test(`${domain}.${service} runs, sensitive=${sensitivity}`, () => {
        const data = MINIMAL_DATA[`${domain}.${service}`] ?? {};
        const plain = call(`${domain}.thing_1`, service, data, null);
        expect(plain).toEqual({ ok: true, sensitive: sensitivity === "always", data });

        // A device class never makes an always-sensitive action safe, and only
        // garage/gate makes a cover sensitive.
        for (const dc of ["garage", "gate", "door", "shutter", "awning", "blind", null]) {
          const r = call(`${domain}.thing_1`, service, data, dc);
          const want =
            sensitivity === "always" ||
            (sensitivity === "garage_or_gate" && (dc === "garage" || dc === "gate"));
          expect(r, `${domain}.${service} with device_class=${dc}`).toEqual({
            ok: true,
            sensitive: want,
            data,
          });
        }
      });
    }
  }

  test("services with required data refuse to run without it", () => {
    for (const key of Object.keys(MINIMAL_DATA)) {
      const [domain, service] = key.split(".");
      expect(call(`${domain}.x`, service, {}), key).toEqual({ ok: false, reason: "invalid_data" });
    }
  });
});

test.describe("refused domains and services", () => {
  const refusedDomains = [
    "homeassistant",
    "automation",
    "update",
    "shell_command",
    "input_text",
    "notify",
    "python_script",
    "rest_command",
    "hassio",
    "persistent_notification",
    "input_select",
    "input_number",
    "camera",
    "person",
    "zone",
    "recorder",
    "system_log",
    "logger",
    "counter",
    "timer",
    "valve",
    "water_heater",
    "remote",
    "device_tracker",
  ];
  for (const domain of refusedDomains) {
    test(`${domain}.* is never callable`, () => {
      for (const service of ["turn_on", "turn_off", "toggle", "trigger", "install", "reload", "press", "set_value", "restart", "stop"]) {
        expect(call(`${domain}.anything`, service), `${domain}.${service}`).toEqual({
          ok: false,
          reason: "not_allowed",
        });
      }
      expect(allowedActionsFor(`${domain}.anything`, null)).toEqual([]);
    });
  }

  test("a service not in the domain's row is refused", () => {
    for (const [entity, service] of [
      ["light.kitchen", "set_brightness"],
      ["siren.garden", "toggle"], // toggle on a silent siren *is* turn_on
      ["lock.front", "lock_all"],
      ["cover.garage", "toggle"],
      ["cover.garage", "open_cover_tilt"],
      ["climate.living", "set_preset_mode"],
      ["media_player.tv", "play_media"],
      ["vacuum.robo", "send_command"],
      ["script.any", "toggle"],
      ["script.any", "reload"],
      ["scene.evening", "apply"],
      ["scene.evening", "create"],
      ["alarm_control_panel.home", "alarm_trigger"],
      ["alarm_control_panel.home", "alarm_arm_vacation"],
      ["lawn_mower.lawn", "start"],
      ["button.anything", "turn_on"],
    ]) {
      expect(call(entity, service), `${entity} ${service}`).toEqual({ ok: false, reason: "not_allowed" });
    }
  });

  test("the domain comes from the entity, and the service is a bare name", () => {
    // A caller cannot smuggle a domain in through the service.
    for (const service of [
      "homeassistant.turn_on",
      "light.turn_on",
      "automation.trigger",
      "turn_on ",
      " turn_on",
      "TURN_ON",
      "turn-on",
      "",
      "turn_on\n",
      "turn_on/../restart",
    ]) {
      expect(call("light.kitchen", service), JSON.stringify(service)).toEqual({
        ok: false,
        reason: "not_allowed",
      });
    }
  });

  test("Object.prototype names are not services", () => {
    for (const service of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(call("light.kitchen", service), service).toEqual({ ok: false, reason: "not_allowed" });
    }
    for (const domain of ["constructor", "__proto__", "toString"]) {
      expect(call(`${domain}.x`, "turn_on"), domain).toEqual({ ok: false, reason: "not_allowed" });
    }
  });
});

test.describe("entity ids", () => {
  const bad = [
    "",
    "light",
    "light.",
    ".kitchen",
    "Light.kitchen",
    "light.Kitchen",
    "LIGHT.KITCHEN",
    "light.kitchen.extra",
    "light..kitchen",
    "light.x/../../",
    "light.x/../../api/services/homeassistant/restart",
    "light.kit chen",
    "light.kitchen\n",
    "\nlight.kitchen",
    "light.kitchen?x=1",
    "light.kitchen#",
    "light.küche",
    "light.kitchen%2F",
    "light-strip.kitchen",
    "1light.kitchen",
    "light.kitchen,lock.front",
    "light." + "a".repeat(300),
  ];
  for (const id of bad) {
    test(`refuses ${JSON.stringify(id).slice(0, 60)}`, () => {
      expect(ENTITY_ID.test(id) && id.length <= 255).toBe(false);
      expect(call(id, "turn_on")).toEqual({ ok: false, reason: "not_allowed" });
      expect(allowedActionsFor(id, null)).toEqual([]);
    });
  }

  test("accepts ordinary ids", () => {
    for (const id of ["light.kitchen", "light.kitchen_2", "input_boolean.guest_mode", "light.0x00158d"]) {
      expect(ENTITY_ID.test(id), id).toBe(true);
      expect(call(id, "turn_on").ok, id).toBe(true);
    }
  });

  test("non-string inputs fail closed", () => {
    expect(
      decideHomeAction({ entityId: 42 as unknown as string, service: "turn_on", data: {}, deviceClass: null }),
    ).toEqual({ ok: false, reason: "not_allowed" });
    expect(
      decideHomeAction({ entityId: "light.x", service: null as unknown as string, data: {}, deviceClass: null }),
    ).toEqual({ ok: false, reason: "not_allowed" });
  });
});

test.describe("garage doors and gates", () => {
  test("a garage or gate cover asks; a blind does not", () => {
    for (const service of ["open_cover", "close_cover", "stop_cover"]) {
      expect(call("cover.garage", service, {}, "garage")).toEqual({ ok: true, sensitive: true, data: {} });
      expect(call("cover.drive", service, {}, "gate")).toEqual({ ok: true, sensitive: true, data: {} });
      expect(call("cover.living_room", service, {}, "blind")).toEqual({ ok: true, sensitive: false, data: {} });
      expect(call("cover.living_room", service, {}, null)).toEqual({ ok: true, sensitive: false, data: {} });
    }
    expect(call("cover.garage", "set_cover_position", { position: 10 }, "garage")).toEqual({
      ok: true,
      sensitive: true,
      data: { position: 10 },
    });
  });

  test("the device class is matched case- and whitespace-insensitively (fail closed)", () => {
    for (const dc of ["Garage", "GATE", " garage ", "gate\n"]) {
      expect(call("cover.x", "open_cover", {}, dc), dc).toEqual({ ok: true, sensitive: true, data: {} });
    }
  });

  test("the name of the entity is not the device class", () => {
    // `cover.garage` with no device class is an ordinary cover: the caller
    // must read device_class live, and the policy never guesses from the id.
    expect(call("cover.garage", "open_cover", {}, null)).toEqual({ ok: true, sensitive: false, data: {} });
  });

  test("allowedActionsFor reflects the device class", () => {
    expect(allowedActionsFor("cover.garage", "garage")).toEqual([
      { service: "close_cover", sensitive: true },
      { service: "open_cover", sensitive: true },
      { service: "set_cover_position", sensitive: true },
      { service: "stop_cover", sensitive: true },
    ]);
    expect(allowedActionsFor("cover.blind", "blind").every((a) => !a.sensitive)).toBe(true);
  });
});

test.describe("service data", () => {
  test("missing, null or empty data is no data", () => {
    for (const data of [undefined, null, {}]) {
      expect(call("light.x", "turn_on", data)).toEqual({ ok: true, sensitive: false, data: {} });
    }
  });

  test("data that is not a plain object is refused", () => {
    for (const data of [[], [1, 2], "brightness_pct=50", 5, true, new Date(), Object.create({ brightness_pct: 50 })]) {
      expect(call("light.x", "turn_on", data), String(data)).toEqual({ ok: false, reason: "invalid_data" });
    }
  });

  test("targeting keys are never passed through, whatever the service", () => {
    for (const key of ["entity_id", "area_id", "device_id", "floor_id", "label_id"]) {
      for (const [entity, service] of [
        ["light.x", "turn_on"],
        ["light.x", "turn_off"],
        ["lock.front", "unlock"],
        ["cover.g", "set_cover_position"],
        ["script.any", "turn_on"],
      ]) {
        const data = { [key]: "lock.front", ...(service === "set_cover_position" ? { position: 1 } : {}) };
        expect(call(entity, service, data), `${entity} ${service} ${key}`).toEqual({
          ok: false,
          reason: "invalid_data",
        });
      }
    }
  });

  test("an alarm code is never accepted — assistants do not hold alarm codes", () => {
    for (const service of Object.keys(RFC_TABLE.alarm_control_panel)) {
      for (const code of ["1234", 1234, "", null]) {
        expect(call("alarm_control_panel.home", service, { code }), `${service} ${code}`).toEqual({
          ok: false,
          reason: "invalid_data",
        });
      }
    }
    // Nor on a lock, where HA also takes a `code`.
    for (const service of Object.keys(RFC_TABLE.lock)) {
      expect(call("lock.front", service, { code: "1234" })).toEqual({ ok: false, reason: "invalid_data" });
    }
  });

  test("no service declares a forbidden key", () => {
    expect([...FORBIDDEN_DATA_KEYS].sort()).toEqual(
      ["area_id", "code", "device_id", "entity_id", "floor_id", "label_id"].sort(),
    );
    for (const [domain, services] of Object.entries(ALLOWED_SERVICES)) {
      for (const [service, spec] of Object.entries(services)) {
        for (const key of Object.keys(spec.fields)) {
          expect(FORBIDDEN_DATA_KEYS.has(key), `${domain}.${service} declares ${key}`).toBe(false);
        }
      }
    }
  });

  test("unknown keys are refused, including ones HA itself would accept", () => {
    for (const [entity, service, data] of [
      ["light.x", "turn_on", { transition: 2 }],
      ["light.x", "turn_on", { brightness: 128 }],
      ["light.x", "turn_on", { effect: "colorloop" }],
      ["light.x", "turn_off", { brightness_pct: 0 }],
      ["light.x", "toggle", { flash: "long" }],
      ["script.any", "turn_on", { variables: { x: 1 } }],
      ["scene.evening", "turn_on", { transition: 1 }],
      ["climate.x", "set_temperature", { temperature: 20, hvac_mode: "heat" }],
      ["climate.x", "set_temperature", { target_temp_high: 25, target_temp_low: 18 }],
      ["media_player.x", "media_play", { media_content_id: "http://evil" }],
      ["fan.x", "set_percentage", { percentage: 10, preset_mode: "auto" }],
      ["humidifier.x", "turn_on", { humidity: 40 }],
      ["vacuum.x", "start", { command: "x" }],
      ["light.x", "turn_on", { __proto__: { brightness_pct: 1 }, extra: 1 }],
    ] as const) {
      expect(call(entity, service, data), `${entity} ${service} ${JSON.stringify(data)}`).toEqual({
        ok: false,
        reason: "invalid_data",
      });
    }
  });

  test("the returned data is a fresh copy holding only validated keys", () => {
    const data = { brightness_pct: 40, rgb_color: [1, 2, 3] };
    const r = call("light.x", "turn_on", data);
    expect(r).toEqual({ ok: true, sensitive: false, data: { brightness_pct: 40, rgb_color: [1, 2, 3] } });
    if (!r.ok) throw new Error("unreachable");
    expect(r.data).not.toBe(data);
    expect(r.data.rgb_color).not.toBe(data.rgb_color);
  });

  // [domain.service, key, accepted values, refused values]
  const RANGES: [string, string, unknown[], unknown[]][] = [
    ["light.turn_on", "brightness_pct", [0, 1, 50, 100], [-1, 101, 50.5, "50", NaN, Infinity, null, true]],
    ["light.turn_on", "color_temp_kelvin", [1500, 2700, 6500, 9000], [1499, 9001, 2700.5, "2700", NaN, null]],
    [
      "light.turn_on",
      "rgb_color",
      [[0, 0, 0], [255, 128, 0], [255, 255, 255]],
      [[256, 0, 0], [-1, 0, 0], [1, 2], [1, 2, 3, 4], [1.5, 2, 3], ["1", 2, 3], "255,0,0", { 0: 1, 1: 2, 2: 3, length: 3 }, null],
    ],
    ["fan.set_percentage", "percentage", [0, 33, 100], [-1, 101, 33.3, "50", null]],
    ["climate.set_temperature", "temperature", [-20, 0, 21.5, 40], [-20.5, 40.5, 100, "21", NaN, Infinity, null]],
    [
      "climate.set_hvac_mode",
      "hvac_mode",
      ["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"],
      ["HEAT", "eco", "", 1, null],
    ],
    ["media_player.volume_set", "volume_level", [0, 0.5, 1], [-0.1, 1.1, 50, "0.5", NaN, null]],
    ["media_player.volume_mute", "is_volume_muted", [true, false], ["true", 1, 0, null]],
    ["media_player.select_source", "source", ["Radio", "HDMI 1", "x".repeat(100)], ["", "x".repeat(101), 5, null, ["Radio"], "a\nb", "a\u0000b"]],
    ["cover.set_cover_position", "position", [0, 50, 100], [-1, 101, 50.5, "50", null]],
    ["humidifier.set_humidity", "humidity", [0, 45, 100], [-1, 101, 45.5, "45", null]],
  ];

  for (const [qualified, key, good, badValues] of RANGES) {
    test(`${qualified} ${key}`, () => {
      const [domain, service] = qualified.split(".");
      for (const v of good) {
        expect(call(`${domain}.x`, service, { [key]: v }), `${key}=${JSON.stringify(v)}`).toEqual({
          ok: true,
          sensitive: false,
          data: { [key]: v },
        });
      }
      for (const v of badValues) {
        expect(call(`${domain}.x`, service, { [key]: v }), `${key}=${String(v)}`).toEqual({
          ok: false,
          reason: "invalid_data",
        });
      }
    });
  }

  test("light: brightness combines with one colour, not with two", () => {
    expect(call("light.x", "turn_on", { brightness_pct: 30, color_temp_kelvin: 3000 }).ok).toBe(true);
    expect(call("light.x", "turn_on", { brightness_pct: 30, rgb_color: [1, 2, 3] }).ok).toBe(true);
    expect(call("light.x", "turn_on", { color_temp_kelvin: 3000, rgb_color: [1, 2, 3] })).toEqual({
      ok: false,
      reason: "invalid_data",
    });
  });
});

test.describe("allowedActionsFor", () => {
  test("lists every allowed service of the domain, sorted, with sensitivity", () => {
    for (const [domain, services] of Object.entries(RFC_TABLE)) {
      const want = Object.entries(services)
        .map(([service, s]) => ({ service, sensitive: s === "always" }))
        .sort((a, b) => a.service.localeCompare(b.service));
      expect(allowedActionsFor(`${domain}.x`, null), domain).toEqual(want);
    }
  });

  test("agrees with decideHomeAction on every service", () => {
    for (const domain of Object.keys(RFC_TABLE)) {
      for (const dc of [null, "garage", "blind"]) {
        for (const { service, sensitive } of allowedActionsFor(`${domain}.x`, dc)) {
          const r = call(`${domain}.x`, service, MINIMAL_DATA[`${domain}.${service}`] ?? {}, dc);
          expect(r.ok && r.sensitive, `${domain}.${service} ${dc}`).toBe(sensitive);
        }
      }
    }
  });

  test("returns a fresh array each time", () => {
    const a = allowedActionsFor("light.x", null);
    a.push({ service: "restart", sensitive: false });
    expect(allowedActionsFor("light.x", null).map((x) => x.service)).not.toContain("restart");
  });
});

test.describe("consistency with RFC-008's on-screen confirmations", () => {
  test("every DANGEROUS_ACTIONS entry is sensitive here, or not allowed at all", () => {
    for (const key of Object.keys(DANGEROUS_ACTIONS)) {
      const [domain, service] = key.split(".");
      const r = call(`${domain}.thing`, service, MINIMAL_DATA[key] ?? {}, null);
      if (r.ok) expect(r.sensitive, `${key} is allowed but not sensitive`).toBe(true);
      else expect(r.reason, key).toBe("not_allowed");
    }
  });
});
