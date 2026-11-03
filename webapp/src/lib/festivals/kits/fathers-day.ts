/**
 * Father's Day (RFC-020 §3.3): the family's country's day. Flowers bloom up
 * from the bottom of the screen -- sunflowers, cornflowers, daisies and
 * forget-me-nots -- each opening as it rises; a tap on the biggest drops a
 * shower of stars. No dressing. The creatures wear the shop's bow tie.
 *
 * The RFC leaves the wash to the family; until there is a setting for it,
 * the default is the flowers' own: cornflower blue from the top over
 * sunflower gold, gentle, at the month's strengths like every wash.
 *
 * Art: Mother's Day's (webapp/scripts/festival-art/mothers-day.py draws
 * these flowers too; public/festivals/mothers-day/).
 */

import { defineFestival } from "@/lib/festivals/kit";
import { blooming } from "./mothers-day";

export default defineFestival({
  id: "fathers-day",
  wash: { light: ["218 60% 44%", "44 88% 46%"], dark: ["218 65% 62%", "45 90% 58%"] },
  visitor: { ...blooming(["sunflower", "cornflower", "daisy", "forget-me-not"]), art: "mothers-day" },
  dressing: null,
  outfit: [{ slot: "neck", item: "bow_tie" }],
});
