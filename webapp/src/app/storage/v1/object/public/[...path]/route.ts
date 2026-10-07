import { NextRequest, NextResponse } from "next/server";
import { serverSupabaseUrl } from "@/lib/supabase/api-base";

export const dynamic = "force-dynamic";

/**
 * GET /storage/v1/object/public/<bucket>/<path>
 *
 * Stored image URLs are relative (RFC-018 §4, lib/supabase/public-url.ts).
 * Where Kong is the front door, or a proxy sends /storage to it, Kong answers
 * this path and the request never gets here. It gets here when the webapp
 * itself answers the page — an install still on KINBOARD_ENTRY=webapp, or
 * `next dev` — and then the object is streamed from Kong over the internal
 * network, so the same stored path works in every layout.
 *
 * Public buckets only, which Kong serves without a key anyway; nothing here
 * can reach anything the browser could not already fetch from Kong.
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  // A bucket and an object, and nothing that could climb out of
  // /object/public/ once the URL is normalised.
  if (!path || path.length < 2 || path.some((p) => p === "" || p === "." || p === "..")) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let base: string;
  try {
    base = serverSupabaseUrl().replace(/\/+$/, "");
  } catch {
    return NextResponse.json({ error: "storage is not configured" }, { status: 503 });
  }
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
