import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_BEDTIME, creatureMood, formatClock, isSleepyTime, parseClock, readBedtime } from "../src/lib/creature-mood";
import {
  HOP_MS,
  PLAY_GAP,
  PLAY_MS,
  across,
  bedSpots,
  bounds,
  platformBounds,
  placeRoamers,
  poke,
  pose,
  stepRoamers,
  type Platform,
  type Roamer,
  type World,
} from "../src/lib/creatures/roam";
import { codeOnly } from "./source-helpers";

/**
 * Creatures on Home: the family's bedtime (lib/creature-mood.ts) and how the
 * creatures walk, play, hop and sleep (lib/creatures/roam.ts), driven step by
 * step with a seeded random source; and how Home, the settings page and the
 * mood hook fit together. creatures-on-home-ui.spec.ts drives the real page.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const at = (hhmm: string) => new Date(`2026-11-05T${hhmm}:00Z`);

/** A small seeded generator, so a run is the same every time. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run the floor for `ms`, 33 ms a step; every step's creatures and events. */
function run(start: Roamer[], world: Omit<World, "now">, ms: number, seed = 7, t0 = 0) {
  const rng = seeded(seed);
  let roamers = start;
  const frames: Roamer[][] = [];
  const events = [];
  for (let now = t0; now < t0 + ms; now += 33) {
    const out = stepRoamers(roamers, { ...world, now }, 33, rng);
    roamers = out.roamers;
    events.push(...out.events);
    frames.push(roamers);
  }
  return { roamers, frames, events };
}

const floor = { width: 1200, size: 80, sleeping: new Set<string>() };
const two = () => placeRoamers([{ id: "a", egg: false }, { id: "b", egg: false }], { ...floor, now: 0 });

test("bedtime: 20:00 to 06:30 unless chosen, across midnight or within a day, and none when both are the same", () => {
  expect(DEFAULT_BEDTIME).toEqual({ sleep: 20 * 60, wake: 6 * 60 + 30 });
  expect(isSleepyTime(at("19:59"), "UTC")).toBe(false);
  expect(isSleepyTime(at("20:00"), "UTC")).toBe(true);
  expect(isSleepyTime(at("06:29"), "UTC")).toBe(true);
  expect(isSleepyTime(at("06:30"), "UTC")).toBe(false);
  const late = { sleep: parseClock("21:30")!, wake: parseClock("07:15")! };
  expect(isSleepyTime(at("21:00"), "UTC", late)).toBe(false);
  expect(isSleepyTime(at("23:59"), "UTC", late)).toBe(true);
  expect(isSleepyTime(at("07:00"), "UTC", late)).toBe(true);
  expect(isSleepyTime(at("07:15"), "UTC", late)).toBe(false);
  const nap = { sleep: parseClock("13:00")!, wake: parseClock("15:00")! };
  expect(isSleepyTime(at("12:59"), "UTC", nap)).toBe(false);
  expect(isSleepyTime(at("14:00"), "UTC", nap)).toBe(true);
  expect(isSleepyTime(at("15:00"), "UTC", nap)).toBe(false);
  expect(isSleepyTime(at("03:00"), "UTC", { sleep: 600, wake: 600 })).toBe(false);
  // In the family's zone: 20:00 UTC is 21:00 in Berlin in November.
  expect(isSleepyTime(at("19:30"), "Europe/Berlin", { sleep: parseClock("20:30")!, wake: parseClock("06:00")! })).toBe(true);
  // The mood follows it.
  expect(creatureMood({ personId: "p", tasks: [], now: at("14:00"), timeZone: "UTC", bedtime: nap })).toBe("sleepy");
  expect(creatureMood({ personId: "p", tasks: [], now: at("21:00"), timeZone: "UTC", bedtime: nap })).toBe("normal");
});

