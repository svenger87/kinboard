/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Carnival (RFC-020 §3.3): the week up to Shrove Tuesday. Paper streamers
 * curling as they unroll, and confetti, burst from the corners of the screen
 * in three waves and rain down; a tap on the big streamer throws wrapped
 * sweets, as the floats do. A twisted purple-and-green crepe streamer runs
 * along each card's top edge, its gold end curling down the card's side; the
 * creatures wear a jester's hat; the wash is purple from the top over green.
 *
 * Art: webapp/scripts/festival-art/carnival.py (public/festivals/carnival/,
 * ./carnival.art.json). The hat is drawn here.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { GOLD, line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import ART from "./carnival.art.json";

const PURPLE = "#8A5BDB";
const GREEN = "#36B26E";

/** A jester's bell at the tip of a point: gold, or silver on the gold point. */
const bell = (x: number, y: number, silver = false) => (
  <g key={`${x} ${y}`}>
    <circle cx={x} cy={y} r="5" fill={silver ? "#E4E7EF" : GOLD} />
    <path d={`M ${x - 3.4} ${y + 1.5} Q ${x} ${y + 3.6} ${x + 3.4} ${y + 1.5}`} stroke={silver ? "#8E95A8" : "#B87F14"} strokeWidth="1.2" fill="none" strokeLinecap="round" />
    <circle cx={x - 1.6} cy={y - 1.8} r="1.4" fill="#FFF6D0" />
  </g>
);

export default defineFestival({
  id: "carnival",
  wash: { light: ["268 58% 44%", "146 55% 34%"], dark: ["268 66% 64%", "146 48% 48%"] },
  visitor: {
    archetype: "burst",
    parts: ART.parts,
    size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
    // Streamers and confetti, about one streamer to two pieces of confetti.
    sprites: [
      "streamer-purple",
      "streamer-green",
      "streamer-gold",
      "streamer-pink",
      "confetti-purple",
      "confetti-green",
      "confetti-gold",
      "confetti-pink",
      "confetti-gold-round",
      "confetti-purple",
      "confetti-green",
      "confetti-pink",
    ],
    count: 54,
    waves: 3,
    // The two bottom corners, then a top one: popped from the floor and thrown from above.
    from: ["bottom-left", "bottom-right", "top-left", "top-right"],
    speed: [340, 660],
    spread: 26,
    gravity: 210,
    drag: 0.6,
    life: [3.2, 5],
    scale: [0.55, 1.1],
    spin: [-2.4, 2.4],
    tap: { drops: ["sweet"] },
  },
  // Nothing reaches into a card (its content can start at its first pixel
  // row) and nothing in the gap above or below it is taller than 16px (the
  // gap at 320px): a piece above or below ends on the card's border line,
  // -(size + 1)px, as the offsets count from inside the 1px border; one
  // beside it keeps a pixel clear, -(size + 2)px.
  // A twisted crepe streamer along each card's top edge, in the gap above it;
  // its gold end curls down the card's right side, in the gap beside it
  // (always the right, so two cards never share a gap).
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      left: 12px;
      right: 12px;
      height: 16px;
      background: ${s.art("streamer-drape")} repeat-x 0 0 / 107px 16px;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::before {
      background-position: -37px 0;
    }
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: 0;
      right: -16px;
      width: 14px;
      height: 40px;
      background: ${s.art("streamer-curl")} center top / contain no-repeat;
      pointer-events: none;
    }
  `,
  outfit: [
    {
      slot: "head",
      item: "jester_hat_carnival",
      // Three floppy points, purple, green and gold, each with a bell,
      // on a gold band with diamonds.
      draw: (st) => (
        <>
          <path d="M -30 -24 C -38 -40 -50 -46 -60 -38 C -52 -38 -46 -32 -44 -26 C -40 -36 -26 -50 -8 -52 Z" fill={PURPLE} {...line(st, 3)} />
          <path d="M 30 -24 C 38 -40 50 -46 60 -38 C 52 -38 46 -32 44 -26 C 40 -36 26 -50 8 -52 Z" fill="#F2B53A" {...line(st, 3)} />
          <path d="M -30 -24 C -32 -44 -16 -60 -4 -76 C 0 -82 6 -84 10 -80 C 4 -78 2 -72 4 -66 C 14 -52 26 -42 30 -24 Z" fill={GREEN} {...line(st, 3)} />
          <path d="M 4 -66 C 12 -54 22 -44 26 -30 C 18 -44 10 -54 2 -62 Z" fill="#1F7A48" opacity="0.45" />
          <path d="M -34 -22 Q 0 -34 34 -22 L 34 -15 Q 0 -27 -34 -15 Z" fill={GOLD} {...line(st, 2.5)} />
          {[-22, -8, 8, 22].map((x, i) => (
            <path key={x} d={`M ${x} ${-24.5 + Math.abs(x) * 0.12} l 3.4 -4 l 3.4 4 l -3.4 4 Z`} transform={`translate(-3.4 ${i === 0 || i === 3 ? 1.5 : 0})`} fill={i % 2 ? PURPLE : GREEN} />
          ))}
          {bell(-60, -38)}
          {bell(60, -38, true)}
          {bell(10, -82)}
          <path d="M -38 -42 C -44 -44 -50 -42 -54 -39" stroke="#C7A6FF" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.7" />
          {sheen(st, -16, -50, 3.5, 10, 30)}
        </>
      ),
    },
  ],
});
