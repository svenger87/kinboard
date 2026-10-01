import { NextRequest, NextResponse } from "next/server";
import { clientIp, hitLimit } from "@/lib/rate-limit";
import { publicOrigin } from "@/lib/oauth/origin";
import { resolveClient } from "@/lib/oauth/clients";
import { validateAuthorizeQuery } from "@/lib/oauth/authorize";
import { createOAuthStore } from "@/lib/oauth/store";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

function page(status: number, message: string) {
  const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Kinboard</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>Kinboard</h1><p>${safe}</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/**
 * The OAuth authorization endpoint. Anonymous: it validates, stores a pending
 * request for ten minutes and hands the browser to the consent page, where a
 * joined device and the PIN decide. Nothing here grants anything.
 */
export async function GET(request: NextRequest) {
  if (hitLimit(`oauth-authorize:${clientIp(request)}`, 30, 60_000).limited) return page(429, "Too many attempts. Try again in a minute.");
  const origin = publicOrigin(request.headers, request.nextUrl.origin);
  const q = request.nextUrl.searchParams;
  const clientId = q.get("client_id");
  const client = clientId ? await resolveClient(clientId).catch(() => null) : null;
  const check = validateAuthorizeQuery(q, origin, client);
  if (check.kind === "page") return page(check.status, check.message);
  if (check.kind === "redirect") return NextResponse.redirect(check.location, 302);
  try {
    const id = await createOAuthStore().createAuthRequest(check.request);
    return NextResponse.redirect(`${origin}/oauth/consent/${id}`, 302);
  } catch (err) {
    await logApiError("oauth/authorize", err);
    return page(500, "Kinboard could not start the connection. Try again.");
  }
}
