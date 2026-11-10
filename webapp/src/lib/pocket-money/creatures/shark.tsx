/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The shark: hatches from a mermaid's purse, the egg case a shark pup really
 * grows in. A dorsal fin that grows every stage, side fins that paddle and a
 * tail fin that swishes; gill marks from the Reef Explorer (5), two little
 * teeth in its grin as the Chomper (6), and glowing spots on its fins like a
 * deep-sea fish from the Glow Shark (7).
 */

import { accentOf, EYE, fillOf, s, speciesFrom } from "./parts";

const GLOW = "#9FF3FF";

/** A glowing spot, deep-sea style: a bright dot in a soft halo. */
function glowDot(x: number, y: number, r = 2.6) {
  return (
    <g key={`${x}-${y}`}>
      <circle cx={x} cy={y} r={r * 2.4} fill={GLOW} opacity="0.35" />
      <circle cx={x} cy={y} r={r} fill={GLOW} />
    </g>
  );
}

export const shark = speciesFrom({
  origin: "eggCase",
  colors: { body: "#7FA6C9", belly: "#F4F8FB", accent: "#4E7DA6" },
  head: {
    behind(c, cx, cy, r) {
      // Leaning back from the crown of the head, taller every stage; to one
      // side of the top, so a hat or the crown still sits on the head.
      const h = 0.62 + Math.min(c.stage, 8) * 0.06;
      const base = cy - r * 0.62;
      return (
        <g data-part="dorsal-fin" data-len={h.toFixed(2)}>
          <path
            d={`M ${cx - r * 0.62} ${base + r * 0.2} Q ${cx - r * 0.66} ${base - r * h * 0.7} ${cx - r * 0.98} ${base - r * h} Q ${cx - r * 0.42} ${base - r * h * 0.86} ${cx - r * 0.08} ${base - r * 0.1} Z`}
            fill={fillOf(c)}
            {...s(c)}
          />
          {c.stage >= 7 && <g data-part="glow">{glowDot(cx - r * 0.8, base - r * h * 0.7, r * 0.08)}</g>}
        </g>
      );
    },
    under(c, cx, cy, r) {
      // The pale underside of the snout, as on a real shark.
      return <path d={`M ${cx - r * 0.86} ${cy + r * 0.38} Q ${cx} ${cy + r * 0.12} ${cx + r * 0.86} ${cy + r * 0.38} Q ${cx + r * 0.6} ${cy + r * 0.92} ${cx} ${cy + r} Q ${cx - r * 0.6} ${cy + r * 0.92} ${cx - r * 0.86} ${cy + r * 0.38} Z`} fill={c.st.pal.belly} />;
    },
    face(c, cx, cy, r) {
      const my = cy + r * 0.36;
      if (c.mood === "sleepy") return <ellipse cx={cx} cy={my + r * 0.12} rx="3.2" ry="2.4" fill={EYE} />;
      const w = r * 0.42;
      return (
        <>
          {/* A wide, friendly grin; two little teeth from the Chomper on. */}
          {c.stage >= 6 &&
            [-1, 1].map((d) => (
              <path key={d} data-part="teeth" d={`M ${cx + d * r * 0.14 - 2.8} ${my + r * 0.15} L ${cx + d * r * 0.14 + 2.8} ${my + r * 0.15} L ${cx + d * r * 0.14} ${my + r * 0.27} Z`} fill="#FFFFFF" {...s(c, 1.2)} />
            ))}
          <path d={`M ${cx - w} ${my} Q ${cx} ${my + r * 0.36} ${cx + w} ${my}`} fill="none" stroke={EYE} strokeWidth="2.6" strokeLinecap="round" />
        </>
      );
    },
    eyeY: -0.16,
  },
  tail(c) {
    // A crescent tail fin, low on the left, behind the body.
    return (
      <g className="creature-part creature-tail-sway" data-part="tail-fin">
        <path d="M 80 160 Q 56 160 42 152 Q 34 132 24 118 Q 46 124 56 140 Q 50 162 30 176 Q 54 172 78 168 Z" fill={accentOf(c)} {...s(c)} />
        {c.stage >= 7 && <g data-part="glow">{[glowDot(38, 132), glowDot(46, 165)]}</g>}
      </g>
    );
  },
  parts: {
    belly(c) {
      return (
        <>
          {c.stage >= 5 && (
            <g data-part="gills">
              {[-1, 1].flatMap((d) =>
                [0, 1, 2].map((i) => (
                  <path key={`${d}${i}`} d={`M ${100 + d * (31 - i * 0.5)} ${120 + i * 8} q ${d * 4} 3 0 7`} fill="none" stroke={c.st.pal.spot} strokeWidth="2.4" strokeLinecap="round" />
                )),
              )}
            </g>
          )}
        </>
      );
    },
    arms(c) {
      // Side fins, pointing down and out, paddling.
      return [-1, 1].map((d) => (
        <g key={d} className="creature-part creature-flap">
          <path
            d={`M ${100 + d * 30} 128 Q ${100 + d * 50} 136 ${100 + d * 52} 158 Q ${100 + d * 40} 152 ${100 + d * 28} 150 Z`}
            fill={accentOf(c)}
            {...s(c)}
          />
          {c.stage >= 7 && <g data-part="glow">{glowDot(100 + d * 44, 148)}</g>}
        </g>
      ));
    },
  },
});
