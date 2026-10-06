/** @jsxImportSource react */
// The pragma is a no-op for Next; it makes the Playwright runner, which
// otherwise compiles JSX into its own component-test objects, build real React
// elements when e2e/creature-avatar.spec.ts renders these to markup.
/**
 * The shared skeleton of every drawn creature: one 200x200 box, the ground at
 * y=182, the creature growing from the ground up through eight stages -- an
 * egg, a hatchling peeking out of its shell, then the species' full body,
 * scaled up stage by stage.
 *
 * A species module (./dragon.tsx) supplies only what is its own: the full
 * body and the hatchling's head. The egg, the shell, the shadow, the glow and
 * stars, the sticker edge, eyes and the sleepy "z"s are shared, so a new
 * species is one file.
 *
 * Pure functions returning React elements -- no HTML strings, nothing set as
 * innerHTML. Every gradient and filter id is prefixed with the caller's `uid`
 * (from React's useId in the component), so two creatures on one page never
 * borrow each other's gradients.
 *
 * Ported faithfully from the approved prototype (dragon-studies.html): the
 * coordinates, palettes and part classes are the prototype's.
 */

import type { ReactNode, SVGProps } from "react";
import type { AvatarTier } from "../types";
import { STYLES, paletteFromColors, shade, tint, type DrawnStyle, type Palette, type SpeciesColors, type StyleSpec } from "./styles";
import type { CreatureLook } from "./look";
import type { CreatureMood } from "@/lib/creature-mood";
import { backdrop, wearing } from "./items";

/** "normal", "happy" (today's tasks done) or "sleepy" (the family's night): lib/creature-mood.ts. */
export type { CreatureMood };

export const GOLD = "#FFC83D";

export type { CreatureLook };

/**
 * The one place a style and a child's look become the colours and effects a
 * drawing uses. Everything below reads `ctx.st`, never STYLES.
 *
 * Order: the style's palette (the dragon) or the creature's own colours (the
 * others), then the look's. A person's hair is their accent colour, so for a
 * species with a hair colour the look's `hair` replaces it, and `accent` --
 * a choice made for some other creature -- is ignored.
 */
export function resolveStyle(style: DrawnStyle, look?: CreatureLook, colors?: SpeciesColors): StyleSpec {
  const l = look ?? {};
  if (colors) {
    const person = colors.hair !== undefined;
    const hair = l.hair ?? colors.hair;
    const merged: SpeciesColors = {
      body: l.body ?? colors.body,
      belly: l.belly ?? colors.belly,
      accent: person ? (hair as string) : (l.accent ?? colors.accent),
      skin: l.skin ?? colors.skin,
      hair,
    };
    return { ...STYLES[style], pal: paletteFromColors(merged) };
  }
  // The dragon: its style's palette, with the look's colours worked in the
  // way the workshop derives them.
  const base = STYLES[style];
  if (!l.body && !l.belly && !l.accent) return base;
  const pal: Palette = { ...base.pal };
  if (l.body) Object.assign(pal, { body: l.body, bodyHi: tint(l.body, 0.12), body2: shade(l.body, 0.32), spot: shade(l.body, 0.22) });
  if (l.belly) pal.belly = l.belly;
  if (l.accent) Object.assign(pal, { wing: l.accent, wingIn: tint(l.accent, 0.45), accent: l.accent, shellSpot: tint(l.accent, 0.45) });
  return { ...base, pal };
}

export interface DrawContext {
  st: StyleSpec;
  /** The child's choices; {} for the creature's own look. */
  look: CreatureLook;
  /** A prefix unique to this drawing, for gradient and filter ids. */
  id: string;
}

/**
 * Where a creature starts: stage 1 is the closed beginning, stage 2 the baby
 * peeking out of it.
 */
export type OriginKind = "egg" | "starEgg" | "jelly" | "basket" | "box" | "leaves" | "cushion";

