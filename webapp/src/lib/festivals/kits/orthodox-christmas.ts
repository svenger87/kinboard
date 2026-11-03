/**
 * Orthodox Christmas (RFC-020 §3.3): 7 January, Christmas Day by the Julian
 * calendar (RS, MD, BY). Christmas itself, a fortnight later: the sleigh
 * flies, snow rests on the cards, the creatures wear the Santa hat, and the
 * wash is red over pine green. All of it borrowed, not copied: the sleigh's
 * parts and the snow cap are Christmas's own files (public/festivals/christmas/),
 * the hat Christmas's own item.
 */

import { defineFestival } from "@/lib/festivals/kit";
import christmas from "./christmas";

export default defineFestival({
  id: "orthodox-christmas",
  draft: true,
  art: "christmas",
  wash: christmas.wash,
  visitor: christmas.visitor && { ...christmas.visitor, art: "christmas" },
  dressing: christmas.dressing,
  outfit: christmas.outfit,
});
