/**
 * Halloween (RFC-020 §3.3): 24 to 31 October. A flock of friendly bats
 * bursts out of a corner and flaps across the widgets, a different corner
 * each pass; a tap on the biggest drops sweets. A cobweb, with a little
 * spider on its thread, on a corner of every card; two pumpkins, one carved
 * with a smile and lit, on the Tasks card. The creatures wear the shop's
 * wizard hat; the wash is orange from the top over purple.
 *
 * Art: webapp/scripts/festival-art/halloween.py (public/festivals/halloween/,
 * ./halloween.art.json).
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import ART from "./halloween.art.json";

export default defineFestival({
  id: "halloween",
  draft: true,
  wash: { light: ["26 92% 48%", "272 48% 34%"], dark: ["28 94% 56%", "272 50% 58%"] },
  visitor: {
    archetype: "burst",
    parts: ART.parts,
    // A bat 100 units across: 60px on a 1080p wall at its largest, 35px on a phone.
    size: { per: "width", px: 3000, min: 0.35, max: 0.6 },
    sprites: ["bat"],
    count: 14,
    // One corner a pass, the next one the pass after.
    from: ["top-left", "bottom-right", "top-right", "bottom-left"],
    waves: 1,
    speed: [150, 260],
    spread: 22,
    // A little lift, hardly any drag: they fly on across the screen.
    gravity: -12,
    drag: 0.05,
    life: [7, 10],
    scale: [0.7, 1.1],
    flap: 3.5,
    tap: { drops: ["sweet-orange", "sweet-purple", "lollipop"] },
  },
  // Every piece lies in the grid's gap, outside the card, and ends on the
  // card's border line (offsets count from inside the 1px border, so a piece
  // h px tall sits at -(h + 1)px): a full-bleed card, a camera or a photo,
  // has content from its first pixel row to its last. In the gap means at
  // most 16px tall below 768px wide, where the gap is 16px, and 24px from
  // there, where it is 24px.
  // A cobweb spun in the gap at one corner of each card, its strands
  // reaching to the card's edge, top left and then bottom right by turns;
  // two pumpkins, one carved and lit, on the Tasks card's top edge, clear of
  // the corner.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      left: -4px;
      width: 16px;
      height: 16px;
      background: ${s.art("cobweb")} center / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::before {
      top: auto;
      left: auto;
      bottom: -17px;
      right: -4px;
      transform: scale(-1, -1);
    }
    ${s.tasks} {
      position: relative;
    }
    ${s.tasks}::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      right: 28px;
      width: 24px;
      height: 16px;
      background: ${s.art("pumpkins")} center bottom / contain no-repeat;
      pointer-events: none;
    }
    @media (min-width: 768px) {
      ${s.cards}::before {
        top: -25px;
        width: 24px;
        height: 24px;
      }
      ${s.cards}:nth-child(even)::before {
        top: auto;
        bottom: -25px;
      }
      ${s.tasks}::after {
        top: -25px;
        width: 36px;
        height: 24px;
      }
    }
  `,
  outfit: [{ slot: "head", item: "wizard_hat" }],
});
