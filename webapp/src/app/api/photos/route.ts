import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { signedObjectUrl } from "@/lib/files/signed";

export const dynamic = "force-dynamic";

const BUCKET = "family-photos" as const;

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

  // Signed here, by the server, for an hour: the bucket is private, and the
  // page loads these as plain <img> sources (lib/files/signed.ts).
  const sign = (path: string) => signedObjectUrl(BUCKET, path, SIGNED_URL_TTL_SECONDS);
  const urlByPath = new Map<string, string>();
  for (const row of rows) {
    urlByPath.set(row.storage_path, sign(row.storage_path));
    if (row.thumbnail_path) urlByPath.set(row.thumbnail_path, sign(row.thumbnail_path));
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
