/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The penguin: a face patch on a dark head, flippers that flap, a scarf from
 * the Explorer (6) and golden cheeks as the Emperor (7). As drawn in the
 * creature workshop.
 */

import { accentOf, fillOf, s, speciesFrom } from "./parts";
import { GOLD } from "./skeleton";
import { wearing } from "./items";

export const penguin = speciesFrom({
  origin: "egg",
  colors: { body: "#3A4A63", belly: "#FFFFFF", accent: "#FFB547" },
  head: {
    under(c, cx, cy, r) {
      return (
        <>
          <path d={`M ${cx} ${cy - r * 0.55} Q ${cx - r * 0.95} ${cy - r * 0.65} ${cx - r * 0.7} ${cy + r * 0.3} Q ${cx} ${cy + r * 0.95} ${cx + r * 0.7} ${cy + r * 0.3} Q ${cx + r * 0.95} ${cy - r * 0.65} ${cx} ${cy - r * 0.55} Z`} fill={c.st.pal.belly} />
          {c.stage >= 7 &&
            [-1, 1].map((d) => <ellipse key={d} data-part="gold-cheek" cx={cx + d * r * 0.78} cy={cy + r * 0.15} rx={r * 0.16} ry={r * 0.26} fill={GOLD} />)}
        </>
      );
    },
    face(c, cx, cy, r) {
      return <path d={`M ${cx - 8} ${cy + r * 0.22} L ${cx + 8} ${cy + r * 0.22} L ${cx} ${cy + r * 0.5} Z`} fill={accentOf(c)} {...s(c, 2.5)} />;
    },
    front(c, cx, cy, r) {
      // Its own scarf, unless something from the shop is worn round the neck.
      if (c.stage < 6 || wearing(c, "neck")) return null;
      return (
        <path data-part="scarf" d={`M ${cx - r * 0.8} ${cy + r * 0.8} Q ${cx} ${cy + r * 1.12} ${cx + r * 0.8} ${cy + r * 0.8} L ${cx + r * 0.84} ${cy + r * 1.02} Q ${cx} ${cy + r * 1.36} ${cx - r * 0.84} ${cy + r * 1.02} Z`} fill="#E8613A" {...s(c, 3)} />
      );
    },
    eyeY: -0.1,
  },
  parts: {
    birdFeet: true,
    arms(c) {
      return [-1, 1].map((d) => (
        <g key={d} className="creature-part creature-flap">
          <ellipse cx={100 + d * 40} cy="140" rx="8" ry="22" fill={fillOf(c)} transform={`rotate(${d * -22} ${100 + d * 40} 140)`} {...s(c)} />
        </g>
      ));
    },
  },
});
