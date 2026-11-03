/**
 * Ramadan (RFC-020 §3.3): the month of Ramadan, to the day before Eid
 * al-Fitr. No visitor and no outfit: after sunset, a lit lantern -- amber
 * or turquoise glass in pierced gold -- hangs on a fine chain beside each
 * card, from its top corner. By day the cards are as always. The wash is night blue from the top over gold, all
 * day.
 *
 * Sunset is the weather's (the date module's `afterDusk`), 18:00 without
 * it (lib/festivals.ts gives Ramadan that fallback). The lanterns stay up
 * until midnight; after midnight the next day's rule takes over, and that
 * is before its sunset.
 *
 * Art: webapp/scripts/festival-art/ramadan.py (public/festivals/ramadan/).
 */

import { css, defineFestival } from "@/lib/festivals/kit";

export default defineFestival({
  id: "ramadan",
  wash: { light: ["226 55% 30%", "42 82% 46%"], dark: ["226 58% 56%", "44 88% 58%"] },
  visitor: null,
  // Nothing reaches into a card (its content can start at its first pixel
  // row) and nothing in the gap above or below it is taller than 16px (the
  // gap at 320px): a piece above or below ends on the card's border line,
  // -(size + 1)px, as the offsets count from inside the 1px border; one
  // beside it keeps a pixel clear, -(size + 2)px.
  // One lantern on a chain hangs beside each card, from its top corner, in
  // the gap on its right (15px wide; the page's margin beside the last
  // column): always the right, so two cards never share a gap. Alternate
  // cards hang a shorter and a longer chain.
  dressing: (s) => css`
    ${s.cardsAt("night")} {
      position: relative;
    }
    ${s.cardsAt("night")}::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: 0;
      right: -17px;
      width: 15px;
      height: 33px;
      background: ${s.art("lantern-side-a")} center top / contain no-repeat;
      pointer-events: none;
    }
    ${s.cardsAt("night")}:nth-child(even)::after {
      height: 45px;
      background-image: ${s.art("lantern-side-b")};
    }
  `,
  outfit: [],
  // Lanterns only after sunset: no stage by day, so nothing is dressed.
  stage: (at) => (at.afterDusk ? "night" : null),
  stages: ["night"],
  previewStage: "night",
});
