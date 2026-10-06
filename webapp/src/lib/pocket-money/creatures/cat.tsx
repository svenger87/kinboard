/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The cat: naps in a basket, becomes an adventurer with a scarf (5), then
 * grows a lion's mane (6), fuller from 7. As drawn in the creature workshop.
 */

import { accentOf, EYE, fillOf, s, speciesFrom } from "./parts";
import { wearing } from "./items";

export const cat = speciesFrom({
  origin: "basket",
  colors: { body: "#FFB054", belly: "#FFF1DC", accent: "#E8613A" },
  head: {
    behind(c, cx, cy, r) {
      const mane = c.stage >= 6;
      const rr = r * (c.stage >= 7 ? 1.42 : 1.28);
      return (
        <>
          {mane && (
            <g data-part="mane">
              {Array.from({ length: 14 }, (_, i) => {
                const a = (i / 14) * Math.PI * 2;
                return <circle key={i} cx={cx + Math.cos(a) * rr * 0.82} cy={cy + Math.sin(a) * rr * 0.82} r={rr * 0.3} fill={accentOf(c)} {...s(c, 3)} />;
              })}
            </g>
          )}
          {[-1, 1].map((d) => (
            <g key={d}>
              <path d={`M ${cx + d * r * 0.85} ${cy - r * 0.2} L ${cx + d * r * 0.78} ${cy - r * 1.2} L ${cx + d * r * 0.2} ${cy - r * 0.82} Z`} fill={fillOf(c)} {...s(c)} />
              <path d={`M ${cx + d * r * 0.7} ${cy - r * 0.4} L ${cx + d * r * 0.7} ${cy - r * 0.98} L ${cx + d * r * 0.35} ${cy - r * 0.78} Z`} fill="#FFB3C7" />
            </g>
          ))}
        </>
      );
    },
    face(c, cx, cy, r) {
      const ny = cy + r * 0.3;
      return (
        <>
          <path d={`M ${cx - 5} ${ny} L ${cx + 5} ${ny} L ${cx} ${ny + 5} Z`} fill="#FF7FA0" />
          {c.mood !== "sleepy" && (
            <path d={`M ${cx - 9} ${ny + 8} Q ${cx - 4.5} ${ny + 13} ${cx} ${ny + 7} Q ${cx + 4.5} ${ny + 13} ${cx + 9} ${ny + 8}`} fill="none" stroke={EYE} strokeWidth="2.4" strokeLinecap="round" />
          )}
          {[-1, 1].flatMap((d) =>
            [-1, 0, 1].map((i) => (
              <path key={`${d}${i}`} d={`M ${cx + d * r * 0.45} ${ny + 4 + i * 4} L ${cx + d * r * 1.05} ${ny + 2 + i * 7}`} stroke={EYE} strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
            )),
          )}
        </>
      );
    },
    front(c, cx, cy, r) {
      // Its own scarf, unless something from the shop is worn round the neck.
      if (c.stage < 5 || wearing(c, "neck")) return null;
      return (
        <g data-part="scarf">
          <path d={`M ${cx - r * 0.78} ${cy + r * 0.78} Q ${cx} ${cy + r * 1.12} ${cx + r * 0.78} ${cy + r * 0.78} L ${cx + r * 0.82} ${cy + r * 1.02} Q ${cx} ${cy + r * 1.36} ${cx - r * 0.82} ${cy + r * 1.02} Z`} fill={accentOf(c)} {...s(c, 3)} />
          <path d={`M ${cx + r * 0.45} ${cy + r * 1.05} l 6 22 l 10 -4 z`} fill={accentOf(c)} {...s(c, 3)} />
        </g>
      );
    },
  },
  tail(c) {
    const d = "M 74 162 C 38 168 30 136 46 124 C 56 116 64 128 54 134";
    const body = c.st.pal.body;
    return (
      <g className="creature-part creature-tail-sway">
        <path d={d} fill="none" stroke={c.st.stroke || body} strokeWidth={c.st.stroke ? 15 : 11} strokeLinecap="round" />
        {c.st.stroke && <path d={d} fill="none" stroke={body} strokeWidth="9" strokeLinecap="round" />}
      </g>
    );
  },
});
