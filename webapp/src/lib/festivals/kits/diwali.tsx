/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Diwali (RFC-020 §3.3): five days, from the date table in lib/festivals.ts.
 * Paper sky lanterns rise from the bottom of the screen, swaying, glowing,
 * fading out near the top; three diyas burn on each card's top edge and a
 * marigold garland hangs under the card on the other side. The creatures
 * wear a marigold garland; the wash is saffron from the top over magenta.
 *
 * Art: webapp/scripts/festival-art/diwali.py (the diyas and the garland).
 * The sky lanterns are Mid-Autumn's parts, the same drawing: this kit
 * borrows that folder. The marigolds are _marigold.py's, shared with Día de
 * Muertos. The garland the creatures wear is drawn here.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { GOLD, line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import LANTERNS from "./mid-autumn.art.json";

const SPRITES = ["lantern-saffron", "lantern-magenta", "lantern-gold", "lantern-red"] as const;

/** Marigolds round the neck, orange and yellow by turns, along the curve the scarf takes. */
const BEADS = Array.from({ length: 11 }, (_, i) => {
  const t = i / 10;
  // A quadratic from (-28, 26) through (0, 44) to (28, 26).
  const x = (1 - t) * (1 - t) * -28 + 2 * (1 - t) * t * 0 + t * t * 28;
  const y = (1 - t) * (1 - t) * 26 + 2 * (1 - t) * t * 50 + t * t * 26;
  return [x, y] as const;
});

export default defineFestival({
  id: "diwali",
  draft: true,
  wash: { light: ["30 95% 48%", "322 72% 40%"], dark: ["32 95% 58%", "322 72% 60%"] },
  visitor: {
    archetype: "rise",
    art: "mid-autumn",
    parts: Object.fromEntries(SPRITES.map((n) => [n, LANTERNS.parts[n]])),
    // A lantern 80 x 110 units: about 50 x 70px on a 1080p wall at its largest.
    size: { per: "width", px: 3200, min: 0.36, max: 0.6 },
    sprites: [...SPRITES],
    count: 12,
    speed: [70, 110],
    sway: 18,
    scale: [0.6, 1.1],
    ceiling: 0.08,
    // Long enough for the slowest to climb a wall display.
    duration: 14_000,
    tap: {},
  },
  // Every piece lies in the grid's gap, outside the card, and ends on the
  // card's border line (offsets count from inside the 1px border, so a piece
  // h px tall sits at -(h + 1)px): a full-bleed card, a camera or a photo,
  // has content from its first pixel row to its last. In the gap means at
  // most 16px tall below 768px wide, where the gap is 16px, and 24px from
  // there, where it is 24px.
  // Three diyas standing on each card's top edge at its left, and a marigold
  // garland hanging from its bottom edge at its right. Not mirrored card to
  // card: in a single column one card's garland would then hang above the
  // diyas of the card under it, in the same 16px.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before,
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      pointer-events: none;
    }
    ${s.cards}::before {
      top: -17px;
      left: 16px;
      width: 51px;
      height: 16px;
      background: ${s.art("diyas")} center bottom / contain no-repeat;
    }
    ${s.cards}::after {
      bottom: -17px;
      right: 16px;
      width: 80px;
      height: 16px;
      background: ${s.art("marigold-garland")} center top / contain no-repeat;
    }
    @media (min-width: 768px) {
      ${s.cards}::before {
        top: -25px;
        width: 76px;
        height: 24px;
      }
      ${s.cards}::after {
        bottom: -25px;
        width: 120px;
        height: 24px;
      }
    }
  `,
  outfit: [
    {
      slot: "neck",
      item: "marigold_garland",
      // A string of marigolds round the neck and one strand hanging at the front.
      draw: (st) => (
        <>
          {BEADS.map(([x, y], i) => (
            <g key={i} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
              <circle r="4.6" fill={i % 2 ? "#F2801E" : "#FFB52E"} {...line(st, 1.4)} />
              <circle cx="-1.5" cy="-1.4" r="2.2" fill={i % 2 ? "#FFA62B" : "#FFD24A"} />
              <circle r="1.3" fill={i % 2 ? "#D9590F" : "#E0960F"} />
            </g>
          ))}
          {[0, 1].map((k) => (
            <g key={k} transform={`translate(0 ${48 + k * 7.5})`}>
              <circle r={4 - k * 0.5} fill={k ? "#FFB52E" : "#F2801E"} {...line(st, 1.4)} />
              <circle cx="-1.2" cy="-1.2" r="1.8" fill={k ? "#FFD24A" : "#FFA62B"} />
            </g>
          ))}
          <path d="M -2 59 L -3.5 65 M 2 59 L 3.5 65" stroke="#3FA877" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="0" cy="58.5" r="1.4" fill={GOLD} />
          {sheen(st, -14, 34, 5, 2, 15)}
        </>
      ),
    },
  ],
});
