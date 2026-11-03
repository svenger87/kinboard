/**
 * `fireworks` (RFC-020 §3.3): rockets climb from below the clock on a
 * glowing trail and burst over and around it into sparks of the kit's
 * colours, which streak out, droop and fade. New Year's Eve at the family's
 * midnight; a national day in the evening. Shells come in kinds (the spec's
 * `kinds`): a peony round a pistil of another colour, a willow hanging on
 * long gold trails, a crackle breaking into flickers as it dies, a tilted
 * ring. Each spark is one drawImage of a sprite drawn once per colour
 * (sprites.ts): every third one a comet stretched from where it was to
 * where it is, its white-hot head drawn in, the rest glowing heads (a
 * willow's every other one); all added together ("lighter"), so a burst
 * brightens where its sparks cross instead of covering them.
 *
 * The clock can move while a pass is under way (Home's cards finishing
 * loading above it): each shell looks where the clock is when its rocket
 * leaves, and goes up there.
 *
 * A tap on the newest burst sets off another one where it is.
 */

import { Tapping, applyLight, fogAlpha, union } from "./common";
import { BURST_S, fireworksPlan, shellAt, PASS_MS, type Shell } from "./motion";
import type { VisitorSprites } from "./sprites";
import type { Bitmap } from "./sprites";
import type { Box, FireworksSpec, Pass, PassEnv, ShellKind } from "./types";

/** How the kinds differ: how far back a spark's trail reaches (s), how much harder it falls, how late its light fades (a willow's, < 1). */
const KIND: Record<ShellKind, { trail: number; fall: number; fade: number }> = {
  peony: { trail: 0.13, fall: 1, fade: 1 },
  // Long trails, falling and hanging: the light fades late.
  willow: { trail: 0.5, fall: 1.6, fade: 0.55 },
  crackle: { trail: 0.1, fall: 0.8, fade: 1 },
  ring: { trail: 0.11, fall: 0.7, fade: 1 },
};

/** A crackle's flickers: on or off by turns, a dozen times a second, never two neighbours alike. */
const flicker = (k: number, j: number, s: number) => {
  const n = Math.sin((k * 12.9898 + j * 78.233 + Math.floor(s * 12) * 37.719) * 43758.5453);
  return n - Math.floor(n);
};

