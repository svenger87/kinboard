/**
 * Midsummer (RFC-020 §3.3; Sweden, Estonia, Latvia, Lithuania): the eve and
 * the day. No visitor: it's light all night. A garland of wild flowers --
 * daisies, cornflowers, buttercups, campion -- and birch leaves along every
 * card's top edge; the creatures wear the shop's flower crown; the wash is
 * light green from the top over summer yellow.
 *
 * Art: webapp/scripts/festival-art/midsummer.py (public/festivals/midsummer/).
 */

import { css, defineFestival } from "@/lib/festivals/kit";

export default defineFestival({
  id: "midsummer",
  wash: { light: ["95 50% 38%", "50 90% 46%"], dark: ["95 48% 56%", "50 92% 60%"] },
  visitor: null,
  // Every piece lies in the grid's gap, outside the card, and ends on the
  // card's border line (offsets count from inside the 1px border, so a piece
  // h px tall sits at -(h + 1)px): a full-bleed card, a camera or a photo,
  // has content from its first pixel row to its last. In the gap means at
  // most 16px tall below 768px wide, where the gap is 16px, and 24px from
  // there, where it is 24px.
  // The garland along each card's top edge: the tile is 24px with the
  // garland in its middle 14, shown 16px high from 4px down. The next card's
  // starts a little further along, so the flowers don't line up row on row.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      left: 4px;
      right: 4px;
      height: 16px;
      background: ${s.art("flower-garland")} repeat-x 0 -4px / 120px 24px;
      pointer-events: none;
    }
    ${s.cards}:nth-child(odd)::before {
      background-position: -53px -4px;
    }
  `,
  outfit: [{ slot: "head", item: "flower_crown" }],
});
