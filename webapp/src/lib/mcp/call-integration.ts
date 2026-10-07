import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

/**
 * Tools call the Integration API route handlers directly, with the caller's
 * own bearer token. That is the point of the design (RFC-010 §3.6): scope
 * checks, family scoping, rate limits and idempotency stay in exactly one
 * place. It is not token passthrough — the token never leaves this server.
 */
/**
 * `params` is typed `any` rather than `Record<string, string>` here: with
 * `strictFunctionTypes` on, a concrete route's narrower params type (e.g.
 * `Promise<{ list: string }>`) is not assignable to a `Record<string,
 * string>`-typed parameter contravariantly, even though every route handler
 * this calls only ever reads the one key it declares. `any` opts that one
 * position out of variance checking without touching the zod schemas that
 * actually validate anything.
 */
export type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<any> },
) => Promise<Response>;

export interface CallOptions {
  origin: string;
  path: string;
  token: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
  /**
   * Send an Idempotency-Key with a PATCH too: for a route that requires one
   * because repeating its edit is not harmless (PATCH /recipes/{id} hands out
   * new ingredient ids each time).
   */
  idempotent?: boolean;
}

export class IntegrationCallError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "IntegrationCallError";
  }
}

export async function callIntegration(handler: RouteHandler, opts: CallOptions): Promise<unknown> {
  const url = new URL(`/api/integration/v1${opts.path}`, opts.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers = new Headers({ authorization: `Bearer ${opts.token}`, accept: "application/json" });
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  // Idempotency-Key is a POST concern (lib/integration-idempotency.ts): it
  // dedupes a *create* retried with the same arguments. PATCH and DELETE are
  // not wired into that store, and replaying an edit or delete is not "the
  // same create happened twice" — it is a second edit or delete. The one
  // exception asks for it with `idempotent`.
  if (method === "POST" || opts.idempotent) {
    headers.set("idempotency-key", randomUUID());
  }
  const response = await handler(
    new NextRequest(url, { method, headers, body }),
    { params: Promise.resolve(opts.params ?? {}) },
  );
  const data = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
  if (!response.ok) {
    throw new IntegrationCallError(
      failureMessage(response, typeof data?.error === "string" ? data.error : null),
      response.status,
      typeof data?.code === "string" ? data.code : undefined,
    );
  }
  return data;
}

/** A status with no words from the route, in words the model can act on. */
const STATUS_WORDS: Record<number, string> = {
  400: "the request was not accepted",
  401: "the connection to Kinboard is no longer signed in; reconnecting the assistant fixes it",
  403: "this connection is not allowed to do that",
  404: "not found in this family's Kinboard",
  409: "it conflicts with the current state in Kinboard",
  429: "too many requests",
};

/**
 * The text a tool's caller sees for a refused or failed call. The route's
 * own `error` is the core of it: written for an external reader, and the
 * only text specific enough to act on ("recurring tasks can't be reopened").
 * Around it: how long to wait when the route said (a rate limit), and for a
 * 5xx that the fault was Kinboard's, so the model does not rewrite valid
 * arguments chasing an error that was never about them. Without a route
 * message the status is put into words, never left as a bare number — the
 * connector directories reject a generic "Internal Server Error" or "Bad
 * Request" with no detail.
 */
function failureMessage(response: Response, routeError: string | null): string {
  const { status } = response;
  const parts: string[] = [];
  if (routeError) parts.push(routeError);
  else if (status >= 500) parts.push(`Kinboard could not complete the request (HTTP ${status})`);
  else parts.push(`Kinboard refused the request (HTTP ${status}): ${STATUS_WORDS[status] ?? "the request was not accepted"}`);
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    parts.push(`Try again in ${Math.ceil(retryAfter)} seconds.`);
  } else if (status >= 500) {
    parts.push("This was a problem on Kinboard's side, not with the request; trying again in a moment may work.");
  }
  return parts.map((p, i) => (i < parts.length - 1 && !/[.!?]$/.test(p) ? `${p}.` : p)).join(" ");
}