export function fireworksPass(spec: FireworksSpec, sprites: VisitorSprites, env: PassEnv): Pass {
  const shells: Shell[] = fireworksPlan(spec, env);
  const placed = new Set<Shell>();
  const tapping = new Tapping(sprites, spec.tap);
  const extras = (spec.sprites ?? []).filter((n) => sprites.parts[n] && spec.parts?.[n]);
  const end = (spec.duration ?? PASS_MS) / 1000 + 0.5;
  let gone = false;
  // The pass's clock as of its last frame, s: when a tap's extra shell goes off.
  let lastS = 0;

  /** At its launch, a shell follows the clock to where it is now. */
  const place = (shell: Shell) => {
    placed.add(shell);
    const then = env.clock;
    const now = env.clockNow?.() ?? null;
    if (!then || !now) return;
    const dx = now.x + now.w / 2 - (then.x + then.w / 2);
    const dy = now.y - then.y;
    shell.cx += dx;
    shell.x0 += dx;
    shell.cy = Math.max(shell.radius * 0.6, shell.cy + dy);
  };

  return {
    get done() {
      return gone && !tapping.falling;
    },
    get target() {
      return tapping.open;
    },
    tap() {
      const t = tapping.target;
      if (!t || !tapping.tap()) return;
      // Another shell, bursting right where the tap was.
      const base = shells[shells.length - 1];
      if (base) {
        const cx = t.x + t.w / 2;
        const extra = { ...base, launch: lastS - 0.9, burst: lastS, cx, cy: t.y + t.h / 2, x0: cx, color: (base.color + 1) % Math.max(1, spec.colors.length) };
        placed.add(extra);
        shells.push(extra);
      }
    },
    draw(ctx, ms, dt, wind, light) {
      const s = ms / 1000;
      lastS = s;
      let drawn: Box | null = null;
      const last = shells.reduce((m, sh) => Math.max(m, sh.burst + BURST_S), 0);
      if (s <= Math.max(end, last)) {
        const fog = fogAlpha(ms, light);
        let newest: Shell | null = null;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        // The canvas's own transform (its pixel ratio), to rotate each trail from.
        const base = ctx.getTransform();
        /** A trail: the comet sprite stretched from (x0, y0) to its head at (x1, y1), `w` px thick. */
        const streak = (img: Bitmap, x0: number, y0: number, x1: number, y1: number, w: number, alpha: number) => {
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = Math.hypot(dx, dy);
          if (len < 1 || alpha <= 0.01) return;
          const c = dx / len;
          const sn = dy / len;
          ctx.setTransform(base.a * c + base.c * sn, base.b * c + base.d * sn, -base.a * sn + base.c * c, -base.b * sn + base.d * c, base.a * x0 + base.c * y0 + base.e, base.b * x0 + base.d * y0 + base.f);
          ctx.globalAlpha = alpha;
          ctx.drawImage(img, 0, -w / 2, len + w * 0.4, w);
        };
        for (const shell of shells) {
          if (s >= shell.launch && !placed.has(shell)) place(shell);
          const st = shellAt(shell, s);
          if (!st) continue;
          const spark = sprites.sparks[shell.color] ?? sprites.star;
          const trail = sprites.streaks[shell.color] ?? spark;
          if (st.rocket) {
            // The rocket: a bright head on a glowing trail, embers dropping off it.
            const back = shellAt(shell, s - 0.2)?.rocket ?? { x: shell.x0, y: shell.y0 };
            streak(sprites.streaks[0] ?? trail, back.x, back.y, st.rocket.x, st.rocket.y, 7, 0.9 * fog);
            ctx.setTransform(base);
            for (let j = 1; j <= 3; j++) {
              const was = shellAt(shell, s - j * 0.09)?.rocket;
              if (!was) break;
              const size = 4.5 - j;
              ctx.globalAlpha = (0.6 - j * 0.15) * fog;
              ctx.drawImage(sprites.sparks[0] ?? spark, was.x - size / 2 + Math.sin(j * 2.1 + s * 9) * 2, was.y - size / 2 + j * j * 3, size, size);
            }
            ctx.globalAlpha = fog;
            ctx.drawImage(spark, st.rocket.x - 6, st.rocket.y - 6, 12, 12);
            drawn = union(drawn, { x: st.rocket.x - 20, y: st.rocket.y - 20, w: 40, h: shell.y0 - st.rocket.y + 60 });
            continue;
          }
          if (!newest || shell.burst > newest.burst) newest = shell;
          const kind = KIND[shell.kind] ?? KIND.peony;
          const age = s - shell.burst;
          const drift = wind * 14 * age;
          // The flash as it bursts.
          if (age < 0.25) {
            const f = 1 - age / 0.25;
            const size = shell.radius * 0.9 * (0.6 + 0.4 * st.open);
            ctx.globalAlpha = 0.55 * f * fog;
            ctx.drawImage(spark, shell.cx - size / 2, shell.cy - size / 2, size, size);
          }
          // The light: a willow's holds, then fades late.
          const alpha = shell.kind === "willow" ? Math.max(0, 1 - Math.pow(age / BURST_S, 1 / kind.fade) ** 2) : st.alpha;
          const crackling = shell.kind === "crackle" && age > 0.75;
          const ring = shell.kind === "ring";
          const cosT = Math.cos(shell.tilt);
          const sinT = Math.sin(shell.tilt);
          const was = shellAt(shell, Math.max(shell.burst, s - kind.trail)) ?? st;
          /** Where spark k is at a moment of the burst (open, fall), px. */
          const at = (a: number, reach: number, open: number, fall: number): [number, number] => {
            let dx = Math.cos(a) * shell.radius * reach * open;
            let dy = Math.sin(a) * shell.radius * reach * open;
            if (ring) {
              dy *= 0.38;
              const rx = dx * cosT - dy * sinT;
              dy = dx * sinT + dy * cosT;
              dx = rx;
            }
            return [shell.cx + dx + drift, shell.cy + dy + fall * kind.fall];
          };
          // Two passes: the comets first, rotated each to its path, then the
          // transform put back once and the glowing heads drawn straight. A
          // willow is a comet every other spark, the other kinds every third,
          // the rest glowing heads: rotated draws are the costly ones on a Pi.
          const comet = (k: number) => k % (shell.kind === "willow" ? 2 : 3) === 0;
          for (let pass = 0; pass < 2; pass++) {
            if (pass === 1) ctx.setTransform(base);
            for (let k = 0; k < shell.sparks.length; k++) {
              const [a, r] = shell.sparks[k];
              // A peony's pistil: every fourth spark an inner sphere of the second colour.
              const pistil = shell.kind === "peony" && k % 4 === 1;
              const reach = pistil ? r * 0.42 : r;
              const [x, y] = at(a, reach, st.open, st.fall);
              const light = Math.max(0, alpha) * fog;
              if (pass === 0) {
                if (!comet(k)) continue;
                const [tx, ty] = at(a, reach, was.open, was.fall);
                // Its trail from where it was a moment ago, the white-hot head drawn in.
                streak(pistil ? (sprites.streaks[shell.color2] ?? trail) : trail, tx, ty, x, y, shell.kind === "willow" ? 6 : 8, light * (crackling ? 0.6 : shell.kind === "willow" ? 0.9 : 1));
                continue;
              }
              if (!comet(k)) {
                const size = (9 + 7 * alpha) * (crackling ? 0.7 : 1);
                ctx.globalAlpha = light * (crackling ? 0.6 : 1);
                ctx.drawImage(pistil ? (sprites.sparks[shell.color2] ?? spark) : spark, x - size / 2, y - size / 2, size, size);
              }
              if (crackling) {
                // Breaking up: a flicker of white beside it, on and off.
                const f = flicker(k, 0, s);
                if (f <= 0.55) {
                  const cs = 5 + f * 6;
                  ctx.globalAlpha = Math.min(1, alpha * 1.6) * fog;
                  ctx.drawImage(sprites.star, x + (f - 0.27) * 22 - cs / 2, y + (flicker(0, k, s) - 0.5) * 18 - cs / 2, cs, cs);
                }
              }
              if (extras.length && k % 9 === 0) {
                const name = extras[k % extras.length];
                const p = spec.parts![name];
                const kk = sprites.scale * 0.6;
                ctx.globalAlpha = Math.max(0, alpha) * fog;
                ctx.drawImage(sprites.parts[name], x - (p.w * kk) / 2, y - (p.h * kk) / 2, p.w * kk, p.h * kk);
              }
            }
          }
          const reach = shell.radius + 24;
          const fall = st.fall * kind.fall;
          drawn = union(drawn, { x: shell.cx - reach + Math.min(0, drift), y: shell.cy - reach, w: reach * 2 + Math.abs(drift), h: reach * 2 + fall });
        }
        ctx.setTransform(base);
        ctx.restore();
        tapping.target = newest ? { x: newest.cx - newest.radius * 0.6, y: newest.cy - newest.radius * 0.6, w: newest.radius * 1.2, h: newest.radius * 1.2 } : null;
        if (drawn) applyLight(ctx, drawn, light);
      } else {
        gone = true;
        tapping.target = null;
      }
      return union(drawn, tapping.draw(ctx, dt, wind, env.height));
    },
  };
}
