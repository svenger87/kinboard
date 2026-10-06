/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The robot: built from a box of parts; a square head with a screen face and
 * an antenna, lights that blink from the Helper Bot (4), jets from 5 and
 * shoulder plates from 6. As drawn in the creature workshop.
 */

import { accentOf, fillOf, s, speciesFrom } from "./parts";
import { shade } from "./styles";

const SCREEN = "#7DF9FF";
const LIGHTS = ["#FF6B8B", "#FFC83D", "#5FD39A"];

export const robot = speciesFrom({
  origin: "box",
  colors: { body: "#8FB8DE", belly: "#E3EEF8", accent: "#FFB547" },
  head: {
    behind(c, cx, cy, r) {
      return (
        <>
          <path d={`M ${cx} ${cy - r * 0.9} L ${cx} ${cy - r * 1.35}`} stroke={c.st.stroke || "#5B6B7A"} strokeWidth="3.5" strokeLinecap="round" />
          <circle cx={cx} cy={cy - r * 1.42} r="5.5" fill={accentOf(c)} className={c.stage >= 4 ? "creature-part creature-led" : undefined} {...s(c, 2.5)} />
        </>
      );
    },
    shape(c, cx, cy, r) {
      return (
        <>
          <rect x={cx - r} y={cy - r * 0.9} width={r * 2} height={r * 1.8} rx={r * 0.45} fill={fillOf(c)} {...s(c)} />
          <rect x={cx - r * 0.72} y={cy - r * 0.55} width={r * 1.44} height={r * 1.05} rx={r * 0.25} fill="#24324A" {...s(c, 2.5)} />
          {[-1, 1].map((d) => (
            <rect key={d} x={cx + d * r - (d > 0 ? 0 : 6)} y={cy - 8} width="6" height="16" rx="3" fill={accentOf(c)} {...s(c, 2.5)} />
          ))}
        </>
      );
    },
    face(c, cx, cy, r) {
      if (c.mood === "sleepy") return <path d={`M ${cx - 7} ${cy + r * 0.28} L ${cx + 7} ${cy + r * 0.28}`} stroke={SCREEN} strokeWidth="3" strokeLinecap="round" />;
      return <path d={`M ${cx - 10} ${cy + r * 0.22} Q ${cx} ${cy + r * 0.4} ${cx + 10} ${cy + r * 0.22}`} fill="none" stroke={SCREEN} strokeWidth="3" strokeLinecap="round" />;
    },
    eyeColor: SCREEN,
    eyeY: -0.12,
    eyeR: 0.17,
    crownLift: 1.0,
  },
  body(c) {
    const p = c.st.pal;
    const fill = fillOf(c);
    return (
      <>
        {c.stage >= 5 && (
          <g data-part="jets">
            {[-1, 1].map((d) => (
              <path key={d} d={`M ${100 + d * 26} 172 L ${100 + d * 20} 192 L ${100 + d * 32} 192 Z`} fill="#FFB547" {...s(c, 2.5)} />
            ))}
          </g>
        )}
        <circle cx="80" cy="176" r="10" fill="#3D4A5C" {...s(c)} />
        <circle cx="120" cy="176" r="10" fill="#3D4A5C" {...s(c)} />
        <circle cx="80" cy="176" r="3.5" fill="#9AA8B8" />
        <circle cx="120" cy="176" r="3.5" fill="#9AA8B8" />
        <rect x="62" y="104" width="76" height="70" rx="20" fill={fill} {...s(c)} />
        <rect x="78" y="118" width="44" height="34" rx="9" fill={p.belly} {...s(c, 2.5)} />
        {LIGHTS.map((col, i) => (
          <circle
            key={col}
            cx={88 + i * 12}
            cy="128"
            r="3.5"
            fill={col}
            className={c.stage >= 4 ? "creature-part creature-led" : undefined}
            style={c.stage >= 4 ? { animationDelay: `${i * 0.4}s` } : undefined}
          />
        ))}
        <rect x="86" y="138" width="28" height="5" rx="2.5" fill={shade(p.belly, 0.2)} />
        {c.stage >= 6 && (
          <g data-part="shoulders">
            {[-1, 1].map((d) => (
              <rect key={d} x={100 + d * 46 - 13} y="104" width="26" height="18" rx="9" fill={accentOf(c)} {...s(c)} />
            ))}
          </g>
        )}
        {[-1, 1].map((d) => (
          <rect key={d} x={100 + d * 44 - 7} y="122" width="14" height="30" rx="7" fill={fill} {...s(c)} />
        ))}
      </>
    );
  },
});
