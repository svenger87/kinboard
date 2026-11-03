/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Día de Muertos (RFC-020 §3.3): 31 October to 2 November. Marigold
 * petals, and a few whole marigolds, drift down over the widgets; papel
 * picado, cut tissue-paper flags, hang along every card's top edge; the
 * creatures wear a crown of marigolds; the wash is marigold from the top
 * over magenta. Festive and colourful: flowers and paper, no skulls and
 * nothing devotional (§7).
 *
 * Art: webapp/scripts/festival-art/dia-de-muertos.py
 * (public/festivals/dia-de-muertos/, ./dia-de-muertos.art.json); the
 * marigolds are _marigold.py's, shared with Diwali. The crown is drawn here.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { GOLD, line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import ART from "./dia-de-muertos.art.json";

const RUFFLE = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [Math.cos((i * Math.PI) / 4) * 4.2, Math.sin((i * Math.PI) / 4) * 4.2]);
const INNER = [0, 1, 2, 3, 4, 5].map((i) => [Math.cos((i * Math.PI) / 3 + 0.5) * 2.4, Math.sin((i * Math.PI) / 3 + 0.5) * 2.4]);

export default defineFestival({
  id: "dia-de-muertos",
  draft: true,
  wash: { light: ["32 95% 48%", "322 70% 42%"], dark: ["34 95% 58%", "322 70% 60%"] },
  visitor: {
    archetype: "drift",
    parts: ART.parts,
    size: { per: "width", px: 2800, min: 0.45, max: 0.7 },
    // Mostly petals, now and then a whole flower.
    sprites: ["petal-orange", "petal-gold", "petal-deep", "petal-orange", "petal-deep", "petal-gold", "marigold-orange", "marigold-yellow"],
    count: 40,
    speed: [60, 110],
    sway: 30,
    scale: [0.7, 1.1],
    spin: [-1.5, 1.5],
    tumble: 0.9,
    tap: {},
  },
  // Every piece lies in the grid's gap, outside the card, and ends on the
  // card's border line (offsets count from inside the 1px border, so a piece
  // h px tall sits at -(h + 1)px): a full-bleed card, a camera or a photo,
  // has content from its first pixel row to its last. In the gap means at
  // most 16px tall below 768px wide, where the gap is 16px, and 24px from
  // there, where it is 24px.
  // Papel picado along each card's top edge, the flags' hems on the line.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      left: 6px;
      right: 6px;
      height: 16px;
      background: ${s.art("papel-picado")} repeat-x 0 0 / 96px 16px;
      pointer-events: none;
    }
    ${s.cards}:nth-child(odd)::before {
      background-position: -48px 0;
    }
    @media (min-width: 768px) {
      ${s.cards}::before {
        top: -21px;
        height: 20px;
        background-size: 120px 20px;
      }
      ${s.cards}:nth-child(odd)::before {
        background-position: -60px 0;
      }
    }
  `,
  outfit: [
    {
      slot: "head",
      item: "marigold_crown",
      // Seven marigolds round the head on a green band, a leaf between each.
      draw: (st) => {
        const heads = ["#D9590F", "#F2801E", "#E0960F", "#D9590F", "#F2801E", "#E0960F", "#D9590F"];
        return (
          <>
            <path d="M -32 -18 Q -26 -38 0 -39 Q 26 -38 32 -18" fill="none" stroke="#3FA877" strokeWidth="3.5" strokeLinecap="round" />
            {heads.map((deep, i) => {
              const a = Math.PI * (1.12 + (i / (heads.length - 1)) * 0.76);
              const x = Math.cos(a) * 33;
              const y = Math.sin(a) * 33 - 4;
              return (
                <g key={i} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
                  <ellipse cx="-6" cy="3" rx="4" ry="1.8" fill="#3FA877" transform="rotate(-30 -6 3)" />
                  <circle r="6" fill={deep} {...line(st, 1.5)} />
                  {RUFFLE.map(([px, py], k) => (
                    <circle key={k} cx={px.toFixed(2)} cy={py.toFixed(2)} r="2.6" fill={deep} />
                  ))}
                  {INNER.map(([px, py], k) => (
                    <circle key={k} cx={px.toFixed(2)} cy={py.toFixed(2)} r="2.3" fill="#FFA62B" />
                  ))}
                  <circle r="2" fill={GOLD} />
                  <circle cx="-1.8" cy="-2.2" r="1" fill="#FFF1A8" />
                </g>
              );
            })}
            {sheen(st, -16, -38, 5, 2, -25)}
          </>
        );
      },
    },
  ],
});