/** What a species draws itself; the rest is the skeleton's. */
export interface SpeciesArt {
  /** Its beginning; an egg when unset. */
  origin?: OriginKind;
  /** The creature's own colours, in every style. Unset: the style's palette (the dragon). */
  colors?: SpeciesColors;
  /** The person skeleton (princess, prince): skin tone and hair instead of an accent. */
  person?: boolean;
  /** Stages 3-8, drawn at full size; the skeleton scales them to the stage. */
  fullBody(ctx: DrawContext, stage: AvatarTier, mood: CreatureMood): ReactNode;
  /** Stage 2: the head poking out of the shell, centred on (100, 112). */
  hatchlingHead(ctx: DrawContext, mood: CreatureMood): ReactNode;
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

type StrokeProps = Pick<SVGProps<SVGPathElement>, "stroke" | "strokeWidth" | "strokeLinejoin" | "strokeLinecap">;

/** The style's outline, or none. */
export function strokeOf(st: StyleSpec, width = 3.5): StrokeProps {
  return st.stroke
    ? { stroke: st.stroke, strokeWidth: width, strokeLinejoin: "round", strokeLinecap: "round" }
    : {};
}

/** The body's fill: a gradient in storybook, a flat colour otherwise. */
export function bodyFill(ctx: DrawContext): string {
  return ctx.st.glow ? `url(#${ctx.id}-body)` : ctx.st.pal.body;
}

function Defs({ ctx }: { ctx: DrawContext }) {
  const { st, id } = ctx;
  return (
    <defs>
      {st.glow && (
        <>
          <radialGradient id={`${id}-body`} cx="40%" cy="30%" r="80%">
            <stop offset="0" stopColor={st.pal.bodyHi ?? st.pal.body} />
            <stop offset="1" stopColor={st.pal.body2 ?? st.pal.body} />
          </radialGradient>
          <radialGradient id={`${id}-glow`} cx="50%" cy="60%" r="50%">
            <stop offset="0" stopColor="#FFE9A8" stopOpacity="0.55" />
            <stop offset="1" stopColor="#FFE9A8" stopOpacity="0" />
          </radialGradient>
        </>
      )}
      {st.sticker && (
        <filter id={`${id}-sticker`} x="-20%" y="-20%" width="140%" height="140%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="5" result="fat" />
          <feFlood floodColor="#FFFFFF" />
          <feComposite in2="fat" operator="in" result="edge" />
          <feOffset in="fat" dx="0" dy="4" result="drop" />
          <feFlood floodColor="#000000" floodOpacity="0.18" />
          <feComposite in2="drop" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="edge" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      )}
    </defs>
  );
}

/**
 * Two eyes: round with highlights and blinking, sparkly (a star in each), or
 * happy (two smiling arcs) as the child chose -- two closed arcs when
 * sleepy, and the smiling arcs when happy, whatever was chosen.
 */
export function eyes(ctx: DrawContext, mood: CreatureMood, x1: number, x2: number, y: number, r: number, color?: string): ReactNode {
  const ink = color ?? ctx.st.pal.eye;
  const kind = mood === "sleepy" ? "sleepy" : mood === "happy" ? "happy" : (ctx.look.eyes ?? "round");
  if (kind === "sleepy" || kind === "happy") {
    const up = kind === "happy";
    const arc = (x: number) => (
      <path
        key={x}
        d={`M ${x - r} ${y + (up ? r * 0.3 : 0)} Q ${x} ${y + (up ? -r * 1.1 : r * 0.9)} ${x + r} ${y + (up ? r * 0.3 : 0)}`}
        fill="none"
        stroke={ink}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    );
    return <g data-eyes={kind}>{arc(x1)}{arc(x2)}</g>;
  }
  const one = (x: number) => (
    <g key={x} className="creature-part creature-blink">
      <ellipse cx={x} cy={y} rx={r} ry={r * 1.15} fill={ink} />
      <circle cx={x + r * 0.35} cy={y - r * 0.4} r={r * 0.38} fill="#FFFFFF" />
      <circle cx={x - r * 0.3} cy={y + r * 0.4} r={r * 0.16} fill="#FFFFFF" opacity="0.8" />
      {kind === "sparkly" && (
        <path
          data-eyes="sparkly"
          d={`M ${x - r * 0.15} ${y + r * 0.05} l ${r * 0.12} ${r * 0.3} l ${r * 0.3} ${r * 0.1} l ${-r * 0.3} ${r * 0.1} l ${-r * 0.12} ${r * 0.3} l ${-r * 0.12} ${-r * 0.3} l ${-r * 0.3} ${-r * 0.1} l ${r * 0.3} ${-r * 0.1} z`}
          fill="#FFFFFF"
        />
      )}
    </g>
  );
  return <>{one(x1)}{one(x2)}</>;
}

/**
 * Sunglasses cover the eyes, except when the creature sleeps -- and not when
 * glasses from the shop are worn instead, which leave the eyes showing.
 */
export function hidesEyes(ctx: DrawContext, mood: CreatureMood): boolean {
  return ctx.look.acc === "glasses" && !wearing(ctx, "face") && mood !== "sleepy";
}

/**
 * The accessory on a head of radius r: a bow, a party hat (not with the
 * crown at stage 8), sunglasses or a flower. As drawn in the workshop.
 *
 * Something bought for the same place wins (./items.tsx): a hat, headphones
 * or a crown of flowers from the shop replaces the bow, the party hat and the
 * flower; glasses from the shop replace the sunglasses.
 */
export function accessory(ctx: DrawContext, stage: number, cx: number, cy: number, r: number): ReactNode {
  const free = ctx.look.acc;
  const a = free === "glasses" ? (wearing(ctx, "face") ? undefined : free) : wearing(ctx, "head") ? undefined : free;
  const s = (w: number) => strokeOf(ctx.st, w);
  if (a === "bow") {
    return (
      <g data-acc="bow" transform={`translate(${cx + r * 0.62} ${cy - r * 0.78}) rotate(18)`}>
        <path d="M 0 0 L -13 -9 L -13 9 Z" fill="#FF5C8A" {...s(2.5)} />
        <path d="M 0 0 L 13 -9 L 13 9 Z" fill="#FF5C8A" {...s(2.5)} />
        <circle r="4.5" fill="#FF8FB0" {...s(2.5)} />
      </g>
    );
  }
  if (a === "hat" && stage < 8) {
    return (
      <g data-acc="hat" transform={`translate(${cx + r * 0.25} ${cy - r * 0.88}) rotate(14)`}>
        <path d="M -14 4 L 0 -30 L 14 4 Z" fill="#56B6E8" {...s(2.5)} />
        <path d="M -9 -8 L 9 -8 M -5 -18 L 5 -18" stroke={GOLD} strokeWidth="3.5" strokeLinecap="round" />
        <circle cy="-31" r="4.5" fill={GOLD} />
      </g>
    );
  }
  if (a === "glasses") {
    return (
      <g data-acc="glasses">
        <rect x={cx - r * 0.62} y={cy - r * 0.38} width={r * 0.54} height={r * 0.4} rx={r * 0.12} fill="#2A2438" opacity="0.92" />
        <rect x={cx + r * 0.08} y={cy - r * 0.38} width={r * 0.54} height={r * 0.4} rx={r * 0.12} fill="#2A2438" opacity="0.92" />
        <path d={`M ${cx - r * 0.08} ${cy - r * 0.22} L ${cx + r * 0.08} ${cy - r * 0.22}`} stroke="#2A2438" strokeWidth="3" />
        <path d={`M ${cx - r * 0.5} ${cy - r * 0.3} l ${r * 0.14} 0`} stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" opacity="0.7" />
      </g>
    );
  }
  if (a === "flower") {
    return (
      <g data-acc="flower" transform={`translate(${cx - r * 0.7} ${cy - r * 0.7})`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <circle key={i} cx={Math.cos(i * 1.2566) * 6} cy={Math.sin(i * 1.2566) * 6} r="5" fill="#FFF1A8" {...s(2)} />
        ))}
        <circle r="4" fill="#FF8A5B" />
      </g>
    );
  }
  return null;
}