test("the stored bedtime is read whole and valid, or it is the default", () => {
  expect(readBedtime({ sleep: "21:30", wake: "07:15" })).toEqual({ sleep: 21 * 60 + 30, wake: 7 * 60 + 15 });
  for (const bad of [null, "21:30", { sleep: "25:00", wake: "07:00" }, { sleep: "21:30" }, { sleep: "9:30", wake: "07:00" }]) {
    expect(readBedtime(bad), JSON.stringify(bad)).toEqual(DEFAULT_BEDTIME);
  }
  expect(formatClock(0)).toBe("00:00");
  expect(formatClock(23 * 60 + 59)).toBe("23:59");
  expect(formatClock(-30)).toBe("23:30");
  expect(parseClock(" 06:05 ")).toBe(365);
});

test("on the floor: each at its own spot, and never past either end however long they walk", () => {
  expect(bedSpots(3, 1200)).toEqual([300, 600, 900]);
  const placed = placeRoamers(
    [{ id: "a", egg: false }, { id: "b", egg: false }, { id: "c", egg: false }],
    { ...floor, now: 0 },
  );
  expect(placed.map((r) => r.x)).toEqual([300, 600, 900]);
  const [lo, hi] = bounds(floor);
  const { frames } = run(placed, floor, 120_000);
  for (const f of frames) for (const r of f) expect(r.x >= lo && r.x <= hi, `${r.id} at ${r.x}`).toBe(true);
  // They do walk: each one has been somewhere else.
  for (const id of ["a", "b", "c"]) {
    const xs = frames.map((f) => f.find((r) => r.id === id)!.x);
    expect(Math.max(...xs) - Math.min(...xs), id).toBeGreaterThan(100);
  }
});

test("a floor that shrinks (the screen turned): every creature is back on it at once", () => {
  const wide = placeRoamers(
    [{ id: "a", egg: false }, { id: "b", egg: false }, { id: "c", egg: false }],
    { ...floor, now: 0 },
  );
  const narrow = { ...floor, width: 500 };
  const [lo, hi] = bounds(narrow);
  const { roamers } = stepRoamers(wide, { ...narrow, now: 0 }, 33, seeded(1));
  for (const r of roamers) expect(r.x >= lo && r.x <= hi, `${r.id} at ${r.x}`).toBe(true);
});

test("an egg stays at its spot and wobbles; it never walks or plays, and at bedtime sleeps where it is", () => {
  const start = placeRoamers([{ id: "egg", egg: true }, { id: "b", egg: false }], { ...floor, now: 0 });
  const { frames } = run(start, floor, 60_000);
  for (const f of frames) {
    const e = f.find((r) => r.id === "egg")!;
    expect(e.state).toBe("egg");
    expect(e.x).toBe(400);
    expect(e.partner).toBeNull();
  }
  const egg = frames[0].find((r) => r.id === "egg")!;
  expect(Math.abs(pose({ ...egg, since: 0 }, 300, 80).tilt)).toBeGreaterThan(0);
  // Bedtime: asleep at its spot, no wobble; a tap there gives one heart and leaves it asleep.
  const night = run(start, { ...floor, sleeping: new Set(["egg", "b"]) }, 5_000).roamers;
  const asleep = night.find((r) => r.id === "egg")!;
  expect(asleep.state).toBe("asleep");
  expect(asleep.x).toBe(400);
  expect(pose(asleep, 6_000, 80)).toEqual({ lift: 0, tilt: 0, lying: true });
  const tapped = poke(night, "egg", 6_000);
  expect(tapped.roamers.find((r) => r.id === "egg")!.state).toBe("asleep");
  expect(tapped.events).toEqual([{ kind: "hearts", x: 400, count: 1 }]);
  // Morning: an egg again, wobbling.
  expect(run(night, floor, 1_000, 7, 6_000).roamers.find((r) => r.id === "egg")!.state).toBe("egg");
  // Drawn upright, dimmed, with the z's: an egg is not turned on its side.
  const home = codeOnly(read("src/components/creatures-on-home.tsx"));
  expect(home).toContain("sleepingRef.current = bedtimeNow ? new Set(cast.map((c) => c.person.id)) : new Set();");
  expect(home).toMatch(/el\.inner\.style\.transform = r\.egg\s*\?[^:]*`scaleX\(\$\{r\.dir\}\) rotate\(\$\{p\.tilt\.toFixed\(1\)\}deg\)`/);
  expect(home).toContain('data-egg={tier === 1 ? "true" : "false"}');
});

