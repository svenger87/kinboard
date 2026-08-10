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

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  requireIntegrationAuth,
  type IntegrationContext,
  type IntegrationScope,
} from "@/lib/integration-auth";
import { findTokenByHash, touchToken, TokenLookupUnavailable } from "@/lib/integration-store";
import { hitLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-error";

/**
 * Rate limits for the Integration API, per TOKEN.
 *
 * RFC-001 left per-token vs per-family open. Per family sounds friendlier —
 * one household, one budget — but it lets a single misbehaving automation
 * starve every other integration the family has: a runaway loop in Home
 * Assistant would lock the Bridge out, and the household would experience that
 * as "Kinboard is broken" with no way to tell which client caused it. Per
 * token, the noisy client throttles itself and everything else keeps working,
 * which is both fairer and far easier to diagnose — the token's name is right
 * there in Settings.
 *
 * Reads and writes get separate budgets. A polling client is *supposed* to
 * read on a schedule; Home Assistant asking for the summary every 30 seconds
 * is correct behaviour, and a limit treating that as suspicious is one nobody
 * can live within. An automation writing 120 times a minute is not working
 * correctly, whatever it believes it is doing.
 *
 * Uses the limiter the PIN, join and create endpoints already use rather than
 * a second one: process-local and best-effort, which is the right trade for a
 * single self-hosted container. A durable counter would mean a database write
 * on every request — precisely the load a limiter exists to prevent.
 */
export const READ_LIMIT = 120;
export const WRITE_LIMIT = 30;
export const RATE_WINDOW_MS = 60_000;

export async function withIntegrationAuth(
  request: NextRequest,
  scope: IntegrationScope,
  handler: (context: IntegrationContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  let matched: Awaited<ReturnType<typeof findTokenByHash>> = null;

  let auth: Awaited<ReturnType<typeof requireIntegrationAuth>>;
  try {
    auth = await requireIntegrationAuth(request, scope, async (hash) => {
      matched = await findTokenByHash(hash);
      return matched;
    });
  } catch (err) {
    if (err instanceof TokenLookupUnavailable) {
      // 503, never 401. A client told 401 is entitled to conclude its
      // credential is wrong and stop using it — Home Assistant does exactly
      // that, and a few seconds of database unavailability during a restart
      // disabled the integration until somebody re-entered a token that had
      // been valid the whole time.
      return apiError("could not verify the token — try again", "unavailable", {
        headers: { "retry-after": "5" },
      });
    }
    throw err;
  }

  if (!auth.ok) return auth.response;

  // Counted AFTER authorisation, so an unauthenticated caller cannot consume a
  // real token's budget — that would turn the limiter into a way to deny the
  // household its own integrations.
  const isRead = request.method === "GET";
  const { limited, retryAfterMs } = hitLimit(
    `integration:${auth.context.tokenId}:${isRead ? "read" : "write"}`,
    isRead ? READ_LIMIT : WRITE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (limited) {
    return apiError("too many requests — slow down", "rate_limited", {
      // At least 1: a Retry-After of 0 invites the immediate retry being
      // throttled.
      headers: { "retry-after": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
    });
  }

  // After authorisation, not before: a rejected token should leave no trace
  // that it was presented, and a failed write here must never fail the
  // request. touchToken is fire-and-forget and rate-limited to hourly.
  if (matched) void touchToken(matched);

  return handler(auth.context);
}
