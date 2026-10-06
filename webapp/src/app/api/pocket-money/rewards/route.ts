import type { NextRequest } from "next/server";
import { POST as forward } from "@/app/api/rewards/route";

export const dynamic = "force-dynamic";

/*
 * REMOVE in the release after RFC-017 step 1. A thin forward, kept for one
 * release so a screen still running the previous bundle (a wall display that
 * has not reloaded since the upgrade) keeps working. The route it forwards to
 * does every check: the session, the settings PIN, the family.
 */

/** POST /api/pocket-money/rewards -> POST /api/rewards. */
export function POST(request: NextRequest) {
  return forward(request);
}
