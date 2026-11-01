import { NextRequest, NextResponse } from "next/server";
import { filesRoot, isPublicBucket } from "@/lib/files/store";
import { serveObject } from "@/lib/files/serve";

export const dynamic = "force-dynamic";

/**
 * GET /storage/v1/object/public/<bucket>/<path>
 *
 * Every stored image URL is this relative path (RFC-018 §4,
 * lib/supabase/public-url.ts), and since 1.15 the webapp answers it from the
 * files on disk (lib/files/store.ts). Public buckets only; family photos go
 * through the signed route next door.
 *
 * Keys carry a timestamp and a random suffix and are never rewritten, so a
 * browser may keep a copy for a day without ever showing a stale image.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const bucket = path?.[0] ?? "";
  if (!path || path.length < 2 || !isPublicBucket(bucket)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!filesRoot()) return legacyStorage(request, path);
  return serveObject(request, bucket, path.slice(1).join("/"), "public, max-age=86400");
}

export const HEAD = GET;

/*
 * An install whose compose file predates 1.15 (a Watchtower update moves the
 * image and nothing else) has no FILES_DIR and still runs the storage-api
 * container. Its images are streamed from there, through Kong's internal
 * address, exactly as before, so nothing breaks until the compose file is
 * updated — at which point the entrypoint moves the files across.
 */

// Forwarded both ways: conditional requests and ranges for the browser's
// cache and for video, the metadata an <img> needs back.
const REQUEST_HEADERS = ["range", "if-none-match", "if-modified-since"];
const RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
];

async function legacyStorage(request: NextRequest, path: string[]): Promise<NextResponse> {
  // Nothing that could climb out of /object/public/ once the URL is normalised.
  if (path.some((p) => p === "" || p === "." || p === "..")) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const base = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return NextResponse.json({ error: "storage is not configured" }, { status: 503 });
  const upstream = `${base}/storage/v1/object/public/${path.map(encodeURIComponent).join("/")}`;

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(upstream, { headers, cache: "no-store", redirect: "manual" });
  } catch {
    return NextResponse.json({ error: "storage unreachable" }, { status: 502 });
  }

  const out = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  return new NextResponse(response.body, { status: response.status, headers: out });
}
