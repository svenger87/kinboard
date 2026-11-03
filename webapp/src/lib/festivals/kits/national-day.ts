/**
 * A national day (RFC-020 §3.3): the family's country's own, from
 * NATIONAL_DAY in lib/festivals.ts (Mexico's from the eve, the night of the
 * Grito). Fireworks go up over the clock from dusk; bunting in the flag's
 * colours hangs along every card's top edge all day; the creatures wear the
 * shop's medal; the wash is the flag's colours.
 *
 * The stage is the flag's set of colours, from the family's country: flags
 * that share colours share a stage (France and the United States are both
 * red-white-blue), which keeps the stages to sixteen, not one a country.
 * Colour only: no emblems. A preview shows Germany's.
 *
 * The fireworks are one kit's colours for every country (the engine flies a
 * kit's one visitor, not one a stage): red, white, blue, gold and green
 * between them cover every flag here.
 *
 * Art: webapp/scripts/festival-art/national-day.py (public/festivals/national-day/).
 */

import { css, defineFestival, type Hsl, type Wash } from "@/lib/festivals/kit";

/** Each country with a national day (NATIONAL_DAY) and its flag's colours, a stage. */
const FLAG: Readonly<Record<string, string>> = {
  AD: "blue-yellow-red",
  AL: "red-black",
  AT: "red-white",
  BE: "black-red-gold",
  BG: "green-white-red",
  BR: "green-yellow-blue",
  BY: "red-green",
  CH: "red-white",
  CZ: "red-white-blue",
  DE: "black-red-gold",
  EE: "blue-black-white",
  ES: "red-gold",
  FR: "red-white-blue",
  HR: "red-white-blue",
  HU: "green-white-red",
  IT: "green-white-red",
  LI: "blue-red",
  LT: "yellow-green-red",
  LU: "red-white-blue",
  LV: "red-white",
  MC: "red-white",
  MD: "blue-yellow-red",
  MT: "red-white",
  MX: "green-white-red",
  PL: "red-white",
  PT: "red-green",
  RO: "blue-yellow-red",
  RS: "red-white-blue",
  SE: "blue-yellow",
  SI: "red-white-blue",
  SK: "red-white-blue",
  SM: "white-blue",
  US: "red-white-blue",
  VA: "yellow-white",
  ZA: "green-gold-red-blue",
};

// The flags' colours as the wash takes them, light theme and dark.
const RED: [Hsl, Hsl] = ["355 70% 46%", "355 72% 60%"];
const BLUE: [Hsl, Hsl] = ["220 62% 38%", "220 65% 60%"];
const GREEN: [Hsl, Hsl] = ["145 55% 32%", "145 48% 48%"];
const GOLD: [Hsl, Hsl] = ["44 90% 46%", "45 92% 58%"];
const SKY: [Hsl, Hsl] = ["205 70% 48%", "205 72% 64%"];
const BLACK: [Hsl, Hsl] = ["240 8% 22%", "240 8% 52%"];
// White can't wash a white page: the light grey-gold of the bunting's white pennants, a little stronger.
const WHITE: [Hsl, Hsl] = ["40 18% 70%", "40 20% 82%"];
const wash = (top: [Hsl, Hsl], bottom: [Hsl, Hsl]): Wash => ({ light: [top[0], bottom[0]], dark: [top[1], bottom[1]] });

const WASH: Readonly<Record<string, Wash>> = {
  "red-white": wash(RED, WHITE),
  "red-white-blue": wash(BLUE, RED),
  "blue-yellow-red": wash(BLUE, RED),
  "green-white-red": wash(GREEN, RED),
  "black-red-gold": wash(RED, GOLD),
  "red-gold": wash(RED, GOLD),
  "blue-yellow": wash(BLUE, GOLD),
  "green-yellow-blue": wash(GREEN, GOLD),
  "yellow-green-red": wash(GOLD, RED),
  "red-green": wash(GREEN, RED),
  "blue-black-white": wash(SKY, BLACK),
  "red-black": wash(RED, BLACK),
  "blue-red": wash(BLUE, RED),
  "white-blue": wash(SKY, WHITE),
  "yellow-white": wash(GOLD, WHITE),
  "green-gold-red-blue": wash(GREEN, GOLD),
};
const STAGES = Object.keys(WASH);

export default defineFestival({
  id: "national-day",
  // Without a country (never by the date; only a stage-less preview): gold over blue.
  wash: wash(GOLD, BLUE),
  washByStage: WASH,
  visitor: {
    archetype: "fireworks",
    // Red, white, blue, gold, green.
    colors: ["#FF5A5A", "#FFFFFF", "#6FA8FF", "#FFD24A", "#6FE3A0"],
    shells: 6,
    sparks: 40,
    radius: 120,
    over: "clock",
    size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
    tap: {},
  },
  // Every piece lies in the grid's gap, outside the card, and ends on the
  // card's border line (offsets count from inside the 1px border, so a piece
  // h px tall sits at -(h + 1)px): a full-bleed card, a camera or a photo,
  // has content from its first pixel row to its last. In the gap means at
  // most 16px tall below 768px wide, where the gap is 16px, and 24px from
  // there, where it is 24px.
  // Bunting along each card's top edge, the pennants' tips on the line; one
  // tile a set of flag colours.
  dressing: (s) => css`
    ${s.cards} {
      position: relative;
    }
    ${s.cards}::before {
      content: "";
      position: absolute;
      z-index: 2;
      top: -17px;
      left: 6px;
      right: 6px;
      height: 16px;
      background: repeat-x 0 0 / 131px 16px;
      pointer-events: none;
    }
    ${s.cards}:nth-child(odd)::before {
      background-position: -33px 0;
    }
    @media (min-width: 768px) {
      ${s.cards}::before {
        top: -21px;
        height: 20px;
        background-size: 164px 20px;
      }
      ${s.cards}:nth-child(odd)::before {
        background-position: -41px 0;
      }
    }
    ${STAGES.map((stage) => `${s.cardsAt(stage)}::before { background-image: ${s.art(`bunting-${stage}`)}; }`).join("\n")}
  `,
  outfit: [{ slot: "neck", item: "medal" }],
  stage: (at) => (at.country ? (FLAG[at.country] ?? null) : null),
  stages: STAGES,
  previewStage: "black-red-gold",
});