/** Spots or stripes on the round body (cx 100, cy 138), a shade darker than it. */
export function pattern(ctx: DrawContext): ReactNode {
  const p = ctx.look.pattern;
  const col = shade(ctx.st.pal.body, 0.18);
  if (p === "spots") {
    return (
      <g data-pattern="spots">
        <circle cx="70" cy="128" r="5" fill={col} />
        <circle cx="131" cy="124" r="4" fill={col} />
        <circle cx="127" cy="154" r="5.5" fill={col} />
        <circle cx="73" cy="157" r="4" fill={col} />
      </g>
    );
  }
  if (p === "stripes") {
    return (
      <g data-pattern="stripes">
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <path d={`M ${64 + i * 2} ${122 + i * 14} q 8 3 10 9`} stroke={col} strokeWidth="5" fill="none" strokeLinecap="round" />
            <path d={`M ${136 - i * 2} ${122 + i * 14} q -8 3 -10 9`} stroke={col} strokeWidth="5" fill="none" strokeLinecap="round" />
          </g>
        ))}
      </g>
    );
  }
  return null;
}

/** Three little hearts around (cx, cy), for the hearts pattern. */
export function hearts(ctx: DrawContext, cx: number, cy: number): ReactNode {
  if (ctx.look.pattern !== "hearts") return null;
  return (
    <g data-pattern="hearts">
      {[[-9, -6], [8, 2], [-4, 12]].map(([dx, dy]) => (
        <path
          key={`${dx}${dy}`}
          transform={`translate(${cx + dx} ${cy + dy}) scale(.42)`}
          d="M0 8 C -10 0 -12 -8 -6 -11 C -2 -13 0 -9 0 -7 C 0 -9 2 -13 6 -11 C 12 -8 10 0 0 8 Z"
          fill="#FF6B8B"
        />
      ))}
    </g>
  );
}

