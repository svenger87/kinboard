/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The owl: an owlet with ear tufts from stage 3, wings that grow at 5,
 * glasses from the Scholar (6) and a graduation cap at 7. As drawn in the
 * creature workshop.
 */

import { accentOf, s, speciesFrom } from "./parts";
import { shade } from "./styles";
import { GOLD } from "./skeleton";
import { wearing } from "./items";

export const owl = speciesFrom({
  origin: "egg",
  colors: { body: "#A47551", belly: "#F4E3C8", accent: "#7A4E2D" },
  head: {
    behind(c, cx, cy, r) {
      if (c.stage < 3) return null;
      return [-1, 1].map((d) => (
        <path key={d} d={`M ${cx + d * r * 0.4} ${cy - r * 0.85} L ${cx + d * r * 0.78} ${cy - r * 1.32} L ${cx + d * r * 0.86} ${cy - r * 0.6} Z`} fill={accentOf(c)} {...s(c)} />
      ));
    },
    under(c, cx, cy, r) {
      return [-1, 1].map((d) => <circle key={d} cx={cx + d * r * 0.38} cy={cy - r * 0.08} r={r * 0.36} fill={c.st.pal.belly} {...s(c, 2.5)} />);
    },
    face(c, cx, cy, r) {
      return <path d={`M ${cx - 6} ${cy + r * 0.26} L ${cx + 6} ${cy + r * 0.26} L ${cx} ${cy + r * 0.5} Z`} fill="#FFB547" {...s(c, 2.5)} />;
    },
    front(c, cx, cy, r) {
      return (
        <>
          {c.stage >= 6 && c.look.acc !== "glasses" && !wearing(c, "face") && (
            <g data-part="glasses">
              {[-1, 1].map((d) => (
                <circle key={d} cx={cx + d * r * 0.38} cy={cy - r * 0.08} r={r * 0.3} fill="none" stroke="#2A2438" strokeWidth="2.6" />
              ))}
              <path d={`M ${cx - r * 0.08} ${cy - r * 0.1} L ${cx + r * 0.08} ${cy - r * 0.1}`} stroke="#2A2438" strokeWidth="2.6" />
            </g>
          )}
          {c.stage === 7 && c.look.acc !== "hat" && !wearing(c, "head") && (
            <g data-part="cap" transform={`translate(${cx} ${cy - r * 0.98})`}>
              <path d="M -24 0 L 0 -10 L 24 0 L 0 10 Z" fill="#2A2438" />
              <rect x="-11" y="0" width="22" height="9" fill="#2A2438" />
              <path d="M 18 0 l 4 16" stroke={GOLD} strokeWidth="2.5" />
              <circle cx="22" cy="17" r="3" fill={GOLD} />
            </g>
          )}
        </>
      );
    },
    eyeX: 0.38,
    eyeY: -0.08,
    eyeR: 0.2,
  },
  parts: {
    birdFeet: true,
    belly(c) {
      return [0, 1, 2].map((i) => (
        <path key={i} d={`M ${88 + i * 8} ${136 + (i % 2) * 8} q 4 4 8 0`} stroke={shade(c.st.pal.belly, 0.25)} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      ));
    },
    arms(c) {
      return [-1, 1].map((d) => (
        <g key={d} className="creature-part creature-flap">
          <ellipse cx={100 + d * 36} cy="140" rx="12" ry={c.stage >= 5 ? 26 : 20} fill={accentOf(c)} transform={`rotate(${d * -14} ${100 + d * 36} 140)`} {...s(c)} />
        </g>
      ));
    },
  },
});
