/** @jsxImportSource react */
// The pragma is a no-op for Next; see ./skeleton.tsx.
/**
 * The shop's items, drawn (RFC-017 §5; the catalogue is ./shop.ts).
 *
 * Every item is drawn on the same anchors as the free accessories: the head's
 * centre and radius (cx, cy, r) that skeleton.tsx's accessory() gets, from
 * parts.tsx's head() for the workshop's creatures and the people, and from
 * dragon.tsx's own head. An item is designed once around a head of radius 34
 * centred on (0, 0) and placed with translate(cx cy) scale(r/34), so it sits
 * the same on a hatchling's head (r 32) as on a grown one, and the stage
 * scaling around it carries it along.
 *
 *   head        on top of the head; replaces the free bow, party hat and
 *               flower, the crown of stage 8, and a species' own headwear
 *               (the princess's tiara, the prince's circlet, the owl's cap)
 *   face        on the eyes, where the species has them; replaces the free
 *               sunglasses and the owl's own glasses, and never hides the eyes
 *   neck        under the chin; the cape also hangs behind the body. Replaces
 *               the cat's and the penguin's scarves and the people's own cape
 *   background  behind everything, inside a rounded frame (backdrop())
 *
 * The styles: an outline in the style's ink in Sticker (as the free
 * accessories do), a soft highlight in Storybook (sheen()), flat in Gumdrop.
 *
 * Only what is in the look is drawn, and the look the screens pass has only
 * owned items in it (readLook with the child's purchases). An id this file
 * does not know draws nothing.
 *
 * No imports from ./skeleton.tsx other than types: skeleton imports this file.
 */

import type { ReactNode, SVGProps } from "react";
import type { StyleSpec } from "./styles";
import type { CreatureLook } from "./look";
import { isItemFor, type ShopSlot } from "./shop";

/** What these drawings need of a drawing context (skeleton.tsx's DrawContext). */
interface ItemContext {
  st: StyleSpec;
  look: CreatureLook;
  id: string;
}

const GOLD = "#FFC83D";

type Stroke = Pick<SVGProps<SVGPathElement>, "stroke" | "strokeWidth" | "strokeLinejoin" | "strokeLinecap">;

/** The style's outline, or none: Sticker's ink, as strokeOf() in skeleton.tsx. */
function line(st: StyleSpec, width = 2.5): Stroke {
  return st.stroke ? { stroke: st.stroke, strokeWidth: width, strokeLinejoin: "round", strokeLinecap: "round" } : {};
}

/** Storybook's soft highlight on an item; nothing in the other styles. */
function sheen(st: StyleSpec, cx: number, cy: number, rx: number, ry: number, rotate = -20): ReactNode {
  if (!st.glow) return null;
  return <ellipse data-sheen="" cx={cx} cy={cy} rx={rx} ry={ry} fill="#FFFFFF" opacity="0.45" transform={`rotate(${rotate} ${cx} ${cy})`} />;
}

/** The item worn in a slot, when it is a catalogue item for that slot. */
export function wearing(ctx: { look: CreatureLook }, slot: ShopSlot): string | undefined {
  const id = ctx.look[slot];
  return isItemFor(slot, id) ? id : undefined;
}

/** Around a head of radius r at (cx, cy): the item's own space, a head of radius 34 at the origin. */
function onHead(id: string, slot: ShopSlot, cx: number, cy: number, r: number, body: ReactNode): ReactNode {
  return (
    <g data-item={id} data-slot={slot} transform={`translate(${cx} ${cy}) scale(${(r / 34).toFixed(4)})`}>
      {body}
    </g>
  );
}

