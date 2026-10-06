/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The fox: hides in a pile of autumn leaves; one bushy tail, three from the
 * Three-Tail (7) and five as the Fox Spirit (8), fanned out on alternating
 * sides. As drawn in the creature workshop.
 */

import { accentOf, EYE, fillOf, s, speciesFrom } from "./parts";

export const fox = speciesFrom({
  origin: "leaves",
  colors: { body: "#FF8A3D", belly: "#FFF4E6", accent: "#5A3A2A" },
  head: {
    behind(c, cx, cy, r) {
      return [-1, 1].map((d) => (
        <g key={d}>
          <path d={`M ${cx + d * r * 0.82} ${cy - r * 0.3} L ${cx + d * r * 0.8} ${cy - r * 1.3} L ${cx + d * r * 0.22} ${cy - r * 0.8} Z`} fill={fillOf(c)} {...s(c)} />
          <path d={`M ${cx + d * r * 0.8} ${cy - r * 1.3} L ${cx + d * r * 0.78} ${cy - r * 1.0} L ${cx + d * r * 0.55} ${cy - r * 1.05} Z`} fill={accentOf(c)} />
        </g>
      ));
    },
    face(c, cx, cy, r) {
      return (
        <>
          {[-1, 1].map((d) => (
            <path key={d} d={`M ${cx} ${cy + r * 0.2} Q ${cx + d * r * 0.9} ${cy + r * 0.05} ${cx + d * r * 0.95} ${cy + r * 0.45} Q ${cx + d * r * 0.4} ${cy + r * 0.85} ${cx} ${cy + r * 0.62} Z`} fill={c.st.pal.belly} />
          ))}
          <ellipse cx={cx} cy={cy + r * 0.32} rx="5" ry="3.6" fill={EYE} />
          {c.mood !== "sleepy" && (
            <path d={`M ${cx - 7} ${cy + r * 0.5} Q ${cx} ${cy + r * 0.66} ${cx + 7} ${cy + r * 0.5}`} fill="none" stroke={EYE} strokeWidth="2.4" strokeLinecap="round" />
          )}
        </>
      );
    },
  },
  tail(c) {
    // Extra tails fan out on alternating sides: left, right, then higher up.
    const fan: Array<[number, number]> =
      c.stage >= 8 ? [[1, 70], [-1, 38], [1, 38], [-1, 0], [1, 0]] : c.stage >= 7 ? [[1, 38], [-1, 0], [1, 0]] : [[1, 0]];
    return (
      <g data-part="tails" data-count={fan.length}>
        {fan.map(([side, a], i) => (
          <g key={i} transform={`${side < 0 ? "translate(200 0) scale(-1 1) " : ""}rotate(${a} 80 152)`}>
            <g className="creature-part creature-tail-sway">
              <path d="M 80 158 Q 30 168 22 128 Q 20 108 34 112 Q 46 136 82 144 Z" fill={fillOf(c)} {...s(c)} />
              <path d="M 22 128 Q 20 108 34 112 Q 32 124 30 132 Z" fill={c.st.pal.belly} />
            </g>
          </g>
        ))}
      </g>
    );
  },
});
