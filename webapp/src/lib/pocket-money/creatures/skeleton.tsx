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
import { STYLES, type DrawnStyle, type Palette, type StyleSpec } from "./styles";

export type CreatureMood = "happy" | "sleepy";

/**
 * Choices a child may one day make about their creature's look (colours,
 * pattern, eyes, an accessory, a name). Nothing is offered yet; the type is
 * here so that when it is, it lands in resolveStyle() below and nowhere else.
 */
export interface CreatureLook {
  /** Overrides for single palette entries, e.g. { body: "#…" }. */
  palette?: Partial<Palette>;
}

/**
 * The one place a style (and, later, a child's look) becomes the colours and
 * effects a drawing uses. Everything below reads `ctx.st`, never STYLES.
 */
export function resolveStyle(style: DrawnStyle, look?: CreatureLook): StyleSpec {
  const base = STYLES[style];
  if (!look?.palette) return base;
  return { ...base, pal: { ...base.pal, ...look.palette } };
}

export interface DrawContext {
  st: StyleSpec;
  /** A prefix unique to this drawing, for gradient and filter ids. */
  id: string;
}

/** What a species draws itself; the rest is the skeleton's. */
export interface SpeciesArt {
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
            <stop offset="0" stopColor={st.pal.body} />
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

/** Two eyes with highlights, blinking -- or two closed arcs when sleepy. */
export function eyes(ctx: DrawContext, mood: CreatureMood, x1: number, x2: number, y: number, r: number): ReactNode {
  const p = ctx.st.pal;
  if (mood === "sleepy") {
    const arc = (x: number) => (
      <path key={x} d={`M ${x - r} ${y} Q ${x} ${y + r * 0.9} ${x + r} ${y}`} fill="none" stroke={p.eye} strokeWidth="3.2" strokeLinecap="round" />
    );
    return <g>{arc(x1)}{arc(x2)}</g>;
  }
  const one = (x: number) => (
    <g key={x} className="creature-part creature-blink">
      <ellipse cx={x} cy={y} rx={r} ry={r * 1.15} fill={p.eye} />
      <circle cx={x + r * 0.35} cy={y - r * 0.4} r={r * 0.38} fill="#FFFFFF" />
      <circle cx={x - r * 0.3} cy={y + r * 0.4} r={r * 0.16} fill="#FFFFFF" opacity="0.8" />
    </g>
  );
  return <>{one(x1)}{one(x2)}</>;
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

// ---------------------------------------------------------------------------
// Stage 1 and the shell of stage 2 -- the same for every species
// ---------------------------------------------------------------------------

export function egg(ctx: DrawContext, cracked: boolean): ReactNode {
  const { st } = ctx;
  const p = st.pal;
  return (
    <g className="creature-part creature-wobble">
      <ellipse cx="100" cy="118" rx="47" ry="59" fill={p.shell} {...strokeOf(st)} />
      <circle cx="80" cy="96" r="9" fill={p.shellSpot} />
      <circle cx="118" cy="122" r="12" fill={p.shellSpot} />
      <circle cx="90" cy="146" r="7" fill={p.shellSpot} />
      <circle cx="122" cy="88" r="5" fill={p.shellSpot} />
      <ellipse cx="84" cy="84" rx="9" ry="15" fill="#FFFFFF" opacity="0.7" transform="rotate(-20 84 84)" />
      {cracked && (
        <path
          data-part="crack"
          d="M 60 112 L 72 104 L 80 116 L 92 102 L 101 117 L 112 103 L 122 115 L 132 104 L 141 112"
          fill="none"
          stroke={st.stroke || p.eye}
          strokeWidth="3.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

function hatchling(ctx: DrawContext, art: SpeciesArt, mood: CreatureMood): ReactNode {
  const { st } = ctx;
  const p = st.pal;
  return (
    <>
      <g className="creature-part creature-breathe">{art.hatchlingHead(ctx, mood)}</g>
      <path
        d="M 54 140 L 64 128 L 74 140 L 86 126 L 98 140 L 110 126 L 122 140 L 134 128 L 146 140 Q 148 184 100 184 Q 52 184 54 140 Z"
        fill={p.shell}
        {...strokeOf(st)}
      />
      <circle cx="78" cy="160" r="7" fill={p.shellSpot} />
      <circle cx="120" cy="166" r="9" fill={p.shellSpot} />
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
  const ctx: DrawContext = { st: resolveStyle(style, look), id: uid };
  const { st } = ctx;
  const scale = STAGE_SCALE[tier];

  let inner: ReactNode;
  if (tier === 1) inner = egg(ctx, cracked);
  else if (tier === 2) inner = hatchling(ctx, art, mood);
  else
    inner = (
      <g transform={`translate(100 182) scale(${scale}) translate(-100 -182)`}>
        {art.fullBody(ctx, tier, mood)}
      </g>
    );

  const shadowW = tier === 1 ? 40 : tier === 2 ? 46 : 52 * scale;

  return (
    <>
      <Defs ctx={ctx} />
      {st.glow && (
        <>
          <circle cx="100" cy="120" r="88" fill={`url(#${uid}-glow)`} />
          {sparkles(st)}
        </>
      )}
      {/* The prototype's --ground token, in Kinboard's own colours. */}
      <ellipse cx="100" cy="184" rx={shadowW} ry="7" className="creature-ground" />
      {st.sticker ? <g filter={`url(#${uid}-sticker)`}>{inner}</g> : inner}
      {mood === "sleepy" && tier > 1 && (
        <g className="creature-zzz">
          <text x="146" y="58" fontFamily="Fredoka, ui-rounded, sans-serif" fontWeight="700" fontSize="18" className="creature-zzz-text">z</text>
          <text x="158" y="42" fontFamily="Fredoka, ui-rounded, sans-serif" fontWeight="700" fontSize="13" className="creature-zzz-text">z</text>
        </g>
      )}
    </>
  );
}
