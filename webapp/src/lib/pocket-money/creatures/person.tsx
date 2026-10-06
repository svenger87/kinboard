/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The person skeleton, shared by the princess and the prince: a head with
 * skin and hair, a dress or a tunic, sleeves and hands. Ported from the
 * creature workshop's personBody() and the two characters' head parts.
 *
 * The hair is its own piece (hair()), drawn from a hairstyle: each character
 * has a default -- long for the princess, short for the prince -- and a
 * child's own choice slots in there and nowhere else.
 */

import type { ReactNode } from "react";
import { EYE, fillOf, s, type Draw, type HeadParts } from "./parts";
import { GOLD } from "./skeleton";
import { shade } from "./styles";

export const HAIRSTYLES = ["short", "long", "ponytail", "curls"] as const;
export type Hairstyle = (typeof HAIRSTYLES)[number];

export const skinOf = (c: Draw) => c.st.pal.skin ?? "#F2C8A0";
export const hairOf = (c: Draw) => c.st.pal.hair ?? c.st.pal.accent ?? c.st.pal.wing;

/** Hair behind the head: long hair falls to the shoulders. */
function hairBehind(c: Draw, style: Hairstyle, cx: number, cy: number, r: number): ReactNode {
  const hair = hairOf(c);
  if (style === "long") {
    return (
      <path
        data-part="hair-back"
        d={`M ${cx - r * 1.05} ${cy} Q ${cx - r * 1.15} ${cy + r * 1.4} ${cx - r * 0.55} ${cy + r * 1.35} L ${cx + r * 0.55} ${cy + r * 1.35} Q ${cx + r * 1.15} ${cy + r * 1.4} ${cx + r * 1.05} ${cy} Q ${cx + r} ${cy - r * 1.15} ${cx} ${cy - r * 1.12} Q ${cx - r} ${cy - r * 1.15} ${cx - r * 1.05} ${cy} Z`}
        fill={hair}
        {...s(c)}
      />
    );
  }
  return null;
}

/** Hair on top of the head: a fringe over the forehead. */
function hairFront(c: Draw, style: Hairstyle, cx: number, cy: number, r: number): ReactNode {
  const hair = hairOf(c);
  if (style === "long") {
    // the princess's: a side-swept fringe
    return (
      <path
        data-part="hair"
        d={`M ${cx - r * 0.98} ${cy - r * 0.05} Q ${cx - r * 0.95} ${cy - r * 1.12} ${cx} ${cy - r * 1.1} Q ${cx + r * 0.95} ${cy - r * 1.12} ${cx + r * 0.98} ${cy - r * 0.05} Q ${cx + r * 0.7} ${cy - r * 0.55} ${cx + r * 0.1} ${cy - r * 0.62} Q ${cx - r * 0.2} ${cy - r * 0.4} ${cx - r * 0.98} ${cy - r * 0.05} Z`}
        fill={hair}
        {...s(c, 2.5)}
      />
    );
  }
  // short: the prince's
  return (
    <path
      data-part="hair"
      d={`M ${cx - r * 0.98} ${cy - r * 0.05} Q ${cx - r} ${cy - r * 1.12} ${cx} ${cy - r * 1.1} Q ${cx + r} ${cy - r * 1.12} ${cx + r * 0.98} ${cy - r * 0.05} Q ${cx + r * 0.8} ${cy - r * 0.58} ${cx + r * 0.25} ${cy - r * 0.6} Q ${cx - r * 0.2} ${cy - r * 0.72} ${cx - r * 0.55} ${cy - r * 0.5} Q ${cx - r * 0.8} ${cy - r * 0.4} ${cx - r * 0.98} ${cy - r * 0.05} Z`}
      fill={hair}
      {...s(c, 2.5)}
    />
  );
}

const smile = (c: Draw, cx: number, cy: number, r: number) =>
  c.mood === "sleepy" ? null : (
    <path d={`M ${cx - 7} ${cy + r * 0.38} Q ${cx} ${cy + r * 0.55} ${cx + 7} ${cy + r * 0.38}`} fill="none" stroke={EYE} strokeWidth="2.4" strokeLinecap="round" />
  );

