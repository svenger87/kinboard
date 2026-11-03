/**
 * What every archetype's pass shares: the tap and what it drops (presents
 * and stars, §2.1), the light the weather puts on the visitor (fog, a
 * storm), and box arithmetic for the scene's dirty-rectangle clearing.
 */

import type { Bitmap, VisitorSprites } from "./sprites";
import type { Box, Light, TapSpec } from "./types";

export const RAD = Math.PI / 180;

export const union = (a: Box | null, b: Box | null): Box | null => {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

interface Drop {
  sprite: Bitmap;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  age: number;
  life: number;
  star: boolean;
}

/** Presents (or the kit's own drops) and stars from a tap: they fall with the wind, and the stars fade. */
function dropsAt(sprites: VisitorSprites, tap: TapSpec, x: number, y: number): Drop[] {
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const out: Drop[] = [];
  const things = tap.drops?.length ? tap.drops.map((n) => sprites.parts[n]).filter(Boolean) : tap.presents ? sprites.presents : [];
  for (let i = 0; i < Math.min(3, things.length ? 3 : 0); i++) {
    out.push({ sprite: things[i % things.length], x: x + rand(-30, 30), y, vx: rand(-40, 60), vy: rand(-80, 20), angle: rand(-0.4, 0.4), spin: rand(-2, 2), age: 0, life: 6, star: false });
  }
  for (let i = 0; i < 12; i++) {
    out.push({ sprite: sprites.star, x: x + rand(-50, 50), y: y + rand(-30, 30), vx: rand(-120, 120), vy: rand(-160, 40), angle: 0, spin: rand(-3, 3), age: 0, life: rand(1.2, 2.2), star: true });
  }
  return out;
}

function drawDrops(ctx: CanvasRenderingContext2D, drops: Drop[], dt: number, wind: number, scale: number, height: number): Box | null {
  let box: Box | null = null;
  const k = scale * 1.6;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.age += dt;
    d.vy += (d.star ? 260 : 620) * dt;
    d.x += (d.vx + wind * 30) * dt;
    d.y += d.vy * dt;
    d.angle += d.spin * dt;
    const size = (d.star ? 30 : 34) * k;
    if (d.age > d.life || d.y - size > height) {
      drops.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = d.star ? Math.max(0, 1 - d.age / d.life) * (0.7 + 0.3 * Math.sin(d.age * 18)) : 1;
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);
    ctx.drawImage(d.sprite, -size / 2, -size / 2, size, size);
    ctx.restore();
    box = union(box, { x: d.x - size, y: d.y - size, w: size * 2, h: size * 2 });
  }
  return box;
}

/**
 * The one-tap rule (§2.1) and what a tap drops, for any archetype: the pass
 * reports its target while it may be tapped, `tap()` takes one and drops from
 * the target, and the drops fall on after the visitor has gone.
 */
export class Tapping {
  /** performance.now() of the tap, or -1. */
  tappedAt = -1;
  target: Box | null = null;
  private drops: Drop[] = [];

  constructor(
    private readonly sprites: VisitorSprites,
    private readonly spec: TapSpec | false | undefined,
  ) {}

  /** The target while the visitor may still be tapped. */
  get open(): Box | null {
    return this.tappedAt >= 0 || this.spec === false ? null : this.target;
  }

  get falling(): boolean {
    return this.drops.length > 0;
  }

  /** ms since the tap, or -1. */
  get sinceTap(): number {
    return this.tappedAt >= 0 ? performance.now() - this.tappedAt : -1;
  }

  tap(): boolean {
    if (this.tappedAt >= 0 || !this.target || this.spec === false) return false;
    this.tappedAt = performance.now();
    const spec = this.spec ?? {};
    const [fx, fy] = spec.at ?? [0.5, 0.4];
    this.drops.push(...dropsAt(this.sprites, spec, this.target.x + this.target.w * fx, this.target.y + this.target.h * fy));
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, dt: number, wind: number, height: number): Box | null {
    return drawDrops(ctx, this.drops, dt, wind, this.sprites.scale, height);
  }
}

/** Where light falls on the visitor: hazy in fog, dark in a storm until the lightning lights it. */
export function applyLight(ctx: CanvasRenderingContext2D, box: Box, light: Light) {
  if (!light.storm) return;
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = `rgba(14, 18, 32, ${0.38 * (1 - light.flash)})`;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  if (light.flash > 0) {
    ctx.fillStyle = `rgba(210, 225, 255, ${0.25 * light.flash})`;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  ctx.restore();
}

export const fogAlpha = (ms: number, light: Light) => (light.fog ? 0.55 + 0.4 * Math.sin(ms / 1400) : 1);
