/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The stegosaurus: more back plates every stage (four at stage 3, nine at the
 * top), then a tail with four spikes from the Spike Tail (5). As drawn in the
 * creature workshop, with one change the RFC asked for: the plates stand up
 * in a row over the head and shoulders, rooted behind the head and the back,
 * instead of fanning out sideways around the body.
 */

import { accentOf, EYE, fillOf, IVORY, s, speciesFrom } from "./parts";

const PLATE = "M -9 6 L -7 -8 L 0 -16 L 7 -8 L 9 6 Z";

/** The top of the head-and-shoulders outline at dx from the centre line. */
function ridgeTop(dx: number): number {
  const body = 138 - 38 * Math.sqrt(Math.max(0, 1 - (dx / 40) ** 2));
  const headTop = Math.abs(dx) < 34 ? 84 - Math.sqrt(34 * 34 - dx * dx) : Infinity;
  return Math.min(body, headTop);
}

export const stego = speciesFrom({
  origin: "egg",
  colors: { body: "#F2B544", belly: "#FFF1C7", accent: "#E8613A" },
  head: {
    face(c, cx, cy, r) {
      return (
        <>
          <ellipse cx={cx} cy={cy + r * 0.42} rx={r * 0.52} ry={r * 0.32} fill={c.st.pal.belly} {...s(c)} />
          <circle cx={cx - 6} cy={cy + r * 0.32} r="2" fill={EYE} />
          <circle cx={cx + 6} cy={cy + r * 0.32} r="2" fill={EYE} />
          {c.mood !== "sleepy" && (
            <path d={`M ${cx - 9} ${cy + r * 0.5} Q ${cx} ${cy + r * 0.7} ${cx + 9} ${cy + r * 0.5}`} fill="none" stroke={EYE} strokeWidth="2.4" strokeLinecap="round" />
          )}
        </>
      );
    },
  },
  tail(c) {
    const n = Math.min(4 + Math.max(0, c.stage - 3), 9);
    return (
      <>
        <g data-part="plates" data-count={n}>
          {Array.from({ length: n }, (_, i) => {
            const t = (i / (n - 1)) * 2 - 1;
            const dx = t * 36;
            // rooted 8 below the outline, so only the plate shows above it;
            // tallest along the spine in the middle, leaning out a little at
            // the shoulders, never more than 20 degrees
            const y = ridgeTop(dx) + 8;
            const k = 1.05 + 0.35 * (1 - Math.abs(t));
            return (
              <path key={i} transform={`translate(${100 + dx} ${y}) rotate(${t * 20}) scale(${k.toFixed(3)})`} d={PLATE} fill={accentOf(c)} {...s(c, 2.6)} />
            );
          })}
        </g>
        <g className="creature-part creature-tail-sway">
          <path d="M 80 160 Q 40 170 28 150 Q 40 152 82 146 Z" fill={fillOf(c)} {...s(c)} />
          {c.stage >= 5 && (
            <g data-part="tail-spikes">
              {[[34, 150, -40], [44, 154, -60], [36, 158, 200], [46, 160, 220]].map(([x, y, a]) => (
                <path key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${a})`} d="M -3 0 L 0 -12 L 3 0 Z" fill={IVORY} {...s(c, 2)} />
              ))}
            </g>
          )}
        </g>
      </>
    );
  },
});
