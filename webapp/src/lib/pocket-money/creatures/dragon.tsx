/** @jsxImportSource react */
// The pragma is a no-op for Next; it makes the Playwright runner, which
// otherwise compiles JSX into its own component-test objects, build real React
// elements when e2e/creature-avatar.spec.ts renders these to markup.
/**
 * The dragon: what it draws itself on the shared skeleton (./skeleton.tsx).
 *
 * Stage settings, as in the approved prototype: crest spikes from the
 * Crocodile (4) on, a longer snout from 4, horns and wings from the Drake (5),
 * big wings, a fang and a spade tail tip from the Dragon (6), a second pair of
 * horns and belly scales from the Behemoth (7), a crown at the top (8).
 */

import type { ReactNode } from "react";
import type { AvatarTier } from "../types";
import { bodyFill, eyes, strokeOf, type CreatureMood, type DrawContext, type SpeciesArt } from "./skeleton";

function head(ctx: DrawContext, stage: number, mood: CreatureMood, cx: number, cy: number, r: number): ReactNode {
  const { st } = ctx;
  const p = st.pal;
  const s = strokeOf(st);
  const parts: ReactNode[] = [];

  // crest spikes from the Crocodile on
  const crest = Math.max(0, stage - 3);
  for (let i = 0; i < crest; i++) {
    const t = crest === 1 ? 0 : (i / (crest - 1)) * 2 - 1;
    const x = cx + t * r * 0.55;
    const y = cy - r * 0.92 + Math.abs(t) * r * 0.22;
    parts.push(<path key={`crest-${i}`} d={`M ${x - 6} ${y + 6} L ${x} ${y - 9} L ${x + 6} ${y + 6} Z`} fill={p.spot} {...s} />);
  }
  // horns from the Drake on, a second pair from the Behemoth
  if (stage >= 5) {
    parts.push(
      <path key="horn-l" d={`M ${cx - r * 0.62} ${cy - r * 0.55} Q ${cx - r * 0.95} ${cy - r * 1.25} ${cx - r * 0.5} ${cy - r * 1.35} Q ${cx - r * 0.55} ${cy - r * 0.95} ${cx - r * 0.3} ${cy - r * 0.75} Z`} fill={p.horn} {...s} />,
      <path key="horn-r" d={`M ${cx + r * 0.62} ${cy - r * 0.55} Q ${cx + r * 0.95} ${cy - r * 1.25} ${cx + r * 0.5} ${cy - r * 1.35} Q ${cx + r * 0.55} ${cy - r * 0.95} ${cx + r * 0.3} ${cy - r * 0.75} Z`} fill={p.horn} {...s} />,
    );
  }
  if (stage >= 7) {
    parts.push(
      <path key="horn2-l" d={`M ${cx - r * 0.9} ${cy - r * 0.15} L ${cx - r * 1.32} ${cy - r * 0.45} L ${cx - r * 0.95} ${cy + r * 0.12} Z`} fill={p.horn} {...s} />,
      <path key="horn2-r" d={`M ${cx + r * 0.9} ${cy - r * 0.15} L ${cx + r * 1.32} ${cy - r * 0.45} L ${cx + r * 0.95} ${cy + r * 0.12} Z`} fill={p.horn} {...s} />,
    );
  }
  if (stage === 8) {
    const top = cy - r * 1.05;
    const crownStroke = st.stroke ? strokeOf(st, 3) : { stroke: "#E0A419", strokeWidth: 2, strokeLinejoin: "round" as const };
    parts.push(
      <path key="crown" data-part="crown" d={`M ${cx - 20} ${top + 4} L ${cx - 20} ${top - 14} L ${cx - 10} ${top - 4} L ${cx} ${top - 18} L ${cx + 10} ${top - 4} L ${cx + 20} ${top - 14} L ${cx + 20} ${top + 4} Z`} fill="#FFC83D" {...crownStroke} />,
      <circle key="crown-gem" cx={cx} cy={top - 4} r="3.4" fill="#FF5C8A" />,
    );
  }
  parts.push(<circle key="skull" cx={cx} cy={cy} r={r} fill={bodyFill(ctx)} {...s} />);

  // snout: grows longer from the Crocodile on
  const snoutRx = stage >= 4 ? r * 0.68 : r * 0.52;
  const snoutRy = stage >= 4 ? r * 0.38 : r * 0.33;
  const sy = cy + r * 0.42;
  parts.push(
    <ellipse key="snout" cx={cx} cy={sy} rx={snoutRx} ry={snoutRy} fill={p.belly} {...s} />,
    <circle key="nostril-l" cx={cx - snoutRx * 0.35} cy={sy - snoutRy * 0.25} r="2.2" fill={p.eye} />,
    <circle key="nostril-r" cx={cx + snoutRx * 0.35} cy={sy - snoutRy * 0.25} r="2.2" fill={p.eye} />,
  );
  const mouthW = snoutRx * 0.45;
  if (mood === "sleepy") {
    parts.push(<ellipse key="mouth" cx={cx} cy={sy + snoutRy * 0.45} rx="3.2" ry="2.4" fill={p.eye} />);
  } else {
    parts.push(
      <path key="mouth" d={`M ${cx - mouthW} ${sy + snoutRy * 0.25} Q ${cx} ${sy + snoutRy * 0.85} ${cx + mouthW} ${sy + snoutRy * 0.25}`} fill="none" stroke={p.eye} strokeWidth="2.6" strokeLinecap="round" />,
    );
    if (stage >= 6) {
      parts.push(
        <path key="fang" d={`M ${cx - mouthW * 0.55} ${sy + snoutRy * 0.42} L ${cx - mouthW * 0.35} ${sy + snoutRy * 0.75} L ${cx - mouthW * 0.15} ${sy + snoutRy * 0.5} Z`} fill="#FFFFFF" />,
      );
    }
  }
  parts.push(
    <circle key="cheek-l" cx={cx - r * 0.62} cy={cy + r * 0.18} r={r * 0.15} fill={p.cheek} opacity="0.75" />,
    <circle key="cheek-r" cx={cx + r * 0.62} cy={cy + r * 0.18} r={r * 0.15} fill={p.cheek} opacity="0.75" />,
    <g key="eyes">{eyes(ctx, mood, cx - r * 0.36, cx + r * 0.36, cy - r * 0.12, r * 0.2)}</g>,
  );
  return <>{parts}</>;
}

