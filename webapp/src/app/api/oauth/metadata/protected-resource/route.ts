import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/oauth/origin";
import { protectedResourceMetadata } from "@/lib/oauth/metadata";

export const dynamic = "force-dynamic";

/** Served at /.well-known/oauth-protected-resource[/api/mcp] by next.config rewrites. */
export function GET(request: NextRequest) {
  const origin = publicOrigin(request.headers, request.nextUrl.origin);
  return NextResponse.json(protectedResourceMetadata(origin), {
    headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
