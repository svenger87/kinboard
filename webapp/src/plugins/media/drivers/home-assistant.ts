import type { HAEntity } from "@/types/home-assistant";
import type { Capability, MediaPlayerState, MediaStatus } from "../types";

/**
 * MediaPlayerEntityFeature, from Home Assistant's media_player/const.py.
 * Only the flags M1 acts on are listed; the rest are deliberately ignored
 * rather than mapped to capabilities nothing draws.
 */
const FEATURE = {
  PAUSE: 1,
  SEEK: 2,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  PLAY_MEDIA: 512,
  SELECT_SOURCE: 2048,
  PLAY: 16384,
  BROWSE_MEDIA: 131072,
} as const;

/**
 * Turn HA's bitmask into the capability set the UI reads.
 *
 * This is why the HA driver needs no per-device knowledge: the device itself
 * states what it accepts, so a Sonos gets a scrubber and a live radio stream
 * does not, with no list of models to maintain.
 */
export function capabilitiesFromSupportedFeatures(supported: number): Capability[] {
  const has = (flag: number) => (supported & flag) === flag;
  const caps: Capability[] = [];
  if (has(FEATURE.PLAY) || has(FEATURE.PAUSE)) caps.push("transport");
  if (has(FEATURE.NEXT_TRACK)) caps.push("next");
  if (has(FEATURE.SEEK)) caps.push("seek");
  if (has(FEATURE.VOLUME_SET)) caps.push("volume");
  if (has(FEATURE.VOLUME_MUTE)) caps.push("mute");
  if (has(FEATURE.SELECT_SOURCE)) caps.push("sources");
  if (has(FEATURE.BROWSE_MEDIA)) caps.push("browse");
  if (has(FEATURE.PLAY_MEDIA)) caps.push("playUrl");
  return caps;
}

/** HA's entity state string → our status. */
function statusFromHaState(state: string): MediaStatus {
  switch (state) {
    case "playing":
      return "playing";
    case "paused":
      return "paused";
    case "off":
      return "off";
    case "standby":
      return "off";
    case "idle":
      return "idle";
    case "unavailable":
    case "unknown":
      return "unavailable";
    default:
      // Buffering and anything a future HA release adds. Treated as idle so a
      // card renders rather than throwing on a state we have not met.
      return "idle";
  }
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/**
 * An entity we could not read at all is `unavailable`, never `idle`.
 *
 * The distinction is the whole difference between "the speaker is on and
 * silent" and "we cannot reach the speaker", and they must not render the
 * same way on a wall display.
 */
export function stateFromHaEntity(entity: HAEntity | undefined): MediaPlayerState {
  if (!entity) return { status: "unavailable", capabilities: [] };

  const a = (entity.attributes ?? {}) as Record<string, unknown>;
  const status = statusFromHaState(entity.state);

  return {
    status,
    title: str(a.media_title),
    artist: str(a.media_artist),
    album: str(a.media_album_name),
    artworkUrl: str(a.entity_picture),
    position: num(a.media_position),
    duration: num(a.media_duration),
    positionUpdatedAt: str(a.media_position_updated_at),
    volume: num(a.volume_level),
    muted: typeof a.is_volume_muted === "boolean" ? a.is_volume_muted : undefined,
    source: str(a.source),
    sourceList: Array.isArray(a.source_list)
      ? (a.source_list.filter((s) => typeof s === "string") as string[])
      : undefined,
    capabilities:
      status === "unavailable"
        ? []
        : capabilitiesFromSupportedFeatures(num(a.supported_features) ?? 0),
  };
}
