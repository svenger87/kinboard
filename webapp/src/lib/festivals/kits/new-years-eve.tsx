/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * New Year's Eve (RFC-020 §3.3): 31 December, to half past midnight.
 * Fireworks go up over the clock at the family's midnight (lib/festivals.ts
 * has the window: the scene is set from five to twelve and the first rocket
 * leaves on the stroke), then every twenty seconds for half an hour.
 * Confetti at the cards' corners all day, a party hat and the shop's star
 * glasses, and the wash gold from the top over midnight blue.
 *
 * Art: webapp/scripts/festival-art/new-years-eve.py (the confetti). The
 * sparks are glows the engine draws in the colours below; the hat is drawn
 * here.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { GOLD, line, sheen, star } from "@/lib/pocket-money/creatures/item-draw";

const MIDNIGHT = "#1E2A5E";

export default defineFestival({
  id: "new-years-eve",
  wash: { light: ["44 90% 48%", "232 58% 30%"], dark: ["45 92% 58%", "232 55% 52%"] },
  visitor: {
    archetype: "fireworks",
    // Gold, rose, mint, sky, violet, and white.
    colors: ["#FFD24A", "#FF6B8B", "#6FE3B0", "#7CC4FF", "#C79BFF", "#FFFFFF"],
    shells: 7,
    sparks: 44,
    radius: 130,
    over: "clock",
    size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
    // At midnight the show goes on: a pass every twenty seconds until the window ends at 00:30.
    every: 20_000,
    tap: {},
  },
  // Confetti at two corners of each card: top left and bottom right, then the
  // other two on the next card. A 64 x 20 px strip along the edge, its corner
  // point 16 x 14 px in, laid on the card's own corner: the strip reaches 6px
  // over the card's edge, inside its 16px padding, and the rest lies in the
  // gap above it and beside it.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before,
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      width: 64px;
      height: 20px;
      background: ${s.art("confetti-corner")} center / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}::before {
      top: -14px;
      left: -16px;
    }
    ${s.cards}::after {
      bottom: -14px;
      right: -16px;
      transform: scale(-1, -1);
    }
    ${s.cards}:nth-child(even)::before {
      left: auto;
      right: -16px;
      transform: scaleX(-1);
    }
    ${s.cards}:nth-child(even)::after {
      right: auto;
      left: -16px;
      transform: scaleY(-1);
    }
  `,
  outfit: [
    {
      slot: "head",
      item: "party_hat_nye",
      // A midnight-blue cone with gold stars and a gold band, tipped to one
      // side, a tinsel pompom on top.
      draw: (st) => (
        <g transform="rotate(10 0 -26)">
          <path d="M -21 -24 Q -6 -52 2 -78 Q 10 -52 23 -24 Q 1 -18 -21 -24 Z" fill={MIDNIGHT} {...line(st, 3)} />
          <path d="M -2 -72 Q -12 -50 -17 -30" stroke="#3A4C9A" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.7" />
          <path d="M -19 -28 Q 1 -22 21 -28 L 19 -33 Q 1 -27 -17 -33 Z" fill={GOLD} {...line(st, 2)} />
          <path d={star(-2, -52, 4.5)} fill={GOLD} />
          <path d={star(8, -40, 3.2)} fill={GOLD} />
          <path d={star(-9, -38, 2.6)} fill="#FFF1A8" />
          <circle cx="5" cy="-62" r="1.4" fill="#FFF1A8" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M 2 -79 l 0 -9" stroke={a % 90 === 0 ? GOLD : "#FFF1A8"} strokeWidth="2.6" strokeLinecap="round" transform={`rotate(${a} 2 -79)`} />
          ))}
          <circle cx="2" cy="-79" r="3.6" fill={GOLD} />
          {sheen(st, -8, -48, 3.5, 8, 18)}
        </g>
      ),
    },
    { slot: "face", item: "star_glasses" },
  ],
});
