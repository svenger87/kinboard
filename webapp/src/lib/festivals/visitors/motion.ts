/**
 * The visitors' timing and paths (RFC-020 §2.1, §5.1) as pure maths: where
 * each archetype is at a moment of its pass, from its spec, the screen and
 * the random choices it made when the pass began. No canvas here, so
 * e2e/festival-archetypes.spec.ts runs every path in Node; the drawing is in
 * the archetypes' own files.
 */

import type { ArcSpec, BurstFrom, BurstSpec, Curve, DriftSpec, FireworksSpec, FlySpec, PassEnv, RiseSpec, Size, WalkSpec } from "./types";

/** How long a pass takes, ms: about ten seconds (§2.1). */
export const PASS_MS = 10_000;

/** A pass every two minutes (§2.1, decision 2), unless the kit says otherwise. */
export const PASS_EVERY_MS = 120_000;

export type Rand = () => number;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The art's size on this screen: CSS px per art unit. */
export function visitorScale(size: Size, width: number, height: number): number {
  return Math.min(size.max, Math.max(size.min, (size.per === "width" ? width : height) / size.px));
}

/* ---------------------------------------------------------------- curves (art.py's) */

/** A periodic Catmull-Rom curve through keyframes [phase 0..1, value]. */
export function keyCurve(keys: number[][], t: number): number {
  t = ((t % 1) + 1) % 1;
  const n = keys.length;
  for (let i = 0; i < n; i++) {
    const p0 = keys[i][0];
    const p1 = i + 1 < n ? keys[i + 1][0] : keys[0][0] + 1;
    if ((p0 <= t && t < p1) || (i === n - 1 && t >= p0)) {
      const u = (t - p0) / (p1 - p0);
      const v0 = keys[(i - 1 + n) % n][1];
      const v1 = keys[i][1];
      const v2 = keys[(i + 1) % n][1];
      const v3 = keys[(i + 2) % n][1];
      return 0.5 * (2 * v1 + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u * u + (-v0 + 3 * v1 - 3 * v2 + v3) * u * u * u);
    }
  }
  return keys[0][1];
}

/** amp * sin(2π(f·t + phase)). */
export const wave = ([a, ph]: readonly number[], t: number, f = 1) => a * Math.sin(2 * Math.PI * (f * t + ph));

/** What a curve is evaluated against. */
export interface CurveClock {
  /** Cycles of the rig's period, phases added. */
  t: number;
  /** ms since the pass began. */
  ms: number;
  wind: number;
  /** ms since the visitor was tapped, or -1. */
  sinceTap: number;
}

export function evalCurve(c: Curve | undefined, at: CurveClock): number {
  if (c === undefined) return 0;
  if (typeof c === "number") return c;
  if (Array.isArray(c)) {
    let sum = 0;
    for (const part of c) sum += evalCurve(part, at);
    return sum;
  }
  if ("keys" in c) return keyCurve(c.keys, at.t);
  if ("wave" in c) {
    const boost = c.tapped && at.sinceTap >= 0 && at.sinceTap < c.tapped.ms ? c.tapped : null;
    return wave(c.wave, at.t * (boost ? boost.speed : 1), c.freq ?? 1) * (boost ? boost.amp : 1);
  }
  const [base, k] = c.wind ?? [1, 0];
  return Math.sin(at.ms / (c.ms / (2 * Math.PI)) + (c.phase ?? 0) * 2 * Math.PI) * c.sine * (base + k * at.wind);
}

/* ---------------------------------------------------------------- fly */

export interface FlyPlan {
  high: boolean;
  baseY: number;
  arc: number;
}

/** A crossing's height and arc: alternate passes high and low, each a little different. */
export function flyPlan(spec: FlySpec, env: PassEnv, rand: Rand = Math.random): FlyPlan {
  const [high, low] = spec.bands ?? [[0.12, 0.14], [0.34, 0.16]];
  const [arcFrom, arcSpread] = spec.arc ?? [0.04, 0.07];
  const isHigh = env.seed % 2 === 0;
  const band = isHigh ? high : low;
  const baseY = env.height * (band[0] + rand() * band[1]);
  const arc = env.height * (arcFrom + rand() * arcSpread) * (rand() < 1 - (spec.dip ?? 0.3) ? 1 : -1);
  return { high: isHigh, baseY, arc };
}

