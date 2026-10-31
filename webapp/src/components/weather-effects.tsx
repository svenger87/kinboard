"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMotion } from "@/hooks/use-motion";
import { useSetting } from "@/hooks/use-supabase-queries";
import { useWeather, useWeatherForecast, useWeatherUnits } from "@/hooks/use-weather";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import {
  DEFAULT_WEATHER_EFFECTS,
  PREVIEW_MS,
  activeEffects,
  normalizeWeatherEffects,
  parsePreview,
  type EffectIntensity,
  type WeatherEffect,
} from "@/lib/weather-effects";

/**
 * Weather effects on Home (Settings -> Weather): snow, rain, a storm with
 * lightning, frost growing in from the edges when it is freezing, wind, fog
 * and heat, from the current weather and the family's thresholds
 * (lib/weather-effects.ts).
 *
 * Nothing here catches a tap (pointer-events: none). What moves is drawn on
 * one canvas behind the widgets from sprites drawn once (flakes, drops,
 * leaves, mist, the sun), at most 30 frames a second, with a capped number of
 * particles, and stops while the page is hidden. Frost is a second canvas,
 * drawn once, at the screen's edges. It follows the device's animation switch
 * (Settings -> Theme, lib/motion.ts): Reduced, or a device asking for reduced
 * motion, gets the still layers only (frost, a plain haze, the warm edge, a
 * darker sky in rain) and no lightning; Off draws nothing at all, for a
 * display such as a Raspberry Pi that can't afford even those.
 *
 * `preview` shows those effects whatever the weather (the settings page's
 * Preview buttons, in place). On Home, `?weather-preview=snow,wind` does the
 * same for a minute; it is kept in sessionStorage, because taking the
 * parameter out of the address redraws this component, and a preview held
 * only in its state was gone within a second.
 */
const PREVIEW_STORE = "kinboard.weatherPreview";

