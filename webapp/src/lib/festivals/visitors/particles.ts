/**
 * `rise`, `drift` and `burst` (RFC-020 §3.3): many small sprites in a pass,
 * one engine. Rise: hearts, balloons, sky lanterns, flowers blooming up from
 * the bottom. Drift: leaves and petals falling with the shared wind. Burst:
 * bats out of a corner, streamers and confetti, clouds of coloured powder,
 * noisemakers. Each particle's path is closed-form (lib/festivals/visitors/
 * motion.ts), so a frame never depends on the frame rate; the wind is the
 * one thing integrated, as a push shared by all of them.
 *
 * A swarm spread over the screen can't be one tap target without catching
 * every tap meant for a widget, so one particle, a little larger, is the
 * visitor's shape for the tap (§2.1).
 */

import { Tapping, applyLight, fogAlpha, union } from "./common";
import { burstAt, burstPlan, driftAt, driftPlan, riseAt, risePlan, PASS_MS, type Particle, type ParticleState } from "./motion";
import type { VisitorSprites } from "./sprites";
import type { Box, BurstSpec, DriftSpec, Pass, PassEnv, RiseSpec } from "./types";

type ParticleSpec = RiseSpec | DriftSpec | BurstSpec;

export function particlePass(spec: ParticleSpec, sprites: VisitorSprites, env: PassEnv): Pass {
  const sc = sprites.scale;
  const parts = spec.parts ?? {};
  const plan: Particle[] = spec.archetype === "rise" ? risePlan(spec, env) : spec.archetype === "drift" ? driftPlan(spec, env) : burstPlan(spec, env);
  const at = (p: Particle, s: number, shift: number): ParticleState =>
    spec.archetype === "rise" ? riseAt(spec, p, env, s, shift) : spec.archetype === "drift" ? driftAt(spec, p, env, s, shift) : burstAt(spec, p, s, shift);
  // A pass lasts until the last particle is gone, but never more than twice its length.
  const longest = Math.max(...plan.map((p) => p.born + p.life), 0);
  const end = Math.min(longest, ((spec.duration ?? PASS_MS) / 1000) * 2);
  const tapping = new Tapping(sprites, spec.tap);
  // The wind's push so far, px: shared by every particle.
  let shift = 0;
  let gone = false;

  return {
    get done() {
      return gone && !tapping.falling;
    },
    get target() {
      return tapping.open;
    },
    tap() {
      tapping.tap();
    },
    draw(ctx, ms, dt, wind, light) {
      const s = ms / 1000;
      let drawn: Box | null = null;
      if (s <= end) {
        shift += wind * (spec.archetype === "drift" ? 60 : 24) * dt;
        let hero: Box | null = null;
        ctx.save();
        const fog = fogAlpha(ms, light);
        for (const p of plan) {
          const st = at(p, s, shift);
          if (!st.alive || st.alpha <= 0) continue;
          const part = parts[p.sprite];
          const bitmap = sprites.parts[p.sprite];
          if (!part || !bitmap) continue;
          const k = sc * p.scale * st.grow;
          const w = part.w * k;
          const h = part.h * k;
          ctx.globalAlpha = st.alpha * fog;
          ctx.save();
          ctx.translate(st.x, st.y);
          if (st.angle) ctx.rotate(st.angle);
          if (st.flip !== 1) ctx.scale(1, st.flip);
          ctx.drawImage(bitmap, -part.pivot[0] * k, -part.pivot[1] * k, w, h);
          ctx.restore();
          // Whatever its pivot and turn, it stays inside this.
          const r = Math.hypot(w, h);
          const box = { x: st.x - r, y: st.y - r, w: r * 2, h: r * 2 };
          drawn = union(drawn, box);
          if (p.hero && st.alpha > 0.5) hero = { x: st.x - w * 0.6, y: st.y - h * 0.6, w: w * 1.2, h: h * 1.2 };
        }
        ctx.restore();
        tapping.target = hero;
        if (drawn) applyLight(ctx, drawn, light);
      } else {
        gone = true;
        tapping.target = null;
      }
      return union(drawn, tapping.draw(ctx, dt, wind, env.height));
    },
  };
}