/** Two rosy cheeks either side of a head of radius r. */
export function cheeks(ctx: DrawContext, cx: number, cy: number, r: number): ReactNode {
  const c = ctx.st.pal.cheek;
  return (
    <>
      <circle cx={cx - r * 0.62} cy={cy + r * 0.2} r={r * 0.15} fill={c} opacity="0.7" />
      <circle cx={cx + r * 0.62} cy={cy + r * 0.2} r={r * 0.15} fill={c} opacity="0.7" />
    </>
  );
}

/** The crown of stage 8 (and of the cushion), its band's bottom edge at top + 4. */
export function crown(ctx: DrawContext, cx: number, top: number, key = "crown"): ReactNode {
  const { st } = ctx;
  const crownStroke = st.stroke ? strokeOf(st, 3) : { stroke: "#E0A419", strokeWidth: 2, strokeLinejoin: "round" as const };
  return (
    <g key={key} data-part="crown">
      <path d={`M ${cx - 20} ${top + 4} L ${cx - 20} ${top - 14} L ${cx - 10} ${top - 4} L ${cx} ${top - 18} L ${cx + 10} ${top - 4} L ${cx + 20} ${top - 14} L ${cx + 20} ${top + 4} Z`} fill={GOLD} {...crownStroke} />
      <circle cx={cx} cy={top - 4} r="3.4" fill="#FF5C8A" />
    </g>
  );
}

/** One wing (the left), flapping; big from the dragon's sixth stage and the unicorn's. */
export function wing(ctx: DrawContext, big: boolean, fill: string, inner: string): ReactNode {
  const k = big ? 1 : 0.62;
  const P = (x: number, y: number) => `${100 - (100 - x) * k} ${120 - (120 - y) * k}`;
  return (
    <g className="creature-part creature-flap">
      <path
        d={`M ${P(84, 118)} C ${P(58, 82)} ${P(34, 66)} ${P(18, 72)} C ${P(30, 84)} ${P(24, 96)} ${P(36, 102)} C ${P(28, 110)} ${P(36, 120)} ${P(50, 120)} C ${P(50, 128)} ${P(62, 132)} ${P(84, 128)} Z`}
        fill={fill}
        {...strokeOf(ctx.st)}
      />
      <path d={`M ${P(80, 116)} C ${P(60, 92)} ${P(44, 82)} ${P(32, 82)} C ${P(44, 96)} ${P(52, 110)} ${P(78, 122)} Z`} fill={inner} opacity="0.85" />
    </g>
  );
}

/** A pair of wings, the right one mirrored. */
export function wings(ctx: DrawContext, big: boolean, fill: string, inner: string): ReactNode {
  return (
    <g data-part="wings">
      {wing(ctx, big, fill, inner)}
      <g transform="translate(200 0) scale(-1 1)">{wing(ctx, big, fill, inner)}</g>
    </g>
  );
}

function sparkles(st: StyleSpec): ReactNode {
  if (!st.glow) return null;
  const star = (x: number, y: number, s: number) => (
    <path
      key={`${x}-${y}`}
      d={`M ${x} ${y - s} L ${x + s * 0.3} ${y - s * 0.3} L ${x + s} ${y} L ${x + s * 0.3} ${y + s * 0.3} L ${x} ${y + s} L ${x - s * 0.3} ${y + s * 0.3} L ${x - s} ${y} L ${x - s * 0.3} ${y - s * 0.3} Z`}
      fill="#FFE08A"
    />
  );
  return <>{star(34, 46, 6)}{star(168, 36, 4.5)}{star(176, 96, 3.5)}</>;
}

