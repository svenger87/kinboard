import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/oauth/origin";
import { assistantsGate } from "@/lib/oauth/enabled";
import { authorizationServerMetadata } from "@/lib/oauth/metadata";

export const dynamic = "force-dynamic";

/** Served at /.well-known/oauth-authorization-server by next.config rewrites. */
export async function GET(request: NextRequest) {
  // Absent until a family switches assistants on (lib/oauth/enabled.ts).
  const off = await assistantsGate();
  if (off) return off;
  const origin = publicOrigin(request.headers, request.nextUrl.origin);
  return NextResponse.json(authorizationServerMetadata(origin), {
    headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
