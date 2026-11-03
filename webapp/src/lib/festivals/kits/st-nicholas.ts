/**
 * St Nicholas (Nikolaus, RFC-020 §3.3): 5 and 6 December. No visitor. On the
 * evening of the 5th an empty boot stands on the Tasks card's top edge, in
 * the corner; on the morning of the 6th it's filled with an orange, nuts and
 * chocolate. The creatures wear the shop's scarf; the wash is red and gold.
 *
 * Art: webapp/scripts/festival-art/st-nicholas.py (public/festivals/st-nicholas/).
 */

import { css, defineFestival } from "@/lib/festivals/kit";

export default defineFestival({
  id: "st-nicholas",
  wash: { light: ["355 70% 46%", "42 85% 46%"], dark: ["355 72% 58%", "44 90% 58%"] },
  visitor: null,
  dressing: (s) => css`
    ${s.tasks} {
      position: relative;
    }
    ${s.tasks}::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: -38px;
      right: 18px;
      width: 40px;
      height: 45px;
      background: ${s.art("boot-filled")} center top / contain no-repeat;
      pointer-events: none;
    }
    ${s.tasksAt("eve")}::after {
      background-image: ${s.art("boot-empty")};
    }
  `,
  outfit: [{ slot: "neck", item: "scarf" }],
  // The boot is empty on the eve, filled on the morning.
  stage: (at) => (at.day === at.start ? "eve" : "day"),
  stages: ["eve", "day"],
  // A preview shows the morning's filled boot.
  previewStage: "day",
});
