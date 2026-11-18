/**
 * The children's creatures on Home (Settings -> Creatures -> On Home): how
 * they walk, rest, hop, play with each other and go to bed, along a floor
 * just above the navigation. Pure: no React, no timers, the random source
 * passed in, so every rule here is in the fast suite; the drawing is
 * components/home/creatures-on-home.tsx.
 *
 * Positions are the centre of each creature, in pixels from the floor's left
 * end; `dir` is the way it faces (1 right, -1 left).
 *
 * Platforms: on Home, now and then a creature jumps up onto the top edge of a
 * widget card, walks along it, perhaps hops across to the next card, and
 * jumps back down. `y` is how high its feet are above the floor (the card's
 * top while it is up there); the arc of a jump is the drawing's (pose()).
 */

export type RoamState =
  | "egg" // stage 1: an egg stays where it is and wobbles now and then
  | "idle" // standing, looking around
  | "walk" // to `target`
  | "hop" // one hop, on the spot (a tap, or for joy)
  | "approach" // walking to a friend to play
  | "play" // with `partner`: hopping in turns, facing each other
  | "flee" // running from `partner`, who chases
  | "chase"
  | "toBed" // walking to its bed spot
  | "asleep" // lying down
  | "waking" // getting up, a moment before walking again
  | "jump"; // through the air, onto a card or back down (`jump`)

/** A widget card's top edge, in the floor's pixels: `top` is its height above the floor. */
export interface Platform {
  id: string;
  left: number;
  right: number;
  top: number;
}

/** A jump under way: from where, to where (a platform's id, or null for the floor), and when. */
export interface Jump {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  to: string | null;
  start: number;
  ms: number;
}

/** Where a walk ends in a jump: the landing spot, on a platform or the floor. */
export interface JumpPlan {
  x: number;
  top: number;
  to: string | null;
}

export interface Roamer {
  id: string;
  x: number;
  dir: 1 | -1;
  state: RoamState;
  /** When the state ends, ms (idle, hop, play, flee, chase, waking). */
  until: number;
  /** When the state began, ms: the drawing times its hops and turns from it. */
  since: number;
  target: number;
  partner: string | null;
  egg: boolean;
  /** Feet above the floor, px: 0 on the floor, a card's top on one. */
  y?: number;
  /** The platform it stands on, or null on the floor. */
  on?: string | null;
  /** A walk that ends in a jump. */
  plan?: JumpPlan | null;
  jump?: Jump | null;
}

export interface World {
  /** The floor's width, px. */
  width: number;
  /** A creature's drawn size, px. */
  size: number;
  now: number;
  /** Ids whose creature should be asleep now (the family's bedtime). */
  sleeping: ReadonlySet<string>;
  /** The cards it may jump onto (Home); none on the idle screen. */
  platforms?: readonly Platform[];
}

/** Something the drawing shows once: hearts over a creature, a heart between two playing. */
export interface RoamEvent {
  kind: "hearts";
  x: number;
  count: number;
}

export const WALK_PX_PER_S = 38;
export const RUN_PX_PER_S = 110;
export const BED_PX_PER_S = 24;
export const HOP_MS = 650;
export const PLAY_MS = 3200;
export const CHASE_MS = 2600;
export const WAKE_MS = 1600;
/** How likely, on finishing a rest, a creature goes to find a friend (with one free). */
export const PLAY_CHANCE = 0.3;
/** How likely it hops for joy instead of walking on. */
export const HOP_CHANCE = 0.15;
/** How far apart two play, in creature widths. */
export const PLAY_GAP = 0.75;
/** Of the walks a creature on the floor sets off on, how many go up onto a card (with one in reach). */
export const VISIT_CHANCE = 0.2;
/** How likely, on finishing a rest up on a card, it leaves (down, or across to the next card). */
export const LEAVE_CHANCE = 0.4;
/** Of those, how many hop across to a neighbouring card instead of down. */
export const ACROSS_CHANCE = 0.5;
/** A jump's time: a base, more the further it goes, and a cap. */
export const JUMP_MS = 520;
export const JUMP_MS_PER_PX = 0.9;
export const JUMP_MAX_MS = 1300;

