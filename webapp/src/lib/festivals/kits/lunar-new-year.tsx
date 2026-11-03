/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.
/**
 * Lunar New Year (Spring Festival, Seollal, Tết; RFC-020 §3.3): from the eve
 * to the Lantern Festival, the fifteenth day. A dragon dances along the
 * bottom of the screen on its dancers' poles, chasing its pearl, a wave
 * running down its body from the head to the tail; a tap drops red
 * envelopes and mandarins. On the last day, the Lantern Festival, lanterns
 * rise instead. Red lanterns hang from the cards, the creatures wear a red
 * cap with a lantern, and the wash is red from the top over gold.
 *
 * The dragon is drawn dancing left to right (`faces: "right"`): on the passes
 * that go the other way `walk` turns it round, head and pearl first.
 *
 * Art: webapp/scripts/festival-art/lunar-new-year.py
 * (public/festivals/lunar-new-year/, ./lunar-new-year.art.json). The cap is
 * drawn here.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import { GOLD, line, sheen } from "@/lib/pocket-money/creatures/item-draw";
import type { PartSpec, Rig, RigNode, Size, VisitorSpec } from "@/lib/festivals/visitors/types";
import ART from "./lunar-new-year.art.json";

const D = ART.rig.dance;
const pt = (v: number[]): [number, number] => [v[0], v[1]];
const pick = (names: string[]): Record<string, PartSpec> => Object.fromEntries(names.map((n) => [n, (ART.parts as Record<string, PartSpec>)[n]]));

/** The tilt along the wave: a quarter of a step behind the member's height, the front end up as the wave rises ahead. */
const TILT = { wave: [D.tilt, 0.75] as [number, number] };
const POLE: RigNode = { part: "pole" };

/** A member on its pole: the pole held still below, the part tilting on top of it. */
const onPole = (node: RigNode): Rig => ({ period: D.period, root: { under: [POLE], over: [node] } });

/** The head: its jaw snapping, its whiskers streaming; the pearl it chases circling ahead of it on its own pole. */
const HEAD: Rig = {
  period: D.period,
  root: {
    under: [POLE],
    over: [
      {
        part: "dragon-head",
        rotate: { wave: [D.tilt * 0.5, 0.75] },
        under: [{ part: "dragon-jaw", at: pt(D.jaw.at), rotate: { keys: D.jaw.open } }],
        over: [{ part: "dragon-whiskers", at: pt(D.whiskers.at), rotate: [{ wave: [D.whiskers.wave[0], D.whiskers.wave[1]] }, { sine: 4, ms: 900, wind: [0.4, 1] }] }],
      },
      {
        part: "pearl",
        at: pt(D.pearl.at),
        x: { sine: D.pearl.circle[0], ms: 1700 },
        y: { sine: D.pearl.circle[1], ms: 1700, phase: 0.25 },
      },
    ],
  },
};

const BODY = (k: number) => onPole({ part: k % 2 ? "dragon-body-b" : "dragon-body-a", rotate: TILT });

const SIZE: Size = { per: "height", px: 1600, min: 0.4, max: 0.68 };
const DROPS = ["hongbao", "mandarin"];

const DRAGON: VisitorSpec = {
  archetype: "walk",
  parts: pick(["pole", "dragon-tail", "dragon-body-a", "dragon-body-b", "dragon-head", "dragon-jaw", "dragon-whiskers", "pearl", ...DROPS]),
  size: SIZE,
  // The tail first: the last member leads.
  members: [onPole({ part: "dragon-tail", rotate: TILT }), ...[0, 1, 2, 3, 4, 5, 6].map(BODY), HEAD],
  gap: [D.gap, 6],
  // The head and the pearl ahead of the last pole.
  tail: 250,
  // The poles' feet stay clear of the navigation bar however the wave lifts them.
  lift: { art: 180, px: [4, 20] },
  duration: 13_000,
  period: D.period,
  lag: D.lag,
  bob: { amp: D.bob },
  // The poles too: what the pass draws is what it clears.
  extent: { left: 114, right: 280, top: 172, bottom: 180 },
  faces: "right",
  tap: { drops: DROPS, at: [0.85, 0.3] },
};