/**
 * The happy mood's sparkle: three small four-pointed stars around the head,
 * still. Never animated, so a happy creature on a wall display costs nothing
 * after it is drawn. Clear of storybook's own stars and of the sleepy "z"s.
 */
function happySparkle(): ReactNode {
  const star = (x: number, y: number, s: number, fill: string) => (
    <path
      key={`${x}-${y}`}
      d={`M ${x} ${y - s} Q ${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q ${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q ${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q ${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s} Z`}
      fill={fill}
    />
  );
  return (
    <g data-mood="happy" className="creature-happy-sparkle">
      {star(44, 74, 8, GOLD)}
      {star(156, 58, 6.5, "#FF8FC0")}
      {star(162, 104, 5, GOLD)}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Stage 1 and the shell of stage 2 -- the same for every species
// ---------------------------------------------------------------------------

/** The crack across an egg, just before it hatches. */
function crack(ctx: DrawContext): ReactNode {
  return (
    <path
      data-part="crack"
      d="M 60 112 L 72 104 L 80 116 L 92 102 L 101 117 L 112 103 L 122 115 L 132 104 L 141 112"
      fill="none"
      stroke={ctx.st.stroke || ctx.st.pal.eye}
      strokeWidth="3.2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

/** A five-pointed star centred on (x, y), outer radius s. */
function starPath(x: number, y: number, s: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? s : s * 0.45;
    pts.push(`${(x + Math.cos(a) * rr).toFixed(2)} ${(y + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

export function egg(ctx: DrawContext, cracked: boolean, stars = false): ReactNode {
  const { st } = ctx;
  const p = st.pal;
  // The unicorn's star egg: the same egg, its spots little stars.
  const spot = (x: number, y: number, r: number) =>
    stars ? <path key={`${x}-${y}`} d={starPath(x, y, r * 1.35)} fill={p.shellSpot} /> : <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={p.shellSpot} />;
  return (
    <g className="creature-part creature-wobble">
      <ellipse cx="100" cy="118" rx="47" ry="59" fill={p.shell} {...strokeOf(st)} />
      {spot(80, 96, 9)}
      {spot(118, 122, 12)}
      {spot(90, 146, 7)}
      {spot(122, 88, 5)}
      <ellipse cx="84" cy="84" rx="9" ry="15" fill="#FFFFFF" opacity="0.7" transform="rotate(-20 84 84)" />
      {cracked && crack(ctx)}
    </g>
  );
}

function shellBottom(ctx: DrawContext, stars = false): ReactNode {
  const { st } = ctx;
  const p = st.pal;
  return (
    <>
      <path
        d="M 54 140 L 64 128 L 74 140 L 86 126 L 98 140 L 110 126 L 122 140 L 134 128 L 146 140 Q 148 184 100 184 Q 52 184 54 140 Z"
        fill={p.shell}
        {...strokeOf(st)}
      />
      {stars ? (
        <>
          <path d={starPath(78, 160, 9)} fill={p.shellSpot} />
          <path d={starPath(120, 166, 11)} fill={p.shellSpot} />
        </>
      ) : (
        <>
          <circle cx="78" cy="160" r="7" fill={p.shellSpot} />
          <circle cx="120" cy="166" r="9" fill={p.shellSpot} />
        </>
      )}
    </>
  );
}

const EYE_INK = "#2A2438";

function basket(ctx: DrawContext): ReactNode {
  const { st } = ctx;
  return (
    <>
      <path d="M 46 132 L 154 132 L 144 182 L 56 182 Z" fill="#D9A066" {...strokeOf(st)} />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M ${50 + i * 2} ${142 + i * 10} L ${150 - i * 2} ${142 + i * 10}`} stroke="#B57D45" strokeWidth="3" />
      ))}
      <path d="M 40 132 Q 100 120 160 132 L 160 140 Q 100 128 40 140 Z" fill={st.pal.accent ?? st.pal.wing} {...strokeOf(st, 3)} />
    </>
  );
}

function cushion(ctx: DrawContext): ReactNode {
  const { st } = ctx;
  return (
    <>
      <path d="M 50 150 Q 100 136 150 150 Q 158 176 100 182 Q 42 176 50 150 Z" fill="#D9434F" {...strokeOf(st)} />
      {[[52, 150], [148, 150], [56, 176], [144, 176]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill={GOLD} />
      ))}
      <path d="M 64 158 Q 100 150 136 158" stroke="#F07A84" strokeWidth="3" fill="none" />
    </>
  );
}

