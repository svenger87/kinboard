/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The dog: naps in a basket; floppy ears that grow longer every stage, a
 * patch round one eye and a wagging tail. A collar with a golden tag from
 * the Sniffer (4), a ball to fetch from the Fetch Champ (5), and a hero's
 * cape as the Super Pup (7). When happy its tongue pokes out.
 */

import { accentOf, EYE, fillOf, s, speciesFrom } from "./parts";
import { GOLD } from "./skeleton";
import { wearing } from "./items";

const CAPE = "#3D7DD8";

export const dog = speciesFrom({
  origin: "basket",
  colors: { body: "#C98A55", belly: "#FFF0DC", accent: "#6E4428" },
  head: {
    under(c, cx, cy, r) {
      // The patch round the right eye, then the ears flopping over the sides.
      const len = 0.9 + Math.min(c.stage, 8) * 0.04;
      return (
        <>
          <ellipse cx={cx + r * 0.38} cy={cy - r * 0.16} rx={r * 0.33} ry={r * 0.3} fill={c.st.pal.spot} />
          <g data-part="ears" data-len={len.toFixed(2)}>
            {[-1, 1].map((d) => (
              <path
                key={d}
                d={`M ${cx + d * r * 0.42} ${cy - r * 0.9} Q ${cx + d * r * 1.22} ${cy - r * 0.86} ${cx + d * r * 1.2} ${cy - r * 0.9 + r * len * 0.7} Q ${cx + d * r * 1.16} ${cy - r * 0.9 + r * len * 1.08} ${cx + d * r * 0.94} ${cy - r * 0.9 + r * len} Q ${cx + d * r * 0.7} ${cy - r * 0.9 + r * len * 0.9} ${cx + d * r * 0.72} ${cy - r * 0.42} Q ${cx + d * r * 0.66} ${cy - r * 0.76} ${cx + d * r * 0.42} ${cy - r * 0.9} Z`}
                fill={accentOf(c)}
                {...s(c)}
              />
            ))}
          </g>
        </>
      );
    },
    face(c, cx, cy, r) {
      const my = cy + r * 0.42;
      return (
        <>
          {/* The muzzle, a round nose and a little smile. */}
          <ellipse cx={cx} cy={my} rx={r * 0.42} ry={r * 0.3} fill={c.st.pal.belly} {...s(c, 2.5)} />
          {c.mood === "happy" && (
            <path data-part="tongue" d={`M ${cx - 5} ${my + r * 0.2} Q ${cx - 5.5} ${my + r * 0.5} ${cx} ${my + r * 0.5} Q ${cx + 5.5} ${my + r * 0.5} ${cx + 5} ${my + r * 0.2} Z`} fill="#FF7FA0" {...s(c, 2)} />
          )}
          <path d={`M ${cx - 7} ${my - r * 0.14} Q ${cx} ${my - r * 0.24} ${cx + 7} ${my - r * 0.14} Q ${cx + 6} ${my + r * 0.02} ${cx} ${my + r * 0.04} Q ${cx - 6} ${my + r * 0.02} ${cx - 7} ${my - r * 0.14} Z`} fill={EYE} />
          <ellipse cx={cx - 2.4} cy={my - r * 0.15} rx="2" ry="1.2" fill="#FFFFFF" opacity="0.6" />
          {c.mood !== "sleepy" && (
            <path d={`M ${cx - 8} ${my + r * 0.12} Q ${cx - 4} ${my + r * 0.26} ${cx} ${my + r * 0.06} Q ${cx + 4} ${my + r * 0.26} ${cx + 8} ${my + r * 0.12}`} fill="none" stroke={EYE} strokeWidth="2.3" strokeLinecap="round" />
          )}
        </>
      );
    },
    front(c, cx, cy, r) {
      // Its collar, unless something from the shop is worn round the neck.
      if (c.stage < 4 || wearing(c, "neck")) return null;
      return (
        <g data-part="collar">
          <path d={`M ${cx - r * 0.74} ${cy + r * 0.8} Q ${cx} ${cy + r * 1.1} ${cx + r * 0.74} ${cy + r * 0.8} L ${cx + r * 0.78} ${cy + r * 0.98} Q ${cx} ${cy + r * 1.3} ${cx - r * 0.78} ${cy + r * 0.98} Z`} fill="#E8434F" {...s(c, 3)} />
          <circle cx={cx} cy={cy + r * 1.3} r={r * 0.16} fill={GOLD} {...s(c, 2.5)} />
        </g>
      );
    },
    eyeY: -0.14,
  },
  tail(c) {
    // A short tail, curled up and wagging; the hero's cape from the Super Pup.
    const d = "M 72 160 Q 48 158 44 136 Q 42 124 50 122";
    const body = c.st.glow ? c.st.pal.body : fillOf(c);
    return (
      <>
        {c.stage >= 7 && wearing(c, "neck") !== "cape" && (
          <g data-part="cape">
            <path d="M 72 104 Q 100 96 128 104 Q 150 136 164 172 Q 150 166 140 176 Q 126 170 114 180 Q 100 174 86 180 Q 74 170 60 176 Q 50 166 36 172 Q 50 136 72 104 Z" fill={CAPE} {...s(c)} />
          </g>
        )}
        <g className="creature-part creature-tail-sway" data-part="tail">
          <path d={d} fill="none" stroke={c.st.stroke || body} strokeWidth={c.st.stroke ? 15 : 11} strokeLinecap="round" />
          {c.st.stroke && <path d={d} fill="none" stroke={body} strokeWidth="9" strokeLinecap="round" />}
        </g>
      </>
    );
  },
  parts: {
    after(c) {
      if (c.stage < 5) return null;
      return (
        <g data-part="ball" transform="translate(140 160)">
          <circle r="10" fill="#C8E64A" {...s(c, 2.5)} />
          <path d="M -9 -4 Q 0 0 -3 9 M 9 4 Q 0 0 3 -9" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    },
  },
});
