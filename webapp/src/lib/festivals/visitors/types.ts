/**
 * What a festival's visitor is (RFC-020 §2.1, §5.1): configuration and art,
 * not loop code. A kit (lib/festivals/kits/<id>.ts) picks one of the
 * archetypes below and fills in its options; the engine in this folder flies
 * it in the scene components/weather-effects.tsx runs, with the weather's
 * clock, wind, light and frame cap. docs/festivals/ADDING-A-FESTIVAL.md is the
 * guide.
 *
 * Units: the art's own units (an SVG part's viewBox) unless a name says px.
 * A visitor is drawn at `scale` art units to the CSS pixel, from `size`.
 */

import type { FestivalId } from "@/lib/festivals";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A part as the art script writes it: its size, and the point it turns about. */
export interface PartSpec {
  w: number;
  h: number;
  pivot: number[];
}

/** `<id>.art.json`, written by webapp/scripts/festival-art/<id>.py: every part, and anything the rig reads. */
export interface ArtJson {
  parts: Record<string, PartSpec>;
}

/* ---------------------------------------------------------------- motion curves */

/**
 * A value that changes over time, for a rig's joints. `t` is in cycles of the
 * rig's `period` (a gallop, a step), plus the phase of the node and its
 * parents.
 *
 * - a number: constant
 * - `{ wave: [amp, phase], freq }`: amp * sin(2π(freq·t + phase)); after a tap,
 *   `tapped` multiplies its amplitude and speed for a while (Santa waves)
 * - `{ keys: [[phase, value], ...] }`: a periodic Catmull-Rom curve through
 *   keyframes, one cycle long (art.py's gait)
 * - `{ sine, ms, phase, wind }`: sine * (wind[0] + wind[1]·wind) * sin(2π·ms/ms + phase),
 *   on the wall clock rather than the cycle (a bob in the wind)
 * - an array: the sum
 */
export type Curve =
  | number
  | { wave: [number, number]; freq?: number; tapped?: { amp: number; speed: number; ms: number } }
  | { keys: number[][] }
  | { sine: number; ms: number; phase?: number; wind?: [number, number] }
  | Curve[];

/**
 * One part of a rig, and the parts that hang off it. `at` is where its pivot
 * sits, in its parent's own drawing (the parent's SVG coordinates, as
 * art.py's parts.json gives them); `under` is drawn before the part (a far
 * leg, a lower leg behind the upper), `over` after it (the head).
 */
export interface RigNode {
  /** A part's name; none for a group that only places its children. */
  part?: string;
  at?: [number, number];
  x?: Curve;
  y?: Curve;
  /** Degrees. */
  rotate?: Curve;
  scaleX?: Curve;
  scaleY?: Curve;
  /** Added to `t` for this node and everything under it: the second reindeer runs out of step. */
  phase?: number;
  under?: RigNode[];
  over?: RigNode[];
  /** Named points in this part's drawing, for `lines` (the reins' rings, Santa's hands). */
  anchors?: Record<string, [number, number]>;
}

/** A visitor drawn from several parts that move against each other: the sleigh team. */
export interface Rig {
  root: RigNode;
  /** Seconds per cycle of `t`. */
  period: number;
  /**
   * Lines drawn live between anchors, under the rig (the reins): from one
   * anchor to each of several, sagging `sag` art units below the lower end.
   */
  lines?: Array<{ from: string; to: string[]; color: string; width: number; sag: number }>;
}

/** What a member of a visitor is: a single part's name, or a rig. */
export type Body = string | Rig;

/* ---------------------------------------------------------------- the archetypes */

/** How big the art is on this screen: clamp(screen[per] / px, min, max) CSS pixels per art unit. */
export interface Size {
  per: "width" | "height";
  px: number;
  min: number;
  max: number;
}

/** What a tap drops (§2.1): stars always; presents, or the kit's own parts; from a point of the target box. */
export interface TapSpec {
  presents?: boolean;
  /** Part names to drop instead of presents (Easter eggs, sweets). */
  drops?: string[];
  /** Where in the target box they come from, as fractions: [0.5, 0.4] by default. */
  at?: [number, number];
}

