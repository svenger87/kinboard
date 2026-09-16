import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { toBrowserStorageUrl } from "@/lib/supabase/signed-url";

export const dynamic = "force-dynamic";

const BUCKET = "family-photos";

/**
 * How long a signed photo URL lives.
 *
 * One hour: long enough that a screensaver cycling a library does not
 * re-sign every few minutes, short enough that a URL which leaks out of a
 * browser history or a shared screenshot stops working the same afternoon.
 * That trade is the whole reason the bucket is private (RFC-009 §3.1).
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

interface PhotoRow {
  id: string;
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  uploaded_at: string;
}

/** The family's uploaded library, newest first, with signed URLs attached. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const familyId = params.get("family_id");
  const limit = Math.min(Number(params.get("limit") ?? 200) || 200, 500);

  if (!familyId) return NextResponse.json({ error: "family_id_required" }, { status: 400 });
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();

   
  const { data, error } = await (supabase as any)
    .from("family_photos")
    .select("*")
    .eq("family_id", familyId)
    // Capture date where the camera gave one, upload order otherwise — the
    // same ordering the index is built for.
    .order("taken_at", { ascending: false, nullsFirst: false })
    .order("uploaded_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[photos] list failed:", error);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  const rows = (data ?? []) as PhotoRow[];
  if (rows.length === 0) return NextResponse.json({ photos: [], totalBytes: 0 });

  // One round trip for every URL rather than one per photo: a library of 200
  // would otherwise be 400 separate signing calls before the page could paint.
  const paths = rows.map((r) => r.storage_path);
  const thumbPaths = rows.map((r) => r.thumbnail_path).filter((p): p is string => !!p);

  const [signed, signedThumbs] = await Promise.all([
    supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS),
    thumbPaths.length
      ? supabase.storage.from(BUCKET).createSignedUrls(thumbPaths, SIGNED_URL_TTL_SECONDS)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (signed.error) {
    console.error("[photos] signing failed:", signed.error);
    return NextResponse.json({ error: "sign_failed" }, { status: 500 });
  }

  const urlByPath = new Map<string, string>();
  for (const entry of [...(signed.data ?? []), ...(signedThumbs.data ?? [])]) {
    // The path comes back on the internal kong origin; swap it for the one
    // the browser can actually reach. See lib/supabase/signed-url.ts.
    if (entry.path && entry.signedUrl) {
      urlByPath.set(entry.path, toBrowserStorageUrl(entry.signedUrl));
    }
  }

  const photos = rows.map((row) => ({
    id: row.id,
    url: urlByPath.get(row.storage_path) ?? null,
    // Falls back to the original when the thumbnail failed to store — a
    // heavier image beats a broken one.
    thumbnailUrl:
      (row.thumbnail_path ? urlByPath.get(row.thumbnail_path) : null) ??
      urlByPath.get(row.storage_path) ??
      null,
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    uploadedAt: row.uploaded_at,
    byteSize: row.byte_size,
  }));

  return NextResponse.json({
    photos,
    // RFC-009 §5: the library is unbounded and lands on the self-hoster's
    // disk. No quota is imposed, but they are told what it costs.
    totalBytes: rows.reduce((sum, r) => sum + Number(r.byte_size ?? 0), 0),
  });
}
