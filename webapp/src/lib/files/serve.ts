import { NextResponse, type NextRequest } from "next/server";
import { filesRoot, openObject, type Bucket } from "@/lib/files/store";

/**
 * The response for one stored object: 200 with the file, 304 when the
 * browser's copy is current, 404 when there is nothing there.
 *
 * Uploaded files are served from our own origin, so they are kept from ever
 * acting as a page: `nosniff` holds the browser to the declared type, and the
 * sandboxing CSP neuters anything that is opened directly anyway.
 */
export async function serveObject(
  request: NextRequest,
  bucket: Bucket,
  key: string,
  cacheControl: string,
): Promise<NextResponse> {
  const root = filesRoot();
  if (!root) return NextResponse.json({ error: "storage is not configured" }, { status: 503 });

  const object = await openObject(bucket, key, root);
  if (!object) return NextResponse.json({ error: "not found" }, { status: 404 });

  const etag = `W/"${object.stats.size.toString(16)}-${Math.floor(object.stats.mtimeMs).toString(16)}"`;
  const headers = new Headers({
    "Content-Type": object.contentType,
    "Cache-Control": cacheControl,
    ETag: etag,
    "Last-Modified": object.stats.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  });

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  headers.set("Content-Length", String(object.stats.size));
  if (request.method === "HEAD") return new NextResponse(null, { status: 200, headers });
  return new NextResponse(object.body(), { status: 200, headers });
}
