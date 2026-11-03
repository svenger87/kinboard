/**
 * `walk` (RFC-020 §3.3): a row of members along the bottom of the screen,
 * clear of the navigation bar, each a little out of step with the one
 * before: bobbing, swinging like a pendulum in the wind, turning. St Martin's
 * lantern walk; a parade, a hopping bunny, a dreidel, a dragon dance,
 * goldfish, a dragon boat. Alternate passes walk the other way.
 */

import { RAD, Tapping, applyLight, fogAlpha, union } from "./common";
import { walkPlan, walkPose } from "./motion";
import { drawRig } from "./rig";
import type { VisitorSprites } from "./sprites";
import type { Box, Pass, PassEnv, WalkSpec } from "./types";

export function walkPass(spec: WalkSpec, sprites: VisitorSprites, env: PassEnv): Pass {
  const sc = sprites.scale;
  const parts = spec.parts ?? {};
  const plan = walkPlan(spec, env, sc);
  const tapping = new Tapping(sprites, spec.tap);
  const { left, right, top: above, bottom: below } = spec.extent;
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
      let drawn: Box | null = null;
      const u = ms / (spec.duration ?? 12_000);
      if (u <= 1.02) {
        const { members } = walkPose(spec, plan, env, ms, wind, sc);
        ctx.save();
        ctx.globalAlpha = fogAlpha(ms, light);
        ctx.lineCap = "round";
        for (let i = 0; i < members.length; i++) {
          const m = members[i];
          if (spec.stick) {
            // The stick, from the hand below up to where the member hangs.
            const [sx, sy] = spec.stick.to;
            ctx.strokeStyle = spec.stick.color;
            ctx.lineWidth = spec.stick.width * sc;
            ctx.beginPath();
            ctx.moveTo(m.x + -plan.dir * sx * sc, m.y + sy * sc);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();
          }
          ctx.save();
          ctx.translate(m.x, m.y);
          ctx.rotate(m.swing * RAD);
          ctx.scale(sc * (spec.turn ? m.turn : 1), sc);
          const body = spec.members[i];
          if (typeof body === "string") {
            const p = parts[body];
            ctx.drawImage(sprites.parts[body], -p.pivot[0], -p.pivot[1], p.w, p.h);
          } else {
            drawRig(ctx, body, parts, sprites.parts, { t: m.t, ms, wind, sinceTap: tapping.sinceTap });
          }
          ctx.restore();
        }
        ctx.restore();
        const xs = members.map((m) => m.x);
        const minX = Math.min(...xs);
        // The row's line, without its bob: the target doesn't jump with each step.
        const top = env.height - plan.lift;
        tapping.target = { x: minX - left * sc, y: top - above * sc, w: Math.max(...xs) - minX + (left + right) * sc, h: (above + below) * sc };
        const target = tapping.target;
        // The members and their sticks down to the hands, with room for the swing.
        const reach = spec.stick ? Math.max(below, spec.stick.to[1]) : below;
        drawn = { x: target.x - 40 * sc - (spec.stick ? spec.stick.to[0] * sc : 0), y: target.y - 20, w: target.w + 80 * sc + (spec.stick ? 2 * spec.stick.to[0] * sc : 0), h: (above + reach) * sc + 40 };
        applyLight(ctx, drawn, light);
        if (plan.dir > 0 ? target.x > env.width : target.x + target.w < 0) gone = true;
      } else {
        gone = true;
        tapping.target = null;
      }
      return union(drawn, tapping.draw(ctx, dt, wind, env.height));
    },
  };
}