test("two or more: they find each other and play, with hearts, and only with a free friend", () => {
  const { frames, events } = run(two(), floor, 180_000, 3);
  const playing = frames.filter((f) => f.every((r) => r.state === "play"));
  expect(playing.length).toBeGreaterThan(0);
  const f = playing[0];
  // Facing each other, side by side: close, never on top of each other.
  const [a, b] = f;
  expect(Math.abs(a.x - b.x)).toBeCloseTo(80 * PLAY_GAP, 0);
  expect(a.dir).toBe(a.x < b.x ? 1 : -1);
  expect(b.dir).toBe(b.x < a.x ? 1 : -1);
  expect(a.partner).toBe("b");
  expect(events.some((e) => e.kind === "hearts")).toBe(true);
  // A game ends: nobody plays for ever.
  const longest = Math.max(...frames.map((_, i) => {
    let n = 0;
    while (frames[i + n]?.[0].state === "play") n++;
    return n;
  }));
  expect(longest * 33).toBeLessThanOrEqual(PLAY_MS + 200);
  // Alone, nobody to play with.
  const alone = run(placeRoamers([{ id: "a", egg: false }], { ...floor, now: 0 }), floor, 120_000, 3);
  expect(alone.frames.some((fr) => fr[0].state === "play" || fr[0].state === "approach")).toBe(false);
});

test("a game starts side by side: a friend passed on the way is walked back from, one at the edge is played with from the other side", () => {
  const world = { ...floor, now: 0 };
  const [lo, hi] = bounds(floor);
  const gap = 80 * PLAY_GAP;
  for (const [ax, bx, side] of [
    [600, 610, -1], // nearly on top of each other: steps back to beside it first
    [lo, lo + 20, 1], // the friend near the left end, this one between it and the end: walks past, plays from its right
    [hi, hi - 20, -1], // and at the right end: from its left
  ] as const) {
    let roamers: Roamer[] = [
      { ...placeRoamers([{ id: "a", egg: false }], world)[0], x: ax, state: "approach", partner: "b", since: 0, until: 0 },
      { ...placeRoamers([{ id: "b", egg: false }], world)[0], x: bx, state: "idle", partner: "a", since: 0, until: 60_000 },
    ];
    const rng = seeded(2);
    let now = 0;
    while (roamers[0].state === "approach" && now < 20_000) {
      const out = stepRoamers(roamers, { ...floor, now }, 33, rng);
      roamers = out.roamers;
      now += 33;
    }
    const [a, b] = roamers;
    expect(a.state, `${ax}/${bx}`).toBe("play");
    expect(a.x - b.x, `${ax}/${bx}`).toBeCloseTo(side * gap, 0);
  }
});

test("bedtime: each walks to its own spot and lies down; in the morning it gets up and goes on", () => {
  const night = { ...floor, sleeping: new Set(["a", "b"]) };
  const awake = run(two(), floor, 20_000, 5).roamers;
  const { roamers } = run(awake, night, 60_000, 5, 20_000);
  const beds = bedSpots(2, 1200);
  roamers.forEach((r, i) => {
    expect(r.state).toBe("asleep");
    expect(r.x).toBe(beds[i]);
    expect(r.partner).toBeNull();
    expect(pose(r, 90_000, 80).lying).toBe(true);
  });
  // Still asleep however long the night.
  expect(run(roamers, night, 30_000, 5, 80_000).roamers.every((r) => r.state === "asleep")).toBe(true);
  // Morning: up, then about their day.
  const morning = run(roamers, floor, 1_000, 5, 110_000).roamers;
  expect(morning.every((r) => r.state === "waking")).toBe(true);
  const later = run(morning, floor, 20_000, 5, 111_000).frames;
  expect(later.some((f) => f.some((r) => r.state === "walk"))).toBe(true);
});

