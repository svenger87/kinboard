/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The triceratops: its frill grows into a shield every stage; a nose horn
 * from the Little Trike (3), longer from 6, and two brow horns from the
 * Shield Head (4) that lengthen at 5 and 7. As drawn in the creature workshop.
 */

import { accentOf, EYE, fillOf, IVORY, s, speciesFrom } from "./parts";
import { shade, tint } from "./styles";

export const trike = speciesFrom({
  origin: "egg",
  colors: { body: "#7FB7E8", belly: "#E6F2FB", accent: "#F2A65A" },
  head: {
    behind(c, cx, cy, r) {
      const k = 0.9 + Math.min(c.stage, 8) * 0.07;
      const a = accentOf(c);
      return (
        <g data-part="frill">
          <ellipse cx={cx} cy={cy - r * 0.2} rx={r * 1.15 * k} ry={r * 0.95 * k} fill={a} {...s(c)} />
          {Array.from({ length: 9 }, (_, i) => {
            const t = Math.PI + (i / 8) * Math.PI;
            return <circle key={i} cx={cx + Math.cos(t) * r * 1.1 * k} cy={cy - r * 0.2 + Math.sin(t) * r * 0.9 * k} r="5" fill={tint(a, 0.4)} />;
          })}
        </g>
      );
    },
    face(c, cx, cy, r) {
      const sy = cy + r * 0.45;
      const belly = c.st.pal.belly;
      return (
        <>
          <ellipse cx={cx} cy={sy} rx={r * 0.55} ry={r * 0.36} fill={belly} {...s(c)} />
          <path d={`M ${cx - 6} ${sy + r * 0.18} L ${cx} ${sy + r * 0.42} L ${cx + 6} ${sy + r * 0.18} Z`} fill={shade(belly, 0.2)} />
          {c.stage >= 3 && (
            <path data-part="nose-horn" d={`M ${cx - 5} ${sy - r * 0.2} L ${cx} ${sy - r * (c.stage >= 6 ? 0.62 : 0.5)} L ${cx + 5} ${sy - r * 0.2} Z`} fill={IVORY} {...s(c, 2.5)} />
          )}
          {c.mood !== "sleepy" && (
            <path d={`M ${cx - 8} ${sy + r * 0.08} Q ${cx} ${sy + r * 0.2} ${cx + 8} ${sy + r * 0.08}`} fill="none" stroke={EYE} strokeWidth="2.2" strokeLinecap="round" />
          )}
        </>
      );
    },
    front(c, cx, cy, r) {
      if (c.stage < 4) return null;
      const len = c.stage >= 7 ? 1.05 : c.stage >= 5 ? 0.85 : 0.65;
      return (
        <g data-part="brow-horns">
          {[-1, 1].map((d) => (
            <path key={d} d={`M ${cx + d * r * 0.3} ${cy - r * 0.55} Q ${cx + d * r * 0.55} ${cy - r * (0.6 + len)} ${cx + d * r * 0.78} ${cy - r * (0.45 + len)} Q ${cx + d * r * 0.5} ${cy - r * 0.7} ${cx + d * r * 0.52} ${cy - r * 0.42} Z`} fill={IVORY} {...s(c, 2.5)} />
          ))}
        </g>
      );
    },
  },
  tail(c) {
    return (
      <g className="creature-part creature-tail-sway">
        <path d="M 80 160 Q 46 170 36 150 Q 48 152 82 146 Z" fill={fillOf(c)} {...s(c)} />
      </g>
    );
  },
});
