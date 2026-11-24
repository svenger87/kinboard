import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CALM,
  FOG_PACE,
  SUNBATHE_MS,
  SNOW_FILL_MS,
  SNOW_MELT_MS,
  SNOW_WALK_SHARE,
  HOP_MS,
  WAKE_MS,
  WALK_PX_PER_S,
  WIND_LEAN_DEG,
  WIND_PUSH_MS,
  WIND_PUSH_PX_PER_S,
  bounds,
  snowAfter,
  placeRoamers,
  poke,
  pose,
  roamWeather,
  stepRoamers,
  type Roamer,
  type World,
} from "../src/lib/creatures/roam";
import { codeOnly } from "./source-helpers";
import { useFloorWeather } from "../src/stores/home-weather";

/**
 * The creatures on Home and the screensaver react to the weather effects showing: the engine's
 * part (lib/creatures/roam.ts: wind, pace, hops, sunbathing, the lean and the
 * shiver), driven step by step with a seeded random source; and the wiring
 * from the weather overlay through stores/home-weather.ts to the floor, which
 * draws rain's umbrella and the heat's towel. creatures-weather-ui.spec.ts
 * drives a stack.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

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

function run(start: Roamer[], world: Omit<World, "now">, ms: number, seed = 7, t0 = 0) {
  const rng = seeded(seed);
  let roamers = start;
  const frames: Roamer[][] = [];
  for (let now = t0; now < t0 + ms; now += 33) {
    roamers = stepRoamers(roamers, { ...world, now }, 33, rng).roamers;
    frames.push(roamers);
  }
  return { roamers, frames };
}

const floor = { width: 1200, size: 80, sleeping: new Set<string>() };
const one = (state: Roamer["state"], x: number, extra: Partial<Roamer> = {}): Roamer => ({
  ...placeRoamers([{ id: "a", egg: false }], { ...floor, now: 0 })[0],
  x, state, since: 0, until: 0, ...extra,
});

/** How far a walk gets toward `target` in `ms`, with this weather. */
function walked(from: number, target: number, weather: World["weather"], ms = 2000) {
  const r = run([one("walk", from, { target, until: Infinity })], { ...floor, weather }, ms).roamers[0];
  return Math.abs(r.x - from);
}

test("the effects showing, as what they do: wind from the gust, pace, hops, the towel, the shiver", () => {
  expect(roamWeather([], 0)).toEqual(CALM);
  expect(roamWeather(["wind"], 1.6)).toMatchObject({ wind: 1.6 });
  expect(roamWeather(["wind"], 0).wind).toBe(1);
  expect(roamWeather(["wind"], 5).wind).toBe(2);
  expect(roamWeather(["rain", "storm"], 0)).toEqual(CALM);
  expect(roamWeather(["fog"], 0).pace).toBe(FOG_PACE);
  expect(roamWeather(["heat"], 0)).toMatchObject({ sunbathe: true });
  expect(roamWeather(["heat"], 0).pace).toBeLessThan(1);
  expect(roamWeather(["snow"], 0).hops).toBeGreaterThan(1);
  expect(roamWeather(["snow"], 0)).toMatchObject({ snow: true });
  expect(CALM.snow).toBe(false);
  expect(roamWeather(["freezing"], 0)).toMatchObject({ shiver: true });
});

test("calm weather, or none given, changes nothing", () => {
  const start = placeRoamers([{ id: "a", egg: false }, { id: "b", egg: false }], { ...floor, now: 0 });
  const none = run(start, floor, 60_000, 4).frames;
  const calm = run(start, { ...floor, weather: CALM }, 60_000, 4).frames;
  expect(calm).toEqual(none);
});