test("a tap: an awake creature hops with hearts and leaves its game; one asleep stays asleep with one heart", () => {
  const playing = run(two(), floor, 180_000, 3).frames.find((f) => f.every((r) => r.state === "play"))!;
  const tapped = poke(playing, "a", 1000);
  const a = tapped.roamers.find((r) => r.id === "a")!;
  const b = tapped.roamers.find((r) => r.id === "b")!;
  expect(a.state).toBe("hop");
  expect(a.until).toBe(1000 + HOP_MS);
  expect(a.partner).toBeNull();
  expect(b.partner).toBeNull();
  expect(b.state).toBe("idle");
  expect(tapped.events).toEqual([{ kind: "hearts", x: a.x, count: 5 }]);
  expect(pose(a, 1000 + HOP_MS / 2, 80).lift).toBeGreaterThan(20);
  const asleep = run(two(), { ...floor, sleeping: new Set(["a", "b"]) }, 10_000).roamers;
  const tappedAsleep = poke(asleep, "a", 20_000);
  expect(tappedAsleep.roamers.find((r) => r.id === "a")!.state).toBe("asleep");
  expect(tappedAsleep.events).toEqual([{ kind: "hearts", x: asleep[0].x, count: 1 }]);
  // The input is left as it was.
  expect(playing.find((r) => r.id === "a")!.state).toBe("play");
});

/** Two cards side by side in a row, and one higher up on its own. */
const cards: Platform[] = [
  { id: "c1", left: 40, right: 400, top: 300 },
  { id: "c2", left: 424, right: 784, top: 300 },
  { id: "c3", left: 820, right: 1160, top: 620 },
];
const withCards = { ...floor, platforms: cards };

test("cards: now and then one jumps up, walks along the top edge inside it, and comes back down", () => {
  const { frames } = run(two(), withCards, 10 * 60_000, 11);
  let ups = 0;
  let downs = 0;
  for (let i = 1; i < frames.length; i++) {
    for (const r of frames[i]) {
      const before = frames[i - 1].find((o) => o.id === r.id)!;
      if (!before.on && r.on) ups++;
      if (before.state === "jump" && r.state !== "jump" && !r.on) downs++;
      if (r.on) {
        const card = cards.find((c) => c.id === r.on)!;
        const [lo, hi] = platformBounds(card, floor.size);
        expect(r.y).toBe(card.top);
        expect(r.x).toBeGreaterThanOrEqual(lo);
        expect(r.x).toBeLessThanOrEqual(hi);
        // Never playing up there: games are on the floor.
        expect(r.partner).toBeNull();
      } else if (r.state !== "jump") {
        expect(r.y ?? 0).toBe(0);
      }
    }
  }
  // Occasional: some visits in ten minutes, not a life on the cards.
  expect(ups).toBeGreaterThan(2);
  expect(downs).toBeGreaterThan(1);
  const upFrames = frames.reduce((n, f) => n + f.filter((r) => r.on).length, 0);
  expect(upFrames / (frames.length * 2)).toBeLessThan(0.5);
});

test("cards: across to a neighbour about level, never to one far up", () => {
  expect(across(cards[0], cards, floor.size).map((c) => c.id)).toEqual(["c2"]);
  expect(across(cards[2], cards, floor.size)).toEqual([]);
  const { frames } = run(two(), withCards, 20 * 60_000, 5);
  let hopsAcross = 0;
  for (let i = 1; i < frames.length; i++) {
    for (const r of frames[i]) {
      const before = frames[i - 1].find((o) => o.id === r.id)!;
      if (before.on && r.state === "jump" && r.jump?.to) {
        hopsAcross++;
        expect(r.jump.to).not.toBe(before.on);
        expect([before.on, r.jump.to].sort()).toEqual(["c1", "c2"]);
      }
    }
  }
  expect(hopsAcross).toBeGreaterThan(0);
});

test("cards: none at all, and they behave as before (the same steps from the same seed)", () => {
  const a = run(two(), floor, 60_000, 3).roamers;
  const b = run(two(), { ...floor, platforms: [] }, 60_000, 3).roamers;
  expect(b).toEqual(a);
});

