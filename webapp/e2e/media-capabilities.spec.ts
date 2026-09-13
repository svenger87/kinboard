import { test, expect } from "@playwright/test";
import {
  capabilitiesFromSupportedFeatures,
  stateFromHaEntity,
} from "../src/plugins/media/drivers/home-assistant";
import type { HAEntity } from "../src/types/home-assistant";

/**
 * Home Assistant states which commands a player accepts in a bitmask on the
 * entity. Reading it is what lets the UI draw a scrubber for a device that can
 * seek and not for one that cannot, without anybody maintaining a list of
 * device models. RFC-003 §2.4.
 */

// MediaPlayerEntityFeature, from Home Assistant's media_player const.py.
const PAUSE = 1, SEEK = 2, VOLUME_SET = 4, VOLUME_MUTE = 8;
const PREVIOUS = 16, NEXT = 32, PLAY_MEDIA = 512, SELECT_SOURCE = 2048;
const TURN_ON = 128, TURN_OFF = 256;
const PLAY = 16384, BROWSE_MEDIA = 131072;

const entity = (attrs: Record<string, unknown>, state = "playing"): HAEntity =>
  ({
    entity_id: "media_player.kitchen",
    state,
    attributes: attrs,
    last_changed: "2026-09-07T10:00:00Z",
    last_updated: "2026-09-07T10:00:00Z",
  }) as unknown as HAEntity;

test.describe("capabilitiesFromSupportedFeatures", () => {
  test("reads each flag it cares about", () => {
    expect(capabilitiesFromSupportedFeatures(PLAY | PAUSE)).toContain("transport");
    expect(capabilitiesFromSupportedFeatures(SEEK)).toContain("seek");
    expect(capabilitiesFromSupportedFeatures(VOLUME_SET)).toContain("volume");
    expect(capabilitiesFromSupportedFeatures(VOLUME_MUTE)).toContain("mute");
    expect(capabilitiesFromSupportedFeatures(NEXT)).toContain("next");
    expect(capabilitiesFromSupportedFeatures(PREVIOUS)).toContain("previous");
    expect(capabilitiesFromSupportedFeatures(TURN_ON)).toContain("power");
    expect(capabilitiesFromSupportedFeatures(TURN_OFF)).toContain("power");
    expect(capabilitiesFromSupportedFeatures(SELECT_SOURCE)).toContain("sources");
    expect(capabilitiesFromSupportedFeatures(PLAY_MEDIA)).toContain("playUrl");
    expect(capabilitiesFromSupportedFeatures(BROWSE_MEDIA)).toContain("browse");
  });

  test("claims nothing when the device claims nothing", () => {
    expect(capabilitiesFromSupportedFeatures(0)).toEqual([]);
  });

  test("does not invent capabilities from neighbouring bits", () => {
    // A device that can only set volume must not acquire transport.
    expect(capabilitiesFromSupportedFeatures(VOLUME_SET)).toEqual(["volume"]);
  });

  test("next needs its own flag, and previous alone does not grant it", () => {
    expect(capabilitiesFromSupportedFeatures(PREVIOUS)).not.toContain("next");
  });
});

test.describe("stateFromHaEntity", () => {
  test("maps a playing entity", () => {
    const s = stateFromHaEntity(
      entity({
        media_title: "Blue Monday",
        media_artist: "New Order",
        media_album_name: "Power, Corruption & Lies",
        entity_picture: "/api/media_player_proxy/media_player.kitchen",
        media_position: 42,
        media_duration: 273,
        media_position_updated_at: "2026-09-07T10:00:00Z",
        volume_level: 0.4,
        is_volume_muted: false,
        source: "Spotify",
        source_list: ["Spotify", "Radio"],
        supported_features: PLAY | PAUSE | VOLUME_SET,
      }),
    );
    expect(s.status).toBe("playing");
    expect(s.title).toBe("Blue Monday");
    expect(s.artist).toBe("New Order");
    expect(s.album).toBe("Power, Corruption & Lies");
    expect(s.position).toBe(42);
    expect(s.duration).toBe(273);
    expect(s.positionUpdatedAt).toBe("2026-09-07T10:00:00Z");
    expect(s.volume).toBe(0.4);
    expect(s.muted).toBe(false);
    expect(s.source).toBe("Spotify");
    expect(s.sourceList).toEqual(["Spotify", "Radio"]);
    expect(s.capabilities).toEqual(expect.arrayContaining(["transport", "volume"]));
  });

  test("a missing entity is unavailable, not idle", () => {
    // The difference matters: idle is a working speaker with nothing on,
    // unavailable is one we cannot reach. They render differently.
    const s = stateFromHaEntity(undefined);
    expect(s.status).toBe("unavailable");
    expect(s.capabilities).toEqual([]);
  });

  test("maps HA's own unavailable and unknown states", () => {
    expect(stateFromHaEntity(entity({}, "unavailable")).status).toBe("unavailable");
    expect(stateFromHaEntity(entity({}, "unknown")).status).toBe("unavailable");
    expect(stateFromHaEntity(entity({}, "off")).status).toBe("off");
    expect(stateFromHaEntity(entity({}, "idle")).status).toBe("idle");
    expect(stateFromHaEntity(entity({}, "paused")).status).toBe("paused");
    // Anything unrecognised is treated as idle rather than crashing a card.
    expect(stateFromHaEntity(entity({}, "buffering")).status).toBe("idle");
  });

  test("volume survives being absent", () => {
    const s = stateFromHaEntity(entity({ supported_features: 0 }));
    expect(s.volume).toBeUndefined();
    expect(s.muted).toBeUndefined();
  });
});

/*
  The four players in the household this was built against, with the masks
  Home Assistant actually reported for them. They are here because they are
  the reason `power` and `previous` exist: two of the four sat `off` with no
  way to switch them on, and two offered a Previous button they cannot honour.
*/
test.describe("the masks four real devices report", () => {
  const REAL = {
    "Apple TV": 450487,
    "Internetradio (Frontier Silicon)": 200588,
    "Soundbar": 152461,
    "Wohnzimmer": 137093,
  } as const;

  test("every one of them can be switched on and off", () => {
    for (const [name, mask] of Object.entries(REAL)) {
      expect(capabilitiesFromSupportedFeatures(mask), name).toContain("power");
    }
  });

  test("only the devices that report PREVIOUS_TRACK offer it", () => {
    // The Apple TV does; the radio, the soundbar and the living-room player
    // do not. Drawing Previous off the transport bit gave three of the four a
    // button Home Assistant accepts and the device ignores.
    expect(capabilitiesFromSupportedFeatures(REAL["Apple TV"])).toContain("previous");
    for (const name of ["Internetradio (Frontier Silicon)", "Soundbar", "Wohnzimmer"] as const) {
      expect(capabilitiesFromSupportedFeatures(REAL[name]), name).not.toContain("previous");
    }
  });

  test("the radio is the one with no transport at all", () => {
    // Which is why it was the only player that felt usable before `power`:
    // its source list gave it something to tap. RFC-003 §2.4.
    const radio = capabilitiesFromSupportedFeatures(REAL["Internetradio (Frontier Silicon)"]);
    expect(radio).not.toContain("transport");
    expect(radio).toContain("sources");
    expect(radio).toContain("power");
  });
});
