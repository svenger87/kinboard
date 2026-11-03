/**
 * Nowruz (RFC-020 §3.3): the Persian new year, around the first of spring.
 * Three goldfish from the haft-sin swim along the bottom of the screen, a
 * gold one, a smaller red-and-white one and a gold one, each out of stroke
 * with the one before; a tap drops an apple, a gold coin and a painted egg.
 * Sabzeh, young wheatgrass, sprouts along each card's bottom edge, tied
 * with a red ribbon. The creatures wear the shop's flower crown; the wash
 * is spring green from the top over turquoise.
 *
 * Art: webapp/scripts/festival-art/nowruz.py (public/festivals/nowruz/,
 * ./nowruz.art.json, with the fish's joints and swim stroke).
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import type { Rig, RigNode } from "@/lib/festivals/visitors/types";
import ART from "./nowruz.art.json";

const J = ART.rig.joints;
const S = ART.rig.swim;
const pt = (v: number[]): [number, number] => [v[0], v[1]];
const wave = (v: number[]) => ({ wave: [v[0], v[1]] as [number, number] });

/**
 * A goldfish, `size` of the drawing: the tail's root sweeps and the fan whips
 * after it, the body counters the tail, the dorsal fin trails and the
 * pectoral fin paddles, one stroke a step.
 */
function goldfish(coat: "" | "-calico", size = 1): Rig {
  const part = (name: string) => `goldfish-${name}${coat}`;
  const fish: RigNode = {
    part: part("body"),
    rotate: wave(S.body),
    under: [
      { part: part("dorsal"), at: pt(J.dorsal), rotate: wave(S.dorsal) },
      {
        part: part("tail-base"),
        at: pt(J.tail),
        rotate: wave(S.tail),
        under: [{ part: part("tail-fan"), at: pt(ART.rig.fan), rotate: wave(S.fan) }],
      },
    ],
    over: [{ part: part("fin"), at: pt(J.fin), rotate: wave(S.fin) }],
  };
  return { period: S.period, root: size === 1 ? fish : { scaleX: size, scaleY: size, over: [fish] } };
}

export default defineFestival({
  id: "nowruz",
  draft: true,
  // The sabzeh's spring green from the top, the goldfish bowl's turquoise from below.
  wash: { light: ["100 55% 36%", "176 62% 34%"], dark: ["100 48% 52%", "175 55% 50%"] },
  visitor: {
    archetype: "walk",
    parts: ART.parts,
    // A fish 230 units long: 140px on a 1080p wall, smaller on a phone.
    size: { per: "height", px: 1800, min: 0.38, max: 0.6 },
    members: [goldfish(""), goldfish("-calico", 0.8), goldfish("")],
    gap: [250, 90],
    tail: 120,
    // Clear of the navigation bar by the fish's own depth below its middle, and a little water.
    lift: { art: 64, px: [18, 46] },
    duration: 13_000,
    period: S.period,
    lag: 0.37,
    // Swimming: a gentle rise and fall (a wave, not a hop), pitching with it.
    bob: { amp: 7 },
    swing: { amp: 3, lag: 0.2, wind: 0.3 },
    // The fish face right.
    direction: "ltr",
    // The fan behind, the dorsal fin above, a stroke's rise.
    extent: { left: 175, right: 80, top: 80, bottom: 62 },
    tap: { drops: ["apple", "coin", "egg"], at: [0.5, 0.5] },
  },
  // Wheatgrass sprouting in the gap under each card, its tips reaching up to
  // the card's bottom edge and never over it (a card's content can start at
  // its very first pixel), kept off the rounded corners; a red ribbon tied
  // round it near one end, the other end on the next card.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before {
      content: "";
      position: absolute;
      z-index: 2;
      bottom: -16px;
      left: 10px;
      right: 10px;
      height: 16px;
      background: ${s.art("sabzeh")} repeat-x 0 100% / 120px 16px;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::before {
      background-position: -53px 100%;
    }
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      bottom: -16px;
      left: 26px;
      width: 27px;
      height: 16px;
      background: ${s.art("ribbon")} center / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::after {
      left: auto;
      right: 26px;
    }
  `,
  outfit: [{ slot: "head", item: "flower_crown" }],
});
