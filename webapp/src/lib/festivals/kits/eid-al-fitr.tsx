/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Eid al-Fitr (RFC-020 §3.3): Shawwal 1, three days. Glowing lanterns --
 * emerald, amber, rose and turquoise glass in pierced gold -- and sparkles
 * rise from the bottom, swaying from their rings, and fade near the top; a
 * tap on the big one showers stars. A string of warm lights runs along each
 * card's top edge and a lantern hangs beside it; the creatures
 * wear a festive emerald cap with a gold tassel; the wash is emerald from
 * the top over gold.
 *
 * Eid al-Adha is the same feast look (./eid-al-adha.ts): it imports the
 * visitor, dressing and cap from here and flies this kit's parts.
 *
 * Art: webapp/scripts/festival-art/eid-al-fitr.py, drawn by ./_eid.py
 * (public/festivals/eid-al-fitr/, ./eid-al-fitr.art.json). The cap is drawn
 * here.
 */

import { css, defineFestival, type DressingSelectors, type FestivalKit, type Wash } from "@/lib/festivals/kit";
import { GOLD, line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import type { StyleSpec } from "@/lib/pocket-money/creatures/styles";
import type { RiseSpec } from "@/lib/festivals/visitors/types";
import ART from "./eid-al-fitr.art.json";

const EMERALD = "#1F9D63";

export const EID_WASH: Wash = { light: ["156 62% 28%", "42 85% 47%"], dark: ["154 50% 46%", "44 90% 58%"] };

/** Lanterns and sparkles rising, about one lantern to two sparkles. */
export const EID_VISITOR: RiseSpec = {
  archetype: "rise",
  art: "eid-al-fitr",
  parts: ART.parts,
  size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
  sprites: ["lantern-emerald", "lantern-amber", "lantern-rose", "lantern-turquoise", "sparkle-gold", "sparkle-gold", "sparkle-white", "sparkle-white", "sparkle-emerald"],
  count: 24,
  // Slower than balloons: lanterns drift up.
  speed: [55, 100],
  sway: 18,
  scale: [0.8, 1.4],
  spin: [-0.12, 0.12],
  ceiling: 0.12,
  tap: {},
};

/**
 * String lights along each card's top edge, in the 16px gap above it, and a
 * lantern on a chain beside each card, from its top corner, in the gap on
 * its right (always the right, so two cards never share a gap; a shorter and
 * a longer chain on alternate cards). Nothing reaches into a card (its
 * content can start at its first pixel row) and nothing above or below it is
 * taller than the 16px gap at 320px: a piece above ends on the card's border
 * line, -(size + 1)px, as the offsets count from inside the 1px border; one
 * beside it keeps a pixel clear, -(size + 2)px.
 */
export const eidDressing = (s: DressingSelectors) => css`
  ${s.cards} {
    position: relative;
  }
  ${s.cards}::before {
    content: "";
    position: absolute;
    z-index: 2;
    top: -17px;
    left: 10px;
    right: 10px;
    height: 16px;
    background: ${s.art("string-lights")} repeat-x 0 0 / 120px 16px;
    pointer-events: none;
  }
  ${s.cards}:nth-child(even)::before {
    background-position: -60px 0;
  }
  ${s.cards}::after {
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
  ${s.cards}:nth-child(even)::after {
    height: 45px;
    background-image: ${s.art("lantern-side-b")};
  }
`;

/** A festive cap: a short emerald fez with a gold embroidered band, and a gold tassel swinging off its crown. */
export const eidCap = (st: StyleSpec) => (
  <>
    <path d="M -27 -22 L -21 -58 Q 0 -63 21 -58 L 27 -22 Q 0 -16 -27 -22 Z" fill={EMERALD} {...line(st, 3)} />
    <path d="M 21 -58 L 27 -22 Q 20 -20 12 -19 L 10 -56 Q 16 -57 21 -58 Z" fill="#147049" opacity="0.55" />
    <ellipse cx="0" cy="-59" rx="21" ry="4.5" fill="#26B574" {...line(st, 2.5)} />
    <path d="M -26.5 -26 Q 0 -20 26.5 -26 L 25.6 -33 Q 0 -27 -25.6 -33 Z" fill={GOLD} {...line(st, 2)} />
    {[-18, -9, 0, 9, 18].map((x) => (
      <path key={x} d={`M ${x} ${-32 + Math.abs(x) * 0.06} l 2.4 2.6 l -2.4 2.6 l -2.4 -2.6 Z`} fill="#FFF1A8" />
    ))}
    {/* The tassel: a cord from the crown's button over the edge, and the gold fringe hanging. */}
    <circle cx="0" cy="-60" r="3" fill={GOLD} />
    <path d="M 0 -60 Q 16 -64 22 -50" stroke={GOLD} strokeWidth="2.2" fill="none" strokeLinecap="round" />
    <path d="M 20 -51 L 24 -51 L 27 -34 L 17 -34 Z" fill={GOLD} {...line(st, 1.5)} />
    <path d="M 19 -46 L 18.5 -35 M 22 -46 L 22 -35 M 25 -46 L 25.5 -35" stroke="#C9921E" strokeWidth="1" />
    <circle cx="22" cy="-51" r="2.6" fill="#FFE27A" />
    {sheen(st, -12, -46, 3.5, 9, 10)}
  </>
);

export function eidKit(id: "eid-al-fitr" | "eid-al-adha", cap: string): FestivalKit {
  return defineFestival({
    id,
    wash: EID_WASH,
    visitor: EID_VISITOR,
    dressing: eidDressing,
    outfit: [{ slot: "head", item: cap, draw: eidCap }],
  });
}

export default eidKit("eid-al-fitr", "eid_cap_fitr");