interface VisitorBase {
  /** Whose art folder the parts are in, public/festivals/<art>/: the kit's own by default (Orthodox Christmas borrows Christmas's sleigh). */
  art?: FestivalId;
  /** The parts this visitor draws, from `<id>.art.json`. */
  parts?: Record<string, PartSpec>;
  size: Size;
  /** Milliseconds between passes: two minutes by default (§2.1, decision 2). */
  every?: number;
  /** What a tap does; `false`: the visitor takes no tap (a swarm too spread out to aim at). */
  tap?: TapSpec | false;
}

/**
 * Across the screen on an arc that changes from pass to pass, banking with
 * its path and drifting in the wind: the sleigh. Alternate passes fly high
 * and low, so it never parks over the same card twice running.
 */
export interface FlySpec extends VisitorBase {
  archetype: "fly";
  body: Body;
  /** The body's box, art units, from its origin: the tap target. */
  box: [number, number, number, number];
  /** How far the body reaches behind its origin, art units: where it starts off-screen. Default box width. */
  length?: number;
  /** ms for the crossing; default PASS_MS (ten seconds). */
  duration?: number;
  /** The heights it flies at, as fractions of the screen: [high band, low band], each [from, spread]. */
  bands?: [[number, number], [number, number]];
  /** How far the arc rises, fraction of the height: [from, spread]. */
  arc?: [number, number];
  /** The share of passes whose arc dips instead of rising. */
  dip?: number;
  /** Degrees it banks along its arc. */
  bank?: number;
}

/**
 * Along the bottom of the screen, above the navigation bar, a few members
 * in a row: St Martin's lanterns bobbing on their sticks, a parade, a hopping
 * bunny, a dreidel, a dragon dance, goldfish, a dragon boat. Alternate passes
 * go the other way.
 */
export interface WalkSpec extends VisitorBase {
  archetype: "walk";
  members: Body[];
  /** The gap between members, art units: [from, spread]. */
  gap: [number, number];
  /** Added to the row's length, art units: the last member's own width. */
  tail?: number;
  /** How high the members' origin rides above the bottom inset: art units, plus [from, spread] px. */
  lift: { art: number; px: [number, number] };
  /** ms for the crossing; default 1.2 x PASS_MS (a walk is slower than a sleigh). */
  duration?: number;
  /** Seconds per step. */
  period: number;
  /** How far out of step each member is, in steps. */
  lag?: number;
  /** Bob per step, art units; `hop`: a hop's |sin| (lanterns, a bunny) rather than a wave (a dragon). */
  bob?: { amp: number; hop?: boolean };
  /** A pendulum swing, degrees, lagging the step by `lag`; the wind swings it `wind` times further and pushes it back. */
  swing?: { amp: number; lag: number; wind: number };
  /** Spinning about the vertical axis, turns per second: a dreidel. */
  turn?: number;
  /** A stick from the member's origin down to a hand, drawn under it: lanterns. */
  stick?: { color: string; width: number; to: [number, number] };
  /** The members' extent around their origin, art units: the tap target. */
  extent: { left: number; right: number; top: number; bottom: number };
  direction?: "alternate" | "ltr" | "rtl";
  /**
   * The way the art faces. `"right"`: drawn walking left to right, so it is
   * mirrored on the passes that go the other way (a bunny, a dragon). Leave it
   * out for art that reads the same both ways, or must not be mirrored
   * (lanterns, a dreidel's letter).
   */
  faces?: "right";
}

/** Particles: many small sprites, one shared engine (rise, drift, burst). */
interface ParticleBase extends VisitorBase {
  /** Part names, picked at random for each particle. */
  sprites: string[];
  /** How many in a pass. */
  count: number;
  /** ms for the pass; default PASS_MS. */
  duration?: number;
  /** Each particle's size, a multiple of `size`: [from, to]. */
  scale: [number, number];
  /** Turning, radians per second: [from, to]. */
  spin?: [number, number];
}

/**
 * Up from the bottom with a sway and the wind, fading out near the top:
 * hearts, balloons, sky lanterns; `bloom` grows each one in from nothing
 * (flowers blooming up). One particle, larger, takes the tap.
 */
export interface RiseSpec extends ParticleBase {
  archetype: "rise";
  /** px per second: [from, to]. */
  speed: [number, number];
  /** Side to side, px. */
  sway: number;
  bloom?: boolean;
  /** Where they fade out, as a fraction of the height from the top: 0.1 by default. */
  ceiling?: number;
}

/**
 * Down from the top with the shared wind, turning over as they fall: leaves,
 * petals. One particle, larger, takes the tap.
 */
