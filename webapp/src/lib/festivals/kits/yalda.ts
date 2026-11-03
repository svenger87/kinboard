/**
 * Yalda (Shab-e Yalda, RFC-020 §3.3): the longest night, the evening of
 * Azar 30. No visitor: it's a night for sitting up together over fruit and
 * poems. Pomegranates, one broken open on its seeds, and a slice of
 * watermelon rest on a corner of the cards; the creatures wear the shop's
 * scarf; the wash is pomegranate red from the top over the long night's blue.
 *
 * Art: webapp/scripts/festival-art/yalda.py (public/festivals/yalda/).
 */

import { css, defineFestival } from "@/lib/festivals/kit";

export default defineFestival({
  id: "yalda",
  wash: { light: ["350 66% 38%", "228 55% 26%"], dark: ["350 70% 54%", "228 52% 50%"] },
  visitor: null,
  // The fruit stands on each card's top edge, in a corner: the full
  // arrangement on the right of odd cards, the small one on the left of even
  // ones. It sits wholly in the gap above, ending on the card's border line
  // (offsets count from inside the 1px border): 16px tall where the grid's
  // gap is 16px, 23px from md up, where it is 24px.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      right: 18px;
      width: 46px;
      height: 16px;
      background: ${s.art("fruit")} center bottom / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::after {
      right: auto;
      left: 18px;
      width: 29px;
      background-image: ${s.art("fruit-small")};
    }
    @media (min-width: 768px) {
      ${s.cards}::after {
        top: -24px;
        width: 66px;
        height: 23px;
      }
      ${s.cards}:nth-child(even)::after {
        width: 42px;
      }
    }
  `,
  outfit: [{ slot: "neck", item: "scarf" }],
});
