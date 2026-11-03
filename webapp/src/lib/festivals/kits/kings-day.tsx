/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * King's Day (Koningsdag, RFC-020 §3.3): 27 April, the 26th when the 27th
 * is a Sunday. Orange balloons in three shades rise from the bottom of the
 * screen, swaying on their strings; a tap on the biggest drops tompouces.
 * Orange bunting along every card's top edge, an orange crown for the
 * creatures, and the wash orange from the top over blue.
 *
 * Art: webapp/scripts/festival-art/kings-day.py (public/festivals/kings-day/,
 * ./kings-day.art.json). The crown is drawn here, as the shop's items are.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { GOLD, line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import ART from "./kings-day.art.json";

const ORANGE = "#FF8A1F";

export default defineFestival({
  id: "kings-day",
  wash: { light: ["28 95% 48%", "214 68% 38%"], dark: ["28 95% 58%", "214 62% 58%"] },
  visitor: {
    archetype: "rise",
    parts: ART.parts,
    // A balloon 90 units wide: 56px on a 1080p wall.
    size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
    sprites: ["balloon", "balloon", "balloon-light", "balloon-deep"],
    count: 18,
    speed: [80, 130],
    sway: 16,
    scale: [0.8, 1.15],
    ceiling: 0.06,
    duration: 11_000,
    tap: { drops: ["tompouce"], at: [0.5, 0.3] },
  },
  // Orange bunting along every card's top edge, hanging in the gap above it
  // down to the edge and never over it (a card's content can start at its
  // very first pixel): an 85 x 16 px tile repeated; every other card starts
  // half a tile on.
  dressing: (s) => css`
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
      background: ${s.art("bunting")} repeat-x 0 0 / 85px 16px;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::before {
      background-position: -42px 0;
    }
  `,
  outfit: [
    {
      slot: "head",
      item: "kings_day_crown",
      // A gold crown, tipped a little, an orange cap inside it, orange
      // stones on the band and pearls on its five points.
      draw: (st) => (
        <g transform="rotate(-6 0 -30)">
          <path d="M -24 -33 Q 0 -66 24 -33 Z" fill={ORANGE} {...line(st, 2.5)} />
          <path d="M -12 -48 Q 0 -60 10 -50" stroke="#FFB766" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.8" />
          <path d="M -28 -26 L -30 -56 L -17 -42 L -9 -62 L 0 -44 L 9 -62 L 17 -42 L 30 -56 L 28 -26 Q 0 -21 -28 -26 Z" fill={GOLD} {...line(st, 3)} />
          <path d="M -28 -26 Q 0 -21 28 -26 L 28.6 -34 Q 0 -29 -28.6 -34 Z" fill="#E8A417" />
          {[-30, -9, 9, 30].map((x, i) => (
            <circle key={x} cx={x} cy={i === 1 || i === 2 ? -63 : -57} r="3.2" fill="#FFF6E0" {...line(st, 1.5)} />
          ))}
          <circle cx="0" cy="-46" r="3" fill="#FFF6E0" {...line(st, 1.5)} />
          {[-16, 0, 16].map((x) => (
            <ellipse key={x} cx={x} cy="-29.5" rx={x === 0 ? 4.2 : 3.2} ry="3" fill={x === 0 ? "#2F6BC4" : ORANGE} {...line(st, 1.5)} />
          ))}
          <path d="M -24 -30 L -25 -48" stroke="#FFF1A8" strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />
          {sheen(st, -18, -36, 2.5, 6, 0)}
        </g>
      ),
    },
  ],
});
