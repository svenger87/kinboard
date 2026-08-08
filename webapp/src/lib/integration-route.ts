/**
 * The wired-up entry point for Integration API routes.
 *
 * `requireIntegrationAuth` in lib/integration-auth.ts takes its lookup as a
 * parameter so the rules can be tested without a database. This is where that
 * parameter gets filled in with the real one, plus the last-used heartbeat, so
 * a route never has to remember either.
 *
 * A route is then three lines and cannot get the auth wrong:
 *
 *   export async function GET(request: NextRequest) {
 *     return withIntegrationAuth(request, "family:read", async (ctx) => {
 *       return NextResponse.json({ ... });
 *     });
 *   }
 *
 * That shape is the point. RFC-001 §4 asks for one shared function because
 * per-route checks drift — and a check that a route has to *remember to call*
 * is one a route can forget. Here the handler only runs if authorisation
 * already succeeded, so forgetting is not expressible.
 */

import type { NextRequest, NextResponse } from "next/server";
import {
  requireIntegrationAuth,
  type IntegrationContext,
  type IntegrationScope,
} from "@/lib/integration-auth";
import { findTokenByHash, touchToken } from "@/lib/integration-store";

export async function withIntegrationAuth(
  request: NextRequest,
  scope: IntegrationScope,
  handler: (context: IntegrationContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  let matched: Awaited<ReturnType<typeof findTokenByHash>> = null;

  const auth = await requireIntegrationAuth(request, scope, async (hash) => {
    matched = await findTokenByHash(hash);
    return matched;
  });

  if (!auth.ok) return auth.response;

  // After authorisation, not before: a rejected token should leave no trace
  // that it was presented, and a failed write here must never fail the
  // request. touchToken is fire-and-forget and rate-limited to hourly.
  if (matched) void touchToken(matched);

  return handler(auth.context);
}
