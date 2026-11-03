/**
 * Mid-Autumn (RFC-020 §3.3): the full moon of the eighth month. A large,
 * soft full moon glides across the top of the screen with a wisp of cloud
 * over it, and paper sky lanterns drift past it, each slipping from behind
 * the moon to ahead of it; a tap brings mooncakes down. A rabbit sits by two
 * mooncakes on the Tasks card's corner. No outfit; the wash is gold from the
 * top over night blue.
 *
 * Art: webapp/scripts/festival-art/mid-autumn.py (public/festivals/mid-autumn/,
 * ./mid-autumn.art.json, with the rig's layout). The sky lanterns are
 * Diwali's too.
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import type { Rig, RigNode } from "@/lib/festivals/visitors/types";
import ART from "./mid-autumn.art.json";

const R = ART.rig;
const pt = (v: number[]): [number, number] => [v[0], v[1]];
/** ms for the crossing: slower than the sleigh, the moon takes its time. */
const DURATION = 16_000;

/** A lantern: sliding from behind the moon to ahead of it over the pass (half a cycle), bobbing and swaying on the wall clock. */
function lantern(l: (typeof R.lanterns)[number], i: number): RigNode {
  return {
    part: l.part,
    at: pt(l.at),
    x: { keys: [[0, -l.slide], [0.5, l.slide]] },
    y: { sine: l.bob, ms: 2600 + i * 370, phase: i * 0.21, wind: [1, 0.6] },
    rotate: { sine: 4, ms: 3100 + i * 290, phase: i * 0.37, wind: [1, 1.5] },
    scaleX: l.scale,
    scaleY: l.scale,
  };
}

export const MOON: Rig = {
  // One cycle is two passes: a pass is the first half, behind to ahead.
  period: (2 * DURATION) / 1000,
  root: {
    over: [
      { part: "moon", at: pt(R.moon), y: { sine: 3, ms: 7000 } },
      { part: "cloud", at: pt(R.cloud), x: { keys: [[0, 70], [0.5, -70]] } },
      ...R.lanterns.map(lantern),
    ],
  },
};

export default defineFestival({
  id: "mid-autumn",
  wash: { light: ["44 88% 46%", "226 58% 28%"], dark: ["45 92% 58%", "226 55% 50%"] },
  visitor: {
    archetype: "fly",
    parts: ART.parts,
    // The moon's disc 300 units across: about 215px on a 1080p wall, 90px on a phone.
    size: { per: "width", px: 2700, min: 0.3, max: 0.72 },
    body: MOON,
    // Everything the rig draws, the moon's halo and every lantern at the ends
    // of its slide: fly clears this box between frames (and takes taps in it).
    box: [-30, -200, 770, 400],
    length: R.length,
    duration: DURATION,
    // High in the sky, the moon's centre a fifth to a third of the way down; hardly any arc, hardly any bank.
    bands: [[0.2, 0.06], [0.3, 0.08]],
    arc: [0.01, 0.03],
    bank: 0.6,
    tap: { drops: ["mooncake"], at: [0.5, 0.6] },
  },
  // Every piece lies in the grid's gap, outside the card, and ends on the
  // card's border line (offsets count from inside the 1px border, so a piece
  // h px tall sits at -(h + 1)px): a full-bleed card, a camera or a photo,
  // has content from its first pixel row to its last. In the gap means at
  // most 16px tall below 768px wide, where the gap is 16px, and 24px from
  // there, where it is 24px.
  // A rabbit and two mooncakes sitting on the Tasks card's top edge.
  dressing: (s) => css`
    ${s.tasks} {
      position: relative;
    }
    ${s.tasks}::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      right: 16px;
      width: 25px;
      height: 16px;
      background: ${s.art("rabbit-mooncakes")} center bottom / contain no-repeat;
      pointer-events: none;
    }
    @media (min-width: 768px) {
      ${s.tasks}::after {
        top: -25px;
        width: 37px;
        height: 24px;
      }
    }
  `,
  outfit: [],
});
