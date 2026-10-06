/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The bunny: naps in a basket; its ears grow longer every stage, it earns a
 * carrot as the Carrot Champion (6) and glows as the Moon Rabbit (7). As
 * drawn in the creature workshop.
 */

import { accentOf, EYE, fillOf, s, speciesFrom } from "./parts";

export const bunny = speciesFrom({
  origin: "basket",
  colors: { body: "#F2E6DA", belly: "#FFFFFF", accent: "#FF9EBB" },
  head: {
    behind(c, cx, cy, r) {
      const len = 0.42 + Math.min(c.stage, 8) * 0.07;
      const w = 0.2;
      return (
        <g data-part="ears" data-len={len.toFixed(2)}>
          {[-1, 1].map((d) => {
            const x = cx + d * r * 0.42;
            const rot = `rotate(${d * 10} ${x} ${cy - r * 0.75})`;
            return (
              <g key={d}>
                <ellipse cx={x} cy={cy - r * (0.75 + len / 2)} rx={r * w} ry={r * len} fill={fillOf(c)} transform={rot} {...s(c)} />
                <ellipse cx={x} cy={cy - r * (0.78 + len / 2)} rx={r * w * 0.5} ry={r * len * 0.78} fill={accentOf(c)} transform={rot} />
              </g>
            );
          })}
        </g>
      );
    },
    face(c, cx, cy, r) {
      return (
        <>
          <path d={`M ${cx - 4.5} ${cy + r * 0.26} L ${cx + 4.5} ${cy + r * 0.26} L ${cx} ${cy + r * 0.4} Z`} fill="#FF7FA0" />
          {c.mood !== "sleepy" && (
            <>
              <path d={`M ${cx - 8} ${cy + r * 0.5} Q ${cx - 4} ${cy + r * 0.64} ${cx} ${cy + r * 0.42} Q ${cx + 4} ${cy + r * 0.64} ${cx + 8} ${cy + r * 0.5}`} fill="none" stroke={EYE} strokeWidth="2.3" strokeLinecap="round" />
              <rect x={cx - 3.5} y={cy + r * 0.47} width="7" height="5" rx="1.5" fill="#FFFFFF" {...s(c, 1.5)} />
            </>
          )}
        </>
      );
    },
  },
  tail(c) {
    return <circle cx="64" cy="162" r="11" fill={c.st.pal.belly} {...s(c)} />;
  },
  parts: {
    aura(c) {
      return c.stage >= 7 ? <circle data-part="moon-glow" cx="100" cy="132" r="56" fill="#FFF6C2" opacity="0.35" /> : null;
    },
    after(c) {
      if (c.stage < 6) return null;
      return (
        <g data-part="carrot" transform="translate(134 138) rotate(28)">
          <path d="M -5 -4 L 5 -4 L 0 26 Z" fill="#FF8A3D" {...s(c, 2.5)} />
          <path d="M -2 -4 l -6 -10 M 0 -4 l 0 -12 M 2 -4 l 6 -10" stroke="#3FA877" strokeWidth="3.5" strokeLinecap="round" />
        </g>
      );
    },
  },
});
