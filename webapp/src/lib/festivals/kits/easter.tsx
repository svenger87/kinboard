/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Easter (RFC-020 §3.3): Palm Sunday to Easter Monday. Two bunnies hop along
 * the bottom of the screen, a caramel one and a little white one behind it,
 * out of step: on the ground the long hind feet come forward under the
 * body, the haunches drive back on the push, the body stretches out nose-up
 * and gathers nose-down for the landing, the forepaws reach for it, the
 * ears lag every move and blow back in the wind, the tail flicks, and the
 * bunny squashes as it lands. A tap drops painted eggs. Bunting along every
 * card's top edge, painted eggs in a nest of grass at a bottom corner, bunny
 * ears for the creatures, and the wash spring green from the top over
 * yellow.
 *
 * Orthodox Easter (./orthodox-easter.ts) flies the same bunnies and hangs
 * the same bunting, from this kit, with eggs dyed red.
 *
 * Art: webapp/scripts/festival-art/easter.py (public/festivals/easter/,
 * ./easter.art.json, with the joints and the hop).
 */

import type { ReactNode } from "react";
import { css, defineFestival, type DressingSelectors, type Wash } from "@/lib/festivals/kit";
import { line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import type { StyleSpec } from "@/lib/pocket-money/creatures/styles";
import type { Curve, Rig, RigNode, WalkSpec } from "@/lib/festivals/visitors/types";
import ART from "./easter.art.json";

const R = ART.rig;
const HOP = R.hop;
const pt = (v: number[]): [number, number] => [v[0], v[1]];
const plus = (a: number[], b: number[]): [number, number] => [a[0] + b[0], a[1] + b[1]];
const keys = (k: number[][]): Curve => ({ keys: k });

/** The head counters the body's pitch, so the bunny looks where it's going. */
const HEAD_KEYS = HOP.body.map(([t, v]) => [t, v * HOP.head_follow]);
/** The ears blow back in the wind (a constant lean, as strong as the gust, from a sine too slow to turn), and flutter in it. */
const EARS_IN_WIND: Curve = [
  { sine: -10, ms: 1e9, phase: 0.25, wind: [0, 1] },
  { sine: 2.5, ms: 260, wind: [0, 1] },
];

/** A bunny, `size` of the drawing, in one of the art's two coats. Its origin is on the ground under its middle. */
function bunny(coat: "" | "-white", size = 1): Rig {
  const part = (name: string) => `bunny-${name}${coat}`;
  const hind = (far: boolean): RigNode => ({
    part: part(far ? "thigh-far" : "thigh"),
    at: far ? plus(R.body.hip, R.far_offset) : pt(R.body.hip),
    phase: far ? 0.03 : 0,
    rotate: keys(HOP.thigh),
    // The foot under the haunch: its heel at the hock.
    under: [{ part: part(far ? "foot-far" : "foot"), at: pt(R.thigh.hock), rotate: keys(HOP.foot) }],
  });
  const fore = (far: boolean): RigNode => ({
    part: part(far ? "fore-far" : "fore"),
    at: far ? plus(R.body.shoulder, R.far_offset) : pt(R.body.shoulder),
    phase: far ? 0.06 : 0,
    rotate: keys(HOP.fore),
  });
  const ear = (far: boolean): RigNode => ({
    part: part(far ? "ear-far" : "ear"),
    at: pt(far ? R.head.ear_far : R.head.ear),
    phase: far ? HOP.ear_far_lag : 0,
    rotate: [keys(HOP.ears), far ? -9 : 0, ...(EARS_IN_WIND as Curve[])],
  });
  const body: RigNode = {
    part: part("body"),
    at: [0, -R.ground],
    rotate: keys(HOP.body),
    under: [hind(true), fore(true)],
    over: [
      hind(false),
      fore(false),
      { part: part("tail"), at: pt(R.body.tail), rotate: { wave: [HOP.tail[0], HOP.tail[1]], freq: 2 } },
      { part: part("head"), at: pt(R.body.neck), rotate: keys(HEAD_KEYS), under: [ear(true), ear(false)] },
    ],
  };
  // Squashing as it lands and stretching as it pushes off, about its feet.
  const hop: RigNode = { scaleX: keys(HOP.stretch), scaleY: keys(HOP.squash), over: [body] };
  return { period: HOP.period, root: size === 1 ? hop : { scaleX: size, scaleY: size, over: [hop] } };
}

/** The bunnies' walk, for Easter and Orthodox Easter: a little white one behind a caramel one. */
export const BUNNIES: WalkSpec = {
  archetype: "walk",
  parts: ART.parts,
  // 208 units from the ground to the ears' tips: 125px on a 1080p wall.
  size: { per: "height", px: 1800, min: 0.38, max: 0.6 },
  members: [bunny("-white", 0.72), bunny("")],
  gap: [250, 70],
  tail: 130,
  // Its feet just clear of the navigation bar.
  lift: { art: 4, px: [8, 30] },
  duration: 9_500,
  period: HOP.period,
  lag: 0.45,
  // One hop a step, as high as the bunny's back.
  bob: { amp: 58, hop: true },
  // The bunnies face right.
  direction: "ltr",
  // Tail and pushing feet behind, nose and reaching paws in front; the ears and the hop above.
  extent: { left: 140, right: 115, top: 300, bottom: 12 },
  tap: { drops: ["egg-blue", "egg-pink", "egg-yellow"], at: [0.6, 0.75] },
};

export const EASTER_WASH: Wash = { light: ["100 55% 36%", "48 92% 48%"], dark: ["100 48% 50%", "50 95% 60%"] };

/**
 * Bunting along every card's top edge, hanging in the gap above it down to
 * the edge: an 85 x 16 px tile repeated. A nest of eggs in the gap under a
 * bottom corner, 46 x 20 px: right on one card, left on the next. Both stay
 * wholly outside the card, whose content can start at its very first pixel
 * (a full-bleed camera).
 * `art` is where the drawings come from (Orthodox Easter's are Easter's),
 * `nest` which eggs.
 */
export function easterDressing(s: DressingSelectors, art: (name: string) => string, nest: "eggs-corner" | "eggs-corner-red"): string {
  return css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before {
      content: "";
      position: absolute;
      z-index: 2;
      top: -16px;
      left: 8px;
      right: 8px;
      height: 16px;
      background: ${art("bunting")} repeat-x 0 0 / 85px 16px;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::before {
      background-position: -42px 0;
    }
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      bottom: -20px;
      right: 14px;
      width: 46px;
      height: 20px;
      background: ${art(nest)} center / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::after {
      right: auto;
      left: 14px;
    }
  `;
}

/** Bunny ears on a pink band: one upright, one with its tip flopped over. */
export const BUNNY_EARS = (st: StyleSpec): ReactNode => (
  <>
    <g transform="rotate(-14 -12 -30)">
      <path d="M -12 -27 C -24 -40 -23 -72 -12 -84 C -1 -72 0 -40 -12 -27 Z" fill="#FFF8F2" {...line(st, 3)} />
      <path d="M -12 -36 C -18 -47 -18 -68 -12 -76 C -6 -68 -6 -47 -12 -36 Z" fill="#FFB3C4" />
      <path d="M -18 -44 C -19 -56 -17 -66 -14 -74" stroke="#FFFFFF" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity="0.7" />
    </g>
    <g transform="rotate(16 12 -30)">
      <path d="M 12 -27 C 0 -38 0 -60 12 -68 C 24 -60 24 -38 12 -27 Z" fill="#FFF8F2" {...line(st, 3)} />
      <path d="M 12 -35 C 6 -44 6 -58 12 -62 C 18 -58 18 -44 12 -35 Z" fill="#FFB3C4" />
      <path d="M 12 -68 C 18 -74 30 -71 31 -60 C 26 -63 19 -63 12 -68 Z" fill="#EFE3D8" {...line(st, 2.5)} />
    </g>
    <path d="M -31 -14 A 34 34 0 0 1 31 -14" stroke="#FF8FB1" strokeWidth="5" fill="none" strokeLinecap="round" />
    <path d="M -27 -20 A 30 30 0 0 1 -8 -33" stroke="#FFD3E0" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    {sheen(st, -16, -58, 2.5, 8, -14)}
  </>
);

export default defineFestival({
  id: "easter",
  wash: EASTER_WASH,
  visitor: BUNNIES,
  dressing: (s) => easterDressing(s, s.art, "eggs-corner"),
  outfit: [{ slot: "head", item: "bunny_ears", draw: BUNNY_EARS }],
});
