/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The princess: a crown on a cushion, then a little tiara (2), a bigger one
 * from the Star Princess (5) with a star wand, a cape from 6, and the
 * queen's crown at the top. As drawn in the creature workshop.
 */

import { s, speciesFrom } from "./parts";
import { personBody, personHead } from "./person";

export const princess = speciesFrom({
  origin: "cushion",
  person: true,
  colors: { body: "#FF8FC0", belly: "#FFF1A8", accent: "#8B5A2B", hair: "#8B5A2B", skin: "#F2C8A0" },
  head: personHead("long", (c, cx, cy, r) => {
    if (c.stage === 8 || c.stage < 2) return null;
    const t = cy - r * 1.02;
    const w = c.stage >= 5 ? 16 : 12;
    const h = c.stage >= 5 ? 12 : 9;
    const edge = c.st.stroke ? s(c, 2.5) : { stroke: "#B8C2D6", strokeWidth: 1.6, strokeLinejoin: "round" as const };
    return (
      <g data-part="tiara">
        <path d={`M ${cx - w} ${t + 3} L ${cx - w * 0.6} ${t - h * 0.6} L ${cx - w * 0.25} ${t} L ${cx} ${t - h} L ${cx + w * 0.25} ${t} L ${cx + w * 0.6} ${t - h * 0.6} L ${cx + w} ${t + 3} Z`} fill="#E9EEF7" {...edge} />
        <circle cx={cx} cy={t - h * 0.35} r="2.6" fill="#FF5C8A" />
      </g>
    );
  }),
  body: (c) => personBody(c, "princess"),
});
