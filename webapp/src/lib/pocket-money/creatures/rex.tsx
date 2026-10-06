/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The T-Rex: a big head, tiny arms and a giant smile; a ridge of spikes from
 * the Stomper (4), one more each stage, and teeth from 4. As drawn in the
 * creature workshop.
 */

import { accentOf, EYE, fillOf, s, speciesFrom } from "./parts";

export const rex = speciesFrom({
  origin: "egg",
  colors: { body: "#7BC96F", belly: "#E8F5C8", accent: "#4E9A47" },
  head: {
    behind(c, cx, cy, r) {
      if (c.stage < 4) return null;
      const n = c.stage - 2;
      return (
        <g data-part="ridge">
          {Array.from({ length: n }, (_, i) => {
            const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
            return <circle key={i} cx={cx + t * r * 0.5} cy={cy - r * 0.95 + Math.abs(t) * r * 0.2} r="6" fill={accentOf(c)} {...s(c, 2.5)} />;
          })}
        </g>
      );
    },
    face(c, cx, cy, r) {
      const sy = cy + r * 0.45;
      const rx = r * 0.78;
      const ry = r * 0.42;
      const snout = (
        <>
          <ellipse cx={cx} cy={sy} rx={rx} ry={ry} fill={c.st.pal.belly} {...s(c)} />
          <circle cx={cx - 7} cy={sy - ry * 0.45} r="2.2" fill={EYE} />
          <circle cx={cx + 7} cy={sy - ry * 0.45} r="2.2" fill={EYE} />
        </>
      );
      if (c.mood === "sleepy") return <>{snout}<ellipse cx={cx} cy={sy + ry * 0.4} rx="3.2" ry="2.4" fill={EYE} /></>;
      return (
        <>
          {snout}
          <path d={`M ${cx - rx * 0.7} ${sy + ry * 0.05} Q ${cx} ${sy + ry * 0.95} ${cx + rx * 0.7} ${sy + ry * 0.05}`} fill="#FFFFFF" stroke={EYE} strokeWidth="2.6" strokeLinejoin="round" />
          {c.stage >= 4 && (
            <g data-part="teeth">
              {[-1, 1].flatMap((d) =>
                [0.25, 0.5].map((k) => (
                  <path key={`${d}${k}`} d={`M ${cx + d * rx * k - 3} ${sy + ry * 0.18} L ${cx + d * rx * k} ${sy + ry * 0.42} L ${cx + d * rx * k + 3} ${sy + ry * 0.18} Z`} fill="#FFFFFF" stroke={EYE} strokeWidth="1.2" strokeLinejoin="round" />
                )),
              )}
            </g>
          )}
        </>
      );
    },
    eyeY: -0.22,
    eyeR: 0.17,
  },
  tail(c) {
    return (
      <g className="creature-part creature-tail-sway">
        <path d="M 80 160 Q 34 172 22 146 Q 20 136 30 136 Q 44 156 82 146 Z" fill={fillOf(c)} {...s(c)} />
        {[0, 1].map((i) => (
          <path key={i} d={`M ${50 - i * 12} ${158 - i * 2} q 3 -6 1 -12`} stroke={accentOf(c)} strokeWidth="4" fill="none" strokeLinecap="round" />
        ))}
      </g>
    );
  },
  parts: {
    // tiny arms
    arms(c) {
      return (
        <>
          <ellipse cx="78" cy="122" rx="5" ry="8" fill={fillOf(c)} {...s(c, 2.5)} transform="rotate(-30 78 122)" />
          <ellipse cx="122" cy="122" rx="5" ry="8" fill={fillOf(c)} {...s(c, 2.5)} transform="rotate(30 122 122)" />
        </>
      );
    },
  },
});
