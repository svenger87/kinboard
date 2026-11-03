/**
 * `fireworks` (RFC-020 §3.3): rockets climb from below the clock and burst
 * over and around it into sparks of the kit's colours, which streak out,
 * droop and fade, glittering as they die. New Year's Eve at the family's
 * midnight; a national day in the evening. Each spark is a few drawImage
 * calls of a glow drawn once per colour (sprites.ts), its head and a short
 * trail behind it, added together ("lighter") so a burst brightens where its
 * sparks cross instead of covering them.
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
import type { Box, FireworksSpec, Pass, PassEnv } from "./types";

/** The trail behind a spark: where it was this many seconds ago, and how bright. */
const TRAIL: ReadonlyArray<readonly [number, number, number]> = [
  // [seconds back, alpha, size]
  [0.05, 0.55, 0.8],
  [0.1, 0.3, 0.65],
  [0.16, 0.15, 0.5],
];

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
        for (const shell of shells) {
          if (s >= shell.launch && !placed.has(shell)) place(shell);
          const st = shellAt(shell, s);
          if (!st) continue;
          const spark = sprites.sparks[shell.color] ?? sprites.star;
          if (st.rocket) {
            // The rocket: a bright head and a short trail of fading glows.
            for (let i = 0; i < 5; i++) {
              const back = shellAt(shell, s - i * 0.035)?.rocket ?? st.rocket;
              const size = 12 - i * 1.8;
              ctx.globalAlpha = (1 - i / 5) * fog;
              ctx.drawImage(spark, back.x - size / 2, back.y - size / 2, size, size);
            }
            drawn = union(drawn, { x: st.rocket.x - 20, y: st.rocket.y - 20, w: 40, h: shell.y0 - st.rocket.y + 60 });
            continue;
          }
          if (!newest || shell.burst > newest.burst) newest = shell;
          const age = s - shell.burst;
          const drift = wind * 14 * age;
          // The flash as it bursts.
          if (age < 0.25) {
            const f = 1 - age / 0.25;
            const size = shell.radius * 0.9 * (0.6 + 0.4 * st.open);
            ctx.globalAlpha = 0.55 * f * fog;
            ctx.drawImage(spark, shell.cx - size / 2, shell.cy - size / 2, size, size);
          }
          // Twinkling as they die.
          const glitter = st.alpha < 0.5;
          for (let k = 0; k < shell.sparks.length; k++) {
            const [a, reach] = shell.sparks[k];
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            const head = shell.radius * reach * st.open;
            const x = shell.cx + cos * head + drift;
            const y = shell.cy + sin * head + st.fall;
            const twinkle = glitter ? 0.55 + 0.45 * Math.sin(s * 40 + k) : 1;
            const size = 9 + 7 * st.alpha;
            ctx.globalAlpha = Math.max(0, st.alpha * twinkle) * fog;
            ctx.drawImage(spark, x - size / 2, y - size / 2, size, size);
            // The streak behind it, while it's still flying out.
            if (st.open < 0.98 || age < 0.6) {
              for (const [back, alpha, scale] of TRAIL) {
                const was = shellAt(shell, s - back);
                if (!was || was.rocket) break;
                const r = shell.radius * reach * was.open;
                const ts = size * scale;
                ctx.globalAlpha = Math.max(0, st.alpha * alpha) * fog;
                ctx.drawImage(spark, shell.cx + cos * r + drift - ts / 2, shell.cy + sin * r + was.fall - ts / 2, ts, ts);
              }
            }
            if (extras.length && k % 9 === 0) {
              const name = extras[k % extras.length];
              const p = spec.parts![name];
              const kk = sprites.scale * 0.6;
              ctx.globalAlpha = Math.max(0, st.alpha) * fog;
              ctx.drawImage(sprites.parts[name], x - (p.w * kk) / 2, y - (p.h * kk) / 2, p.w * kk, p.h * kk);
            }
          }
          const reach = shell.radius + 20;
          drawn = union(drawn, { x: shell.cx - reach + Math.min(0, drift), y: shell.cy - reach, w: reach * 2 + Math.abs(drift), h: reach * 2 + st.fall });
        }
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
