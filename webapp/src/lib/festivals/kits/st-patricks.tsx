/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * St Patrick's Day (RFC-020 §3.3): 17 March. A rainbow arcs over the
 * widgets, drawn in from a cloud at its left foot to a pot of gold at its
 * right, sparkling where it is being drawn; a tap on its top drops gold
 * coins and shamrocks. Shamrocks at two corners of each card, a green top
 * hat with a shamrock in its band and the shop's rainbow behind the
 * creatures, and the wash green from the top over gold.
 *
 * Art: webapp/scripts/festival-art/st-patricks.py (public/festivals/st-patricks/,
 * ./st-patricks.art.json). The hat is drawn here, as the shop's items are.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { GOLD, line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import ART from "./st-patricks.art.json";

const HAT = "#2E9B57";
const HAT_DARK = "#1E6E3D";

/** A shamrock's three leaves round (x, y), `r` to their tips: the one in the hat's band. */
function shamrock(x: number, y: number, r: number) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 120, 240].map((a) => (
        <circle key={a} cx={(Math.sin((a * Math.PI) / 180) * r * 0.5).toFixed(2)} cy={(-Math.cos((a * Math.PI) / 180) * r * 0.5).toFixed(2)} r={(r * 0.5).toFixed(2)} fill="#5FD38A" />
      ))}
      <circle r={r * 0.18} fill={HAT_DARK} />
      <path d={`M 0 0 q ${r * 0.3} ${r * 0.6} ${r * 0.1} ${r * 1.1}`} stroke={HAT_DARK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </g>
  );
}

export default defineFestival({
  id: "st-patricks",
  draft: true,
  // Shamrock green from the top, the pot's gold rising from below.
  wash: { light: ["142 58% 34%", "44 90% 46%"], dark: ["142 50% 48%", "45 92% 58%"] },
  visitor: {
    archetype: "arc",
    parts: ART.parts,
    // The bow is 60% of the screen's width, so on a 1080p wall its 1800-unit
    // bitmap is drawn at its own size (0.62 px a unit, the sleigh's scale,
    // which also sizes the sparkle and the coins a tap drops): every frame
    // repaints the bow's whole box, and a wider or scaled bow drops frames.
    size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
    sprite: "rainbow",
    sparkle: "sparkle",
    span: 0.6,
    grow: 2600,
    hold: 5200,
    fade: 1600,
    tap: { drops: ["coin", "shamrock", "coin"] },
  },
  // Shamrocks at two corners of each card: a sprig lying on the top edge at
  // the top-left corner, and one standing in the gap at the bottom-right.
  // Both are wholly outside the card, in the grid's gap, ending at its edge:
  // a card's content can start at its very first pixel (a full-bleed
  // camera). Diagonal corners, the same on every card, so one card's bottom
  // sprig never meets the next card's top one when the cards stack.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before,
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      height: 16px;
      width: 35px;
      background: center / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}::before {
      top: -17px;
      left: -11px;
      background-image: ${s.art("shamrocks-top")};
    }
    ${s.cards}::after {
      bottom: -17px;
      right: -11px;
      background-image: ${s.art("shamrocks-bottom")};
    }
    /* As tall as the gap: 16px on a phone, 24px from md. */
    @media (min-width: 768px) {
      ${s.cards}::before,
      ${s.cards}::after {
        height: 24px;
        width: 53px;
      }
      ${s.cards}::before {
        top: -25px;
      }
      ${s.cards}::after {
        bottom: -25px;
      }
    }
  `,
  outfit: [
    {
      slot: "head",
      item: "st_patricks_hat",
      // A green top hat, tipped a little, a dark band with a gold buckle and
      // a shamrock tucked in it.
      draw: (st) => (
        <g transform="rotate(-7 0 -28)">
          <ellipse cy="-28" rx="37" ry="8" fill={HAT_DARK} {...line(st, 3)} />
          <path d="M -21 -30 L -24 -74 Q 0 -80 24 -74 L 21 -30 Q 0 -25 -21 -30 Z" fill={HAT} {...line(st, 3)} />
          <ellipse cy="-74" rx="24" ry="5.5" fill="#3FB56A" {...line(st, 2.5)} />
          <path d="M -21.6 -38 Q 0 -33 21.6 -38 L 22.2 -47 Q 0 -42 -22.2 -47 Z" fill="#1F2A24" />
          <rect x="-7" y="-46" width="14" height="11" rx="2" fill="none" stroke={GOLD} strokeWidth="3" />
          <path d="M -26 -28 Q 0 -22 26 -28" stroke="#3FB56A" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.6" />
          {shamrock(16, -48, 7)}
          <path d="M -15 -68 L -13 -40" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" opacity="0.18" />
          {sheen(st, -11, -62, 3.5, 9, 4)}
        </g>
      ),
    },
    { slot: "background", item: "rainbow" },
  ],
});
