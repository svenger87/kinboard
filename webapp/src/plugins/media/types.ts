/**
 * What a media player can do, right now.
 *
 * Declared per read rather than per driver, because it is genuinely dynamic:
 * a radio can seek inside a podcast and not in live DAB, and reports
 * differently minute to minute. The UI draws a control only when the current
 * state lists it, which is what lets protocols that disagree about what a
 * "source" is share one interface without anybody faking a response.
 * RFC-003 §2.4.
 */
export type Capability =
  | "transport"
  | "next"
  | "seek"
  | "volume"
  | "mute"
  | "sources"
  | "browse"
  | "playUrl";

export type MediaStatus = "playing" | "paused" | "idle" | "off" | "unavailable";

export interface MediaPlayerState {
  status: MediaStatus;
  title?: string;
  artist?: string;
  album?: string;
  /** Driver-relative; the client renders it through the artwork proxy. */
  artworkUrl?: string;
  /** Seconds into the track at `positionUpdatedAt`. */
  position?: number;
  duration?: number;
  /** ISO timestamp. The progress bar interpolates from here — RFC-003 §2.2. */
  positionUpdatedAt?: string;
  /** 0..1 */
  volume?: number;
  muted?: boolean;
  source?: string;
  sourceList?: string[];
  capabilities: Capability[];
}

/** The commands a driver may be asked to perform. */
export type MediaCommand =
  | { kind: "playPause" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "seek"; position: number }
  | { kind: "setVolume"; volume: number }
  | { kind: "setMuted"; muted: boolean }
  | { kind: "selectSource"; source: string };
