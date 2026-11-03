/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Christmas (RFC-020 §3.3): the first Sunday of Advent to 6 January. The
 * sleigh with Santa and two galloping reindeer flies over the widgets, snow
 * rests on every card, the creatures wear a Santa hat, and the wash is red
 * from the top and pine green from the bottom.
 *
 * Art: webapp/scripts/festival-art/christmas.py (public/festivals/christmas/,
 * ./christmas.art.json, the groundwork's parts, rig and gallop).
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import type { Rig, RigNode } from "@/lib/festivals/visitors/types";
import ART from "./christmas.art.json";

const G = ART.rig.gait;
const R = ART.rig.reindeer;
const SL = ART.rig.sleigh;
const P = ART.parts;
const pt = (v: number[]): [number, number] => [v[0], v[1]];

/** A leg: the upper segment at the hip or shoulder, the lower hanging from its knee or hock, behind it. */
function leg(kind: "front" | "back", far: boolean): RigNode {
  const suffix = far ? "-far" : "";
  const at = R.legs[kind];
  const off = far ? R.far_offset : [0, 0];
  const phase = G.phase[`${kind}${suffix}` as keyof typeof G.phase];
  return {
    part: `reindeer-${kind}-upper${suffix}`,
    at: [at[0] + off[0], at[1] + off[1]],
    phase,
    rotate: { keys: G.legs[kind].upper },
    under: [{ part: `reindeer-${kind}-lower${suffix}`, at: pt(R.joints[kind]), rotate: { keys: G.legs[kind].lower } }],
  };
}

/**
 * A reindeer, `k` places behind the sleigh: the body pitches and rises once
 * a stride, the head counters the pitch, the tail flicks twice a stride, the
 * far legs behind, and the second runs out of step with the first.
 */
function reindeer(k: number, lead: boolean): RigNode {
  const bp = P["reindeer-body"].pivot;
  return {
    part: "reindeer-body",
    at: [R.first[0] + k * R.spacing + bp[0], R.first[1] + bp[1]],
    phase: k * G.second_deer_phase,
    // Bobbing in the wind (on the wall clock), and rising once a stride.
    y: [{ sine: 3, ms: 800 * 2 * Math.PI, phase: k / (2 * Math.PI), wind: [0.4, 1] }, { wave: [G.body.bob[0], -0.25] }],
    rotate: { wave: [G.body.pitch[0], G.body.pitch[1]] },
    under: [leg("back", true), leg("front", true), { part: "reindeer-tail", at: pt(R.tail), rotate: { wave: [G.tail.flick[0], G.tail.flick[1]], freq: G.tail.freq } }, leg("back", false), leg("front", false)],
    over: [
      {
        part: lead ? "reindeer-head-lead" : "reindeer-head",
        at: pt(R.head),
        rotate: [{ wave: [G.head.follow * G.body.pitch[0], G.body.pitch[1]] }, { wave: [G.head.nod[0], G.head.nod[1]] }],
      },
    ],
    anchors: { [`rein-${k}`]: pt(R.rein_ring) },
  };
}

/** The team: the sleigh riding the stride with a lag, Santa's arm with the reins (waving after a tap), two reindeer, the reins live between. */
export const SLEIGH: Rig = {
  period: G.period,
  root: {
    over: [
      {
        part: "sleigh",
        at: pt(P.sleigh.pivot),
        y: { wave: [G.sleigh.bob[0], G.sleigh.bob[1]], freq: 0.5 },
        rotate: { wave: [G.sleigh.sway[0], G.sleigh.sway[1]], freq: 0.5 },
        anchors: { hands: pt(SL.reins_from) },
        over: [{ part: "santa-arm", at: pt(SL.arm.at), rotate: { wave: [G.sleigh.arm[0], G.sleigh.arm[1]], tapped: { amp: 6, speed: 2.5, ms: 1500 } } }],
      },
      reindeer(0, false),
      reindeer(1, true),
    ],
  },
  lines: [{ from: "hands", to: ["rein-0", "rein-1"], color: "#C9A46E", width: 2, sag: 26 }],
};

export default defineFestival({
  id: "christmas",
  wash: { light: ["355 70% 46%", "152 55% 28%"], dark: ["355 72% 58%", "150 48% 44%"] },
  visitor: {
    archetype: "fly",
    parts: P,
    // 0.62 of the drawing on a 1080p wall (the prototype's), smaller on a phone.
    size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
    body: SLEIGH,
    // The sleigh and both reindeer, heads and hooves.
    box: [-10, -70, R.first[0] + R.spacing + 270, 320],
    length: R.first[0] + R.spacing + 260,
    // Presents from under the sleigh, where Santa sits.
    tap: { presents: true, at: [150 / (R.first[0] + R.spacing + 270), 150 / 320] },
  },
  // Snow resting on each card's top edge, entirely in the grid's gap (16px or
  // more) above it. It used to reach 12px down into the card, over its
  // padding — but a full-bleed card (a camera, a photo) has content right at
  // its edge, and the snow sat on the picture (festivals-ui, CI's camera
  // mock). Same art, scaled to 16px, ending exactly at the card's edge:
  // a full-bleed card's picture starts on that very line, so not even the
  // border row is free (CI measured a 1px overlap at -15px). -17px, since
  // the offset counts from inside the 1px border and card heights can be
  // fractional: the cap ends on the border line.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      left: -2px;
      right: -2px;
      height: 16px;
      border-radius: 14px 14px 6px 6px;
      background: ${s.art("snow-cap")} repeat-x 0 0 / 91px 16px;
      pointer-events: none;
    }
    ${s.cards}:nth-child(odd)::before {
      background-position: -36px 0;
    }
  `,
  outfit: [
    {
      slot: "head",
      item: "santa_hat",
      // Red, flopping to one side, a fur brim and a pompom.
      draw: (st) => (
        <>
          <path d="M -29 -22 C -29 -50 -4 -64 20 -58 C 36 -54 46 -42 50 -28 C 44 -34 36 -40 26 -41 C 30 -34 31 -28 30 -22 Z" fill="#D9333F" {...line(st, 3)} />
          <path d="M 26 -41 C 36 -40 44 -34 50 -28 C 46 -42 38 -52 26 -56 C 30 -50 30 -45 26 -41 Z" fill="#A8222D" />
          <path d="M -36 -24 Q -36 -31 -28 -31 L 28 -31 Q 36 -31 36 -24 L 36 -18 Q 36 -12 28 -12 L -28 -12 Q -36 -12 -36 -18 Z" fill="#FBF6EE" {...line(st, 3)} />
          {[-28, -18, -8, 2, 12, 22, 30].map((x, i) => (
            <circle key={x} cx={x} cy={i % 2 ? -17 : -25} r="1.6" fill="#E3DACB" />
          ))}
          <circle cx="50" cy="-26" r="8" fill="#FBF6EE" {...line(st, 2.5)} />
          <circle cx="47.5" cy="-28.5" r="2.4" fill="#FFFFFF" />
          {sheen(st, -14, -44, 9, 4, -35)}
        </>
      ),
    },
  ],
});
