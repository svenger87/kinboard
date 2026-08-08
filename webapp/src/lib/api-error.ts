/**
 * The API error contract.
 *
 * Phase 0 of the 2026 plan asks for an API error format and correlation IDs.
 * The point is diagnosis: today a user reports "it said something went wrong",
 * and there is nothing tying that sentence to a line in the container log. A
 * correlation ID printed next to the message and attached to every log line for
 * that request closes the gap.
 *
 * **Additive on purpose.** `{ error: "..." }` is the established shape — 302
 * responses use it and client code reads `.error` in 165 places. Changing it
 * would be a large, risky edit across the app for no user benefit, so `error`
 * keeps its exact meaning and `code` / `correlationId` are added beside it.
 * Every existing caller keeps working untouched.
 *
 *   {
 *     "error": "not authenticated",   // unchanged: human-readable
 *     "code": "not_authenticated",    // new: stable, machine-readable
 *     "correlationId": "k7f3c1a8b2e4f1" // new: matches the log line
 *   }
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { CORRELATION_HEADER, newCorrelationId } from "@/lib/correlation";

export { CORRELATION_HEADER } from "@/lib/correlation";

/**
 * Stable machine-readable codes. Clients — including the Home Assistant
 * integration and later the Bridge — branch on these, so they are API: add
 * freely, never repurpose. The human `error` string may be reworded at any
 * time; the code may not.
 */
export type ApiErrorCode =
  | "not_authenticated"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal_error";

const STATUS_FOR: Record<ApiErrorCode, number> = {
  not_authenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  rate_limited: 429,
  upstream_unavailable: 502,
  internal_error: 500,
};

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  correlationId: string;
}

/**
 * The current request's correlation ID.
 *
 * proxy.ts sets this header on every inbound request, so in normal
 * operation it is always present. The fallback covers the paths the proxy
 * does not run on — notably cron jobs and server-side calls made outside a
 * request — where an ID is still better than a blank field, because it at
 * least groups the log lines of one operation.
 */
export async function correlationId(): Promise<string> {
  try {
    const h = await headers();
    return h.get(CORRELATION_HEADER) ?? newCorrelationId();
  } catch {
    // headers() throws outside a request scope (scripts, some server actions).
    return newCorrelationId();
  }
}


/**
 * Build an error response carrying the contract above.
 *
 * The correlation ID goes in the body *and* the response header: the body is
 * what a user can read off the screen and quote, the header is what a proxy or
 * an automated client can log without parsing JSON.
 */
export async function apiError(
  message: string,
  code: ApiErrorCode = "internal_error",
  init?: { status?: number; headers?: HeadersInit },
): Promise<NextResponse<ApiErrorBody>> {
  const id = await correlationId();
  return NextResponse.json(
    { error: message, code, correlationId: id },
    {
      status: init?.status ?? STATUS_FOR[code],
      headers: { ...init?.headers, [CORRELATION_HEADER]: id },
    },
  );
}

/**
 * Log an error against the current request.
 *
 * Prefixed so the ID can be grepped straight out of `docker logs`, which is
 * how a self-hoster will actually use this:
 *
 *   docker logs kinboard-webapp 2>&1 | grep k7f3c1a8b2e4
 *
 * The message is logged, never the payload — request bodies here contain
 * family data.
 */
export async function logApiError(
  scope: string,
  err: unknown,
  id?: string,
): Promise<string> {
  const cid = id ?? (await correlationId());
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[${cid}] ${scope}: ${detail}`);
  return cid;
}