function wing(ctx: DrawContext, big: boolean): ReactNode {
  const { st } = ctx;
  const p = st.pal;
  const k = big ? 1 : 0.62;
  const P = (x: number, y: number) => `${100 - (100 - x) * k} ${120 - (120 - y) * k}`;
  return (
    <g className="creature-part creature-flap">
      <path
        d={`M ${P(84, 118)} C ${P(58, 82)} ${P(34, 66)} ${P(18, 72)} C ${P(30, 84)} ${P(24, 96)} ${P(36, 102)} C ${P(28, 110)} ${P(36, 120)} ${P(50, 120)} C ${P(50, 128)} ${P(62, 132)} ${P(84, 128)} Z`}
        fill={p.wing}
        {...strokeOf(st)}
      />
      <path d={`M ${P(80, 116)} C ${P(60, 92)} ${P(44, 82)} ${P(32, 82)} C ${P(44, 96)} ${P(52, 110)} ${P(78, 122)} Z`} fill={p.wingIn} opacity="0.85" />
    </g>
  );
}

function fullBody(ctx: DrawContext, stage: AvatarTier, mood: CreatureMood): ReactNode {
  const { st } = ctx;
  const p = st.pal;
  const s = strokeOf(st);
  const fill = bodyFill(ctx);
  return (
    <>
      {/* tail, behind the body; a spade tip from the Dragon on */}
      <g className="creature-part creature-tail-sway">
        <path d="M 78 158 Q 40 166 30 140 Q 26 128 36 126 Q 44 150 80 146 Z" fill={fill} {...s} />
        {stage >= 6 && <path d="M 36 128 L 22 118 L 30 134 Z" fill={p.spot} {...s} />}
      </g>
      {stage >= 5 && (
        <g data-part="wings">
          {wing(ctx, stage >= 6)}
          <g transform="translate(200 0) scale(-1 1)">{wing(ctx, stage >= 6)}</g>
        </g>
      )}
      <g className="creature-part creature-breathe">
        <ellipse cx="82" cy="174" rx="13" ry="8" fill={fill} {...s} />
        <ellipse cx="118" cy="174" rx="13" ry="8" fill={fill} {...s} />
        <ellipse cx="100" cy="138" rx="40" ry="38" fill={fill} {...s} />
        <ellipse cx="100" cy="145" rx="26" ry="27" fill={p.belly} {...strokeOf(st, 2.5)} />
        {stage >= 7 &&
          [0, 1, 2].map((i) => (
            <path key={i} d={`M 84 ${136 + i * 10} Q 100 ${142 + i * 10} 116 ${136 + i * 10}`} fill="none" stroke={p.spot} strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
          ))}
        <ellipse cx="66" cy="142" rx="9" ry="12" fill={fill} {...s} transform="rotate(25 66 142)" />
        <ellipse cx="134" cy="142" rx="9" ry="12" fill={fill} {...s} transform="rotate(-25 134 142)" />
        {head(ctx, stage, mood, 100, 84, 34)}
      </g>
    </>
  );
}

export const dragon: SpeciesArt = {
  fullBody,
  hatchlingHead: (ctx, mood) => head(ctx, 2, mood, 100, 112, 32),
};
