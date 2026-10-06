/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The axolotl: a jelly egg in the pond; frilly gills that grow every stage
 * and wave, and from the Glow Axolotl (7) glowing spots. As drawn in the
 * creature workshop.
 */

import { accentOf, EYE, s, speciesFrom } from "./parts";

export const axolotl = speciesFrom({
  origin: "jelly",
  colors: { body: "#FF9EC4", belly: "#FFE6F0", accent: "#E8558F" },
  head: {
    behind(c, cx, cy, r) {
      const size = 0.55 + Math.min(c.stage, 8) * 0.08;
      return (
        <g data-part="gills">
          {[-1, 1].flatMap((d) =>
            [-1, 0, 1].map((i) => {
              const x = cx + d * r * 0.92;
              const y = cy - r * 0.15 + i * r * 0.32;
              const a = d * (i * 22 - 8);
              return (
                <g key={`${d}${i}`} className={`creature-part ${d > 0 ? "creature-gill-r" : "creature-gill"}`}>
                  <ellipse cx={x + d * r * 0.32 * size} cy={y} rx={r * 0.42 * size} ry={r * 0.13} fill={accentOf(c)} transform={`rotate(${a} ${x} ${y})`} {...s(c, 3)} />
                </g>
              );
            }),
          )}
        </g>
      );
    },
    face(c, cx, cy, r) {
      if (c.mood === "sleepy") return <ellipse cx={cx} cy={cy + r * 0.45} rx="3.2" ry="2.4" fill={EYE} />;
      return <path d={`M ${cx - r * 0.5} ${cy + r * 0.32} Q ${cx} ${cy + r * 0.7} ${cx + r * 0.5} ${cy + r * 0.32}`} fill="none" stroke={EYE} strokeWidth="2.8" strokeLinecap="round" />;
    },
    eyeY: 0,
    eyeX: 0.48,
  },
  tail(c) {
    return (
      <g className="creature-part creature-tail-sway">
        <path d="M 80 160 Q 44 172 26 150 Q 40 154 50 146 Q 36 140 30 128 Q 52 136 80 146 Z" fill={accentOf(c)} {...s(c)} />
      </g>
    );
  },
  parts: {
    belly(c) {
      if (c.stage < 7) return null;
      return (
        <g data-part="glow">
          {[[74, 124], [128, 130], [120, 160], [80, 160]].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="3" fill="#FFFBCC" />
              <circle cx={x} cy={y} r="7" fill="#FFFBCC" opacity="0.3" />
            </g>
          ))}
        </g>
      );
    },
  },
});
