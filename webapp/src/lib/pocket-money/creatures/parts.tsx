/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The workshop's creatures, assembled: a head (what is behind it, its shape,
 * the face, cheeks, eyes, what sits in front, the crown at stage 8), a round
 * body with feet, a tummy and paws, and whatever a species adds -- a tail,
 * wings, a carrot. Ported from the approved prototype
 * (creature-workshop.html: head(), bodyParts(), full()), its coordinates
 * unchanged.
 *
 * A species module (./cat.tsx, ./rex.tsx, ...) supplies its own parts and
 * calls animalArt() or personArt(); the dragon (./dragon.tsx, Step 1) draws
 * itself.
 */

import type { ReactNode } from "react";
import type { AvatarTier } from "../types";
import {
  bodyFill,
  cheeks,
  crown,
  eyes,
  strokeOf,
  type CreatureMood,
  type DrawContext,
  type OriginKind,
  type SpeciesArt,
} from "./skeleton";
import type { SpeciesColors } from "./styles";

/** A drawing context that also knows the stage and the mood. */
export interface Draw extends DrawContext {
  stage: number;
  mood: CreatureMood;
}

export const EYE = "#2A2438";
export const IVORY = "#FFF3D6";

/** The style's outline at a width, or none. */
export const s = (c: DrawContext, w?: number) => strokeOf(c.st, w);
/** The body's fill: flat, or the storybook gradient. */
export const fillOf = (c: DrawContext) => bodyFill(c);
/** The creature's third colour. */
export const accentOf = (c: DrawContext) => c.st.pal.accent ?? c.st.pal.wing;

/** What a species draws on and around its head. */
export interface HeadParts {
  /** Drawn before the head's shape: ears, horns, a mane, gills. */
  behind?(c: Draw, cx: number, cy: number, r: number): ReactNode;
  /** The head itself; a circle in the body colour when unset. */
  shape?(c: Draw, cx: number, cy: number, r: number): ReactNode;
  /** On the head, under the face: an owl's eye discs, a penguin's face. */
  under?(c: Draw, cx: number, cy: number, r: number): ReactNode;
  /** Snout, nose and mouth. */
  face(c: Draw, cx: number, cy: number, r: number): ReactNode;
  /** In front of the eyes: a scarf, glasses, a tiara, horns. */
  front?(c: Draw, cx: number, cy: number, r: number): ReactNode;
  eyeX?: number;
  eyeY?: number;
  eyeR?: number;
  eyeColor?: string;
  noCheeks?: boolean;
  /** How far above the head's centre the crown sits, in radii. */
  crownLift?: number;
}

export function head(c: Draw, h: HeadParts, cx: number, cy: number, r: number): ReactNode {
  const ex = h.eyeX ?? 0.36;
  return (
    <>
      {h.behind?.(c, cx, cy, r)}
      {h.shape ? h.shape(c, cx, cy, r) : <circle cx={cx} cy={cy} r={r} fill={fillOf(c)} {...s(c)} />}
      {h.under?.(c, cx, cy, r)}
      {h.face(c, cx, cy, r)}
      {!h.noCheeks && cheeks(c, cx, cy, r)}
      {eyes(c, c.mood, cx - r * ex, cx + r * ex, cy + r * (h.eyeY ?? -0.12), r * (h.eyeR ?? 0.2), h.eyeColor)}
      {h.front?.(c, cx, cy, r)}
      {c.stage === 8 && crown(c, cx, cy - r * (h.crownLift ?? 1.05))}
    </>
  );
}

/** What a species changes about the round body. */
export interface AnimalBodyParts {
  /** Bird feet (owl, penguin) instead of round paws. */
  birdFeet?: boolean;
  /** Drawn first, behind everything: the moon rabbit's glow. */
  aura?(c: Draw): ReactNode;
  /** On the tummy: feathers, glowing spots, belly scales. */
  belly?(c: Draw): ReactNode;
  /** The arms; two round paws when unset. */
  arms?(c: Draw): ReactNode;
  /** Last, in front: a carrot. */
  after?(c: Draw): ReactNode;
}

export function animalBody(c: Draw, b: AnimalBodyParts): ReactNode {
  const p = c.st.pal;
  const fill = fillOf(c);
  return (
    <>
      {b.aura?.(c)}
      {b.birdFeet ? (
        [-1, 1].map((d) => (
          <path key={d} d={`M ${100 + d * 16 - 8} 176 l 4 -6 l 4 6 l 4 -6 l 4 6 z`} fill="#FFB547" {...s(c, 2.5)} />
        ))
      ) : (
        <>
          <ellipse cx="82" cy="174" rx="13" ry="8" fill={fill} {...s(c)} />
          <ellipse cx="118" cy="174" rx="13" ry="8" fill={fill} {...s(c)} />
        </>
      )}
      <ellipse cx="100" cy="138" rx="40" ry="38" fill={fill} {...s(c)} />
      <ellipse cx="100" cy="145" rx="26" ry="27" fill={p.belly} {...s(c, 2.5)} />
      {b.belly?.(c)}
      {b.arms ? (
        b.arms(c)
      ) : (
        <>
          <ellipse cx="66" cy="142" rx="9" ry="12" fill={fill} {...s(c)} transform="rotate(25 66 142)" />
          <ellipse cx="134" cy="142" rx="9" ry="12" fill={fill} {...s(c)} transform="rotate(-25 134 142)" />
        </>
      )}
      {b.after?.(c)}
    </>
  );
}

export interface SpeciesDef {
  origin: OriginKind;
  colors: SpeciesColors;
  head: HeadParts;
  /** Behind the body: a tail, a ring of plates. */
  tail?(c: Draw): ReactNode;
  /** Behind the body, after the tail. */
  wings?(c: Draw): ReactNode;
  /** The round body's changes; ignored when `body` is set. */
  parts?: AnimalBodyParts;
  /** A body of its own (the robot, the people). */
  body?(c: Draw): ReactNode;
  person?: boolean;
}

const at = (ctx: DrawContext, stage: number, mood: CreatureMood): Draw => ({ ...ctx, stage, mood });

/** A SpeciesArt from a species' parts, assembled as the workshop's full(). */
export function speciesFrom(def: SpeciesDef): SpeciesArt {
  return {
    origin: def.origin,
    colors: def.colors,
    person: def.person,
    fullBody(ctx: DrawContext, stage: AvatarTier, mood: CreatureMood) {
      const c = at(ctx, stage, mood);
      return (
        <>
          {def.tail?.(c)}
          {def.wings?.(c)}
          <g className="creature-part creature-breathe">
            {def.body ? def.body(c) : animalBody(c, def.parts ?? {})}
            {head(c, def.head, 100, 84, 34)}
          </g>
        </>
      );
    },
    hatchlingHead(ctx: DrawContext, mood: CreatureMood) {
      return head(at(ctx, 2, mood), def.head, 100, 112, 32);
    },
  };
}
