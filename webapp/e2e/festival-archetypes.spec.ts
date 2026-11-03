import { expect, test } from "@playwright/test";
import {
  BURST_S,
  PASS_MS,
  arcAt,
  arcPlan,
  burstAt,
  burstOrigin,
  burstPlan,
  driftAt,
  driftPlan,
  evalCurve,
  fireworksPlan,
  flyPlan,
  flyPose,
  keyCurve,
  riseAt,
  risePlan,
  shellAt,
  visitorScale,
  walkPlan,
  walkPose,
} from "../src/lib/festivals/visitors/motion";
import type { ArcSpec, BurstSpec, DriftSpec, FireworksSpec, FlySpec, PassEnv, RiseSpec, WalkSpec } from "../src/lib/festivals/visitors/types";
import { FESTIVAL_KITS } from "../src/lib/festivals/kits";

/**
 * The visitors' archetypes (lib/festivals/visitors/, RFC-020 §2.1, §3.3):
 * the timing and path of each, as the pure maths the engine draws from.
 * Each pass starts off-screen or invisible, crosses (or rises, falls,
 * bursts) within about ten seconds, keeps clear of the navigation bar, and
 * varies from pass to pass. Pure; no stack, no canvas.
 */

/** A seeded random, so a pass's choices are the same every run. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wall: PassEnv = { width: 1920, height: 1080, seed: 1, bottom: 96, clock: { x: 660, y: 180, w: 600, h: 200 } };
const phone: PassEnv = { width: 390, height: 844, seed: 2, bottom: 80, clock: null };
const size = { per: "width" as const, px: 3100, min: 0.3, max: 0.62 };

test("the size on screen: the art's scale, clamped, by width or height", () => {
  expect(visitorScale(size, 1920, 1080)).toBeCloseTo(1920 / 3100);
  expect(visitorScale(size, 390, 844)).toBe(0.3);
  expect(visitorScale(size, 3840, 2160)).toBe(0.62);
  expect(visitorScale({ per: "height", px: 1800, min: 0.38, max: 0.6 }, 1920, 1080)).toBe(0.6);
});

test("curves: keyframes loop smoothly, waves and wind sines, a tap's boost for a while", () => {
  const keys = [[0, 30], [0.15, 18], [0.38, -30], [0.55, -46], [0.75, -8]];
  // Through every keyframe, and periodic.
  for (const [p, v] of keys) expect(keyCurve(keys, p)).toBeCloseTo(v, 6);
  expect(keyCurve(keys, 1.15)).toBeCloseTo(18, 6);
  expect(keyCurve(keys, -0.85)).toBeCloseTo(18, 6);
  // Continuous at the wrap.
  expect(Math.abs(keyCurve(keys, 0.9999) - keyCurve(keys, 0))).toBeLessThan(0.1);
  const at = { t: 0.25, ms: 0, wind: 0, sinceTap: -1 };
  expect(evalCurve({ wave: [4, 0] }, at)).toBeCloseTo(4);
  expect(evalCurve({ wave: [4, 0], freq: 2 }, at)).toBeCloseTo(0);
  expect(evalCurve([{ wave: [4, 0] }, 1], at)).toBeCloseTo(5);
  // On the wall clock, stronger in the wind.
  expect(evalCurve({ sine: 3, ms: 1000, wind: [0.4, 1] }, { ...at, ms: 250, wind: 0 })).toBeCloseTo(1.2);
  expect(evalCurve({ sine: 3, ms: 1000, wind: [0.4, 1] }, { ...at, ms: 250, wind: 1 })).toBeCloseTo(4.2);
  // Santa waves harder and faster for a second and a half after a tap.
  const arm = { wave: [4, 0] as [number, number], tapped: { amp: 6, speed: 2.5, ms: 1500 } };
  expect(evalCurve(arm, { ...at, t: 0.1, sinceTap: 200 })).toBeCloseTo(24 * Math.sin(2 * Math.PI * 0.25));
  expect(evalCurve(arm, { ...at, t: 0.25, sinceTap: 1600 })).toBeCloseTo(4);
});

test("fly: in from off the left, out past the right in a pass, high and low by turns, on an arc", () => {
  const spec: FlySpec = { archetype: "fly", size, body: "x", box: [-10, -70, 900, 320] };
  const sc = 0.6;
  for (const env of [wall, phone]) {
    for (const seed of [1, 2, 3, 4]) {
      const e = { ...env, seed };
      const plan = flyPlan(spec, e, seeded(seed));
      const start = flyPose(spec, plan, e, 0, 0, 0, sc);
      const end = flyPose(spec, plan, e, PASS_MS, 0, 0, sc);
      // Its whole length off-screen at the start, past the right edge by the end.
      expect(start.x + (spec.box[0] + spec.box[2]) * sc).toBeLessThanOrEqual(0 + 1);
      expect(end.x).toBeGreaterThan(e.width);
      // Alternate passes high and low.
      expect(plan.high).toBe(seed % 2 === 0);
      expect(plan.baseY / e.height).toBeGreaterThanOrEqual(plan.high ? 0.12 : 0.34);
      expect(plan.baseY / e.height).toBeLessThanOrEqual(plan.high ? 0.26 : 0.5);
      // The arc peaks mid-pass.
      const mid = flyPose(spec, plan, e, PASS_MS / 2, 0, 0, sc);
      expect(Math.abs(mid.y - (plan.baseY - plan.arc))).toBeLessThan(12);
      // Banked along the arc: one way going up, the other coming down.
      expect(Math.sign(flyPose(spec, plan, e, 0, 0, 0, sc).bank)).toBe(-Math.sign(flyPose(spec, plan, e, PASS_MS, 0, 0, sc).bank));
    }
  }
  // The wind pushes it along (the scene integrates the drift).
  const plan = flyPlan(spec, wall, seeded(1));
  expect(flyPose(spec, plan, wall, 3000, 1.5, 40, sc).x - flyPose(spec, plan, wall, 3000, 1.5, 0, sc).x).toBe(40);
});

test("walk: along the bottom above the navigation bar, out of step, the other way on alternate passes", () => {
  const spec: WalkSpec = {
    archetype: "walk",
    size,
    members: ["a", "b", "c", "a"],
    gap: [170, 40],
    tail: 120,
    lift: { art: 200, px: [10, 40] },
    period: 1.1,
    bob: { amp: 8, hop: true },
    swing: { amp: 11, lag: 0.18, wind: 0.35 },
    extent: { left: 90, right: 90, top: 20, bottom: 220 },
  };
  const sc = 0.5;
  for (const seed of [1, 2]) {
    const e = { ...wall, seed };
    const plan = walkPlan(spec, e, sc, seeded(seed));
    expect(plan.dir).toBe(seed % 2 === 0 ? 1 : -1);
    // Clear of the navigation bar: the members' origin rides at least their own drawing above it.
    expect(plan.lift).toBeGreaterThanOrEqual(e.bottom + 200 * sc + 10);
    const first = walkPose(spec, plan, e, 0, 0, sc);
    const last = walkPose(spec, plan, e, 12_000, 0, sc);
    // Off one side at the start, past the other at the end.
    const xs0 = first.members.map((m) => m.x);
    const xs1 = last.members.map((m) => m.x);
    if (plan.dir > 0) {
      expect(Math.max(...xs0)).toBeLessThanOrEqual(0);
      expect(Math.min(...xs1)).toBeGreaterThan(e.width - 1);
    } else {
      expect(Math.min(...xs0)).toBeGreaterThanOrEqual(e.width);
      expect(Math.max(...xs1)).toBeLessThan(1);
    }
    // Each member a step out of the one before: a hop only ever lifts.
    const mid = walkPose(spec, plan, e, 5_000, 0, sc);
    for (const m of mid.members) expect(m.y).toBeLessThanOrEqual(e.height - plan.lift + 0.001);
    expect(new Set(mid.members.map((m) => m.y.toFixed(3))).size).toBeGreaterThan(1);
    // The wind swings them further and pushes them back.
    const windy = walkPose(spec, plan, e, 5_000, 1.5, sc);
    expect(windy.members[0].swing).not.toBeCloseTo(mid.members[0].swing);
  }
  // A dreidel turns: its squash goes through zero.
  const dreidel: WalkSpec = { ...spec, turn: 1.5 };
  const plan = walkPlan(dreidel, wall, sc, seeded(3));
  const turns = Array.from({ length: 20 }, (_, i) => walkPose(dreidel, plan, wall, i * 50, 0, sc).members[0].turn);
  expect(Math.min(...turns)).toBeLessThan(0);
  expect(Math.max(...turns)).toBeGreaterThan(0);
});

test("rise: up from below the bottom, swaying, fading by the ceiling; one hero takes the tap", () => {
  const spec: RiseSpec = { archetype: "rise", size, sprites: ["h1", "h2"], count: 14, scale: [0.6, 1], speed: [90, 160], sway: 20, bloom: true };
  const plan = risePlan(spec, wall, seeded(5));
  expect(plan.length).toBe(14);
  expect(plan.filter((p) => p.hero).length).toBe(1);
  for (const p of plan) {
    // Born in the first 60% of the pass (plus a little), from below the bottom inset.
    expect(p.born).toBeLessThanOrEqual(6.4);
    expect(p.y0).toBeGreaterThan(wall.height - wall.bottom);
    const born = riseAt(spec, p, wall, p.born + 0.01, 0);
    const later = riseAt(spec, p, wall, p.born + 2, 0);
    expect(later.y).toBeLessThan(born.y);
    // Blooming in from nothing.
    expect(born.grow).toBeLessThan(0.1);
    expect(later.grow).toBe(1);
    // Gone (faded) by the top.
    const top = riseAt(spec, p, wall, p.born + p.life, 0);
    expect(top.alpha).toBeLessThan(0.05);
    // Invisible before it's born.
    expect(riseAt(spec, p, wall, p.born - 0.1, 0).alpha).toBe(0);
  }
});

test("drift: down from above the top with the wind, turning over", () => {
  const spec: DriftSpec = { archetype: "drift", size, sprites: ["leaf"], count: 12, scale: [0.6, 1], speed: [60, 110], sway: 30, spin: [-1, 1], tumble: 0.8 };
  const plan = driftPlan(spec, wall, seeded(6));
  for (const p of plan) {
    expect(p.y0).toBeLessThan(0);
    const a = driftAt(spec, p, wall, p.born + 1, 0);
    const b = driftAt(spec, p, wall, p.born + 3, 0);
    expect(b.y).toBeGreaterThan(a.y);
    // The shared wind's push moves every one the same.
    expect(driftAt(spec, p, wall, p.born + 1, 50).x - a.x).toBe(50);
  }
  const flips = Array.from({ length: 30 }, (_, i) => driftAt(spec, plan[0], wall, plan[0].born + i * 0.1, 0).flip);
  expect(Math.min(...flips)).toBeLessThan(0);
  // Gone below the bottom.
  expect(driftAt(spec, plan[0], wall, plan[0].born + plan[0].life + 1, 0).alive).toBe(false);
});

test("burst: out of a corner into the screen, slowing, falling, fading; waves from the next corner", () => {
  const spec: BurstSpec = {
    archetype: "burst",
    size,
    sprites: ["bat"],
    count: 18,
    waves: 3,
    from: ["top-left", "top-right", "bottom-left"],
    speed: [300, 500],
    spread: 25,
    gravity: 0,
    drag: 0.3,
    life: [2, 3],
    scale: [0.5, 1],
    flap: 5,
  };
  for (const from of ["top-left", "top-right", "bottom-left", "bottom-right", "left", "right", "top", "bottom"] as const) {
    const o = burstOrigin(from, wall);
    // Just off-screen, heading in.
    const inX = o.x + Math.cos(o.angle) * 100;
    const inY = o.y + Math.sin(o.angle) * 100;
    expect(inX >= 0 && inX <= wall.width && inY >= 0 && inY <= wall.height - wall.bottom, from).toBe(true);
    expect(o.x <= 0 || o.x >= wall.width || o.y <= 0 || o.y >= wall.height - wall.bottom).toBe(true);
  }
  const plan = burstPlan(spec, wall, seeded(7));
  expect(plan.length).toBe(18);
  // Three waves, from three corners.
  expect(new Set(plan.map((p) => `${p.x0},${p.y0}`)).size).toBe(3);
  for (const p of plan) {
    const a = burstAt(spec, p, p.born + 0.5, 0);
    const b = burstAt(spec, p, p.born + 1.0, 0);
    const c = burstAt(spec, p, p.born + 1.5, 0);
    // Moving in, slowing down (drag).
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(Math.hypot(c.x - b.x, c.y - b.y));
    // Bats flap.
    expect(a.flip).toBeLessThanOrEqual(1);
    expect(burstAt(spec, p, p.born + p.life + 0.01, 0).alive).toBe(false);
  }
  // With gravity, confetti falls.
  const confetti: BurstSpec = { ...spec, gravity: 300, flap: undefined };
  const p = burstPlan(confetti, wall, seeded(8))[0];
  expect(burstAt(confetti, p, p.born + 2, 0).y).toBeGreaterThan(burstAt({ ...confetti, gravity: 0 }, p, p.born + 2, 0).y);
});

test("fireworks: rockets from the bottom, bursting over and around the clock, left and right by turns, all within the pass", () => {
  const spec: FireworksSpec = { archetype: "fireworks", size, colors: ["#FFD24A", "#FF6B8B"], shells: 7, radius: 130, over: "clock" };
  const shells = fireworksPlan(spec, wall, seeded(9));
  expect(shells.length).toBe(7);
  const clock = wall.clock!;
  for (const [i, s] of shells.entries()) {
    expect(s.y0).toBe(wall.height - wall.bottom);
    // Over the clock: across its width, its burst no lower than the clock's middle.
    expect(s.cx).toBeGreaterThanOrEqual(clock.x - 1);
    expect(s.cx).toBeLessThanOrEqual(clock.x + clock.w + 1);
    expect(s.cy).toBeLessThanOrEqual(clock.y + clock.h / 2);
    // Left and right of its middle by turns.
    expect(Math.sign(s.cx - (clock.x + clock.w / 2))).toBe(i % 2 === 0 ? -1 : 1);
    // The rocket climbs, the burst opens and fades, all inside the pass.
    expect(shellAt(s, s.launch - 0.01)).toBeNull();
    const climbing = shellAt(s, s.launch + 0.3)!;
    expect(climbing.rocket!.y).toBeLessThan(s.y0);
    expect(climbing.rocket!.y).toBeGreaterThan(s.cy);
    const open = shellAt(s, s.burst + 0.6)!;
    expect(open.rocket).toBeNull();
    expect(open.open).toBeCloseTo(1, 1);
    expect(shellAt(s, s.burst + BURST_S - 0.05)!.alpha).toBeLessThan(0.1);
    expect(s.burst + BURST_S).toBeLessThanOrEqual(PASS_MS / 1000 + 0.35);
  }
  // No clock on this screen: over the top of the screen.
  for (const s of fireworksPlan(spec, phone, seeded(10))) expect(s.cy).toBeLessThan(phone.height * 0.6);
});

test("arc: drawn in from the left foot, held, faded; its feet above the navigation bar", () => {
  const spec: ArcSpec = { archetype: "arc", size, sprite: "rainbow", span: 0.7, grow: 2500, hold: 5000, fade: 1500 };
  const plan = arcPlan(spec, wall, seeded(11));
  expect(plan.radius).toBeCloseTo((wall.width * 0.7) / 2);
  expect(plan.cy).toBeLessThanOrEqual(wall.height - wall.bottom);
  expect(arcAt(spec, 0)).toEqual({ reveal: 0, alpha: 1, done: false });
  expect(arcAt(spec, 1250).reveal).toBeGreaterThan(0.5);
  expect(arcAt(spec, 2500).reveal).toBe(1);
  expect(arcAt(spec, 7000).alpha).toBe(1);
  expect(arcAt(spec, 8250).alpha).toBeCloseTo(0.5);
  expect(arcAt(spec, 9000).done).toBe(true);
});

test("every kit's visitor is a known archetype with what it needs", () => {
  for (const kit of Object.values(FESTIVAL_KITS)) {
    const v = kit?.visitor;
    if (!v) continue;
    expect(["fly", "walk", "rise", "drift", "burst", "fireworks", "arc"], kit!.id).toContain(v.archetype);
    if (v.every !== undefined) expect(v.every, kit!.id).toBeGreaterThanOrEqual(15_000);
    if (v.archetype === "fireworks") expect(v.colors.length, kit!.id).toBeGreaterThan(0);
  }
});