test("cards: one that goes (scrolled away, switched off) drops its creature to the floor; at bedtime they come down to bed", () => {
  const up = (): Roamer[] =>
    two().map((r, i) => (i === 0 ? { ...r, on: "c1", y: 300, x: 200, state: "idle", until: 1e9 } : r));
  // The card is gone: down, landing on the floor inside its ends.
  let out = run(up(), floor, 3000, 1);
  const a = out.roamers.find((r) => r.id === "a")!;
  expect(a.on ?? null).toBeNull();
  expect(a.y).toBe(0);
  const [lo, hi] = bounds(floor);
  expect(a.x).toBeGreaterThanOrEqual(lo);
  expect(a.x).toBeLessThanOrEqual(hi);
  // Bedtime: down first, then to bed and asleep on the floor.
  out = run(up(), { ...withCards, sleeping: new Set(["a", "b"]) }, 120_000, 1);
  for (const r of out.roamers) {
    expect(r.state).toBe("asleep");
    expect(r.on ?? null).toBeNull();
    expect(r.y ?? 0).toBe(0);
  }
});

test("cards: a jump arcs from one surface to the other, and a tap mid-air only sends a heart", () => {
  let roamers = two();
  // Run until one is in the air.
  const rng = (() => {
    let a = 9;
    return () => ((a = (a * 16807) % 2147483647) / 2147483647);
  })();
  let now = 0;
  while (!roamers.some((r) => r.state === "jump") && now < 30 * 60_000) {
    roamers = stepRoamers(roamers, { ...withCards, now }, 33, rng).roamers;
    now += 33;
  }
  const r = roamers.find((o) => o.state === "jump")!;
  expect(r).toBeTruthy();
  const j = r.jump!;
  expect(pose({ ...r }, j.start, floor.size).lift).toBe(0);
  expect(pose({ ...r }, j.start + j.ms / 2, floor.size).lift).toBeGreaterThan(floor.size * 0.3);
  expect(pose({ ...r }, j.start + j.ms, floor.size).lift).toBeCloseTo(0, 6);
  const tapped = poke(roamers, r.id, now);
  expect(tapped.roamers.find((o) => o.id === r.id)!.state).toBe("jump");
  expect(tapped.events).toEqual([{ kind: "hearts", x: r.x, count: 1 }]);
});

test("Home measures its cards for the creatures; the idle screen has none", () => {
  const home = codeOnly(read("src/components/creatures-on-home.tsx"));
  expect(home).toContain('const PLATFORM_SELECTOR = ".festival-grid > :not(button)";');
  expect(home).toContain('if (placement !== "home" || still || width === 0) return;');
  expect(home).toContain("{ width, size, now, sleeping: sleepingRef.current, platforms: platforms.current }");
  expect(home).toContain("el.outer.style.transform = `translate3d(${left}px, ${snap(-(up + p.lift))}px, 0)`;");
  // The cards it measures are the ones Home renders.
  expect(read("src/app/page.tsx")).toContain('<section className="festival-grid ');
});

