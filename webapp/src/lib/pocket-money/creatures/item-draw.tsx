/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * What every drawn item shares (RFC-017 §5): the style's outline, Storybook's
 * soft highlight, a star and a heart, and where a species' eyes are. The
 * shop's items (./items.tsx) and the festivals' own (lib/festivals/kits/)
 * are drawn with these, so a festival's hat sits in the same world as the
 * shop's cap.
 *
 * Imports nothing that draws: ./items.tsx imports the festival kits, and the
 * kits import this.
 */

import type { ReactNode, SVGProps } from "react";
import type { StyleSpec } from "./styles";

export const GOLD = "#FFC83D";

export type Stroke = Pick<SVGProps<SVGPathElement>, "stroke" | "strokeWidth" | "strokeLinejoin" | "strokeLinecap">;

/** The style's outline, or none: Sticker's ink, as strokeOf() in skeleton.tsx. */
export function line(st: StyleSpec, width = 2.5): Stroke {
  return st.stroke ? { stroke: st.stroke, strokeWidth: width, strokeLinejoin: "round", strokeLinecap: "round" } : {};
}

/** Storybook's soft highlight on an item; nothing in the other styles. */
export function sheen(st: StyleSpec, cx: number, cy: number, rx: number, ry: number, rotate = -20): ReactNode {
  if (!st.glow) return null;
  return <ellipse data-sheen="" cx={cx} cy={cy} rx={rx} ry={ry} fill="#FFFFFF" opacity="0.45" transform={`rotate(${rotate} ${cx} ${cy})`} />;
}

/** A five-pointed star's path, centred on (x, y), `s` to its points. */
export function star(x: number, y: number, s: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? s : s * 0.45;
    pts.push(`${(x + Math.cos(a) * rr).toFixed(2)} ${(y + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

export const HEART = "M0 8 C -10 0 -12 -8 -6 -11 C -2 -13 0 -9 0 -7 C 0 -9 2 -13 6 -11 C 12 -8 10 0 0 8 Z";

/** Where the species' eyes are, as head() and the dragon pass them to eyes(). */
export interface EyeSpot {
  x1: number;
  x2: number;
  y: number;
  /** An eye's radius. */
  r: number;
}