export interface FlyPose {
  /** The body's origin, px. */
  x: number;
  y: number;
  /** Degrees. */
  bank: number;
}

/**
 * Where the body is `ms` into the crossing: in from the left with its whole
 * length off-screen, out past the right edge, on an arc, bobbing and banking
 * with it; `drift` is how far the wind has pushed it so far (px).
 */
export function flyPose(spec: FlySpec, plan: FlyPlan, env: PassEnv, ms: number, wind: number, drift: number, scale: number): FlyPose {
  const u = ms / (spec.duration ?? PASS_MS);
  const length = (spec.length ?? spec.box[2]) * scale;
  const x = -length + u * (env.width + length * 1.15) + drift;
  const y = plan.baseY - Math.sin(Math.min(1, u) * Math.PI) * plan.arc + Math.sin(ms / 1700) * 6 + Math.sin(ms / 800) * 3 * wind;
  const bank = Math.cos(Math.min(1, u) * Math.PI) * -(spec.bank ?? 3) * Math.sign(plan.arc) + Math.sin(ms / 900) * 1.5 * wind;
  return { x, y, bank };
}

/* ---------------------------------------------------------------- walk */

export interface WalkPlan {
  dir: 1 | -1;
  /** Between members, px. */
  gap: number;
  /** The row's length, px. */
  group: number;
  /** How high the members' origin rides above the bottom of the screen, px. */
  lift: number;
}

export function walkPlan(spec: WalkSpec, env: PassEnv, scale: number, rand: Rand = Math.random): WalkPlan {
  const direction = spec.direction ?? "alternate";
  const dir = direction === "ltr" ? 1 : direction === "rtl" ? -1 : env.seed % 2 === 0 ? 1 : -1;
  const gap = spec.gap[0] * scale + rand() * spec.gap[1] * scale;
  const group = gap * (spec.members.length - 1) + (spec.tail ?? 0) * scale;
  const lift = env.bottom + spec.lift.art * scale + spec.lift.px[0] + rand() * spec.lift.px[1];
  return { dir, gap, group, lift };
}

export interface WalkMember {
  x: number;
  y: number;
  /** Degrees. */
  swing: number;
  /** -1..1: a dreidel's turn as a horizontal squash. */
  turn: number;
  /** In steps, for the member's own rig. */
  t: number;
}

/** The row `ms` into the walk: each member a step out of the one before, bobbing, swinging in the wind. */
export function walkPose(spec: WalkSpec, plan: WalkPlan, env: PassEnv, ms: number, wind: number, scale: number): { lead: number; members: WalkMember[] } {
  const u = ms / (spec.duration ?? PASS_MS * 1.2);
  const lead = -plan.group + u * (env.width + plan.group * 1.05);
  const t = ms / 1000 / spec.period;
  const top = env.height - plan.lift;
  const members: WalkMember[] = [];
  for (let i = 0; i < spec.members.length; i++) {
    const lag = i * (spec.lag ?? 0.23);
    const bob = spec.bob ? (spec.bob.hop ? Math.abs(Math.sin(Math.PI * (t + lag))) : Math.sin(2 * Math.PI * (t + lag))) * spec.bob.amp : 0;
    const swing = spec.swing ? spec.swing.amp * Math.sin(2 * Math.PI * (t + lag - spec.swing.lag)) * (1 + wind * spec.swing.wind) - plan.dir * wind * 4 : 0;
    const along = lead + i * plan.gap;
    members.push({
      x: plan.dir > 0 ? along : env.width - along,
      y: top - bob * scale,
      swing,
      turn: spec.turn ? Math.cos(2 * Math.PI * spec.turn * (ms / 1000) + lag) : 1,
      t: t + lag,
    });
  }
  return { lead, members };
}

/* ---------------------------------------------------------------- particles: rise, drift, burst */

export interface Particle {
  sprite: string;
  /** When it appears, s into the pass, and how long it lives, s. */
  born: number;
  life: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  /** A multiple of the visitor's scale. */
  scale: number;
  spin: number;
  angle0: number;
  phase: number;
  /** The one that takes the tap. */
  hero: boolean;
}

