import type { NextRequest } from "next/server";
import { PATCH as forward } from "@/app/api/rewards/redemptions/[id]/route";

export const dynamic = "force-dynamic";

/*
 * REMOVE in the release after RFC-017 step 1. A thin forward, kept for one
 * release so a screen still running the previous bundle (a wall display that
 * has not reloaded since the upgrade) keeps working. The route it forwards to
 * does every check: the session, the settings PIN, the family.
 */

/** PATCH /api/pocket-money/redemptions/[id] -> PATCH /api/rewards/redemptions/[id]. */
export function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return forward(request, ctx);
}
