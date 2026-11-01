import { NextRequest, NextResponse } from "next/server";
import { isBucket } from "@/lib/files/store";
import { serveObject } from "@/lib/files/serve";
import { verifySignedObject } from "@/lib/files/signed";

export const dynamic = "force-dynamic";

/**
 * GET /storage/v1/object/sign/<bucket>/<key>?exp=…&sig=…
 *
 * A private object (family photos) for whoever holds a URL that
 * lib/files/signed.ts issued and that has not expired. No session is needed —
 * a screensaver page loads these as plain <img> sources — which is why the
 * URLs live an hour and no longer. A bad or stale signature is the same 404 as
 * a missing file, so the route says nothing about what exists.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const bucket = path?.[0] ?? "";
  if (!path || path.length < 2 || !isBucket(bucket)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const key = path.slice(1).join("/");
  const query = request.nextUrl.searchParams;
  if (!verifySignedObject(bucket, key, query.get("exp"), query.get("sig"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return serveObject(request, bucket, key, "private, max-age=3600");
}

export const HEAD = GET;