/** Where a particle is, `s` seconds into the pass. */
export interface ParticleState {
  x: number;
  y: number;
  angle: number;
  /** 0..1. */
  alpha: number;
  /** Size, a multiple of its scale: blooms in, grows. */
  grow: number;
  /** scaleY: a leaf's flip, a bat's wings. */
  flip: number;
  alive: boolean;
}

const pickOf = <T>(list: readonly T[], rand: Rand) => list[Math.floor(rand() * list.length) % list.length];
const between = ([a, b]: readonly number[], rand: Rand) => a + rand() * (b - a);

/**
 * Up from the bottom: born over the first 60% of the pass across the width,
 * rising at their own speed, swaying, fading out by the ceiling. The largest
 * is the hero.
 */
export function risePlan(spec: RiseSpec, env: PassEnv, rand: Rand = Math.random): Particle[] {
  const duration = (spec.duration ?? PASS_MS) / 1000;
  const out: Particle[] = [];
  for (let i = 0; i < spec.count; i++) {
    const speed = between(spec.speed, rand);
    const climb = env.height - env.bottom + 80;
    out.push({
      sprite: pickOf(spec.sprites, rand),
      born: (i / Math.max(1, spec.count)) * duration * 0.6 + rand() * 0.4,
      life: climb / speed,
      x0: env.width * (0.06 + rand() * 0.88),
      y0: env.height - env.bottom + 40,
      vx: 0,
      vy: -speed,
      scale: between(spec.scale, rand),
      spin: spec.spin ? between(spec.spin, rand) : 0,
      angle0: spec.spin ? rand() * 0.6 - 0.3 : 0,
      phase: rand() * Math.PI * 2,
      hero: false,
    });
  }
  crownHero(out);
  return out;
}

export function riseAt(spec: RiseSpec, p: Particle, env: PassEnv, s: number, windShift: number): ParticleState {
  const age = s - p.born;
  const alive = age >= 0 && age <= p.life;
  const y = p.y0 + p.vy * Math.max(0, age);
  const ceiling = env.height * (spec.ceiling ?? 0.1);
  const fadeIn = clamp(age / 0.6, 0, 1);
  const fadeOut = clamp((y - ceiling) / (env.height * 0.25), 0, 1);
  return {
    x: p.x0 + Math.sin(age * 1.3 + p.phase) * spec.sway + windShift,
    y,
    angle: p.angle0 + p.spin * age + Math.sin(age * 1.1 + p.phase) * 0.08,
    alpha: alive ? fadeIn * fadeOut : 0,
    grow: spec.bloom ? clamp(age / 1.2, 0, 1) * (2 - clamp(age / 1.2, 0, 1)) : 1,
    flip: 1,
    alive: alive && y > -80,
  };
}

/** Down from the top: born over the first 60% of the pass, falling and swaying, tumbling. */
export function driftPlan(spec: DriftSpec, env: PassEnv, rand: Rand = Math.random): Particle[] {
  const duration = (spec.duration ?? PASS_MS) / 1000;
  const out: Particle[] = [];
  for (let i = 0; i < spec.count; i++) {
    const speed = between(spec.speed, rand);
    out.push({
      sprite: pickOf(spec.sprites, rand),
      born: (i / Math.max(1, spec.count)) * duration * 0.6 + rand() * 0.4,
      life: (env.height + 120) / speed,
      x0: env.width * (-0.1 + rand() * 1.1),
      y0: -60,
      vx: 0,
      vy: speed,
      scale: between(spec.scale, rand),
      spin: spec.spin ? between(spec.spin, rand) : 0,
      angle0: rand() * Math.PI * 2,
      phase: rand() * Math.PI * 2,
      hero: false,
    });
  }
  crownHero(out);
  return out;
}

export function driftAt(spec: DriftSpec, p: Particle, env: PassEnv, s: number, windShift: number): ParticleState {
  const age = s - p.born;
  const y = p.y0 + p.vy * Math.max(0, age);
  const alive = age >= 0 && y < env.height + 60;
  return {
    x: p.x0 + Math.sin(age * 1.6 + p.phase) * spec.sway + windShift,
    y,
    angle: p.angle0 + p.spin * age,
    alpha: alive ? clamp(age / 0.5, 0, 1) : 0,
    grow: 1,
    flip: spec.tumble ? Math.cos(2 * Math.PI * spec.tumble * age + p.phase) : 1,
    alive,
  };
}