const LEAF_COLORS = ["#E8613A", "#FFB547", "#C9783B", "#FF8A3D", "#B5552C"];
function leafPile(ctx: DrawContext): ReactNode {
  const leaves: Array<[number, number, number, number, number]> = [
    [64, 166, 22, 12, -20], [100, 170, 26, 13, 10], [136, 166, 22, 12, 25], [80, 150, 22, 12, 30], [120, 150, 22, 12, -25], [100, 138, 20, 11, 5],
  ];
  return leaves.map(([x, y, rx, ry, a], i) => (
    <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill={LEAF_COLORS[i % LEAF_COLORS.length]} transform={`rotate(${a} ${x} ${y})`} {...strokeOf(ctx.st, 2.5)} />
  ));
}

/**
 * Stage 1: the closed beginning, wobbling now and then. The egg kinds show a
 * crack when asked (the hatching scene); the others have nothing to crack.
 */
export function originClosed(ctx: DrawContext, kind: OriginKind, cracked: boolean): ReactNode {
  const { st } = ctx;
  const p = st.pal;
  const s = strokeOf(st);
  const fill = bodyFill(ctx);
  const accent = p.accent ?? p.wing;
  switch (kind) {
    case "egg":
    case "starEgg":
      return egg(ctx, cracked, kind === "starEgg");
    case "basket":
      // ears and the top of a head peeking over the rim
      return (
        <g className="creature-part creature-wobble">
          {[-1, 1].map((d) => (
            <path key={d} d={`M ${100 + d * 24} 128 L ${100 + d * 30} 104 L ${100 + d * 8} 122 Z`} fill={fill} {...s} />
          ))}
          <path d="M 74 128 Q 100 112 126 128" fill={fill} {...s} />
          {basket(ctx)}
        </g>
      );
    case "box":
      return (
        <g className="creature-part creature-wobble">
          <circle cx="78" cy="106" r="9" fill="#9AA8B8" {...strokeOf(st, 2.5)} />
          <circle cx="78" cy="106" r="3.5" fill="#5B6B7A" />
          <path d="M 116 96 l 10 0 l 0 18 l -10 0 z" fill="#9AA8B8" {...strokeOf(st, 2.5)} />
          <rect x="52" y="112" width="96" height="70" rx="6" fill="#D9A066" {...s} />
          <path d="M 52 112 L 148 112" stroke="#B57D45" strokeWidth="3" />
          <rect x="90" y="108" width="20" height="74" fill="#C68A4E" opacity="0.55" />
          <path d="M 72 140 l 4 8 l 8 0 l -6 6 l 3 8 l -9 -5 l -9 5 l 3 -8 l -6 -6 l 8 0 z" fill={GOLD} />
        </g>
      );
    case "cushion":
      return (
        <g className="creature-part creature-wobble">
          {cushion(ctx)}
          <g transform="translate(0 6)">{crown(ctx, 100, 136)}</g>
        </g>
      );
    case "leaves":
      return (
        <g className="creature-part creature-wobble">
          {[-1, 1].map((d) => (
            <g key={d}>
              <path d={`M ${100 + d * 12} 134 L ${100 + d * 22} 108 L ${100 + d * 2} 126 Z`} fill={fill} {...s} />
              <path d={`M ${100 + d * 22} 108 L ${100 + d * 20} 116 L ${100 + d * 14} 114 Z`} fill={accent} />
            </g>
          ))}
          {leafPile(ctx)}
        </g>
      );
    case "jelly":
      return (
        <g className="creature-part creature-wobble">
          <circle cx="78" cy="152" r="22" fill="#BDE8F5" opacity="0.75" {...strokeOf(st, 2.5)} />
          <circle cx="126" cy="156" r="18" fill="#BDE8F5" opacity="0.75" {...strokeOf(st, 2.5)} />
          <circle cx="102" cy="122" r="40" fill="#CDEFF8" opacity="0.85" {...s} />
          <circle cx="102" cy="124" r="13" fill={p.body} />
          <circle cx="98" cy="121" r="2.2" fill={EYE_INK} />
          <circle cx="106" cy="121" r="2.2" fill={EYE_INK} />
          <ellipse cx="86" cy="104" rx="7" ry="11" fill="#FFFFFF" opacity="0.7" transform="rotate(-25 86 104)" />
          {cracked && crack(ctx)}
        </g>
      );
  }
}