test("wind: quicker walking with it (to the right), slower against it, and pushed back standing still", () => {
  const windy = roamWeather(["wind"], 2);
  const calmRight = walked(300, 900, CALM);
  expect(calmRight).toBeCloseTo((WALK_PX_PER_S * 2000) / 1000, -1);
  expect(walked(300, 900, windy)).toBeGreaterThan(calmRight * 1.4);
  expect(walked(900, 300, windy)).toBeLessThan(calmRight * 0.6);
  // Standing: pushed downwind for a moment, then it braces; never off the floor.
  const [lo, hi] = bounds(floor);
  const step = (WIND_PUSH_PX_PER_S * 2 * WIND_PUSH_MS) / 1000;
  const braced = run([one("idle", 600, { until: Infinity })], { ...floor, weather: windy }, WIND_PUSH_MS + 500).roamers[0];
  expect(braced.x).toBeGreaterThan(600 + step * 0.9);
  expect(braced.x).toBeLessThan(600 + step * 1.1);
  const idle = run([one("idle", 600, { until: Infinity })], { ...floor, weather: windy }, 5000).roamers[0];
  expect(idle.x).toBe(braced.x);
  const edge = run([one("idle", hi - 2, { until: Infinity })], { ...floor, weather: windy }, 5000).roamers[0];
  expect(edge.x).toBe(hi);
  // Walking off from the downwind half: back into the wind.
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const from = lo + (hi - lo) * 0.8;
    const r = stepRoamers([one("idle", from)], { ...floor, now: 1000, weather: windy }, 33, seeded(seed)).roamers[0];
    if (r.state === "walk") expect(r.target).toBeLessThan(from);
  }
});

test("wind: over many minutes the creatures stay spread over the floor, not gathered at the right end", () => {
  for (const width of [500, 1200, 1920]) {
    const world = { width, size: Math.round(Math.min(72, Math.max(50, width / 18))), sleeping: new Set<string>() };
    const [lo, hi] = bounds(world);
    const start = placeRoamers(["a", "b", "c"].map((id) => ({ id, egg: false })), { ...world, now: 0 });
    for (const seed of [1, 2, 3]) {
      const { frames } = run(start, { ...world, weather: roamWeather(["wind"], 2) }, 600_000, seed);
      const at = frames.slice(1800).flatMap((f) => f.map((r) => (r.x - lo) / (hi - lo)));
      const mean = at.reduce((a, b) => a + b, 0) / at.length;
      expect(mean, `width ${width}, seed ${seed}`).toBeLessThan(0.58);
      expect(at.filter((x) => x > 0.85).length / at.length, `width ${width}, seed ${seed}`).toBeLessThan(0.2);
    }
  }
});

test("fog and heat: slower walking", () => {
  const calm = walked(300, 900, CALM);
  expect(walked(300, 900, roamWeather(["fog"], 0))).toBeLessThan(calm * 0.8);
  expect(walked(300, 900, roamWeather(["heat"], 0))).toBeLessThan(calm * 0.9);
});

test("snow: many more hops, catching flakes", () => {
  const start = placeRoamers([{ id: "a", egg: false }, { id: "b", egg: false }, { id: "c", egg: false }], { ...floor, now: 0 });
  const hops = (weather: World["weather"]) =>
    run(start, { ...floor, weather }, 180_000, 11).frames.reduce(
      (n, f, i, all) => n + f.filter((r, k) => r.state === "hop" && all[i - 1]?.[k]?.state !== "hop").length,
      0,
    );
  expect(hops(roamWeather(["snow"], 0))).toBeGreaterThan(hops(CALM) * 2.5);
});

test("snow settles on their heads: standing, slower walking, kept through a catching hop, thrown off by a jump, a game or a tap, melting after", () => {
  const snow = roamWeather(["snow"], 0);
  const stand = one("idle", 500, { until: Infinity });
  expect(snowAfter(stand, snow, SNOW_FILL_MS / 2)).toBeCloseTo(0.5, 5);
  expect(snowAfter(stand, snow, SNOW_FILL_MS * 2)).toBe(1);
  expect(snowAfter(one("walk", 500, { target: 900 }), snow, SNOW_FILL_MS)).toBeCloseTo(SNOW_WALK_SHARE, 5);
  // A hop on the spot keeps it; the big moves throw it off.
  expect(snowAfter(one("hop", 500, { snow: 0.8 }), snow, 33)).toBeGreaterThan(0.8);
  for (const state of ["jump", "play", "flee", "chase"] as const) expect(snowAfter(one(state, 500, { snow: 0.8 }), snow, 33), state).toBe(0);
  // The snow over: it melts.
  expect(snowAfter(one("idle", 500, { snow: 1 }), CALM, SNOW_MELT_MS / 2)).toBeCloseTo(0.5, 5);
  expect(snowAfter(one("idle", 500, { snow: 1 }), CALM, SNOW_MELT_MS * 2)).toBe(0);
  // A tap shakes it off.
  expect(poke([one("idle", 500, { snow: 0.9 })], "a", 1000).roamers[0].snow).toBeUndefined();

  // On the floor, alone in the snow (nobody to play with): a full cap within a minute, some of the time.
  const alone = run([one("idle", 500)], { ...floor, weather: snow }, 60_000, 3).frames.map((f) => f[0].snow ?? 0);
  expect(Math.max(...alone)).toBeGreaterThan(0.9);
  // A dry day: no snow on anyone, not even as a zero.
  const dry = run([one("idle", 500)], floor, 30_000, 3).frames;
  expect(dry.every((f) => !("snow" in f[0]))).toBe(true);
});

