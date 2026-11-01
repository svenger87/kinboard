import { NextRequest, NextResponse } from "next/server";
import {
  carriesServiceRole,
  downstreamResponseHeaders,
  postgrestUrl,
  upstreamRequestHeaders,
} from "@/lib/rest-proxy";

export const dynamic = "force-dynamic";

/**
 * /rest/v1/* → PostgREST. The browser's direct database path, on the page's
 * own origin; see lib/rest-proxy.ts for what this replaced and why it refuses
 * the service_role key.
 *
 * Authorisation is PostgREST's and the database's: the family-scoped token in
 * Authorization is verified there and read by the row-level-security policies.
 * This route only forwards.
 */
async function forward(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (carriesServiceRole(request.headers)) {
    return NextResponse.json(
      { error: "service_role is not accepted from the public endpoint" },
      { status: 403 },
    );
  }

  const direct = postgrestUrl();
  const base = direct ?? legacyBase();
  if (!base) return NextResponse.json({ error: "the database API is not configured" }, { status: 503 });
  const headers = upstreamRequestHeaders(request.headers);
  if (!direct) headers.set("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");

  const { path } = await params;
  const target = `${base}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // Required by Node's fetch to stream a request body.
      ...(hasBody ? { duplex: "half" } : {}),
      redirect: "manual",
      cache: "no-store",
    } as RequestInit);
  } catch {
    return NextResponse.json({ error: "the database API is unreachable" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: downstreamResponseHeaders(upstream.headers),
  });
}

/**
 * A compose file from before 1.15 sets SUPABASE_URL (Kong) and no
 * POSTGREST_URL. Kong's PostgREST routes sit under /rest/v1 and want the anon
 * key, so that is where this goes, with the key, until the compose file is
 * updated.
 */
function legacyBase(): string | null {
  const kong = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  return kong ? `${kong}/rest/v1` : null;
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
