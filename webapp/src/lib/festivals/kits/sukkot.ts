/**
 * Sukkot (RFC-020 §3.3): Tishri 15, seven days. Autumn leaves drift down
 * over the widgets, turning over as they fall; fruit and leaves hang from
 * each card on a string, as they hang in a sukkah. No outfit; the wash is
 * harvest gold from the top over green.
 *
 * Art: webapp/scripts/festival-art/sukkot.py (public/festivals/sukkot/,
 * ./sukkot.art.json). The leaves are _leaves.py's, shared with Thanksgiving.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import ART from "./sukkot.art.json";

export default defineFestival({
  id: "sukkot",
  draft: true,
  wash: { light: ["40 85% 44%", "118 40% 30%"], dark: ["42 90% 58%", "112 38% 46%"] },
  visitor: {
    archetype: "drift",
    parts: ART.parts,
    // A leaf 64 units across: about 40px on a 1080p wall, 26px on a phone.
    size: { per: "width", px: 3000, min: 0.4, max: 0.64 },
    sprites: Object.keys(ART.parts),
    count: 22,
    speed: [70, 125],
    sway: 40,
    scale: [0.8, 1.2],
    spin: [-1.1, 1.1],
    tumble: 0.45,
    tap: {},
  },
  // Every piece lies in the grid's gap, outside the card, and ends on the
  // card's border line (offsets count from inside the 1px border, so a piece
  // h px tall sits at -(h + 1)px): a full-bleed card, a camera or a photo,
  // has content from its first pixel row to its last. In the gap means at
  // most 16px tall below 768px wide, where the gap is 16px, and 24px from
  // there, where it is 24px.
  // A string of fruit and leaves hanging from each card's bottom edge into
  // the gap below, alternate cards on the other side.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      bottom: -17px;
      right: 18px;
      width: 59px;
      height: 16px;
      background: ${s.art("fruit-hanging")} center top / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::after {
      right: auto;
      left: 18px;
    }
    @media (min-width: 768px) {
      ${s.cards}::after {
        bottom: -25px;
        width: 88px;
        height: 24px;
      }
    }
  `,
  outfit: [],
});
