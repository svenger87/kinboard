/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Thanksgiving (RFC-020 §3.3, US): the fourth Thursday of November and its
 * weekend. Autumn leaves blow across the widgets, tumbling in the wind;
 * leaves and an acorn lie on each card's corner and a pumpkin pie stands on
 * the Tasks card. The creatures wear a crown of leaves; the wash is amber
 * from the top over brown.
 *
 * Art: webapp/scripts/festival-art/thanksgiving.py (the dressing). The
 * leaves that fly are Sukkot's parts, the same drawing (_leaves.py): this
 * kit borrows that folder. The crown is drawn here.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import LEAVES from "./sukkot.art.json";

/** A small maple leaf and an oval one, centred, pointing up. */
const MAPLE = "M0 -10 L2.6 -5 L7.4 -7 L5.8 -1.8 L10 0.4 L5.2 2.6 L6.2 6.4 L1.2 4.2 L0 8.6 L-1.2 4.2 L-6.2 6.4 L-5.2 2.6 L-10 0.4 L-5.8 -1.8 L-7.4 -7 L-2.6 -5 Z";
const OVAL = "M0 -10 C 6.5 -5 6.5 4 0 9.5 C -6.5 4 -6.5 -5 0 -10 Z";
const CROWN: ReadonlyArray<[string, string, string]> = [
  // [fill, vein, shape]
  ["#F2913A", "#FFD9A0", OVAL],
  ["#D9433A", "#FFB49C", MAPLE],
  ["#F2C23A", "#FFF3C2", OVAL],
  ["#E0672A", "#FFD0A0", MAPLE],
  ["#A8642E", "#E9C79B", OVAL],
  ["#D9433A", "#FFB49C", MAPLE],
  ["#F2C23A", "#FFF3C2", OVAL],
];

export default defineFestival({
  id: "thanksgiving",
  draft: true,
  wash: { light: ["36 90% 46%", "24 45% 30%"], dark: ["38 92% 56%", "24 40% 46%"] },
  visitor: {
    archetype: "drift",
    art: "sukkot",
    parts: LEAVES.parts,
    size: { per: "width", px: 3000, min: 0.4, max: 0.64 },
    sprites: Object.keys(LEAVES.parts),
    // More of them than Sukkot's, faster, swaying wider and turning over more: blowing, not falling.
    count: 28,
    speed: [95, 155],
    sway: 90,
    scale: [0.8, 1.25],
    spin: [-2, 2],
    tumble: 0.8,
    tap: {},
  },
  // Every piece lies in the grid's gap, outside the card, and ends on the
  // card's border line (offsets count from inside the 1px border, so a piece
  // h px tall sits at -(h + 1)px): a full-bleed card, a camera or a photo,
  // has content from its first pixel row to its last. In the gap means at
  // most 16px tall below 768px wide, where the gap is 16px, and 24px from
  // there, where it is 24px.
  // Leaves and an acorn lying above each card's top corner, the other corner
  // on the next card; a pumpkin pie standing on the Tasks card's top edge,
  // clear of the leaves.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      left: -8px;
      width: 23px;
      height: 16px;
      background: ${s.art("leaves-corner")} center / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::before {
      left: auto;
      right: -8px;
      transform: scaleX(-1);
    }
    ${s.tasks} {
      position: relative;
    }
    ${s.tasks}::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      right: 36px;
      width: 22px;
      height: 16px;
      background: ${s.art("pie")} center bottom / contain no-repeat;
      pointer-events: none;
    }
    @media (min-width: 768px) {
      ${s.cards}::before {
        top: -25px;
        width: 35px;
        height: 24px;
      }
      ${s.tasks}::after {
        top: -25px;
        width: 34px;
        height: 24px;
      }
    }
  `,
  outfit: [
    {
      slot: "head",
      item: "leaf_crown",
      // Autumn leaves round the head on a twig, maple and oval by turns.
      draw: (st) => (
        <>
          <path d="M -32 -18 Q -26 -38 0 -39 Q 26 -38 32 -18" fill="none" stroke="#7A4E24" strokeWidth="3" strokeLinecap="round" />
          {CROWN.map(([fill, vein, shape], i) => {
            const a = Math.PI * (1.1 + (i / (CROWN.length - 1)) * 0.8);
            const x = Math.cos(a) * 33;
            const y = Math.sin(a) * 33 - 5;
            const turn = (a * 180) / Math.PI + 90 + (i % 2 ? 12 : -12);
            return (
              <g key={i} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${turn.toFixed(1)}) scale(${i % 2 ? 1 : 0.9})`}>
                <path d={shape} fill={fill} {...line(st, 1.5)} />
                <path d="M0 8 L0 -7" stroke={vein} strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
              </g>
            );
          })}
          {sheen(st, -16, -36, 5, 2, -25)}
        </>
      ),
    },
  ],
});
