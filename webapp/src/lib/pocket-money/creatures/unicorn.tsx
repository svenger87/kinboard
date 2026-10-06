/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The unicorn: a star egg, then a foal; a golden horn from the Pony (3),
 * longer from the Pegasus (6), a rainbow mane and tail from the Rainbow
 * Unicorn (5), wings from the Pegasus (6). As drawn in the creature workshop.
 */

import { accentOf, EYE, fillOf, s, speciesFrom } from "./parts";
import { GOLD, wings } from "./skeleton";
import { tint } from "./styles";

const RAINBOW = ["#FF7AA2", "#FFC83D", "#5FD39A", "#56B6E8", "#B58CFF"];

export const unicorn = speciesFrom({
  origin: "starEgg",
  colors: { body: "#F4F0FF", belly: "#FFFFFF", accent: "#B58CFF" },
  head: {
    behind(c, cx, cy, r) {
      const a = accentOf(c);
      const mane = c.stage >= 5 ? RAINBOW : [a, tint(a, 0.3), a];
      return (
        <>
          {[-1, 1].map((d) => (
            <path key={d} d={`M ${cx + d * r * 0.78} ${cy - r * 0.45} L ${cx + d * r * 0.72} ${cy - r * 1.08} L ${cx + d * r * 0.32} ${cy - r * 0.82} Z`} fill={fillOf(c)} {...s(c)} />
          ))}
          <g data-part="mane">
            {mane.map((col, i) => (
              <circle key={i} cx={cx - r * 0.75 - i * 3} cy={cy - r * 0.55 + i * r * 0.32} r={r * 0.3} fill={col} {...s(c, 2.5)} />
            ))}
          </g>
        </>
      );
    },
    face(c, cx, cy, r) {
      return (
        <>
          <ellipse cx={cx} cy={cy + r * 0.45} rx={r * 0.5} ry={r * 0.3} fill={tint(accentOf(c), 0.7)} {...s(c, 2.5)} />
          <circle cx={cx - 6} cy={cy + r * 0.42} r="2" fill={EYE} />
          <circle cx={cx + 6} cy={cy + r * 0.42} r="2" fill={EYE} />
          {c.stage >= 3 && (
            <g data-part="horn">
              <path d={`M ${cx - 7} ${cy - r * 0.82} L ${cx} ${cy - r * (c.stage >= 6 ? 1.75 : 1.5)} L ${cx + 7} ${cy - r * 0.82} Z`} fill={GOLD} {...s(c, 2.5)} />
              <path d={`M ${cx - 4} ${cy - r * 1.05} L ${cx + 5} ${cy - r * 1.15} M ${cx - 3} ${cy - r * 1.3} L ${cx + 4} ${cy - r * 1.38}`} stroke="#E0A419" strokeWidth="2" strokeLinecap="round" />
            </g>
          )}
        </>
      );
    },
    eyeY: -0.15,
  },
  tail(c) {
    return (
      <g className="creature-part creature-tail-sway">
        <path d="M 78 156 Q 40 160 34 130 Q 50 140 54 128 Q 60 146 80 146 Z" fill={c.stage >= 5 ? "#FF7AA2" : accentOf(c)} {...s(c)} />
      </g>
    );
  },
  wings(c) {
    if (c.stage < 6) return null;
    const a = accentOf(c);
    return wings(c, true, a, tint(a, 0.45));
  },
});
