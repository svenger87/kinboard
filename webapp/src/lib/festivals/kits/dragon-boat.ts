/**
 * Dragon Boat (RFC-020 §3.3): the fifth day of the fifth month. A dragon
 * boat paddles along the bottom of the screen, left to right: a long green
 * hull scaled like a dragon, its tail curled at the stern and its head held
 * high, eight paddlers pulling in rhythm -- reach, catch, pull, lift --
 * while the drummer at the bow beats twice a stroke and the steerer holds
 * the long oar at the stern; the boat pitches with the stroke and rides
 * the water. No dressing, no outfit; the wash is green from the top over red.
 *
 * Art: webapp/scripts/festival-art/dragon-boat.py (public/festivals/dragon-boat/,
 * ./dragon-boat.art.json with the joints and the stroke).
 */

import { defineFestival } from "@/lib/festivals/kit";
import type { Rig, RigNode } from "@/lib/festivals/visitors/types";
import ART from "./dragon-boat.art.json";

const R = ART.rig;
const S = R.stroke;
const pt = (v: number[]): [number, number] => [v[0], v[1]];
const CREW = ["light-yellow", "dark-red", "light-blue", "dark-yellow", "light-red", "dark-blue", "light-yellow", "dark-red"] as const;
// The paddles reach from the shoulder to just under the near water.
const REACH = 0.86;

/** A paddler's body: on the seat, below the gunwale, leaning with the stroke. */
const torso = (seat: number, i: number): RigNode => ({ part: `paddler-${CREW[i]}`, at: [seat, R.seat_y], x: { keys: S.lean } });

/** A paddler's arm and paddle, over the gunwale: the stroke, lifted on the recovery, leaning with the body. */
const paddle = (seat: number, i: number): RigNode => ({
  part: `paddle-${CREW[i].split("-")[0]}`,
  at: [seat + R.shoulder[0], R.seat_y + R.shoulder[1]],
  x: { keys: S.lean },
  y: { keys: S.lift },
  rotate: { keys: S.rotate },
  scaleY: REACH,
});

export const BOAT: Rig = {
  period: R.period,
  root: {
    over: [
      { part: "water-far", at: pt(R.water.far), x: { sine: 6, ms: 2400 } },
      {
        part: "hull",
        at: pt(R.hull),
        // The bow lifts a little on each pull.
        rotate: { keys: [[0, 0.4], [0.42, -0.6], [0.7, 0.2]] },
        under: [
          ...R.seats.map(torso),
          { part: "drum", at: [R.drummer.drum, 100] },
          // The drummer faces the crew.
          { part: "paddler-light-red", at: [R.drummer.x, R.seat_y], scaleX: -1 },
          { part: "paddler-dark-blue", at: [R.steerer.x, R.seat_y - 6] },
        ],
        over: [
          ...R.seats.map(paddle),
          // Two beats a stroke, the first on the catch.
          { part: "drumstick", at: [R.drummer.x + R.drummer.shoulder[0] * -1, R.seat_y + R.drummer.shoulder[1] + 8], rotate: { keys: [[0, 92], [0.25, 140], [0.5, 92], [0.75, 140]] } },
          { part: "oar", at: [R.steerer.x + 8, R.seat_y - 32], rotate: [38, { sine: 3, ms: 3200, wind: [1, 1] }], scaleY: 0.62 },
          { part: "head", at: pt(R.head), rotate: { wave: [2.5, 0.1] } },
        ],
      },
      { part: "water-near", at: pt(R.water.near), x: { sine: 8, ms: 3000, phase: 0.3 } },
    ],
  },
};

export default defineFestival({
  id: "dragon-boat",
  wash: { light: ["145 55% 32%", "355 70% 46%"], dark: ["145 48% 48%", "355 72% 60%"] },
  visitor: {
    archetype: "walk",
    parts: ART.parts,
    // The boat, 710 units bow to stern: 390px on a 1080p wall, 190px on a phone.
    size: { per: "width", px: 3400, min: 0.27, max: 0.55 },
    members: [BOAT],
    gap: [0, 0],
    tail: 710,
    // The water's foot just above the navigation bar.
    lift: { art: 140, px: [4, 16] },
    duration: 13_000,
    period: R.period,
    bob: { amp: 1.5 },
    // The dragon looks ahead: drawn facing right, turned round for the passes that go left.
    faces: "right",
    extent: { left: 0, right: 710, top: 50, bottom: 140 },
    tap: { at: [0.5, 0.45] },
  },
  dressing: null,
  outfit: [],
});