const free = (r: Roamer) => (r.state === "idle" || r.state === "walk") && !r.on && !r.plan;

/** Where a creature's feet may stand on a platform: clear of the card's rounded corners. */
export function platformBounds(p: Platform, size: number): [number, number] {
  return [p.left + size * 0.6, p.right - size * 0.6];
}

/** Whether a card can take a creature at all. */
const roomy = (p: Platform, size: number) => {
  const [lo, hi] = platformBounds(p, size);
  return hi > lo;
};

/** A neighbour a creature can hop across to: about level, and a short gap away. */
export function across(from: Platform, platforms: readonly Platform[], size: number): Platform[] {
  return platforms.filter(
    (p) =>
      p.id !== from.id &&
      roomy(p, size) &&
      Math.abs(p.top - from.top) <= size * 2.5 &&
      Math.max(p.left - from.right, from.left - p.right) <= size * 3,
  );
}

function startJump(r: Roamer, toX: number, toY: number, to: string | null, now: number) {
  const fromY = r.y ?? 0;
  const dist = Math.hypot(toX - r.x, toY - fromY);
  const ms = Math.min(JUMP_MAX_MS, JUMP_MS + dist * JUMP_MS_PER_PX);
  r.jump = { fromX: r.x, fromY, toX, toY, to, start: now, ms };
  r.on = null;
  r.plan = null;
  if (toX !== r.x) r.dir = toX > r.x ? 1 : -1;
  set(r, "jump", now, now + ms);
}

/** Where each creature sleeps: spread evenly along the floor, in the order given. */
export function bedSpots(count: number, width: number): number[] {
  return Array.from({ length: count }, (_, i) => (width * (i + 1)) / (count + 1));
}

/** The floor's ends, so a creature never walks off the screen. */
export function bounds(world: Pick<World, "width" | "size">): [number, number] {
  const half = world.size / 2;
  return [half, Math.max(half, world.width - half)];
}

/** New creatures on the floor: each at its bed spot, eggs included, resting a moment first. */
export function placeRoamers(ids: ReadonlyArray<{ id: string; egg: boolean }>, world: Pick<World, "width" | "size" | "now">): Roamer[] {
  const beds = bedSpots(ids.length, world.width);
  return ids.map(({ id, egg }, i) => ({
    id,
    x: beds[i],
    dir: i % 2 === 0 ? 1 : -1,
    state: egg ? "egg" : "idle",
    until: world.now + 800 + i * 500,
    since: world.now,
    target: beds[i],
    partner: null,
    egg,
  }));
}

/** Move `x` toward `target` at `speed`; true once there. */
function move(r: Roamer, target: number, speed: number, dt: number): boolean {
  const step = (speed * dt) / 1000;
  const gap = target - r.x;
  if (Math.abs(gap) <= step) {
    r.x = target;
    return true;
  }
  r.dir = gap > 0 ? 1 : -1;
  r.x += Math.sign(gap) * step;
  return false;
}

function set(r: Roamer, state: RoamState, now: number, until = 0) {
  r.state = state;
  r.since = now;
  r.until = until;
}

/**
 * One step of `dt` ms for every creature: a new array of new objects (the
 * input is left as it was) and the events the drawing shows.
 */
