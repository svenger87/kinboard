/**
 * `fly` (RFC-020 §2.1): one crossing left to right in about ten seconds, on
 * an arc whose height and depth change from pass to pass (never parking over
 * the same card twice running), banking with its path and drifting in the
 * weather's wind. The sleigh.
 */

import { RAD, Tapping, applyLight, fogAlpha, union } from "./common";
import { flyPlan, flyPose, PASS_MS } from "./motion";
import { drawRig, drawRigLines } from "./rig";
import type { VisitorSprites } from "./sprites";
import type { Box, FlySpec, Pass, PassEnv } from "./types";

export function flyPass(spec: FlySpec, sprites: VisitorSprites, env: PassEnv): Pass {
  const sc = sprites.scale;
  const parts = spec.parts ?? {};
  const plan = flyPlan(spec, env);
  const tapping = new Tapping(sprites, spec.tap);
  const [bx, by, bw, bh] = spec.box;
  const duration = spec.duration ?? PASS_MS;
  let drift = 0;
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
      const u = ms / duration;
      if (u <= 1.05) {
        // The weather's gust pushes it along, and it bobs and banks with it.
        drift += wind * 18 * dt;
        const { x, y, bank } = flyPose(spec, plan, env, ms, wind, drift, sc);
        const alpha = fogAlpha(ms, light);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(bank * RAD);
        ctx.scale(sc, sc);
        if (typeof spec.body === "string") {
          const p = parts[spec.body];
          ctx.drawImage(sprites.parts[spec.body], -p.pivot[0], -p.pivot[1], p.w, p.h);
          ctx.restore();
        } else {
          const t = ms / 1000 / spec.body.period;
          const anchors = drawRig(ctx, spec.body, parts, sprites.parts, { t, ms, wind, sinceTap: tapping.sinceTap });
          ctx.restore();
          // The lines (the reins), under the rest, between the anchors it passed.
          drawRigLines(ctx, spec.body, anchors, sc, spec.size.max, alpha);
        }
        // Its own box, for the tap.
        tapping.target = { x: x + bx * sc, y: y + by * sc, w: bw * sc, h: bh * sc };
        const target = tapping.target;
        drawn = { x: target.x - 24, y: target.y - 24, w: target.w + 48, h: target.h + 48 };
        applyLight(ctx, drawn, light);
        if (x > env.width + 10) gone = true;
      } else {
        gone = true;
        tapping.target = null;
      }
      return union(drawn, tapping.draw(ctx, dt, wind, env.height));
    },
  };
}
