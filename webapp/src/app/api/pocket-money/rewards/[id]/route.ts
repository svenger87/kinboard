import type { NextRequest } from "next/server";
import { DELETE as forwardDelete, PATCH as forwardPatch } from "@/app/api/rewards/[id]/route";

export const dynamic = "force-dynamic";

/*
 * REMOVE in the release after RFC-017 step 1. A thin forward, kept for one
 * release so a screen still running the previous bundle (a wall display that
 * has not reloaded since the upgrade) keeps working. The route it forwards to
 * does every check: the session, the settings PIN, the family.
 */

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/pocket-money/rewards/[id] -> PATCH /api/rewards/[id]. */
export function PATCH(request: NextRequest, ctx: Ctx) {
  return forwardPatch(request, ctx);
}

/** DELETE /api/pocket-money/rewards/[id] -> DELETE /api/rewards/[id]. */
export function DELETE(request: NextRequest, ctx: Ctx) {
  return forwardDelete(request, ctx);
}