export interface DriftSpec extends ParticleBase {
  archetype: "drift";
  speed: [number, number];
  sway: number;
  /** Turning over as they fall (a leaf's flip), flips per second; 0 for none. */
  tumble?: number;
}

/** Where a burst comes from. */
export type BurstFrom = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "left" | "right" | "top" | "bottom";

/**
 * Out of a corner or an edge, spreading, slowing, falling or flying on:
 * bats, streamers and confetti, clouds of coloured powder, noisemakers.
 * `waves` bursts in a pass, each from the next of `from`.
 */
export interface BurstSpec extends ParticleBase {
  archetype: "burst";
  from: BurstFrom[];
  waves?: number;
  /** px per second at launch: [from, to]. */
  speed: [number, number];
  /** Degrees either side of the direction into the screen. */
  spread: number;
  /** px per second², down. Negative floats up. */
  gravity: number;
  /** The share of speed lost per second: 0 none, 0.9 a lot (powder). */
  drag: number;
  /** Seconds each lives: [from, to]. */
  life: [number, number];
  /** Wings: a flap's scaleY, beats per second (bats). */
  flap?: number;
  /** Grows by this factor over its life (a powder cloud spreading). */
  grow?: number;
}

/**
 * Fireworks over the clock (or the top of the screen): rockets climb and
 * burst into sparks of the kit's colours that fall and fade. New Year's Eve
 * at the family's midnight, a national day in the evening. The sparks are
 * glows drawn once per colour, no art needed; `sprites` adds the kit's own.
 */
export interface FireworksSpec extends VisitorBase {
  archetype: "fireworks";
  colors: string[];
  /** Shells in a pass. */
  shells: number;
  over?: "clock" | "top";
  /** Sparks a shell. */
  sparks?: number;
  /** A burst's radius at full size, px. */
  radius?: number;
  /** ms for the pass; default PASS_MS. */
  duration?: number;
  /** Extra parts to throw among the sparks (stars, a heart). */
  sprites?: string[];
  /**
   * The kinds of shell, one after another (starting at the pass's seed):
   * `peony` a sphere of streaking sparks round a pistil of another colour
   * (the default); `willow` sparks of the first colour drooping on long
   * trails, hanging before they fade; `crackle` a burst whose sparks break
   * into flickering crackles as they die; `ring` a flat ring, tilted.
   */
  kinds?: ShellKind[];
}

export type ShellKind = "peony" | "willow" | "crackle" | "ring";

/** A rainbow arcing over the widgets: drawn in from one end, held, faded. */
export interface ArcSpec extends VisitorBase {
  archetype: "arc";
  /** The part: drawn as the full arc, its pivot at the circle's centre bottom. */
  sprite: string;
  /** Its width as a share of the screen's. */
  span: number;
  /** ms to draw in, hold, fade out. */
  grow: number;
  hold: number;
  fade: number;
  /** Sparkles along it, a part's name. */
  sparkle?: string;
}

export type VisitorSpec = FlySpec | WalkSpec | RiseSpec | DriftSpec | BurstSpec | FireworksSpec | ArcSpec;
export type Archetype = VisitorSpec["archetype"];

/* ---------------------------------------------------------------- a pass in the scene */

export interface Light {
  /** Fog: the visitor fades in and out of the haze. */
  fog: boolean;
  /** A storm: darker, lit up by the lightning (`flash`, 0..1). */
  storm: boolean;
  flash: number;
}

/** Where a pass happens. */
export interface PassEnv {
  width: number;
  height: number;
  /** Varies the path from pass to pass: alternate high and low, left and right. */
  seed: number;
  /** What covers the bottom edge, px: Home's navigation bar, which a walk keeps clear of. */
  bottom: number;
  /** The clock's box on this screen when the pass began, for fireworks over it; null when there is none. */
  clock: Box | null;
  /** Where the clock is now: the page can move under a pass (cards loading above it). */
  clockNow?: () => Box | null;
}

export interface Pass {
  /** Over: the visitor has left the screen and everything it dropped has landed. */
  readonly done: boolean;
  /** The visitor's own shape, CSS pixels, for the tap target; null once it has gone or been tapped. */
  readonly target: Box | null;
  /** Draw this frame at `ms` since the pass began; returns what it drew over, CSS pixels. */
  draw(ctx: CanvasRenderingContext2D, ms: number, dt: number, wind: number, light: Light): Box | null;
  /** A tap on the visitor: presents and stars come down. Once per pass. */
  tap(): void;
}
