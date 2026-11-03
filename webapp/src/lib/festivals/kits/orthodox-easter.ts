/**
 * Orthodox Easter (RFC-020 §3.3): the Orthodox Easter week. Easter's kit,
 * shared rather than copied: the same two bunnies hop along the bottom, the
 * same bunting hangs on the cards and the creatures wear the same bunny
 * ears, but the eggs are dyed red, as they are for Orthodox Easter, both in
 * the nest at the cards' corner and the ones a tap drops. The wash is
 * Easter's, spring green over yellow.
 *
 * Art: Easter's (webapp/scripts/festival-art/easter.py draws the red eggs
 * too; public/festivals/easter/).
 */

import { defineFestival } from "@/lib/festivals/kit";
import { BUNNIES, BUNNY_EARS, EASTER_WASH, easterDressing } from "./easter";

export default defineFestival({
  id: "orthodox-easter",
  wash: EASTER_WASH,
  visitor: { ...BUNNIES, art: "easter", tap: { drops: ["egg-red", "egg-red", "egg-red"], at: [0.6, 0.75] } },
  dressing: (s) => easterDressing(s, (name) => `url("/festivals/easter/${name}.svg")`, "eggs-corner-red"),
  // Easter's ears under a name of their own: a festival's own item belongs to one kit.
  outfit: [{ slot: "head", item: "bunny_ears_orthodox", draw: BUNNY_EARS }],
});