/** The point a burst comes from, and the direction into the screen (radians). */
export function burstOrigin(from: BurstFrom, env: PassEnv): { x: number; y: number; angle: number } {
  const w = env.width;
  const h = env.height - env.bottom;
  switch (from) {
    case "top-left":
      return { x: -20, y: -20, angle: Math.PI / 4 };
    case "top-right":
      return { x: w + 20, y: -20, angle: (3 * Math.PI) / 4 };
    case "bottom-left":
      return { x: -20, y: h + 20, angle: -Math.PI / 4 };
    case "bottom-right":
      return { x: w + 20, y: h + 20, angle: (-3 * Math.PI) / 4 };
    case "left":
      return { x: -20, y: h * 0.45, angle: 0 };
    case "right":
      return { x: w + 20, y: h * 0.45, angle: Math.PI };
    case "top":
      return { x: w / 2, y: -20, angle: Math.PI / 2 };
    case "bottom":
      return { x: w / 2, y: h + 20, angle: -Math.PI / 2 };
  }
}

/** `waves` bursts across the pass, each from the next corner or edge in `from`, fanned by `spread`. */
export function burstPlan(spec: BurstSpec, env: PassEnv, rand: Rand = Math.random): Particle[] {
  const duration = (spec.duration ?? PASS_MS) / 1000;
  const waves = Math.max(1, spec.waves ?? 1);
  const out: Particle[] = [];
  for (let wv = 0; wv < waves; wv++) {
    const origin = burstOrigin(spec.from[(wv + env.seed) % spec.from.length], env);
    const at = (wv / waves) * duration * 0.55;
    const n = Math.round(spec.count / waves);
    for (let i = 0; i < n; i++) {
      const a = origin.angle + ((rand() * 2 - 1) * spec.spread * Math.PI) / 180;
      const speed = between(spec.speed, rand);
      out.push({
        sprite: pickOf(spec.sprites, rand),
        born: at + rand() * 0.35,
        life: between(spec.life, rand),
        x0: origin.x,
        y0: origin.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        scale: between(spec.scale, rand),
        spin: spec.spin ? between(spec.spin, rand) : 0,
        angle0: spec.flap ? 0 : rand() * Math.PI * 2,
        phase: rand() * Math.PI * 2,
        hero: false,
      });
    }
  }
  crownHero(out);
  return out;
}

/**
 * Closed form, so a frame's position never depends on the frame rate:
 * velocity decays by `drag` (exponentially), gravity pulls, the wind pushes.
 */
export function burstAt(spec: BurstSpec, p: Particle, s: number, windShift: number): ParticleState {
  const age = s - p.born;
  const alive = age >= 0 && age <= p.life;
  const t = Math.max(0, age);
  const k = -Math.log(Math.max(1e-3, 1 - Math.min(0.999, spec.drag)));
  const travel = k > 0 ? (1 - Math.exp(-k * t)) / k : t;
  const life = clamp(age / p.life, 0, 1);
  return {
    x: p.x0 + p.vx * travel + windShift,
    y: p.y0 + p.vy * travel + 0.5 * spec.gravity * t * t,
    // Bats face where they fly; the rest turn.
    angle: spec.flap ? Math.atan2(p.vy, p.vx) * 0.25 : p.angle0 + p.spin * t,
    alpha: alive ? clamp(age / 0.2, 0, 1) * (1 - clamp((life - 0.7) / 0.3, 0, 1)) : 0,
    grow: 1 + (spec.grow ?? 0) * life,
    flip: spec.flap ? 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * spec.flap * t + p.phase)) : 1,
    alive,
  };
}

/** The largest particle takes the tap: drawn a little bigger, born in the middle of the pass. */
function crownHero(list: Particle[]) {
  if (list.length === 0) return;
  const hero = list[Math.floor(list.length / 2)];
  hero.hero = true;
  hero.scale *= 1.35;
}

/* ---------------------------------------------------------------- fireworks */

export interface Shell {
  /** When the rocket leaves the ground, and when it bursts, s. */
  launch: number;
  burst: number;
  /** Where it starts and where it bursts, px. */
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  color: number;
  radius: number;
  /** Each spark's direction (radians) and its share of the radius. */
  sparks: Array<[number, number]>;
}

