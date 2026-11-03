/**
 * A rig (RFC-020 §5.1): a visitor drawn from parts that move against each
 * other, as data. Each node turns about its own pivot at a point of its
 * parent's drawing, by curves of the rig's cycle (a gallop, a step); the
 * whole tree is a few save/translate/rotate/drawImage calls a frame. Lines
 * between named points are drawn live under it (the reins sag and tighten).
 *
 * The sleigh team is one (lib/festivals/kits/christmas.ts builds it from the
 * art's rig and gait), and so can a hopping bunny's ears or a dragon boat's
 * paddlers be.
 */

import { RAD } from "./common";
import { evalCurve, type CurveClock } from "./motion";
import type { Bitmap } from "./sprites";
import type { PartSpec, Rig, RigNode } from "./types";

const NO_PIVOT = [0, 0];

/**
 * Draw `rig` with its root at the context's origin (the caller has placed,
 * banked and scaled it), `at.t` in cycles. Returns the anchors it passed, in
 * the canvas's device pixels, for the lines.
 */
export function drawRig(
  ctx: CanvasRenderingContext2D,
  rig: Rig,
  parts: Record<string, PartSpec>,
  bitmaps: Record<string, Bitmap>,
  at: CurveClock,
): Map<string, DOMPoint> {
  const anchors = new Map<string, DOMPoint>();
  const node = (n: RigNode, parentPivot: number[], t: number) => {
    const clock = { ...at, t: t + (n.phase ?? 0) };
    const spec = n.part ? parts[n.part] : null;
    const pivot = spec?.pivot ?? NO_PIVOT;
    const [ax, ay] = n.at ?? [0, 0];
    ctx.save();
    ctx.translate(ax - parentPivot[0] + evalCurve(n.x, clock), ay - parentPivot[1] + evalCurve(n.y, clock));
    const deg = evalCurve(n.rotate, clock);
    if (deg) ctx.rotate(deg * RAD);
    if (n.scaleX !== undefined || n.scaleY !== undefined) {
      ctx.scale(n.scaleX === undefined ? 1 : evalCurve(n.scaleX, clock), n.scaleY === undefined ? 1 : evalCurve(n.scaleY, clock));
    }
    for (const child of n.under ?? []) node(child, pivot, clock.t);
    if (spec && n.part) ctx.drawImage(bitmaps[n.part], -pivot[0], -pivot[1], spec.w, spec.h);
    for (const [name, [x, y]] of Object.entries(n.anchors ?? {})) {
      anchors.set(name, ctx.getTransform().transformPoint(new DOMPoint(x - pivot[0], y - pivot[1])));
    }
    for (const child of n.over ?? []) node(child, pivot, clock.t);
    ctx.restore();
  };
  node(rig.root, NO_PIVOT, at.t);
  return anchors;
}

/**
 * The rig's lines (the reins), under everything drawn so far, between
 * anchors in device pixels: from `from` to each of `to`, sagging below the
 * lower end. `scale` is the rig's, `nominal` the size its line widths were
 * drawn for.
 */
export function drawRigLines(
  ctx: CanvasRenderingContext2D,
  rig: Rig,
  anchors: Map<string, DOMPoint>,
  scale: number,
  nominal: number,
  alpha: number,
) {
  if (!rig.lines?.length) return;
  const dpr = ctx.getTransform().a || 1;
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.globalAlpha = alpha;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const line of rig.lines) {
    const from = anchors.get(line.from);
    if (!from) continue;
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.width * dpr * Math.max(0.6, scale / nominal);
    for (const name of line.to) {
      const r = anchors.get(name);
      if (!r) continue;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo((from.x + r.x) / 2, Math.max(from.y, r.y) + line.sag * scale * dpr, r.x, r.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}