/** A person's head parts, with a hairstyle, and what they wear on it. */
export function personHead(defaultHair: Hairstyle, headwear: HeadParts["front"]): HeadParts {
  // The hairstyle is the character's default until a child chooses one.
  const style = (_c: Draw): Hairstyle => defaultHair;
  return {
    behind: (c, cx, cy, r) => hairBehind(c, style(c), cx, cy, r),
    shape: (c, cx, cy, r) => (
      <>
        <circle cx={cx} cy={cy} r={r} fill={skinOf(c)} {...s(c)} />
        {hairFront(c, style(c), cx, cy, r)}
      </>
    ),
    face: smile,
    front: headwear,
    eyeY: -0.02,
  };
}

/** The princess's dress or the prince's tunic, sleeves and hands, and what they carry. */
export function personBody(c: Draw, who: "princess" | "prince"): ReactNode {
  const p = c.st.pal;
  const prin = who === "princess";
  const fill = fillOf(c);
  return (
    <>
      {c.stage >= 6 && (
        <path data-part="cape" d="M 70 106 Q 100 98 130 106 L 148 178 Q 100 190 52 178 Z" fill={prin ? shade(p.body, 0.3) : "#D9434F"} {...s(c)} />
      )}
      {prin ? (
        <>
          <ellipse cx="88" cy="181" rx="8" ry="5" fill={shade(p.body, 0.35)} />
          <ellipse cx="112" cy="181" rx="8" ry="5" fill={shade(p.body, 0.35)} />
          <path d="M 82 112 Q 100 106 118 112 L 142 174 Q 100 186 58 174 Z" fill={fill} {...s(c)} />
          <path d="M 60 170 Q 100 182 140 170" stroke={p.belly} strokeWidth="6" fill="none" strokeLinecap="round" />
          <ellipse cx="100" cy="120" rx="20" ry="13" fill={fill} {...s(c)} />
          <path d="M 84 128 Q 100 134 116 128" stroke={p.belly} strokeWidth="4" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="86" y="148" width="11" height="28" rx="5" fill={shade(p.body, 0.4)} {...s(c)} />
          <rect x="103" y="148" width="11" height="28" rx="5" fill={shade(p.body, 0.4)} {...s(c)} />
          <ellipse cx="90" cy="178" rx="10" ry="6" fill="#5A3A2A" {...s(c)} />
          <ellipse cx="110" cy="178" rx="10" ry="6" fill="#5A3A2A" {...s(c)} />
          <rect x="72" y="106" width="56" height="52" rx="16" fill={fill} {...s(c)} />
          <path d="M 84 108 L 100 122 L 116 108" stroke={p.belly} strokeWidth="4" fill="none" strokeLinejoin="round" />
          <rect x="74" y="138" width="52" height="7" fill="#5A3A2A" />
          <rect x="95" y="136" width="10" height="11" rx="2" fill={GOLD} />
        </>
      )}
      {/* sleeves and hands */}
      {[-1, 1].map((d) => (
        <g key={d}>
          <ellipse cx={100 + d * 26} cy="124" rx="9" ry="13" fill={fill} transform={`rotate(${d * -25} ${100 + d * 26} 124)`} {...s(c)} />
          <circle cx={100 + d * 31} cy="138" r="6.5" fill={skinOf(c)} {...s(c, 2.5)} />
        </g>
      ))}
      {prin && c.stage >= 5 && (
        <g data-part="wand">
          <path d="M 132 140 L 144 96" stroke="#C9A227" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M 144 82 l 3.5 8 l 8.5 .8 l -6.4 5.6 l 2 8.4 l -7.6 -4.6 l -7.6 4.6 l 2 -8.4 l -6.4 -5.6 l 8.5 -.8 z" fill={GOLD} {...s(c, 2)} />
        </g>
      )}
      {!prin && c.stage >= 5 && (
        <g data-part="sword" transform="rotate(-18 131 138)">
          <rect x="128.5" y="96" width="5" height="40" rx="2" fill="#DDE4EE" {...s(c, 2)} />
          <rect x="122" y="132" width="18" height="5" rx="2" fill={GOLD} />
          <rect x="128.5" y="137" width="5" height="9" rx="2" fill="#5A3A2A" />
        </g>
      )}
      {!prin && c.stage >= 6 && (
        <g data-part="shield">
          <path d="M 56 118 L 80 118 L 80 138 Q 80 154 68 160 Q 56 154 56 138 Z" fill={p.belly} {...(c.st.stroke ? s(c) : { stroke: "#B8901A", strokeWidth: 2 })} />
          <path d="M 68 124 l 0 26 M 60 134 l 16 0" stroke="#D9434F" strokeWidth="4" strokeLinecap="round" />
        </g>
      )}
    </>
  );
}