export function stepRoamers(
  input: readonly Roamer[],
  world: World,
  dt: number,
  rng: () => number,
): { roamers: Roamer[]; events: RoamEvent[] } {
  const now = world.now;
  const [lo, hi] = bounds(world);
  const beds = bedSpots(input.length, world.width);
  const roamers = input.map((r) => ({ ...r }));
  const byId = new Map(roamers.map((r) => [r.id, r]));
  const events: RoamEvent[] = [];

  const release = (r: Roamer) => {
    const p = r.partner ? byId.get(r.partner) : undefined;
    r.partner = null;
    if (p && p.partner === r.id) {
      p.partner = null;
      if (!["toBed", "asleep", "egg"].includes(p.state)) set(p, "idle", now, now + 1500 + rng() * 2500);
    }
  };

  const platforms = world.platforms ?? [];

  roamers.forEach((r, i) => {
    r.x = Math.min(hi, Math.max(lo, r.x));
    const bed = Math.min(hi, Math.max(lo, beds[i]));
    if (r.egg) {
      // An egg stays at its spot: wobbling now and then, asleep at bedtime.
      const sleeps = world.sleeping.has(r.id);
      if (sleeps && r.state !== "asleep") set(r, "asleep", now);
      else if (!sleeps && r.state !== "egg") set(r, "egg", now);
      r.x = bed;
      return;
    }

    // In the air: along the jump, onto a card that is still there (and where it is now).
    if (r.state === "jump" && r.jump) {
      const j = r.jump;
      if (j.to) {
        const p = platforms.find((q) => q.id === j.to);
        if (p) j.toY = p.top;
        else {
          j.to = null;
          j.toY = 0;
          j.toX = Math.min(hi, Math.max(lo, j.toX));
        }
      }
      const k = Math.min(1, (now - j.start) / j.ms);
      r.x = j.fromX + (j.toX - j.fromX) * k;
      r.y = j.fromY + (j.toY - j.fromY) * k;
      if (k >= 1) {
        r.x = j.toX;
        r.y = j.toY;
        r.on = j.to;
        r.jump = null;
        set(r, "idle", now, now + 600 + rng() * 1400);
      }
      return;
    }
    // Up on a card: riding it as the page moves; when it goes (scrolled away,
    // a widget switched off), down to the floor.
    let stand: Platform | undefined;
    if (r.on) {
      stand = platforms.find((q) => q.id === r.on);
      if (!stand || !roomy(stand, world.size)) {
        if (r.partner) release(r);
        startJump(r, Math.min(hi, Math.max(lo, r.x)), 0, null, now);
        return;
      }
      r.y = stand.top;
      const [plo, phi] = platformBounds(stand, world.size);
      r.x = Math.min(phi, Math.max(plo, r.x));
    }

    // Bedtime wins over everything: go to bed, lie down; in the morning, get up.
    if (world.sleeping.has(r.id)) {
      if (stand) {
        // Down from the card first.
        startJump(r, Math.min(hi, Math.max(lo, r.x + r.dir * world.size * 0.8)), 0, null, now);
        return;
      }
      if (r.plan) r.plan = null;
      if (r.state === "asleep") return;
      if (r.partner) release(r);
      if (r.state !== "toBed") set(r, "toBed", now);
      r.target = bed;
      if (move(r, bed, BED_PX_PER_S, dt)) set(r, "asleep", now);
      return;
    }
    if (r.state === "asleep" || r.state === "toBed") {
      set(r, "waking", now, now + WAKE_MS);
      return;
    }

    switch (r.state) {
      case "walk":
        if (move(r, r.target, WALK_PX_PER_S, dt)) {
          // A walk to the take-off spot ends in the jump, if the card is still there.
          const plan = r.plan;
          r.plan = null;
          const landing = plan?.to ? platforms.find((q) => q.id === plan.to) : undefined;
          if (plan && (plan.to === null || landing)) startJump(r, plan.x, landing ? landing.top : 0, plan.to, now);
          else set(r, "idle", now, now + 2000 + rng() * 4000);
        }
        break;
      case "hop":
      case "waking":
        if (now >= r.until) set(r, "idle", now, now + 1000 + rng() * 2000);
        break;
      case "approach": {
        const p = r.partner ? byId.get(r.partner) : undefined;
        if (!p || p.partner !== r.id) {
          r.partner = null;
          set(r, "idle", now, now + 1000);
          break;
        }
        // Walk to just beside the friend, on this side unless that is off the
        // floor, then play, both of them: side by side, never on top of each other.
        const gap = world.size * PLAY_GAP;
        const near = p.x >= r.x ? p.x - gap : p.x + gap;
        const spot = near < lo || near > hi ? (near < lo ? p.x + gap : p.x - gap) : near;
        if (move(r, spot, WALK_PX_PER_S * 1.4, dt)) {
          for (const c of [r, p]) {
            set(c, "play", now, now + PLAY_MS);
            c.dir = c === r ? (p.x >= r.x ? 1 : -1) : p.x >= r.x ? -1 : 1;
          }
          events.push({ kind: "hearts", x: (r.x + p.x) / 2, count: 4 });
        }
        break;
      }
      case "play": {
        const p = r.partner ? byId.get(r.partner) : undefined;
        if (!p) {
          release(r);
          set(r, "idle", now, now + 1500);
          break;
        }
        if (now >= r.until && r.id < p.id) {
          // Half the time a game of chase follows; the other half, both rest.
          if (rng() < 0.5) {
            set(r, "flee", now, now + CHASE_MS);
            set(p, "chase", now, now + CHASE_MS);
            r.target = r.x < (lo + hi) / 2 ? hi - rng() * world.size : lo + rng() * world.size;
          } else {
            release(r);
            set(r, "idle", now, now + 2000 + rng() * 3000);
          }
        }
        break;
      }
      case "flee":
        if (move(r, r.target, RUN_PX_PER_S, dt) || now >= r.until) {
          const p = r.partner ? byId.get(r.partner) : undefined;
          if (p) events.push({ kind: "hearts", x: (r.x + p.x) / 2, count: 3 });
          release(r);
          set(r, "idle", now, now + 2000 + rng() * 3000);
        }
        break;
      case "chase": {
        const p = r.partner ? byId.get(r.partner) : undefined;
        if (!p || p.state !== "flee") {
          if (r.partner) release(r);
          if (r.state === "chase") set(r, "idle", now, now + 2000);
          break;
        }
        move(r, p.x - p.dir * world.size * 0.6, RUN_PX_PER_S * 0.92, dt);
        break;
      }
      case "idle":
      default: {
        if (r.state !== "idle") set(r, "idle", now, now + 1500);
        if (now < r.until) break;
        if (stand) {
          // Up on a card: look around, walk along it, hop, and after a while leave.
          const [plo, phi] = platformBounds(stand, world.size);
          const roll = rng();
          if (roll < LEAVE_CHANCE) {
            const next = across(stand, platforms, world.size);
            if (next.length > 0 && rng() < ACROSS_CHANCE) {
              const q = next[Math.floor(rng() * next.length)];
              const [qlo, qhi] = platformBounds(q, world.size);
              // From the end nearer the other card, to its near end.
              const right = q.left > stand.left;
              r.target = right ? phi : plo;
              r.plan = { x: right ? qlo : qhi, top: q.top, to: q.id };
            } else {
              // Off the nearer end, down to the floor beside it.
              const right = r.x - plo > phi - r.x;
              r.target = right ? phi : plo;
              const land = r.target + (right ? 1 : -1) * world.size * 0.9;
              r.plan = { x: Math.min(hi, Math.max(lo, land)), top: 0, to: null };
            }
            set(r, "walk", now);
          } else if (roll < LEAVE_CHANCE + HOP_CHANCE) {
            set(r, "hop", now, now + HOP_MS);
          } else {
            r.target = plo + rng() * (phi - plo);
            set(r, "walk", now);
          }
          break;
        }
        const friends = roamers.filter((o) => o !== r && !o.egg && !o.partner && free(o) && !world.sleeping.has(o.id));
        const roll = rng();
        if (friends.length > 0 && roll < PLAY_CHANCE) {
          const p = friends[Math.floor(rng() * friends.length)];
          r.partner = p.id;
          p.partner = r.id;
          set(r, "approach", now);
          set(p, "idle", now, now + 60_000); // waits for its friend
        } else if (roll < PLAY_CHANCE + HOP_CHANCE) {
          set(r, "hop", now, now + HOP_MS);
        } else {
          r.target = lo + rng() * (hi - lo);
          set(r, "walk", now);
          // Now and then the walk is to the foot of a card, and up onto it.
          const cards = platforms.filter((q) => roomy(q, world.size));
          if (cards.length > 0 && rng() < VISIT_CHANCE) {
            const q = cards[Math.floor(rng() * cards.length)];
            const [qlo, qhi] = platformBounds(q, world.size);
            const land = qlo + rng() * (qhi - qlo);
            // Take off a little to the side it comes from.
            const off = land + (r.x < land ? -1 : 1) * world.size * 0.9;
            r.target = Math.min(hi, Math.max(lo, off));
            r.plan = { x: land, top: q.top, to: q.id };
          }
        }
      }
    }
  });
  return { roamers, events };
}

