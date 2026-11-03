/**
 * `arc` (RFC-020 §3.3): a rainbow arcing over the widgets, St Patrick's.
 * Drawn in from its left foot over `grow` ms (a wedge of the circle opening
 * clockwise), held, then faded; sparkles ride its leading edge. The bow is
 * scaled to the screen's pixels once, on the first frame, so a frame copies
 * it pixel for pixel; the wedge's clip is only there while it is drawn in.
 *
 * Its apex, not the whole bow, takes the tap: a bow over every card would
 * catch the taps meant for them.
 */

import { Tapping, applyLight, fogAlpha, union } from "./common";
import { arcAt, arcPlan } from "./motion";
import type { VisitorSprites } from "./sprites";
import type { ArcSpec, Box, Pass, PassEnv } from "./types";

export function arcPass(spec: ArcSpec, sprites: VisitorSprites, env: PassEnv): Pass {
  const plan = arcPlan(spec, env);
  const tapping = new Tapping(sprites, spec.tap);
  const part = spec.parts?.[spec.sprite];
  const bitmap = sprites.parts[spec.sprite];
  const sparkle = spec.sparkle ? { part: spec.parts?.[spec.sparkle], bitmap: sprites.parts[spec.sparkle] } : null;
  // The bow at the screen's own pixels, and where it goes, snapped to them.
  let bow: { image: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null = null;
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
      const st = arcAt(spec, ms);
      if (!st.done && part && bitmap) {
        const { cx, cy, radius } = plan;
        if (!bow) {
          // The part is drawn to the bow's width; its pivot sits on the circle's centre.
          const k = (radius * 2) / part.w;
          const dpr = ctx.getTransform().a || 1;
          const image = document.createElement("canvas");
          image.width = Math.max(1, Math.ceil(part.w * k * dpr));
          image.height = Math.max(1, Math.ceil(part.h * k * dpr));
          image.getContext("2d")?.drawImage(bitmap, 0, 0, image.width, image.height);
          const snap = (v: number) => Math.round(v * dpr) / dpr;
          bow = { image, x: snap(cx - part.pivot[0] * k), y: snap(cy - part.pivot[1] * k), w: image.width / dpr, h: image.height / dpr };
        }
        ctx.save();
        ctx.globalAlpha = st.alpha * fogAlpha(ms, light);
        if (st.reveal < 1) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, radius * 1.2, Math.PI, Math.PI + Math.PI * st.reveal);
          ctx.closePath();
          ctx.clip();
        }
        ctx.drawImage(bow.image, bow.x, bow.y, bow.w, bow.h);
        ctx.restore();
        drawn = { x: bow.x - 4, y: bow.y - 4, w: bow.w + 8, h: bow.h + 8 };
        if (sparkle?.part && sparkle.bitmap && st.reveal < 1) {
          // At the leading edge, where the bow is being drawn.
          const a = Math.PI + Math.PI * st.reveal;
          const sk = sprites.scale;
          for (let i = 0; i < 3; i++) {
            const r = radius * (0.85 + i * 0.06);
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            const s = sparkle.part.w * sk * (0.7 + 0.3 * Math.sin(ms / 90 + i));
            ctx.globalAlpha = st.alpha;
            ctx.drawImage(sparkle.bitmap, x - s / 2, y - s / 2, s, s);
          }
          ctx.globalAlpha = 1;
        }
        // The apex: 30% of the bow's width, its top band.
        tapping.target = st.reveal > 0.6 ? { x: cx - radius * 0.15, y: cy - radius - 20, w: radius * 0.3, h: Math.max(60, radius * 0.25) } : null;
        applyLight(ctx, drawn, light);
      } else {
        gone = true;
        tapping.target = null;
      }
      return union(drawn, tapping.draw(ctx, dt, wind, env.height));
    },
  };
}
