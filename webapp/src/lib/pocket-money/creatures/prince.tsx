/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The prince: a crown on a cushion, then a golden circlet (3), a page and a
 * squire, a sword from 5, shield and cape as the Knight (6), and the king's
 * crown at the top. As drawn in the creature workshop.
 */

import { speciesFrom } from "./parts";
import { personBody, personHead } from "./person";
import { GOLD } from "./skeleton";

export const prince = speciesFrom({
  origin: "cushion",
  person: true,
  colors: { body: "#4F7BD9", belly: "#FFC83D", accent: "#3B2A20", hair: "#3B2A20", skin: "#D9A27A" },
  head: personHead("short", (c, cx, cy, r) => {
    if (c.stage === 8 || c.stage < 3) return null;
    return (
      <path data-part="circlet" d={`M ${cx - r * 0.9} ${cy - r * 0.62} Q ${cx} ${cy - r * 0.95} ${cx + r * 0.9} ${cy - r * 0.62}`} fill="none" stroke={GOLD} strokeWidth="4" strokeLinecap="round" />
    );
  }),
  body: (c) => personBody(c, "prince"),
});