test("Home: off unless switched on, gone with animations off, still with reduced; cheap to draw, and only a creature takes a tap", () => {
  expect(codeOnly(read("src/app/page.tsx"))).toMatch(/<WeatherEffects \/>\s*<CreaturesOnHome \/>/);
  const home = codeOnly(read("src/components/creatures-on-home.tsx"));
  expect(home).toContain('if (on !== true || motion === "off" || kids.length === 0) return null;');
  expect(home).toContain('return <CreatureFloor kids={kids} still={motion !== "full"} placement="home" />;');
  expect(home).toContain("const FRAME_MS = 1000 / 30;");
  // No steps while the page is hidden or the screensaver covers Home.
  expect(home).toContain('document.hidden || (placement === "home" && document.documentElement.hasAttribute("data-screensaver"));');
  expect(home).toContain('screensaver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-screensaver"] });');
  expect(home).toContain('className={`creature-floor pointer-events-none inset-x-0 ${placement === "home" ? "fixed z-[15]" : "absolute"}');
  expect(home).toContain('style={{ bottom: placement === "home" ? "var(--nav-spacing, 0px)" : 0, height: floorHeight }}');
  // Home keeps the floor's height free at its bottom, so the creatures walk below the widgets.
  expect(home).toContain('const name = placement === "home" ? "--home-creature-floor" : "--idle-creature-floor";');
  expect(home).toContain("root.style.setProperty(name, `${floorHeight}px`);");
  expect(read("src/app/page.tsx")).toContain('className="has-fab home-column ');
  expect(read("src/app/globals.css")).toMatch(/html\[data-home-creatures\] \.home-column \{\s*padding-bottom: var\(--home-creature-floor\);/);
  expect(home).toContain('className="pointer-events-auto flex size-full items-end justify-center rounded-full');
  // A little smaller than the widget's: 50 to 72 px; a classic picture at 0.8 of that, as it fills its frame.
  expect(home).toContain("const size = Math.round(Math.min(72, Math.max(50, width / 18)));");
  expect(home).toContain("const PICTURE_SCALE = 0.8;");
  expect(home).toContain("size={picture ? Math.round(size * PICTURE_SCALE) : size}");
  // The same creature as the widget: its stage, its look, its festival outfit, its mood.
  expect(home).toContain("creatureStage({ creature, account, earnedPoints: totalsFor(person.id).earned })");
  expect(home).toContain("const look = festive(readLook(creature.look, ownedFor(person.id)));");
  expect(home).toContain('const shownMood = lying ? "sleepy" : mood === "sleepy" ? "normal" : mood;');
  // Bedtime is the family's, on the family's clock.
  expect(home).toContain("isSleepyTime(new Date(minute * MINUTE_MS), timeZone, bedtime)");
  const css = read("src/app/globals.css");
  expect(css).toMatch(/\.home-creature \.creature-zzz \{\s*display: none;/);
  // Asleep: a drawing lies on its side; a classic picture (no closed eyes) dozes sitting up, dimmed.
  expect(home).toContain('const picture = effectiveStyle(creature.species, creature.style) === "classic" && !classicIsDrawn(creature.species, creature.style);');
  expect(home).toContain('data-art={picture ? "picture" : "drawn"}');
  expect(home).toContain("`scaleX(${r.dir}) rotate(${(-12 * ready + p.tilt).toFixed(1)}deg) scaleY(${(1 - 0.08 * ready).toFixed(3)})`");
  expect(home).toContain("`rotate(${(-90 * ready + p.tilt).toFixed(1)}deg)`");
  expect(css).toMatch(/\.home-creature\[data-art="picture"\]\[data-lying="true"\] \.home-creature-body,\s*\.home-creature\[data-egg="true"\]\[data-lying="true"\] \.home-creature-body \{\s*filter: brightness\(0\.8\)/);
  // One shadow each, flat on the floor; the drawing's own is hidden here, or it would turn with a creature lying down.
  expect(css).toMatch(/\.home-creature \.creature-ground \{\s*display: none;/);
  expect(home).toContain("el.shadow.style.transform = `translate3d(${left}px, ${snap(-up)}px, 0) scaleX(${stretch.toFixed(3)})`;");
  // Whole device pixels while walking: a sub-pixel offset makes the edge shimmer on a GPU.
  expect(home).toContain("const snap = (v: number) => (Math.round(v * dpr) / dpr).toFixed(2);");
  expect(home).toContain("const left = snap(r.x - size / 2);");
});

test("the mood hook and settings: one family bedtime, re-read every minute; the switch and times on Settings -> Creatures", () => {
  const hook = codeOnly(read("src/hooks/use-creature-mood.ts"));
  expect(hook).toContain("useSetting<unknown>(SETTINGS_KEYS.creatureBedtime, null, { refetchInterval: 60_000 })");
  expect(hook).toContain("creatureMood({ personId, tasks: tasks ?? [], now: new Date(minute * MINUTE_MS), timeZone, bedtime })");
  const keys = read("src/lib/settings-keys.ts");
  expect(keys).toContain('creatureBedtime: "creature_bedtime",');
  expect(keys).toContain('creaturesOnHome: "creatures_on_home",');
  const settings = codeOnly(read("src/components/settings/creatures-home-settings.tsx"));
  expect(settings).toContain('<Card id="home" data-setting="home" className="p-4 space-y-4">');
  expect(settings).toContain("void save(SETTINGS_KEYS.creatureBedtime, { sleep: formatClock(s), wake: formatClock(w) });");
  expect(settings).toContain("onCheckedChange={(next) => void save(SETTINGS_KEYS.creaturesOnHome, next)}");
  // "Back to 20:00-06:30" saves the default times: a setting can't be saved empty.
  expect(settings).toContain("void save(SETTINGS_KEYS.creatureBedtime, { sleep: formatClock(DEFAULT_BEDTIME.sleep), wake: formatClock(DEFAULT_BEDTIME.wake) })");
  expect(settings).not.toContain("save(SETTINGS_KEYS.creatureBedtime, null)");
  expect(codeOnly(read("src/app/settings/creatures/page.tsx"))).toContain("<CreaturesHomeSettings />");
  expect(read("src/lib/settings-search/registry.ts")).toContain('{ anchor: "home", labelKey: "settings.creatures.homeLabel", descriptionKey: "settings.creatures.homeHint" },');
});

test("every string is there in every language", () => {
  const load = (lang: string) => JSON.parse(read(`messages/${lang}.json`));
  const keys = ["homeLabel", "homeHint", "bedtimeLabel", "bedtimeHint", "bedtimeSleep", "bedtimeWake", "bedtimeReset"];
  for (const lang of ["en", "de", "fr"]) {
    const m = load(lang);
    for (const k of keys) expect(m.settings.creatures[k], `${lang} ${k}`).toBeTruthy();
    expect(m.settings.creatures.bedtimeReset, lang).toMatch(/\{sleep\}.*\{wake\}/);
    expect(m.creaturesOnHome.aria, lang).toBeTruthy();
    expect(m.creaturesOnHome.tapAria, lang).toContain("{name}");
    expect(m.settingsSearch.keywords.creatures_home, lang).toBeTruthy();
  }
});

test("the idle screen: the same floor, its own switch, off unless switched on; a tap there doesn't wake the screen", () => {
  const home = codeOnly(read("src/components/creatures-on-home.tsx"));
  expect(read("src/lib/settings-keys.ts")).toContain('creaturesOnIdle: "creatures_on_idle"');
  expect(home).toContain("useSetting<unknown>(SETTINGS_KEYS.creaturesOnIdle, false, { refetchInterval: 60_000 })");
  expect(home).toContain('return <CreatureFloor kids={kids} still={motion !== "full"} placement="idle" dim={dim} />;');
  // The idle floor runs while the screensaver is up; Home's stops then.
  expect(home).toContain('(placement === "home" && document.documentElement.hasAttribute("data-screensaver"))');
  expect(home).toContain('data-no-wake={placement === "idle" ? "" : undefined}');
  const saver = codeOnly(read("src/components/screensaver.tsx"));
  expect(saver).toContain("<CreaturesOnIdle />");
  expect(saver).toContain("<CreaturesOnIdle dim />");
  // Under everything that reads: after the photo and the visitor, before the news.
  const floor = saver.indexOf("<CreaturesOnIdle />");
  expect(floor).toBeGreaterThan(saver.indexOf('<FestivalVisitor placement="screensaver" />'));
  expect(floor).toBeLessThan(saver.indexOf('ref={newsListRef}'));
  // The clock and the events stand on the floor, not behind it.
  expect(saver.match(/bottom-\[calc\(3rem\+var\(--idle-creature-floor,0px\)\)\]/g)?.length).toBe(3);
  expect(read("src/components/settings/creatures-home-settings.tsx")).toContain("onCheckedChange={(next) => void save(SETTINGS_KEYS.creaturesOnIdle, next)}");
  // Measured: the drawings' own CSS animations more than doubled the main
  // thread's load on a throttled CPU, so the floor draws them still.
  expect(home).toContain("animated={false}");
});