function star(x: number, y: number, s: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? s : s * 0.45;
    pts.push(`${(x + Math.cos(a) * rr).toFixed(2)} ${(y + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

const HEART = "M0 8 C -10 0 -12 -8 -6 -11 C -2 -13 0 -9 0 -7 C 0 -9 2 -13 6 -11 C 12 -8 10 0 0 8 Z";

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------

function headItem(st: StyleSpec, id: string): ReactNode {
  const s = (w?: number) => line(st, w);
  switch (id) {
    case "cap":
      return (
        <>
          <path d="M -31 -15 Q -30 -47 0 -47 Q 30 -47 31 -15 Q 0 -24 -31 -15 Z" fill="#E8463A" {...s(3)} />
          <path d="M 0 -47 L 0 -20" stroke="#B8322A" strokeWidth="2" />
          <path d="M 6 -17 Q 32 -27 52 -15 Q 32 -8 6 -14 Z" fill="#C93A30" {...s(3)} />
          <circle cy="-47" r="3.5" fill="#FFFFFF" {...s(2)} />
          {sheen(st, -14, -36, 8, 4)}
        </>
      );
    case "wizard_hat":
      return (
        <>
          <path d="M -23 -27 Q -8 -50 6 -76 Q 10 -54 23 -27 Z" fill="#4B3FB5" {...s(3)} />
          <ellipse cy="-27" rx="36" ry="7" fill="#3A2F96" {...s(3)} />
          <path d="M -21 -31 Q 0 -36 21 -31" stroke={GOLD} strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d={star(-4, -50, 5.5)} fill={GOLD} />
          <path d={star(8, -40, 3.5)} fill={GOLD} />
          <path d="M -12 -38 a 4 4 0 1 0 3 6 a 3 3 0 1 1 -3 -6 z" fill="#FFF1A8" />
          {sheen(st, -9, -46, 3.5, 9, 25)}
        </>
      );
    case "pirate_hat":
      return (
        <>
          <path d="M -43 -19 Q -38 -52 -14 -49 Q 0 -66 14 -49 Q 38 -52 43 -19 Q 0 -31 -43 -19 Z" fill="#3A3046" {...s(3)} />
          <path d="M -42 -20 Q 0 -32 42 -20" stroke={GOLD} strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cy="-40" r="6.5" fill="#FFFFFF" />
          <rect x="-3.5" y="-36" width="7" height="4" rx="1.5" fill="#FFFFFF" />
          <circle cx="-2.4" cy="-40.5" r="1.6" fill="#3A3046" />
          <circle cx="2.4" cy="-40.5" r="1.6" fill="#3A3046" />
          <path d="M -10 -28 L 10 -36 M -10 -36 L 10 -28" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
          {sheen(st, -24, -40, 7, 3.5, -30)}
        </>
      );
    case "headphones":
      return (
        <>
          {st.stroke && <path d="M -34 -6 Q -38 -48 0 -48 Q 38 -48 34 -6" fill="none" stroke={st.stroke} strokeWidth="11" strokeLinecap="round" />}
          <path d="M -34 -6 Q -38 -48 0 -48 Q 38 -48 34 -6" fill="none" stroke="#5B6B7A" strokeWidth="6" strokeLinecap="round" />
          {[-1, 1].map((d) => (
            <g key={d}>
              <rect x={d < 0 ? -44 : 30} y="-16" width="14" height="26" rx="6" fill="#FF5C8A" {...s(3)} />
              <rect x={d < 0 ? -40 : 34} y="-11" width="6" height="16" rx="3" fill="#FF9FBC" />
            </g>
          ))}
          {sheen(st, -38, -9, 2, 5, 0)}
        </>
      );
    case "flower_crown": {
      const colors = ["#FF8FC0", "#FFF1A8", "#B58CFF", "#FF8A5B", "#FF8FC0", "#FFF1A8", "#B58CFF"];
      return (
        <>
          <path d="M -32 -18 Q -26 -38 0 -39 Q 26 -38 32 -18" fill="none" stroke="#3FA877" strokeWidth="3.5" strokeLinecap="round" />
          {colors.map((col, i) => {
            const a = Math.PI * (1.12 + (i / (colors.length - 1)) * 0.76);
            const x = Math.cos(a) * 33;
            const y = Math.sin(a) * 33 - 4;
            return (
              <g key={i} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
                <ellipse cx="-5" cy="2" rx="4" ry="2" fill="#3FA877" transform="rotate(-30 -5 2)" />
                {[0, 1, 2, 3, 4].map((p) => (
                  <circle key={p} cx={(Math.cos(p * 1.2566) * 3.6).toFixed(2)} cy={(Math.sin(p * 1.2566) * 3.6).toFixed(2)} r="3.4" fill={col} {...s(1.5)} />
                ))}
                <circle r="2.4" fill={GOLD} />
              </g>
            );
          })}
        </>
      );
    }
    case "space_helmet":
      return (
        <>
          <path d="M -36 26 Q 0 46 36 26" fill="none" stroke={st.stroke ?? "#7D8A99"} strokeWidth={st.stroke ? 12 : 10} strokeLinecap="round" />
          <path d="M -36 26 Q 0 46 36 26" fill="none" stroke="#C8D2DE" strokeWidth="7" strokeLinecap="round" />
          <circle cy="-3" r="46" fill="#BDE8F5" fillOpacity="0.28" stroke={st.stroke ?? "#A9C7DA"} strokeWidth={st.stroke ? 3.5 : 2.5} />
          <path d="M -30 -26 Q -20 -40 -4 -44" fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" opacity="0.75" />
          <path d="M 30 14 Q 34 4 34 -6" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
          <circle cy="-50" r="4" fill="#FF6B8B" {...s(2)} />
        </>
      );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Face: on the eyes
// ---------------------------------------------------------------------------

/** Where the species' eyes are, as head() and the dragon pass them to eyes(). */
export interface EyeSpot {
  x1: number;
  x2: number;
  y: number;
  /** An eye's radius. */
  r: number;
}

function faceItem(st: StyleSpec, id: string, e: EyeSpot, cx: number, r: number): ReactNode {
  const s = (w?: number) => line(st, w);
  // The lens: a bit wider than the eye, as the free sunglasses are.
  const lens = Math.max(e.r * 1.7, r * 0.27);
  const temples = (frame: string) => (
    <path
      d={`M ${e.x1 - lens} ${e.y - lens * 0.2} L ${cx - r * 0.96} ${e.y - lens * 0.45} M ${e.x2 + lens} ${e.y - lens * 0.2} L ${cx + r * 0.96} ${e.y - lens * 0.45}`}
      stroke={frame}
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  );
  const bridge = (frame: string) => (
    <path d={`M ${e.x1 + lens * 0.75} ${e.y - lens * 0.25} Q ${(e.x1 + e.x2) / 2} ${e.y - lens * 0.6} ${e.x2 - lens * 0.75} ${e.y - lens * 0.25}`} fill="none" stroke={frame} strokeWidth="2.6" strokeLinecap="round" />
  );
  switch (id) {
    case "heart_glasses": {
      const k = (lens * 1.15) / 11;
      const frame = "#E8558F";
      return (
        <>
          {temples(frame)}
          {[e.x1, e.x2].map((x) => (
            <path
              key={x}
              d={HEART}
              transform={`translate(${x} ${e.y + 2 * k}) scale(${k.toFixed(3)})`}
              fill="#FF8FC0"
              fillOpacity="0.55"
              stroke={st.stroke ?? frame}
              strokeWidth={(st.stroke ? 3 : 2.4) / k}
              strokeLinejoin="round"
            />
          ))}
          {bridge(frame)}
          {sheen(st, e.x1 - lens * 0.35, e.y - lens * 0.45, lens * 0.22, lens * 0.12)}
          {sheen(st, e.x2 - lens * 0.35, e.y - lens * 0.45, lens * 0.22, lens * 0.12)}
        </>
      );
    }
    case "star_glasses": {
      const frame = "#E0A419";
      return (
        <>
          {temples(frame)}
          {[e.x1, e.x2].map((x) => (
            <path key={x} d={star(x, e.y, lens * 1.25)} fill={GOLD} fillOpacity="0.5" stroke={st.stroke ?? frame} strokeWidth={st.stroke ? 3 : 2.4} strokeLinejoin="round" />
          ))}
          {bridge(frame)}
          {sheen(st, e.x1 - lens * 0.3, e.y - lens * 0.35, lens * 0.2, lens * 0.11)}
          {sheen(st, e.x2 - lens * 0.3, e.y - lens * 0.35, lens * 0.2, lens * 0.11)}
        </>
      );
    }
    case "monocle": {
      // On the right eye, a chain hanging down to the cheek.
      const m = lens * 1.05;
      return (
        <>
          <path
            d={`M ${e.x2 + m * 0.2} ${e.y + m} Q ${e.x2 + m * 0.9} ${e.y + m * 2.2} ${cx + r * 0.78} ${e.y + m * 2.6}`}
            fill="none"
            stroke={GOLD}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeDasharray="0.1 3.2"
          />
          <circle cx={e.x2} cy={e.y} r={m} fill="#FFFFFF" fillOpacity="0.22" stroke={st.stroke ?? "#C9A227"} strokeWidth={st.stroke ? 3.5 : 2.6} />
          {st.stroke && <circle cx={e.x2} cy={e.y} r={m - 1.6} fill="none" stroke={GOLD} strokeWidth="1.8" />}
          {!st.stroke && <circle cx={e.x2} cy={e.y} r={m} fill="none" stroke={GOLD} strokeWidth="1.4" />}
          {sheen(st, e.x2 - m * 0.4, e.y - m * 0.45, m * 0.28, m * 0.14)}
        </>
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Neck: under the chin, and the cape behind
// ---------------------------------------------------------------------------

const CAPE = "#D9434F";

function neckItem(st: StyleSpec, id: string): ReactNode {
  const s = (w?: number) => line(st, w);
  switch (id) {
    case "scarf":
      return (
        <>
          <path d="M -26.5 26.5 Q 0 38 26.5 26.5 L 27.9 34.7 Q 0 46.2 -27.9 34.7 Z" fill="#3F8FE0" {...s(3)} />
          <path d="M 15.3 35.7 l 6 22 l 10 -4 z" fill="#3F8FE0" {...s(3)} />
          <path d="M 18 45 l 8.5 -3 M 20 52 l 8.5 -3" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M -14 33 Q 0 38 14 33" stroke="#9CCBF5" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          {sheen(st, -14, 31, 6, 2.2, 8)}
        </>
      );
    case "cape":
      // The front of the cape: the collar round the neck and the clasp.
      return (
        <>
          <path d="M -25 25 Q 0 39 25 25 L 21 34 Q 0 45 -21 34 Z" fill={CAPE} {...s(3)} />
          <circle cy="38" r="4.5" fill={GOLD} {...s(2)} />
          {sheen(st, -12, 30, 5, 2, 10)}
        </>
      );
    case "medal":
      return (
        <>
          <path d="M -15 26 L -2 50 M 15 26 L 2 50" stroke={st.stroke ?? "#2A6FC4"} strokeWidth={st.stroke ? 8 : 6} strokeLinecap="round" />
          <path d="M -15 26 L -2 50" stroke="#56B6E8" strokeWidth="5" strokeLinecap="round" />
          <path d="M 15 26 L 2 50" stroke="#E8463A" strokeWidth="5" strokeLinecap="round" />
          <circle cy="56" r="9.5" fill={GOLD} {...(st.stroke ? s(3) : { stroke: "#E0A419", strokeWidth: 2 })} />
          <path d={star(0, 56.5, 5.5)} fill="#FFF1A8" />
          {sheen(st, -3.5, 52, 2.6, 1.6)}
        </>
      );
    case "bow_tie":
      return (
        <g transform="translate(0 33)">
          <path d="M 0 0 L -13 -8 Q -16 0 -13 8 Z" fill="#E8463A" {...s(2.5)} />
          <path d="M 0 0 L 13 -8 Q 16 0 13 8 Z" fill="#E8463A" {...s(2.5)} />
          <circle cx="-8" cy="-1" r="1.4" fill="#FFFFFF" />
          <circle cx="9" cy="2" r="1.4" fill="#FFFFFF" />
          <rect x="-4" y="-4.5" width="8" height="9" rx="2.5" fill="#C93A30" {...s(2.5)} />
        </g>
      );
  }
  return null;
}

/**
 * The cape behind the body, for the full body (stages 3-8), in the 200x200
 * box's own coordinates: drawn first, so the tail and wings come over it.
 */
export function capeBehind(ctx: ItemContext): ReactNode {
  if (wearing(ctx, "neck") !== "cape") return null;
  const { st } = ctx;
  return (
    <g data-item="cape" data-slot="neck" data-part="cape-back">
      <path d="M 70 106 Q 100 98 130 106 L 152 178 Q 100 191 48 178 Z" fill={CAPE} {...line(st, 3.5)} />
      <path d="M 82 112 L 70 176 M 118 112 L 130 176" stroke="#B8323D" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      {sheen(st, 66, 140, 4, 20, 12)}
    </g>
  );
}

// ---------------------------------------------------------------------------
// On the head: what head() and the dragon draw after the eyes
// ---------------------------------------------------------------------------

/**
 * The worn items on a head: round the neck, on the eyes, then on top. Called
 * where accessory() is, with the eyes' positions.
 */
export function wornOnHead(ctx: ItemContext, cx: number, cy: number, r: number, eyes: EyeSpot): ReactNode {
  const neck = wearing(ctx, "neck");
  const face = wearing(ctx, "face");
  const head = wearing(ctx, "head");
  if (!neck && !face && !head) return null;
  return (
    <>
      {neck && onHead(neck, "neck", cx, cy, r, neckItem(ctx.st, neck))}
      {face && (
        <g data-item={face} data-slot="face">
          {faceItem(ctx.st, face, eyes, cx, r)}
        </g>
      )}
      {head && onHead(head, "head", cx, cy, r, headItem(ctx.st, head))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

/**
 * The frame a background is drawn in: a rounded square inside the 200x200
 * box. A square rather than a circle because every scene has a ground the
 * creature stands on (y 182): a circle cuts the ground away where the feet,
 * the shadow, the egg's base and the cushion are, and would crop the corners
 * of the scenes to a porthole. The radius is the app's card corner at the
 * sizes the creature is shown.
 */
export const BACKDROP = { x: 4, y: 4, size: 192, radius: 34 } as const;

function scene(id: string, uid: string): ReactNode {
  const sky = (top: string, bottom: string) => (
    <>
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="200" height="200" fill={`url(#${uid}-sky)`} />
    </>
  );
  const dots = (pts: ReadonlyArray<readonly [number, number, number]>, fill: string, opacity = 1) =>
    pts.map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={fill} opacity={opacity} />);
  switch (id) {
    case "starry_sky":
      return (
        <>
          {sky("#151B48", "#3B3F8F")}
          {dots([[30, 30, 1.6], [58, 62, 1.2], [92, 22, 1.8], [124, 52, 1.2], [176, 92, 1.4], [20, 104, 1.2], [66, 120, 1], [150, 128, 1], [104, 84, 1]], "#FFFFFF", 0.85)}
          <path d={star(42, 80, 5)} fill={GOLD} />
          <path d={star(140, 30, 4)} fill={GOLD} />
          <path d={star(176, 140, 3.5)} fill={GOLD} />
          <path d="M 160 36 a 16 16 0 1 0 14 24 a 12 12 0 1 1 -14 -24 z" fill="#FFF1A8" />
          <path d="M 0 176 Q 60 160 110 172 Q 160 182 200 166 L 200 200 L 0 200 Z" fill="#262B66" />
        </>
      );
    case "rainbow":
      return (
        <>
          {sky("#9FD8FF", "#E6F5FF")}
          {["#FF6B6B", "#FFA94D", "#FFD43B", "#69DB7C", "#4DABF7", "#9775FA"].map((c, i) => (
            <path key={c} d={`M ${-6 + i * 8} 182 A ${106 - i * 8} ${106 - i * 8} 0 0 1 ${206 - i * 8} 182`} fill="none" stroke={c} strokeWidth="8.5" />
          ))}
          {[[26, 168], [176, 168]].map(([x, y]) => (
            <g key={x} fill="#FFFFFF">
              <circle cx={x - 12} cy={y} r="11" />
              <circle cx={x + 2} cy={y - 6} r="14" />
              <circle cx={x + 16} cy={y} r="11" />
            </g>
          ))}
          <path d="M 0 178 Q 100 168 200 178 L 200 200 L 0 200 Z" fill="#8ED081" />
        </>
      );
    case "beach":
      return (
        <>
          {sky("#7CCBFF", "#D9F1FF")}
          <circle cx="158" cy="44" r="17" fill="#FFD54A" />
          <circle cx="158" cy="44" r="25" fill="#FFD54A" opacity="0.25" />
          <path d="M 22 50 q 8 -6 16 0 q 8 -6 16 0" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
          <rect x="0" y="118" width="200" height="40" fill="#3FA9E0" />
          <path d="M 0 130 q 12 -5 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0" fill="none" stroke="#8FD6FA" strokeWidth="2.5" />
          <path d="M 0 144 q 12 -5 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0" fill="none" stroke="#8FD6FA" strokeWidth="2.5" />
          <path d="M 0 154 Q 50 146 100 152 Q 150 158 200 150 L 200 200 L 0 200 Z" fill="#F5D9A0" />
          <path d={star(30, 176, 7)} fill="#FF8A5B" />
          <path d="M 168 178 q 6 -10 12 0 z" fill="#FFB3C7" />
        </>
      );
    case "outer_space":
      return (
        <>
          {sky("#0A0E2A", "#2A1452")}
          {dots([[18, 24, 1.3], [48, 100, 1], [80, 18, 1.6], [112, 46, 1.1], [182, 22, 1.4], [172, 116, 1.1], [12, 140, 1.2], [96, 120, 0.9], [140, 92, 1]], "#FFFFFF", 0.9)}
          <circle cx="50" cy="56" r="18" fill="#FF8A5B" />
          <path d="M 44 46 q 10 2 16 10" fill="none" stroke="#E8613A" strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="50" cy="58" rx="30" ry="7" fill="none" stroke="#FFD08A" strokeWidth="3" transform="rotate(-14 50 58)" />
          <circle cx="160" cy="72" r="9" fill="#56B6E8" />
          <circle cx="157" cy="69" r="3" fill="#9AD7F5" />
          <path d={star(130, 28, 4)} fill={GOLD} />
          <path d="M 0 170 Q 50 160 100 166 Q 150 172 200 162 L 200 200 L 0 200 Z" fill="#8C8FA8" />
          <ellipse cx="40" cy="180" rx="10" ry="3.5" fill="#6E7190" />
          <ellipse cx="164" cy="176" rx="8" ry="3" fill="#6E7190" />
        </>
      );
    case "forest":
      return (
        <>
          {sky("#BFE8CE", "#ECF9F0")}
          {[[24, 168, 30], [62, 166, 22], [148, 166, 24], [182, 170, 32]].map(([x, base, h]) => (
            <g key={x}>
              <rect x={x - 3} y={base - 10} width="6" height="12" fill="#8B5A2B" />
              <path d={`M ${x - h * 0.6} ${base - 8} L ${x} ${base - 8 - h * 1.5} L ${x + h * 0.6} ${base - 8} Z`} fill={x % 3 === 0 ? "#2E8A5F" : "#3FA877"} />
              <path d={`M ${x - h * 0.45} ${base - 8 - h * 0.6} L ${x} ${base - 8 - h * 1.9} L ${x + h * 0.45} ${base - 8 - h * 0.6} Z`} fill={x % 3 === 0 ? "#3FA877" : "#2E8A5F"} />
            </g>
          ))}
          <path d="M 0 172 Q 100 162 200 172 L 200 200 L 0 200 Z" fill="#7CC46E" />
          <g transform="translate(36 182)">
            <rect x="-2" y="-6" width="4" height="7" rx="1.5" fill="#FFF4E0" />
            <path d="M -7 -5 Q 0 -14 7 -5 Z" fill="#E8463A" />
            <circle cx="-2" cy="-8" r="1.1" fill="#FFFFFF" />
          </g>
        </>
      );
    case "snow":
      return (
        <>
          {sky("#CFE4F6", "#F3F9FE")}
          {dots([[20, 30, 2.4], [56, 56, 1.8], [96, 24, 2.2], [140, 46, 1.8], [178, 30, 2.4], [30, 96, 1.8], [168, 92, 2], [80, 100, 1.6], [124, 112, 1.6]], "#FFFFFF")}
          <path d="M 0 150 Q 50 130 104 148 Q 150 162 200 140 L 200 200 L 0 200 Z" fill="#E4EEF8" />
          <g transform="translate(166 152)">
            <rect x="-2.5" y="0" width="5" height="9" fill="#8B5A2B" />
            <path d="M -16 2 L 0 -30 L 16 2 Z" fill="#2E8A5F" />
            <path d="M -10 -10 L 0 -30 L 10 -10 Q 0 -14 -10 -10 Z" fill="#FFFFFF" />
          </g>
          <path d="M 0 176 Q 100 166 200 176 L 200 200 L 0 200 Z" fill="#FFFFFF" />
        </>
      );
  }
  return null;
}