/** Stage 2's foreground: what the baby peeks out of. */
export function originOpen(ctx: DrawContext, kind: OriginKind): ReactNode {
  const { st } = ctx;
  switch (kind) {
    case "egg":
    case "starEgg":
      return shellBottom(ctx, kind === "starEgg");
    case "basket":
      return basket(ctx);
    case "box":
      return (
        <>
          <rect x="52" y="128" width="96" height="54" rx="6" fill="#D9A066" {...strokeOf(st)} />
          <path d="M 52 128 L 40 112 L 92 112 L 100 128 M 148 128 L 160 112 L 108 112 L 100 128" fill="#E5B57E" {...strokeOf(st)} />
          <rect x="90" y="128" width="20" height="54" fill="#C68A4E" opacity="0.55" />
        </>
      );
    case "cushion":
      return cushion(ctx);
    case "leaves":
      return leafPile(ctx);
    case "jelly":
      return (
        <>
          <path d="M 50 148 Q 100 128 150 148 Q 156 184 100 184 Q 44 184 50 148 Z" fill="#CDEFF8" opacity="0.9" {...strokeOf(st)} />
          <circle cx="76" cy="164" r="6" fill="#FFFFFF" opacity="0.6" />
        </>
      );
  }
}

function hatchling(ctx: DrawContext, art: SpeciesArt, mood: CreatureMood): ReactNode {
  return (
    <>
      <g className="creature-part creature-breathe">{art.hatchlingHead(ctx, mood)}</g>
      {originOpen(ctx, art.origin ?? "egg")}
    </>
  );
}

// ---------------------------------------------------------------------------
// The whole drawing
// ---------------------------------------------------------------------------

/** How big the full body is drawn at each stage; the egg and hatchling are their own size. */
const STAGE_SCALE = [0, 1, 1, 0.66, 0.74, 0.82, 0.9, 0.96, 1] as const;

export interface DrawArgs {
  art: SpeciesArt;
  style: DrawnStyle;
  tier: AvatarTier;
  mood: CreatureMood;
  /** A prefix unique on the page (useId), for gradient and filter ids. */
  uid: string;
  /** Stage 1 only: the egg shows a crack, just before it hatches. */
  cracked?: boolean;
  look?: CreatureLook;
}

/** The contents of the creature's <svg viewBox="0 0 200 200">. */
export function drawCreature({ art, style, tier, mood, uid, cracked = false, look }: DrawArgs): ReactNode {
  const ctx: DrawContext = { st: resolveStyle(style, look, art.colors), id: uid, look: look ?? {} };
  const { st } = ctx;
  const scale = STAGE_SCALE[tier];

  let inner: ReactNode;
  if (tier === 1) inner = originClosed(ctx, art.origin ?? "egg", cracked);
  else if (tier === 2) inner = hatchling(ctx, art, mood);
  else
    inner = (
      <g transform={`translate(100 182) scale(${scale}) translate(-100 -182)`}>
        {art.fullBody(ctx, tier, mood)}
      </g>
    );

  const origin = art.origin ?? "egg";
  const eggLike = origin === "egg" || origin === "starEgg";
  const shadowW = tier === 1 ? (eggLike ? 40 : 50) : tier === 2 ? (eggLike ? 46 : 52) : 52 * scale;

  return (
    <>
      <Defs ctx={ctx} />
      {backdrop(ctx)}
      {st.glow && (
        <>
          <circle cx="100" cy="120" r="88" fill={`url(#${uid}-glow)`} />
          {sparkles(st)}
        </>
      )}
      {/* The prototype's --ground token, in Kinboard's own colours. */}
      <ellipse cx="100" cy="184" rx={shadowW} ry="7" className="creature-ground" />
      {st.sticker ? <g filter={`url(#${uid}-sticker)`}>{inner}</g> : inner}
      {mood === "happy" && happySparkle()}
      {mood === "sleepy" && tier > 1 && (
        <g className="creature-zzz" data-mood="sleepy">
          <text x="146" y="58" fontFamily="Fredoka, ui-rounded, sans-serif" fontWeight="700" fontSize="18" className="creature-zzz-text">z</text>
          <text x="158" y="42" fontFamily="Fredoka, ui-rounded, sans-serif" fontWeight="700" fontSize="13" className="creature-zzz-text">z</text>
        </g>
      )}
    </>
  );
}