/** The Lantern Festival: red lanterns rising through the screen. */
const LANTERNS: VisitorSpec = {
  archetype: "rise",
  parts: pick(["lantern-round", "lantern-tall", ...DROPS]),
  size: SIZE,
  sprites: ["lantern-round", "lantern-tall"],
  count: 16,
  speed: [55, 95],
  sway: 18,
  scale: [0.65, 1.1],
  spin: [-0.08, 0.08],
  ceiling: 0.08,
  tap: { drops: DROPS },
};

export default defineFestival({
  id: "lunar-new-year",
  draft: true,
  wash: { light: ["356 76% 44%", "42 90% 47%"], dark: ["356 78% 58%", "44 92% 58%"] },
  visitor: DRAGON,
  visitorByStage: { lanterns: LANTERNS },
  // Two red lanterns on a gold cord, hung from each card's bottom edge into
  // the gap below, on the right of odd cards and the left of even ones:
  // wholly in the gap, hanging from the card's border line (offsets count
  // from inside the 1px border): 16px where the grid's gap is 16px, 23px
  // from md up, where it is 24px.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      bottom: -17px;
      right: 24px;
      width: 30px;
      height: 16px;
      background: ${s.art("lanterns-hanging")} center top / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::after {
      right: auto;
      left: 24px;
    }
    @media (min-width: 768px) {
      ${s.cards}::after {
        bottom: -24px;
        width: 43px;
        height: 23px;
      }
    }
  `,
  outfit: [
    {
      slot: "head",
      item: "lantern_cap_lny",
      // A round red cap in six panels, a gold band and knot, a little lantern hanging from the knot.
      draw: (st) => (
        <>
          <path d="M -31 -20 Q -30 -54 0 -55 Q 30 -54 31 -20 Q 0 -27 -31 -20 Z" fill="#D9333F" {...line(st, 3)} />
          <path d="M 0 -55 Q -12 -40 -15 -23 M 0 -55 Q 12 -40 15 -23" stroke="#A8222D" strokeWidth="1.6" fill="none" opacity="0.7" />
          <path d="M -32 -22 Q 0 -30 32 -22 L 32 -16 Q 0 -24 -32 -16 Z" fill={GOLD} {...line(st, 2)} />
          <circle cx="0" cy="-57" r="5" fill={GOLD} {...line(st, 2)} />
          <path d="M 4 -58 Q 16 -60 22 -50 L 22 -46" stroke="#C68C18" strokeWidth="1.6" fill="none" />
          <ellipse cx="22" cy="-38" rx="7" ry="8.5" fill="#E8303A" {...line(st, 2)} />
          <ellipse cx="22" cy="-38" rx="3" ry="8" fill="none" stroke="#A8222D" strokeWidth="1.2" opacity="0.7" />
          <rect x="17.5" y="-47.5" width="9" height="3" rx="1" fill={GOLD} />
          <rect x="17.5" y="-31.5" width="9" height="3" rx="1" fill={GOLD} />
          <ellipse cx="19.5" cy="-41" rx="1.8" ry="2.6" fill="#FFE0A8" opacity="0.8" />
          <path d="M 21 -28 L 20.5 -22 M 22 -28 L 22 -21.5 M 23 -28 L 23.5 -22" stroke="#D9333F" strokeWidth="1.2" strokeLinecap="round" />
          {sheen(st, -14, -42, 8, 4)}
        </>
      ),
    },
  ],
  // The Lantern Festival, the window's last day: lanterns rise instead of the dragon.
  stage: (at) => (at.dayIndex === at.days - 1 ? "lanterns" : "new-year"),
  stages: ["new-year", "lanterns"],
});