/**
 * The background behind the creature, inside the rounded frame: an outline
 * in Sticker, a soft light from the top in Storybook.
 */
export function backdrop(ctx: ItemContext): ReactNode {
  const id = wearing(ctx, "background");
  if (!id) return null;
  const body = scene(id, ctx.id);
  if (!body) return null;
  const { x, y, size, radius } = BACKDROP;
  const { st } = ctx;
  return (
    <g data-item={id} data-slot="background">
      <defs>
        <clipPath id={`${ctx.id}-backdrop`}>
          <rect x={x} y={y} width={size} height={size} rx={radius} />
        </clipPath>
        {st.glow && (
          <radialGradient id={`${ctx.id}-backdrop-light`} cx="35%" cy="20%" r="75%">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.35" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        )}
      </defs>
      <g clipPath={`url(#${ctx.id}-backdrop)`}>
        {body}
        {st.glow && <rect x={x} y={y} width={size} height={size} fill={`url(#${ctx.id}-backdrop-light)`} />}
      </g>
      {st.stroke ? (
        <rect x={x} y={y} width={size} height={size} rx={radius} fill="none" stroke={st.stroke} strokeWidth="4" />
      ) : (
        // A hairline in the page's own ink, so a pale sky (snow) still has an edge on a white card.
        <rect x={x} y={y} width={size} height={size} rx={radius} fill="none" className="creature-backdrop-edge" strokeWidth="1.5" />
      )}
    </g>
  );
}