test("snow: the head goes back through a catching hop, whichever way it faces", () => {
  const snow = roamWeather(["snow"], 0);
  for (const dir of [1, -1] as const) {
    const hop = one("hop", 500, { dir, since: 0, until: HOP_MS });
    expect(pose(hop, HOP_MS / 2, 80, snow).tilt, `dir ${dir}`).toBeLessThan(-10);
    expect(pose(hop, HOP_MS / 2, 80, CALM).tilt).toBe(0);
  }
});

test("heat: now and then one lies on its towel, gets up after a while; never an egg, and bedtime wins", () => {
  const heat = roamWeather(["heat"], 0);
  const start = placeRoamers([{ id: "a", egg: false }, { id: "b", egg: false }, { id: "egg", egg: true }], { ...floor, now: 0 });
  const { frames } = run(start, { ...floor, weather: heat }, 120_000, 5);
  const sunning = frames.findIndex((f) => f.some((r) => r.state === "sunbathe"));
  expect(sunning).toBeGreaterThan(-1);
  const who = frames[sunning].find((r) => r.state === "sunbathe")!;
  expect(pose(who, sunning * 33, 80, heat).lying).toBe(true);
  // Up again: no longer than its time on the towel and a little.
  let n = sunning;
  while (frames[n]?.find((r) => r.id === who.id)?.state === "sunbathe") n++;
  expect((n - sunning) * 33).toBeLessThanOrEqual(SUNBATHE_MS * 1.6 + 100);
  expect(frames[n].find((r) => r.id === who.id)!.state).toBe("waking");
  expect(frames.some((f) => f.find((r) => r.id === "egg")!.state === "sunbathe")).toBe(false);
  // Calm: never.
  expect(run(start, floor, 120_000, 5).frames.some((f) => f.some((r) => r.state === "sunbathe"))).toBe(false);
  // A tap on the towel: up first, as at the end of its time there, with hearts; no hop.
  const tapped = poke([one("sunbathe", 500, { since: 0, until: 60_000 })], "a", 10_000);
  expect(tapped.roamers[0]).toMatchObject({ state: "waking", since: 10_000, until: 10_000 + WAKE_MS });
  expect(tapped.events).toEqual([{ kind: "hearts", x: 500, count: 3 }]);
  // Bedtime: off the towel and to bed.
  const sunbathing = one("sunbathe", 500, { until: Infinity });
  const night = run([sunbathing], { ...floor, weather: heat, sleeping: new Set(["a"]) }, 60_000).roamers[0];
  expect(night.state).toBe("asleep");
});

test("the pose: leaning into the wind (to the left, whichever way it faces), shivering in the frost; lying down, neither", () => {
  const windy = roamWeather(["wind"], 2);
  const right = one("idle", 500, { dir: 1 });
  const left = one("idle", 500, { dir: -1 });
  // The drawing turns inside scaleX(dir): -dir is a lean to the left on screen.
  expect(pose(right, 1000, 80, windy).tilt).toBeCloseTo(-2 * WIND_LEAN_DEG, 5);
  expect(pose(left, 1000, 80, windy).tilt).toBeCloseTo(2 * WIND_LEAN_DEG, 5);
  expect(pose(right, 1000, 80, CALM).tilt).toBe(0);
  const asleep = one("asleep", 500);
  expect(pose(asleep, 1000, 80, windy)).toEqual({ lift: 0, tilt: 0, lying: true });
  const frost = roamWeather(["freezing"], 0);
  const tilts = [0, 10, 20, 30, 40].map((t) => pose(right, 1000 + t, 80, frost).tilt);
  expect(new Set(tilts.map((v) => v.toFixed(2))).size).toBeGreaterThan(2);
  expect(Math.max(...tilts.map(Math.abs))).toBeLessThan(2);
});

