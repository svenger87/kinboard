/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Holi (RFC-020 §3.3): Holika Dahan and the day of colours. Clouds of
 * coloured powder -- pink, yellow, green, blue, orange, violet -- burst in
 * from the corners and sides, four bursts a pass, billowing out as they
 * slow, drifting up a little and thinning to nothing within three or four
 * seconds: translucent all the way, so a card under one is never hidden for
 * long. Powder splashes at two corners of each card, warm on one and cool
 * on the other; the creatures' faces are dabbed with colour; the wash is
 * magenta from the top over saffron.
 *
 * Art: webapp/scripts/festival-art/holi.py (public/festivals/holi/,
 * ./holi.art.json). The colour on the creatures' faces is drawn here.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { sheen } from "@/lib/pocket-money/creatures/item-draw";
import ART from "./holi.art.json";

/** A soft dab of powder: a blot and two specks beside it. */
const dab = (x: number, y: number, s: number, fill: string, turn: number) => (
  <g key={`${x} ${y}`} transform={`rotate(${turn} ${x} ${y})`} opacity="0.88">
    <ellipse cx={x} cy={y} rx={s * 1.25} ry={s * 0.8} fill={fill} />
    <ellipse cx={x - s * 0.3} cy={y - s * 0.15} rx={s * 0.55} ry={s * 0.35} fill="#FFFFFF" opacity="0.28" />
    <circle cx={x + s * 1.65} cy={y - s * 0.55} r={s * 0.28} fill={fill} />
    <circle cx={x - s * 1.55} cy={y + s * 0.6} r={s * 0.2} fill={fill} />
  </g>
);

export default defineFestival({
  id: "holi",
  wash: { light: ["322 72% 48%", "38 92% 50%"], dark: ["322 78% 64%", "40 95% 60%"] },
  visitor: {
    archetype: "burst",
    parts: ART.parts,
    // A cloud 125-180 CSS px across as it leaves the corner on a 1080p wall,
    // up to 1.9 times that as it spreads: as large as it can be and still fill
    // in time at 6x (RFC-020 §7.1); larger clouds halved the frame rate there.
    size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
    sprites: [
      "cloud-pink",
      "cloud-yellow",
      "cloud-green",
      "cloud-blue",
      "cloud-orange",
      "cloud-violet",
      "puff-pink",
      "puff-yellow",
      "puff-green",
      "puff-blue",
      "puff-orange",
      "puff-violet",
    ],
    count: 20,
    waves: 4,
    from: ["bottom-left", "right", "bottom-right", "left", "top-left", "top-right"],
    speed: [380, 700],
    spread: 30,
    // Powder floats: a little lift, and a lot of drag, so each cloud slows and spreads where it is.
    gravity: -18,
    drag: 0.82,
    life: [2.6, 3.8],
    scale: [0.85, 1.2],
    spin: [-0.25, 0.25],
    grow: 0.9,
    tap: {},
  },
  // Splashes at two corners of each card: top left and bottom right (warm,
  // cool), then the other two on the next card (cool, warm). A 64 x 16 strip
  // in the gap along the edge, its blot just beyond the card's corner.
  // Nothing reaches into a card (its content can start at its first pixel
  // row) and nothing in the gap above or below it is taller than 16px (the
  // gap at 320px): every piece ends on the card's border line, -(size + 1)px,
  // as the offsets count from inside the 1px border.
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
      height: 16px;
      background: center / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}::before {
      top: -17px;
      left: -16px;
      background-image: ${s.art("splash-warm")};
    }
    ${s.cards}::after {
      bottom: -17px;
      right: -16px;
      background-image: ${s.art("splash-cool")};
      transform: scale(-1, -1);
    }
    ${s.cards}:nth-child(even)::before {
      left: auto;
      right: -16px;
      background-image: ${s.art("splash-cool")};
      transform: scaleX(-1);
    }
    ${s.cards}:nth-child(even)::after {
      right: auto;
      left: -16px;
      background-image: ${s.art("splash-warm")};
      transform: scaleY(-1);
    }
  `,
  outfit: [
    {
      slot: "face",
      item: "holi_colours",
      // Gulal on the cheeks and the brow: pink and yellow on one cheek,
      // green on the other, a streak of yellow above; never over the eyes.
      draw: (st, e, cx, r) => {
        const s = Math.max(r * 0.12, e.r * 0.95);
        const cheek = e.y + Math.max(e.r * 1.7, r * 0.22);
        const brow = e.y - Math.max(e.r * 2.3, r * 0.3);
        return (
          <>
            {dab(e.x1 - s * 1.5, cheek, s, "#FF3D8B", -12)}
            {dab(e.x1 - s * 0.4, cheek + s * 1.1, s * 0.55, "#FFC93C", 20)}
            {dab(e.x2 + s * 1.5, cheek, s, "#34C771", 15)}
            <path
              d={`M ${cx - s * 1.7} ${brow + s * 0.35} Q ${cx} ${brow - s * 0.8} ${cx + s * 1.7} ${brow + s * 0.1}`}
              stroke="#FFC93C"
              strokeWidth={s * 0.8}
              strokeLinecap="round"
              fill="none"
              opacity="0.9"
            />
            <circle cx={cx + s * 2.5} cy={brow - s * 0.35} r={s * 0.3} fill="#FF3D8B" opacity="0.9" />
            <circle cx={cx - s * 2.4} cy={brow - s * 0.1} r={s * 0.22} fill="#3D8BFF" opacity="0.9" />
            {sheen(st, cx - s * 0.6, brow - s * 0.15, s * 0.45, s * 0.14, -10)}
          </>
        );
      },
    },
  ],
});