export function WeatherEffects({ preview: forced }: { preview?: WeatherEffect[] } = {}) {
  const { data: stored } = useSetting<unknown>(SETTINGS_KEYS.weatherEffects, DEFAULT_WEATHER_EFFECTS);
  const settings = useMemo(() => normalizeWeatherEffects(stored), [stored]);
  const { data: weather } = useWeather();
  // The chance of rain is the forecast's: its next slot, the next few hours.
  // The weather widget's query; asked for here only when the rain effect is on.
  const { data: forecast } = useWeatherForecast({ enabled: settings.enabled && settings.effects.rain });
  const slot = forecast?.hourly?.[0];
  const reading = useMemo(
    () => (weather ? { ...weather, nextSlot: slot ? { chance: slot.precipProbability, conditionMain: slot.conditionMain } : undefined } : weather),
    [weather, slot],
  );
  const { system } = useWeatherUnits();
  const [preview, setPreview] = useState<WeatherEffect[]>([]);
  const motion = useMotion();
  const reducedMotion = motion !== "full";

  useEffect(() => {
    if (forced) return;
    const url = new URL(window.location.href);
    const asked = parsePreview(url.searchParams.get("weather-preview"));
    let until = Date.now() + PREVIEW_MS;
    let effects = asked;
    try {
      if (asked.length > 0) {
        window.sessionStorage.setItem(PREVIEW_STORE, JSON.stringify({ effects: asked, until }));
      } else {
        const saved = JSON.parse(window.sessionStorage.getItem(PREVIEW_STORE) ?? "null");
        if (saved && typeof saved.until === "number" && saved.until > Date.now()) {
          effects = parsePreview(Array.isArray(saved.effects) ? saved.effects.join(",") : "");
          until = saved.until;
        }
      }
    } catch {
      // No storage (a private window): the preview lasts as long as this component.
    }
    if (asked.length > 0) {
      url.searchParams.delete("weather-preview");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    if (effects.length === 0) return;
    setPreview(effects);
    const timer = window.setTimeout(() => {
      setPreview([]);
      try {
        window.sessionStorage.removeItem(PREVIEW_STORE);
      } catch {
        // nothing kept
      }
    }, Math.max(0, until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [forced]);

  const effects = forced && forced.length > 0 ? forced : preview.length > 0 ? preview : activeEffects(reading, settings, system);
  if (effects.length === 0 || motion === "off") return null;
  const on = new Set(effects);
  const intensity = settings.intensity;
  const strength = intensity === "normal" ? 1 : 0.65;
  // How hard the wind blows, against the family's threshold: 1 at it, up to 2.
  const windKmh = weather ? (system === "imperial" ? weather.windSpeed * 1.609344 : weather.windSpeed) : 0;
  const gust = on.has("wind") ? Math.min(2, Math.max(1, windKmh / Math.max(1, settings.windAtKmh))) : 0;
  const moving = (["snow", "rain", "storm", "wind", "fog", "heat"] as const).filter((e) => on.has(e));
  const wet = on.has("rain") || on.has("storm");

  return (
    <div aria-hidden="true" data-testid="weather-effects" data-effects={effects.join(",")}>
      {wet && (
        <div
          className="weather-gloom pointer-events-none fixed inset-0 z-[5]"
          style={{ opacity: (on.has("storm") ? 0.8 : 0.5) * strength }}
        />
      )}
      {on.has("fog") && (
        <div className="weather-fog pointer-events-none fixed inset-0 z-[5]" style={{ opacity: 0.5 * strength }} />
      )}
      {!reducedMotion && moving.length > 0 && (
        <EffectsCanvas effects={moving} intensity={intensity} gust={gust} />
      )}
      {on.has("freezing") && <FrostCanvas strength={strength} />}
      {on.has("heat") && (
        <div className="weather-heat pointer-events-none fixed inset-0 z-20" style={{ opacity: strength }} />
      )}
      {on.has("storm") && !reducedMotion && <StormGlow strength={strength} />}
    </div>
  );
}

/** Tells the canvas to draw a bolt, so the glow and the bolt come together. */
const LIGHTNING_EVENT = "kinboard:lightning";

/** A soft brightening now and then, never a flash: about a second, every 9 to 20 seconds. */
function StormGlow({ strength }: { strength: number }) {
  const [lit, setLit] = useState(false);
  useEffect(() => {
    let timer = 0;
    const next = () => {
      timer = window.setTimeout(() => {
        setLit(true);
        window.dispatchEvent(new Event(LIGHTNING_EVENT));
        timer = window.setTimeout(() => {
          setLit(false);
          next();
        }, 900);
      }, 9_000 + Math.random() * 11_000);
    };
    next();
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      className="weather-storm pointer-events-none fixed inset-0 z-20 transition-opacity duration-700 ease-out"
      style={{ opacity: lit ? 0.22 * strength : 0 }}
    />
  );
}

/* ---------------------------------------------------------------- sprites */

function sprite(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  const ctx = c.getContext("2d");
  if (ctx) paint(ctx);
  return c;
}

/** A six-armed flake with side branches; three designs. */
function flakeSprite(radius: number, design: number): HTMLCanvasElement {
  const pad = 4;
  const size = radius * 2 + pad * 2;
  return sprite(size, size, (ctx) => {
    ctx.translate(size / 2, size / 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, radius / 7);
    ctx.shadowColor = "rgba(40, 70, 110, 0.45)";
    ctx.shadowBlur = 2;
    const branches = design === 0 ? [[0.45, 0.32], [0.72, 0.2]] : design === 1 ? [[0.35, 0.22], [0.55, 0.3], [0.78, 0.16]] : [[0.6, 0.34]];
    for (let k = 0; k < 6; k++) {
      ctx.save();
      ctx.rotate((k * Math.PI) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -radius);
      for (const [at, len] of branches) {
        const y = -radius * at;
        const l = radius * len;
        ctx.moveTo(0, y);
        ctx.lineTo(-l * 0.87, y - l * 0.5);
        ctx.moveTo(0, y);
        ctx.lineTo(l * 0.87, y - l * 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (design === 2) {
      // A small hexagonal plate at the centre.
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        const r = radius * 0.22;
        if (k === 0) ctx.moveTo(Math.sin(a) * r, -Math.cos(a) * r);
        else ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
      }
      ctx.closePath();
      ctx.stroke();
    }
  });
}

/** A soft round glow: distant flakes, mist, heat shimmer, the sun. */
function glowSprite(radius: number, rgb: string, alpha: number): HTMLCanvasElement {
  return sprite(radius * 2, radius * 2, (ctx) => {
    const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
    g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    g.addColorStop(0.45, `rgba(${rgb}, ${alpha * 0.55})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, radius * 2, radius * 2);
  });
}

/** A raindrop streak, clear at the top and brightest at the tip. */
function dropSprite(length: number, width: number, alpha: number): HTMLCanvasElement {
  return sprite(width + 2, length, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, length);
    g.addColorStop(0, "rgba(190, 215, 240, 0)");
    g.addColorStop(1, `rgba(215, 235, 255, ${alpha})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(1 + width / 2, 0);
    ctx.lineTo(1 + width / 2, length - width);
    ctx.stroke();
  });
}

/** A leaf with a midrib and a stem, in an autumn colour. */
function leafSprite(size: number, color: string): HTMLCanvasElement {
  const w = size * 2.4;
  const h = size * 1.4;
  return sprite(w, h, (ctx) => {
    ctx.translate(w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.bezierCurveTo(-size * 0.4, -size * 0.75, size * 0.5, -size * 0.6, size, 0);
    ctx.bezierCurveTo(size * 0.5, size * 0.6, -size * 0.4, size * 0.75, -size, 0);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(60, 35, 10, 0.45)";
    ctx.lineWidth = Math.max(0.8, size / 9);
    ctx.beginPath();
    ctx.moveTo(-size * 1.15, 0);
    ctx.lineTo(size * 0.85, 0);
    for (const t of [-0.4, 0, 0.4]) {
      ctx.moveTo(size * t, 0);
      ctx.lineTo(size * (t + 0.28), -size * 0.3);
      ctx.moveTo(size * t, 0);
      ctx.lineTo(size * (t + 0.28), size * 0.3);
    }
    ctx.stroke();
  });
}

/* ---------------------------------------------------------------- motion */

type Moving = "snow" | "rain" | "storm" | "wind" | "fog" | "heat";
type Kind = "flake" | "speck" | "drop" | "splash" | "gust" | "leaf" | "mist" | "shimmer";

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  spin: number;
  angle: number;
  age: number;
  sprite?: HTMLCanvasElement;
  far?: boolean;
}

const FRAME_MS = 1000 / 30;

function EffectsCanvas({ effects, intensity, gust }: { effects: Moving[]; intensity: EffectIntensity; gust: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = effects.join(",");

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const has = new Set(effects);
    const share = intensity === "normal" ? 1 : 0.6;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let width = 0;
    let height = 0;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
    const wind = gust; // 0 when calm, 1..2 when windy
    const heavy = has.has("storm");

    // Sprites, drawn once.
    const flakes = [0, 1, 2].flatMap((d) => [flakeSprite(6, d), flakeSprite(9, d), flakeSprite(13, d)]);
    const speck = glowSprite(4, "255, 255, 255", 0.9);
    const nearDrop = dropSprite(34, 1.8, 0.75);
    const farDrop = dropSprite(18, 1.1, 0.45);
    const leaves = ["rgb(214, 132, 40)", "rgb(176, 72, 38)", "rgb(196, 160, 52)", "rgb(140, 120, 50)"].map((c) => leafSprite(12, c));
    const mist = glowSprite(160, "215, 220, 228", 0.5);
    const shimmer = glowSprite(6, "255, 205, 130", 0.9);
    const sun = glowSprite(300, "255, 200, 120", 0.6);
    const flare = glowSprite(40, "255, 220, 160", 0.35);
    // Rain falls along the wind; one angle for every drop.
    const slant = Math.atan2(wind * 220, 760);

    const spawn = (kind: Kind, anywhere: boolean): Particle => {
      const base = { phase: rand(0, Math.PI * 2), spin: 0, angle: 0, age: 0 };
      switch (kind) {
        case "flake": {
          const s = pick(flakes);
          const near = s.width > 26;
          return { ...base, kind, sprite: s, x: rand(-40, width + 40), y: anywhere ? rand(-20, height) : rand(-60, -20), vx: wind * rand(50, 110), vy: near ? rand(45, 70) : rand(28, 45), size: s.width, alpha: near ? rand(0.85, 1) : rand(0.6, 0.85), spin: rand(-0.6, 0.6), angle: rand(0, Math.PI) };
        }
        case "speck":
          return { ...base, kind, sprite: speck, x: rand(-20, width + 20), y: anywhere ? rand(0, height) : -10, vx: wind * rand(25, 50), vy: rand(14, 24), size: rand(4, 7), alpha: rand(0.25, 0.5) };
        case "drop": {
          const far = Math.random() < 0.55;
          const speed = far ? rand(620, 760) : rand(820, 1000);
          return { ...base, kind, far, sprite: far ? farDrop : nearDrop, x: rand(-150, width + 50), y: anywhere ? rand(-30, height) : rand(-80, -30), vx: Math.sin(slant) * speed, vy: Math.cos(slant) * speed, size: 0, alpha: far ? rand(0.5, 0.8) : rand(0.75, 1) };
        }
        case "gust":
          return { ...base, kind, x: anywhere ? rand(-200, width) : rand(-700, -300), y: rand(height * 0.05, height * 0.95), vx: rand(380, 620) * Math.max(1, wind), vy: rand(-8, 8), size: rand(260, 520), alpha: rand(0.28, 0.45) };
        case "leaf":
          return { ...base, kind, sprite: pick(leaves), x: anywhere ? rand(0, width) : rand(-120, -40), y: rand(0, height * 0.85), vx: rand(160, 300) * Math.max(1, wind), vy: rand(-10, 30), size: rand(0.7, 1.2), alpha: rand(0.75, 0.95), spin: rand(1.5, 4) * (Math.random() < 0.5 ? -1 : 1) };
        case "mist":
          return { ...base, kind, sprite: mist, x: anywhere ? rand(-300, width) : -rand(300, 500), y: rand(height * 0.15, height * 1.05), vx: rand(6, 16) * (1 + wind), vy: 0, size: rand(2.2, 4.2), alpha: rand(0.35, 0.7) };
        case "shimmer":
          return { ...base, kind, sprite: shimmer, x: rand(0, width), y: anywhere ? rand(height * 0.3, height + 20) : height + rand(10, 40), vx: rand(-6, 6), vy: -rand(14, 30), size: rand(0.6, 1.4), alpha: rand(0.35, 0.7) };
        case "splash":
          return { ...base, kind, x: rand(0, width), y: rand(height * 0.8, height - 6), vx: 0, vy: 0, size: rand(5, 10), alpha: 0.5 };
      }
    };

    const particles: Particle[] = [];
    const add = (kind: Kind, n: number) => {
      for (let i = 0; i < Math.round(n * share); i++) particles.push(spawn(kind, true));
    };
    if (has.has("snow")) {
      add("flake", 55);
      add("speck", 45);
    }
    if (has.has("rain") || heavy) add("drop", heavy ? 190 : 130);
    if (has.has("wind")) {
      add("gust", 16);
      add("leaf", 14);
    }
    if (has.has("fog")) add("mist", 14);
    if (has.has("heat")) add("shimmer", 40);
    const splashes: Particle[] = [];

    // Lightning: a bolt that fades over about 0.7 s, when the glow asks for one.
    let bolt: { points: Array<[number, number]>; branches: Array<Array<[number, number]>>; at: number } | null = null;
    const strike = () => {
      const points: Array<[number, number]> = [];
      let x = rand(width * 0.2, width * 0.8);
      let y = 0;
      const end = rand(height * 0.35, height * 0.6);
      points.push([x, y]);
      while (y < end) {
        x += rand(-28, 28);
        y += rand(18, 40);
        points.push([x, y]);
      }
      const branches: Array<Array<[number, number]>> = [];
      for (let b = 0; b < 2; b++) {
        const from = points[Math.floor(rand(2, points.length - 2))];
        if (!from) continue;
        const branch: Array<[number, number]> = [from];
        let [bx, by] = from;
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (let i = 0; i < 4; i++) {
          bx += dir * rand(10, 30);
          by += rand(14, 30);
          branch.push([bx, by]);
        }
        branches.push(branch);
      }
      bolt = { points, branches, at: performance.now() };
    };
    const onLightning = () => heavy && strike();
    window.addEventListener(LIGHTNING_EVENT, onLightning);

    const drawPath = (pts: Array<[number, number]>) => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
    };

    const offscreen = (p: Particle) =>
      p.y > height + 60 || p.x > width + 480 || p.x < -800 || (p.kind === "shimmer" && p.y < height * 0.15);

    const draw = (p: Particle, t: number) => {
      switch (p.kind) {
        case "flake":
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.drawImage(p.sprite!, -p.size / 2, -p.size / 2);
          ctx.restore();
          break;
        case "speck":
          ctx.globalAlpha = p.alpha;
          ctx.drawImage(p.sprite!, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
          break;
        case "drop":
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.translate(p.x, p.y);
          ctx.rotate(-slant);
          ctx.drawImage(p.sprite!, -p.sprite!.width / 2, -p.sprite!.height);
          ctx.restore();
          break;
        case "gust": {
          const g = ctx.createLinearGradient(p.x - p.size, 0, p.x, 0);
          g.addColorStop(0, "rgba(225, 232, 240, 0)");
          g.addColorStop(0.6, `rgba(225, 232, 240, ${p.alpha})`);
          g.addColorStop(1, "rgba(225, 232, 240, 0)");
          ctx.globalAlpha = 1;
          ctx.strokeStyle = g;
          ctx.lineWidth = 2;
          ctx.lineCap = "round";
          const bend = Math.sin(t / 900 + p.phase) * 10;
          ctx.beginPath();
          ctx.moveTo(p.x - p.size, p.y + bend);
          ctx.quadraticCurveTo(p.x - p.size * 0.5, p.y - bend, p.x, p.y + bend * 0.4);
          ctx.stroke();
          break;
        }
        case "leaf": {
          const s = p.sprite!;
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          // Tumbling: the leaf turns over as it flies.
          ctx.scale(p.size, p.size * Math.cos(t / 260 + p.phase));
          ctx.drawImage(s, -s.width / 2, -s.height / 2);
          ctx.restore();
          break;
        }
        case "mist": {
          const s = p.sprite!;
          ctx.globalAlpha = p.alpha;
          ctx.drawImage(s, p.x - (s.width * p.size) / 2, p.y - (s.height * p.size * 0.45) / 2, s.width * p.size, s.height * p.size * 0.45);
          break;
        }
        case "shimmer": {
          // A warm mote of light drifting up, fading in low and out high.
          const s = p.sprite!;
          const rise = Math.max(0, Math.min(1, (height - p.y) / (height * 0.85)));
          ctx.globalAlpha = p.alpha * Math.sin(rise * Math.PI) * (0.75 + Math.sin(t / 600 + p.phase) * 0.25);
          const w = s.width * p.size;
          ctx.drawImage(s, p.x + Math.sin(t / 1300 + p.phase) * 10 - w / 2, p.y - w / 2, w, w);
          break;
        }
        default:
          break;
      }
    };

    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      frame = window.requestAnimationFrame(tick);
      if (t - last < FRAME_MS) return;
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      ctx.clearRect(0, 0, width, height);

      if (has.has("heat")) {
        // The sun's glare in the top corner, breathing slowly, with a few
        // flare spots along the diagonal.
        const pulse = 0.85 + Math.sin(t / 2500) * 0.15;
        ctx.globalAlpha = 0.7 * pulse;
        ctx.drawImage(sun, width - sun.width * 0.6, -sun.height * 0.4);
        const sx = width - 30;
        const sy = 30;
        for (const [k, scale, a] of [[0.35, 0.6, 0.5], [0.55, 1.1, 0.35], [0.8, 0.45, 0.45]] as const) {
          const fx = sx - (sx - width * 0.25) * k;
          const fy = sy + (height * 0.7 - sy) * k;
          const fw = flare.width * scale;
          ctx.globalAlpha = a * pulse;
          ctx.drawImage(flare, fx - fw / 2, fy - fw / 2, fw, fw);
        }
      }

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += (p.vx + (p.kind === "flake" || p.kind === "speck" ? Math.sin(t / 1100 + p.phase) * 16 : 0)) * dt;
        p.y += (p.vy + (p.kind === "leaf" ? Math.sin(t / 420 + p.phase) * 45 : 0)) * dt;
        p.angle += p.spin * dt;
        if (p.kind === "mist" && p.x - (p.sprite!.width * p.size) / 2 > width) {
          particles[i] = spawn("mist", false);
        } else if (offscreen(p)) {
          if (p.kind === "drop" && !p.far && splashes.length < 24) splashes.push(spawn("splash", false));
          particles[i] = spawn(p.kind, false);
        }
        draw(particles[i], t);
      }

      // Splashes: a small ring that widens and fades, low on the screen.
      ctx.lineWidth = 1;
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        s.age += dt;
        const k = s.age / 0.35;
        if (k >= 1) {
          splashes.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = (1 - k) * 0.55;
        ctx.strokeStyle = "rgb(205, 225, 245)";
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, s.size * (0.4 + k), s.size * 0.3 * (0.4 + k), 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (bolt) {
        const age = (performance.now() - bolt.at) / 700;
        if (age >= 1) bolt = null;
        else {
          const env = age < 0.08 ? age / 0.08 : 1 - (age - 0.08) / 0.92;
          ctx.save();
          ctx.globalAlpha = env;
          ctx.shadowColor = "rgba(190, 210, 255, 0.9)";
          ctx.shadowBlur = 16;
          ctx.strokeStyle = "rgb(235, 242, 255)";
          ctx.lineJoin = "round";
          ctx.lineWidth = 2.4;
          drawPath(bolt.points);
          ctx.lineWidth = 1.2;
          bolt.branches.forEach(drawPath);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    };
    const start = () => {
      if (!frame && !document.hidden) frame = window.requestAnimationFrame(tick);
    };
    const stop = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener(LIGHTNING_EVENT, onLightning);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `key` stands for `effects`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intensity, gust]);

  return (
    <canvas
      ref={ref}
      data-testid="weather-effects-motion"
      className="pointer-events-none fixed inset-0 z-[5] h-full w-full"
    />
  );
}

/* ---------------------------------------------------------------- frost */

/**
 * Frost growing in from the edges: an icy rim and branching crystals, thickest
 * in the corners, drawn once (and again on a resize). Above the widgets, but
 * only at the edges.
 */
function FrostCanvas({ strength }: { strength: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // The icy rim: clear in the middle, frosted towards every edge.
      const rim = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
      rim.addColorStop(0, "rgba(215, 235, 255, 0)");
      rim.addColorStop(0.6, "rgba(215, 235, 255, 0.10)");
      rim.addColorStop(1, "rgba(225, 242, 255, 0.45)");
      ctx.fillStyle = rim;
      ctx.fillRect(0, 0, w, h);

      // Ice crystals: a stem with side branches at 60 degrees, smaller each time.
      const grow = (x: number, y: number, angle: number, len: number, depth: number) => {
        const x2 = x + Math.cos(angle) * len;
        const y2 = y + Math.sin(angle) * len;
        ctx.globalAlpha = 0.35 + depth * 0.15;
        ctx.lineWidth = 0.6 + depth * 0.3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (depth <= 0 || len < 6) return;
        const steps = 3;
        for (let i = 1; i <= steps; i++) {
          const k = i / (steps + 1);
          const bx = x + Math.cos(angle) * len * k;
          const by = y + Math.sin(angle) * len * k;
          const side = len * (1 - k) * 0.45;
          grow(bx, by, angle - Math.PI / 3, side, depth - 1);
          grow(bx, by, angle + Math.PI / 3, side, depth - 1);
        }
      };
      ctx.strokeStyle = "rgb(240, 248, 255)";
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(190, 220, 255, 0.8)";
      ctx.shadowBlur = 4;
      const seed = (x: number, y: number, inward: number, len: number) => grow(x, y, inward + rand(-0.35, 0.35), len, 2);
      for (let x = rand(20, 60); x < w; x += rand(70, 140)) {
        seed(x, 0, Math.PI / 2, rand(22, 48));
        seed(x, h, -Math.PI / 2, rand(22, 48));
      }
      for (let y = rand(20, 60); y < h; y += rand(70, 140)) {
        seed(0, y, 0, rand(22, 48));
        seed(w, y, Math.PI, rand(22, 48));
      }
      // The corners, where frost is thickest.
      for (const [cx, cy, a] of [[0, 0, Math.PI / 4], [w, 0, (3 * Math.PI) / 4], [0, h, -Math.PI / 4], [w, h, (-3 * Math.PI) / 4]] as const) {
        for (let i = 0; i < 4; i++) grow(cx, cy, a + rand(-0.55, 0.55), rand(80, 150), 3);
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    };
    paint();
    window.addEventListener("resize", paint);
    return () => window.removeEventListener("resize", paint);
  }, []);
  return (
    <canvas
      ref={ref}
      className="weather-frost pointer-events-none fixed inset-0 z-20 h-full w-full"
      style={{ opacity: strength }}
    />
  );
}