test("the store: Home's and the screensaver's weather are kept apart, so Home's overlay under the screensaver can't overwrite it", () => {
  const { setFloorWeather } = useFloorWeather.getState();
  setFloorWeather("idle", ["rain"], 0);
  setFloorWeather("home", [], 0);
  expect(useFloorWeather.getState().idle).toEqual({ effects: ["rain"], gust: 0 });
  expect(useFloorWeather.getState().home).toEqual({ effects: [], gust: 0 });
  setFloorWeather("home", ["wind"], 1.5);
  expect(useFloorWeather.getState().idle.effects).toEqual(["rain"]);
  setFloorWeather("idle", [], 0);
  expect(useFloorWeather.getState().home).toEqual({ effects: ["wind"], gust: 1.5 });
});

test("the wiring: each overlay shares its own screen's effects, each floor moves and poses with its own and draws the umbrella and the towel", () => {
  const overlay = codeOnly(read("src/components/weather-effects.tsx"));
  // With Animations off the overlay draws nothing, so the floor gets nothing either.
  // Home's overlay for Home's floor, the screensaver's for the idle screen's (#282 follow-up).
  expect(overlay).toContain('const floor = home ? "home" : "idle";');
  expect(overlay).toContain('const publish = !forced && motion !== "off";');
  expect(overlay).toContain('setFloorWeather(floor, effectsKey ? (effectsKey.split(",") as WeatherEffect[]) : [], gust);');
  expect(overlay).toContain("useEffect(() => (publish ? () => setFloorWeather(floor, [], 0) : undefined), [publish, floor, setFloorWeather]);");
  // The publishing comes before any early return: hooks run every render.
  expect(overlay.indexOf("setFloorWeather(floor, effectsKey")).toBeLessThan(overlay.indexOf("if (effects.length === 0 && visitor) return"));
  const floorSrc = codeOnly(read("src/components/creatures-on-home.tsx"));
  expect(floorSrc).toContain("const shown = useFloorWeather((s) => s[placement]);");
  expect(floorSrc).toContain("const weather = useMemo(() => roamWeather(shown.effects, shown.gust), [shown]);");
  expect(floorSrc).toContain("platforms: platforms.current, weather: weatherRef.current }");
  expect(floorSrc).toContain("pose(r, now, size, weatherRef.current)");
  expect(floorSrc).toContain('const wet = shown.effects.includes("rain") || shown.effects.includes("storm");');
  // The screensaver draws its overlay and its floor, so its creatures get its weather.
  const saver = codeOnly(read("src/components/screensaver.tsx"));
  expect(saver).toContain('<WeatherEffects placement="screensaver" enabled={weatherEffects} onPhoto={Boolean(currentBlobUrl)} />');
  expect(saver).toContain("<CreaturesOnIdle />");
  expect(floorSrc).toContain('umbrella={wet ? (stormy ? "storm" : "rain") : null}');
  // The snow cap follows r.snow, not while lying on its side, and settles with motion reduced too.
  expect(floorSrc).toContain("const cover = ready > 0 ? 0 : r.snow ?? 0;");
  expect(floorSrc).toContain("const snow = snowAfter(r, weatherRef.current, dt);");
  expect(floorSrc).toContain('data-testid="home-creature-snow"');
  expect(floorSrc).toContain('el.towel.style.opacity = why === "sun" && ready > 0 ? ready.toFixed(2) : "0";');
  expect(floorSrc).toContain('const shownMood = lying === "sleep" ? "sleepy" : lying === "sun" ? "happy"');
  expect(floorSrc).toContain('{lying === "sleep" && (');
  // Nothing they wear changes with the weather.
  expect(floorSrc).toContain("const look = festive(readLook(creature.look, ownedFor(person.id)));");
  const css = read("src/app/globals.css");
  expect(css).toMatch(/:root:not\(\[data-motion="full"\]\) \.home-creature-umbrella-storm \{\s*animation: none;/);
});
