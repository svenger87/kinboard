/**
 * The festivals' visitors (RFC-020 §2.1, §5.1), flown on a canvas by the
 * scene in components/weather-effects.tsx. No React here. A kit says which
 * archetype its visitor is and how it looks (./types.ts); this picks the
 * archetype's pass.
 */

import { arcPass } from "./arc";
import { fireworksPass } from "./fireworks";
import { flyPass } from "./fly";
import { particlePass } from "./particles";
import { walkPass } from "./walk";
import type { VisitorSprites } from "./sprites";
import type { Pass, PassEnv, VisitorSpec } from "./types";

export { PASS_EVERY_MS, PASS_MS, visitorScale } from "./motion";
export { prepareVisitorSprites, releaseVisitorSprites, type VisitorSprites } from "./sprites";
export type { Box, Light, Pass, PassEnv, VisitorSpec } from "./types";

/** One pass of `spec` across a screen (`env`), drawn from `sprites`. */
export function createPass(spec: VisitorSpec, sprites: VisitorSprites, env: PassEnv): Pass {
  switch (spec.archetype) {
    case "fly":
      return flyPass(spec, sprites, env);
    case "walk":
      return walkPass(spec, sprites, env);
    case "rise":
    case "drift":
    case "burst":
      return particlePass(spec, sprites, env);
    case "fireworks":
      return fireworksPass(spec, sprites, env);
    case "arc":
      return arcPass(spec, sprites, env);
  }
}
