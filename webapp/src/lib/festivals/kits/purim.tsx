/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Purim (RFC-020 §3.3): Adar 14 (Adar II in a leap year). Noisemakers and
 * carnival masks are flung in from the sides and tumble across the middle
 * of the screen, turning over as they go; a tap on the big one drops
 * hamantaschen. A garland of small masks hangs along each card's top
 * edge; the creatures wear a gold domino mask with purple trim (the face
 * slot, its eye holes round their eyes); the wash is purple over gold.
 *
 * Art: webapp/scripts/festival-art/purim.py (public/festivals/purim/,
 * ./purim.art.json). The creatures' mask is drawn here.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { GOLD, line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import ART from "./purim.art.json";

export default defineFestival({
  id: "purim",
  wash: { light: ["268 55% 40%", "42 85% 47%"], dark: ["268 62% 62%", "44 90% 58%"] },
  visitor: {
    archetype: "burst",
    parts: ART.parts,
    size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
    sprites: ["noisemaker-purple", "noisemaker-teal", "mask-purple", "mask-gold", "mask-rose"],
    count: 16,
    waves: 2,
    // From one side, then the other, across the middle of the screen.
    from: ["left", "right"],
    speed: [300, 520],
    spread: 24,
    gravity: 55,
    drag: 0.12,
    life: [4.5, 6.5],
    scale: [1, 1.5],
    spin: [-3.2, 3.2],
    tap: { drops: ["hamantasch"] },
  },
  // Nothing reaches into a card (its content can start at its first pixel
  // row) and nothing in the gap above or below it is taller than 16px (the
  // gap at 320px): every piece ends on the card's border line, -(size + 1)px,
  // as the offsets count from inside the 1px border.
  // A garland of three small masks on a ribbon along the card's top edge, in
  // the gap above it, near one corner; the other corner on alternate cards.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      right: 16px;
      width: 96px;
      height: 16px;
      background: ${s.art("masks-garland")} center / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::after {
      right: auto;
      left: 16px;
    }
  `,
  outfit: [
    {
      slot: "face",
      item: "purim_mask",
      // A gold domino mask over both eyes, purple trim round its almond eye holes, a little larger
      // than the eyes, so the eyes always show through.
      draw: (st, e, cx, r) => {
        const hole = Math.max(e.r * 1.6, r * 0.2);
        const left = e.x1 - hole * 1.75;
        const right = e.x2 + hole * 1.75;
        const top = e.y - hole * 1.3;
        const bottom = e.y + hole * 1.25;
        const almond = (x: number) =>
          `M ${x - hole} ${e.y} C ${x - hole * 0.6} ${e.y - hole * 0.95} ${x + hole * 0.6} ${e.y - hole * 0.95} ${x + hole} ${e.y} C ${x + hole * 0.6} ${e.y + hole * 0.85} ${x - hole * 0.6} ${e.y + hole * 0.85} ${x - hole} ${e.y} Z`;
        const outer =
          `M ${left} ${top + hole * 0.2} C ${left + hole} ${top - hole * 0.5} ${cx - hole} ${top} ${cx} ${top + hole * 0.6} ` +
          `C ${cx + hole} ${top} ${right - hole} ${top - hole * 0.5} ${right} ${top + hole * 0.2} ` +
          `C ${right + hole * 0.2} ${e.y + hole * 0.6} ${right - hole * 0.6} ${bottom} ${e.x2} ${bottom} ` +
          `C ${e.x2 - hole} ${bottom} ${cx + hole * 0.3} ${e.y + hole * 0.5} ${cx} ${e.y + hole * 0.4} ` +
          `C ${cx - hole * 0.3} ${e.y + hole * 0.5} ${e.x1 + hole} ${bottom} ${e.x1} ${bottom} ` +
          `C ${left + hole * 0.6} ${bottom} ${left - hole * 0.2} ${e.y + hole * 0.6} ${left} ${top + hole * 0.2} Z`;
        return (
          <>
            <path d={`${outer} ${almond(e.x1)} ${almond(e.x2)}`} fill={GOLD} fillRule="evenodd" {...line(st, 2.6)} />
            <path d={`${almond(e.x1)} ${almond(e.x2)}`} fill="none" stroke="#7B4FD0" strokeWidth="1.9" />
            <circle cx={cx} cy={top + hole * 0.95} r={hole * 0.24} fill="#E0557A" />
            <circle cx={left + hole * 0.5} cy={top + hole * 0.35} r={hole * 0.15} fill="#8A5BDB" />
            <circle cx={right - hole * 0.5} cy={top + hole * 0.35} r={hole * 0.15} fill="#8A5BDB" />
            {sheen(st, e.x1 - hole * 0.6, top + hole * 0.45, hole * 0.5, hole * 0.16, -12)}
          </>
        );
      },
    },
  ],
});