/** How long a burst's sparks live, s. */
export const BURST_S = 1.9;
const CLIMB_S = 0.9;

/**
 * The shells of a pass, over the clock (or the top of the screen): launched
 * through the first two thirds of the pass, from below the clock's box,
 * bursting above and around it, never two in one place in a row.
 */
export function fireworksPlan(spec: FireworksSpec, env: PassEnv, rand: Rand = Math.random): Shell[] {
  const duration = (spec.duration ?? PASS_MS) / 1000;
  const clock = spec.over !== "top" && env.clock ? env.clock : { x: env.width * 0.2, y: env.height * 0.12, w: env.width * 0.6, h: env.height * 0.2 };
  const radius = Math.min(spec.radius ?? 120, env.width * 0.22);
  const shells: Shell[] = [];
  for (let i = 0; i < spec.shells; i++) {
    const launch = (i / Math.max(1, spec.shells)) * (duration - BURST_S - CLIMB_S) + rand() * 0.3;
    // Left and right of the clock's middle by turns, above its top edge or level with it.
    const side = i % 2 === 0 ? -1 : 1;
    const cx = clamp(clock.x + clock.w / 2 + side * clock.w * (0.1 + rand() * 0.4), radius * 0.6, env.width - radius * 0.6);
    const cy = clamp(clock.y + clock.h * (0.1 + rand() * 0.4) - radius * 0.3, radius * 0.6, env.height * 0.6);
    const n = spec.sparks ?? 36;
    const sparks: Array<[number, number]> = [];
    // A shell is a sphere seen from the side: most sparks reach the rim, a few stay inside it.
    for (let k = 0; k < n; k++) {
      const u = rand();
      sparks.push([(k / n) * Math.PI * 2 + rand() * 0.25, 1 - 0.6 * u * u * u]);
    }
    shells.push({
      launch,
      burst: launch + CLIMB_S,
      x0: cx + (rand() - 0.5) * 60,
      y0: env.height - env.bottom,
      cx,
      cy,
      color: i % Math.max(1, spec.colors.length),
      radius: radius * (0.75 + rand() * 0.25),
      sparks,
    });
  }
  return shells;
}

/** A rocket's head while it climbs, or null; a burst's sparks after, eased out, falling, fading. */
export function shellAt(shell: Shell, s: number): { rocket: { x: number; y: number } | null; open: number; fall: number; alpha: number } | null {
  if (s < shell.launch) return null;
  if (s < shell.burst) {
    const k = (s - shell.launch) / CLIMB_S;
    // Fast off the ground, slowing to the top.
    const e = 1 - (1 - k) * (1 - k);
    return { rocket: { x: shell.x0 + (shell.cx - shell.x0) * e, y: shell.y0 + (shell.cy - shell.y0) * e }, open: 0, fall: 0, alpha: 1 };
  }
  const age = s - shell.burst;
  if (age > BURST_S) return null;
  const k = age / BURST_S;
  return { rocket: null, open: 1 - Math.pow(1 - Math.min(1, age / 0.5), 3), fall: 40 * age * age, alpha: 1 - k * k };
}

/* ---------------------------------------------------------------- arc */

export interface ArcPlan {
  cx: number;
  /** The arc's foot line and its radius, px. */
  cy: number;
  radius: number;
}

/** A rainbow over the widgets: centred, its feet on the lower third, its top under the clock. */
export function arcPlan(spec: ArcSpec, env: PassEnv, rand: Rand = Math.random): ArcPlan {
  const radius = (env.width * spec.span) / 2;
  const cx = env.width / 2 + (rand() - 0.5) * env.width * 0.1;
  const cy = Math.min(env.height - env.bottom, env.height * 0.72 + radius * 0.25);
  return { cx, cy, radius };
}

/** How much of the arc is drawn (0..1, from the left foot) and how opaque, `ms` into the pass. */
export function arcAt(spec: ArcSpec, ms: number): { reveal: number; alpha: number; done: boolean } {
  const reveal = clamp(ms / spec.grow, 0, 1);
  const eased = 1 - Math.pow(1 - reveal, 2);
  const fading = ms - spec.grow - spec.hold;
  const alpha = fading <= 0 ? 1 : clamp(1 - fading / spec.fade, 0, 1);
  return { reveal: eased, alpha, done: fading >= spec.fade };
}
