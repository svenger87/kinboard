/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Hanukkah (RFC-020 §3.3): eight nights from Kislev 25. Two dreidels spin
 * along the bottom of the screen, wobbling on their points, and a tap drops
 * chocolate coins; a row of eight candles stands on the cards' top edge, one
 * more lit each night; the creatures wear a knitted blue hat; the wash is
 * blue from the top over silver.
 *
 * A dreidel spins as a rig (its faces slide round its square body), not as
 * one sprite squashed side to side by `walk`'s `turn`: see the art script.
 *
 * Art: webapp/scripts/festival-art/hanukkah.py (public/festivals/hanukkah/,
 * ./hanukkah.art.json). The hat is drawn here.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import type { Rig, RigNode } from "@/lib/festivals/visitors/types";
import ART from "./hanukkah.art.json";

const SPIN = ART.rig.spin;
const WALK = ART.rig.walk;
const pt = (v: number[]): [number, number] => [v[0], v[1]];
const LETTERS = ["nun", "gimel", "hei", "shin"] as const;

/** A dreidel: its body stretched to its silhouette, its four faces sliding round, the light fixed over them, wobbling on its point. */
function dreidel(colour: "blue" | "silver", phase: number): Rig {
  const faces: RigNode[] = LETTERS.map((letter, k) => ({
    part: `face-${colour}-${letter}`,
    at: pt(SPIN.face_at),
    phase: k / 4,
    x: { keys: SPIN.face_x },
    scaleX: { keys: SPIN.face_w },
  }));
  return {
    period: WALK.period,
    root: {
      phase,
      // Precessing on its point: slower than the spin, further in the wind.
      rotate: { sine: WALK.wobble, ms: WALK.wobble_ms, phase, wind: [1, 0.5] },
      over: [{ part: `dreidel-${colour}`, scaleX: { keys: SPIN.body_w } }, ...faces, { part: "dreidel-shade", at: pt(SPIN.shade_at), scaleX: { keys: SPIN.body_w } }],
    },
  };
}

const NIGHTS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `night-${n}`);

/** The knit's rows: a V of two stitches, alternate rows offset. */
function knit(y: number, from: number, to: number, color: string) {
  const out = [];
  for (let x = from; x <= to; x += 7) {
    out.push(<path key={`${x}-${y}`} d={`M ${x - 2.6} ${y - 2.4} L ${x} ${y + 1.6} L ${x + 2.6} ${y - 2.4}`} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />);
  }
  return out;
}

export default defineFestival({
  id: "hanukkah",
  draft: true,
  wash: { light: ["216 72% 42%", "214 16% 60%"], dark: ["216 76% 60%", "214 20% 74%"] },
  visitor: {
    archetype: "walk",
    parts: ART.parts,
    size: { per: "height", px: 1400, min: 0.5, max: 0.8 },
    members: [dreidel("blue", 0), dreidel("silver", 0.37)],
    gap: [280, 80],
    tail: 45,
    // The point a little above the navigation bar.
    lift: { art: 8, px: [6, 26] },
    period: WALK.period,
    lag: 0.31,
    bob: { amp: WALK.bob },
    extent: { left: 46, right: 46, top: 150, bottom: 4 },
    tap: { drops: ["gelt-gold", "gelt-silver"], at: [0.5, 0.45] },
  },
  // Eight candles in silver cups on the top edge of every other card, in its
  // right corner, wholly in the gap above, ending on the card's border line
  // (offsets count from inside the 1px border): 16px tall where the grid's
  // gap is 16px, 23px from md up, where it is 24px. One more lit
  // each night, the newest on the left, as they are added.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}:nth-child(odd)::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      right: 16px;
      width: 49px;
      height: 16px;
      background: ${s.art("lights-8")} center bottom / contain no-repeat;
      pointer-events: none;
    }
    @media (min-width: 768px) {
      ${s.cards}:nth-child(odd)::after {
        top: -24px;
        width: 71px;
        height: 23px;
      }
    }
    ${NIGHTS.slice(0, 7)
      .map((night, i) => `${s.cardsAt(night)}:nth-child(odd)::after { background-image: ${s.art(`lights-${i + 1}`)}; }`)
      .join("\n")}
  `,
  outfit: [
    {
      slot: "head",
      item: "knit_hat_hanukkah",
      // A knitted blue beanie: a ribbed cuff, white and silver bands, a pompom.
      draw: (st) => (
        <>
          <path d="M -31 -20 Q -32 -54 0 -56 Q 32 -54 31 -20 Z" fill="#2F6FD6" {...line(st, 3)} />
          <path d="M -30 -34 Q 0 -40 30 -34 L 30.6 -28 Q 0 -34 -30.6 -28 Z" fill="#F2F6FF" />
          <path d="M -27 -44 Q 0 -50 27 -44 L 28.5 -40 Q 0 -45.5 -28.5 -40 Z" fill="#C8D2E0" />
          {knit(-47, -18, 18, "#173C82")}
          {knit(-23, -24, 24, "#173C82")}
          <path d="M -34 -24 Q 0 -31 34 -24 L 34 -14 Q 0 -21 -34 -14 Z" fill="#2456B8" {...line(st, 3)} />
          {[-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30].map((x) => (
            <path key={x} d={`M ${x} ${-26 + Math.abs(x) * 0.07} L ${x} ${-16 + Math.abs(x) * 0.07}`} stroke="#173C82" strokeWidth="1.6" opacity="0.5" strokeLinecap="round" />
          ))}
          <circle cx="0" cy="-60" r="8.5" fill="#F2F6FF" {...line(st, 2.5)} />
          <circle cx="-3" cy="-63" r="2.6" fill="#FFFFFF" />
          <circle cx="3" cy="-57" r="2.2" fill="#C8D2E0" opacity="0.8" />
          {sheen(st, -15, -44, 8, 3.5, -25)}
        </>
      ),
    },
  ],
  // Nights from the eve's candle: one on the first day, a second from its
  // dusk, ... eight on the last.
  stage: (at) => NIGHTS[Math.min(7, Math.max(0, at.dayIndex + (at.afterDusk ? 1 : 0)))],
  stages: NIGHTS,
  previewStage: "night-8",
});