/** A tap: an awake creature hops and sends up hearts; one asleep stays asleep, with a single heart. */
export function poke(input: readonly Roamer[], id: string, now: number): { roamers: Roamer[]; events: RoamEvent[] } {
  const roamers = input.map((r) => ({ ...r }));
  const r = roamers.find((x) => x.id === id);
  if (!r) return { roamers, events: [] };
  if (r.state === "asleep" || r.state === "toBed" || r.egg) return { roamers, events: [{ kind: "hearts", x: r.x, count: 1 }] };
  // In the air: it lands first; a heart on the way.
  if (r.state === "jump") return { roamers, events: [{ kind: "hearts", x: r.x, count: 1 }] };
  // A tap cancels a walk to a card: the hop is right here.
  r.plan = null;
  if (r.partner) {
    const p = roamers.find((x) => x.id === r.partner);
    if (p && p.partner === r.id) {
      p.partner = null;
      set(p, "idle", now, now + 1500);
    }
    r.partner = null;
  }
  set(r, "hop", now, now + HOP_MS);
  return { roamers, events: [{ kind: "hearts", x: r.x, count: 5 }] };
}

/** How the drawing poses a creature this frame: lift off the floor (px), lean (deg), and lying down. */
export function pose(r: Roamer, now: number, size: number): { lift: number; tilt: number; lying: boolean } {
  const t = now - r.since;
  const hop = (ms: number, height: number) => {
    const k = (t % ms) / ms;
    return Math.sin(Math.PI * k) * height;
  };
  switch (r.state) {
    case "walk":
    case "approach":
      return { lift: Math.abs(Math.sin(t / 140)) * size * 0.05, tilt: Math.sin(t / 140) * 4, lying: false };
    case "flee":
    case "chase":
      return { lift: Math.abs(Math.sin(t / 90)) * size * 0.09, tilt: Math.sin(t / 90) * 6, lying: false };
    case "toBed":
      return { lift: Math.abs(Math.sin(t / 220)) * size * 0.03, tilt: Math.sin(t / 220) * 2, lying: false };
    case "hop":
      return { lift: t < HOP_MS ? hop(HOP_MS, size * 0.35) : 0, tilt: 0, lying: false };
    case "play": {
      // Hopping in turns: the two are half a hop apart.
      const offset = r.id < (r.partner ?? "") ? 0 : 400;
      return { lift: hop(800, size * 0.28) * (((t + offset) % 1600) < 800 ? 1 : 0.15), tilt: 0, lying: false };
    }
    case "egg": {
      // A wobble every few seconds.
      const k = t % 5000;
      return { lift: 0, tilt: k < 700 ? Math.sin((k / 700) * Math.PI * 4) * 8 : 0, lying: false };
    }
    case "jump": {
      // The arc over the line between the two surfaces: higher going up, a
      // little lean into it.
      const j = r.jump;
      if (!j) return { lift: 0, tilt: 0, lying: false };
      const k = Math.min(1, Math.max(0, (now - j.start) / j.ms));
      const height = size * 0.4 + Math.max(0, j.toY - j.fromY) * 0.15;
      return { lift: 4 * k * (1 - k) * height, tilt: (k - 0.5) * 14, lying: false };
    }
    case "asleep":
      return { lift: 0, tilt: 0, lying: true };
    default:
      return { lift: 0, tilt: 0, lying: false };
  }
}
