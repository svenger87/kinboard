/**
 * Mother's Day (RFC-020 §3.3): the family's country's day. Flowers bloom up
 * from the bottom of the screen -- roses, tulips, carnations and daisies --
 * each opening from nothing as it rises and swaying as it goes; a tap on
 * the biggest drops a shower of stars. No dressing: the day is the flowers.
 * The creatures wear the shop's flower crown.
 *
 * The RFC leaves the wash to the family; until there is a setting for it,
 * the default is the flowers' own: rose from the top over leaf green,
 * gentle, at the month's strengths like every wash.
 *
 * Art: webapp/scripts/festival-art/mothers-day.py (public/festivals/mothers-day/,
 * ./mothers-day.art.json); Father's Day borrows it.
 */

import { defineFestival } from "@/lib/festivals/kit";
import type { RiseSpec } from "@/lib/festivals/visitors/types";
import ART from "./mothers-day.art.json";

/** Flowers blooming up from the bottom, from this festival's drawings: Mother's Day's and Father's Day's. */
export function blooming(sprites: string[]): RiseSpec {
  return {
    archetype: "rise",
    parts: Object.fromEntries(sprites.map((name) => [name, ART.parts[name as keyof typeof ART.parts]])),
    // A flower 90 units wide: 56px on a 1080p wall, before its own scale.
    size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
    sprites,
    count: 18,
    speed: [55, 95],
    sway: 18,
    scale: [0.8, 1.15],
    spin: [-0.15, 0.15],
    bloom: true,
    ceiling: 0.08,
    duration: 11_000,
    tap: {},
  };
}

export default defineFestival({
  id: "mothers-day",
  wash: { light: ["340 62% 50%", "105 40% 40%"], dark: ["340 70% 66%", "105 38% 52%"] },
  visitor: blooming(["rose", "tulip", "carnation", "daisy"]),
  dressing: null,
  outfit: [{ slot: "head", item: "flower_crown" }],
});
