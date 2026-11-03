/**
 * St Martin's Day (Sankt Martin, RFC-020 §3.3): 11 November. The lantern
 * walk -- children's paper lanterns, sun, moon and star, bobbing on their
 * sticks along the bottom of the screen -- from dusk (the weather's sunset;
 * 17:00 without it); paper lanterns hang from the cards and the wash is
 * night blue over amber all day.
 *
 * Art: webapp/scripts/festival-art/st-martin.py (public/festivals/st-martin/,
 * ./st-martin.art.json).
 */

import { css, defineFestival } from "@/lib/festivals/kit";
import ART from "./st-martin.art.json";

const L = ART.rig.lantern;

export default defineFestival({
  id: "st-martin",
  // The lanterns glow along the bottom: night blue from the top, amber from below.
  wash: { light: ["224 55% 32%", "34 92% 48%"], dark: ["224 60% 52%", "36 95% 58%"] },
  visitor: {
    archetype: "walk",
    parts: ART.parts,
    size: { per: "height", px: 1800, min: 0.38, max: 0.6 },
    members: ["lantern-sun", "lantern-moon", "lantern-star", "lantern-sun"],
    gap: [170, 40],
    tail: 120,
    // Clear of the navigation bar, the lantern's own height and a little air,
    // a little higher or lower each pass.
    lift: { art: 200, px: [10, 40] },
    period: L.walk_period,
    lag: 0.23,
    // Each step bobs the stick; the lantern swings behind it like a pendulum, further in the wind.
    bob: { amp: L.bob * 2, hop: true },
    swing: { amp: L.swing, lag: L.damping_lag, wind: 0.35 },
    // The stick, from where the lantern hangs down and back to the child's hand.
    stick: { color: "#8A6236", width: 4, to: [70, 190] },
    extent: { left: 90, right: 90, top: 20, bottom: 220 },
    tap: { at: [0.5, 0.4] },
  },
  // Three paper lanterns hanging from each card's bottom edge, into the gap
  // below; alternate cards hang them on the other side. -29px for a 28px
  // drawing: the offset counts from inside the card's 1px border, and a
  // full-bleed card's picture reaches that line (festivals-ui).
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::after {
      content: "";
      position: absolute;
      z-index: 2;
      bottom: -29px;
      right: 22px;
      width: 90px;
      height: 28px;
      background: ${s.art("lanterns-hanging")} center top / contain no-repeat;
      pointer-events: none;
    }
    ${s.cards}:nth-child(even)::after {
      right: auto;
      left: 22px;
    }
  `,
  outfit: [],
  // The wash and the hanging lanterns all day; the walk from dusk.
  stage: (at) => (at.visitorReady ? "dusk" : "day"),
  stages: ["day", "dusk"],
});
