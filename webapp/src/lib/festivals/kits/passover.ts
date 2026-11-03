/**
 * Passover (Pesach, RFC-020 §3.3): eight days from Nisan 15. Quiet on
 * purpose: no visitor and no outfit. A sprig of almond blossom with
 * wine-red buds lies on one top corner of each card, the right on one and
 * the left on the next, and the wash is spring green from the top over wine
 * red. Blossom only: festive, never devotional (§7).
 *
 * Art: webapp/scripts/festival-art/passover.py (public/festivals/passover/).
 */

import { css, defineFestival } from "@/lib/festivals/kit";

export default defineFestival({
  id: "passover",
  wash: { light: ["98 50% 36%", "344 58% 32%"], dark: ["98 45% 50%", "344 52% 54%"] },
  visitor: null,
  // A 54 x 20 px sprig resting on the card's top edge at the corner, wholly
  // in the gap above it and beside it (a card's content can start at its
  // very first pixel), its corner point 10px in from the card's side.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: -20px;
      right: -10px;
      width: 54px;
      height: 20px;
      background: ${s.art("blossom-corner")} center / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::after {
      right: auto;
      left: -10px;
      transform: scaleX(-1);
    }
  `,
  outfit: [],
});
