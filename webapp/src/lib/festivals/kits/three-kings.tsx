/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Three Kings' Day (Día de Reyes, RFC-020 §3.3; ES, MX): 5 and 6 January.
 * Three crowns parade along the bottom of the screen, each rocking on a
 * velvet cushion as it's carried, as in the cabalgata on the evening of the
 * 5th; a tap throws sweets, as the floats do. A ring cake, the roscón, sits
 * in a corner of the cards; the creatures wear a crown; the wash is gold
 * from the top over purple.
 *
 * Art: webapp/scripts/festival-art/three-kings.py (public/festivals/three-kings/,
 * ./three-kings.art.json). The creatures' crown is drawn here.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { GOLD, line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import ART from "./three-kings.art.json";

const W = ART.rig.walk;

export default defineFestival({
  id: "three-kings",
  wash: { light: ["44 88% 46%", "274 48% 36%"], dark: ["45 90% 58%", "274 52% 60%"] },
  visitor: {
    archetype: "walk",
    parts: ART.parts,
    size: { per: "height", px: 1400, min: 0.45, max: 0.8 },
    members: ["crown-points", "crown-arches", "crown-rays"],
    gap: [190, 30],
    tail: 75,
    // The cushion's foot rides a little above the navigation bar.
    lift: { art: 12, px: [8, 30] },
    period: W.period,
    lag: W.lag,
    // Carried at a stately step: a lift each step, rocking on the cushion.
    bob: { amp: W.bob, hop: true },
    swing: { amp: W.swing, lag: 0.12, wind: 0.25 },
    extent: { left: 66, right: 66, top: 120, bottom: 4 },
    // The floats throw sweets.
    tap: { drops: ["sweet-red", "sweet-gold", "sweet-violet"], at: [0.5, 0.35] },
  },
  // The roscón on the top edge of every other card, in its right corner,
  // wholly in the gap above, ending on the card's border line (offsets count
  // from inside the 1px border): 16px tall where the grid's gap is 16px, 23px
  // from md up, where it is 24px.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}:nth-child(odd)::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      right: 18px;
      width: 42px;
      height: 16px;
      background: ${s.art("roscon")} center bottom / contain no-repeat;
      pointer-events: none;
    }
    @media (min-width: 768px) {
      ${s.cards}:nth-child(odd)::after {
        top: -24px;
        width: 60px;
        height: 23px;
      }
    }
  `,
  outfit: [
    {
      slot: "head",
      item: "three_kings_crown",
      // A gold crown with five pearl-tipped points and three stones.
      draw: (st) => (
        <>
          <path
            d="M -27 -18 L -30 -44 L -19 -32 L -10 -50 L 0 -34 L 10 -50 L 19 -32 L 30 -44 L 27 -18 Q 0 -12 -27 -18 Z"
            fill={GOLD}
            {...line(st, 3)}
          />
          <path d="M -27 -18 L -28 -27 Q 0 -21 28 -27 L 27 -18 Q 0 -12 -27 -18 Z" fill="#E0A21E" {...line(st, 2)} />
          <path d="M -10 -50 L 0 -34 L -3 -34 Z M 10 -50 L 19 -32 L 16 -33 Z" fill="#C8891A" opacity="0.5" />
          {[
            [-30, -45, 3.2],
            [-10, -51, 3.6],
            [10, -51, 3.6],
            [30, -45, 3.2],
          ].map(([x, y, r]) => (
            <g key={x}>
              <circle cx={x} cy={y} r={r} fill="#FFFDF6" {...line(st, 1.6)} />
              <circle cx={x - 1} cy={y - 1.1} r={r * 0.35} fill="#FFFFFF" />
            </g>
          ))}
          <ellipse cx="0" cy="-22" rx="4" ry="3.6" fill="#E8243F" {...line(st, 1.6)} />
          <circle cx="-14" cy="-22.5" r="2.6" fill="#2F6BE0" {...line(st, 1.4)} />
          <circle cx="14" cy="-22.5" r="2.6" fill="#1FA968" {...line(st, 1.4)} />
          <circle cx="-1.2" cy="-23.4" r="1.1" fill="#FFFFFF" opacity="0.9" />
          {sheen(st, -16, -32, 3, 7, 20)}
        </>
      ),
    },
  ],
});
