/**
 * Valentine's Day (RFC-020 §3.3): 14 February. Glossy hearts in rose, pink
 * and blush, and now and then a heart balloon on its string, float up from
 * the bottom, swaying, and fade out near the top; a tap on the big one
 * scatters little hearts and stars. No dressing: the hearts, the wash (rose
 * from the top, pink from below) and the shop's heart glasses are the whole
 * festival.
 *
 * Art: webapp/scripts/festival-art/valentines.py (public/festivals/valentines/,
 * ./valentines.art.json).
 */

import { defineFestival } from "@/lib/festivals/kit";
import ART from "./valentines.art.json";

export default defineFestival({
  id: "valentines",
  draft: true,
  wash: { light: ["348 72% 46%", "332 80% 62%"], dark: ["348 78% 60%", "332 85% 70%"] },
  visitor: {
    archetype: "rise",
    parts: ART.parts,
    // A heart 60-75 CSS px across at its largest on a 1080p wall, half that on a phone.
    size: { per: "width", px: 3100, min: 0.3, max: 0.62 },
    // Mostly hearts, a balloon in about one in seven.
    sprites: ["heart-rose", "heart-rose", "heart-pink", "heart-pink", "heart-blush", "heart-blush", "heart-balloon"],
    count: 22,
    speed: [70, 125],
    sway: 26,
    scale: [0.55, 1.15],
    spin: [-0.15, 0.15],
    // They fade out a little below the top, clear of the header.
    ceiling: 0.12,
    tap: { drops: ["heart-drop"] },
  },
  dressing: null,
  outfit: [{ slot: "face", item: "heart_glasses" }],
});
