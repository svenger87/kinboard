import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { checkPhotoUpload } from "@/lib/photo-upload-rules";

export const dynamic = "force-dynamic";

const BUCKET = "family-photos";

/** Long edge of the stored thumbnail. Enough for a grid cell on a 4K panel. */
const THUMBNAIL_EDGE = 640;

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/**
 * EXIF DateTimeOriginal, which is "YYYY:MM:DD HH:MM:SS" — not something
 * `new Date()` parses. Returned as an ISO string, or null when the camera
 * said nothing or said something unusable.
 */
function exifTakenAt(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Upload one photo into the family's library. RFC-009 §3.3.
 *
 * The only way into the `family-photos` bucket: it has no client-facing write
 * policy, for the reasons migration_zzzz_storage_write_policies.sql records at
 * length. This route holds `createAdminClient()` (service_role, bypasses RLS)
 * and is therefore the thing that has to check the session and the family.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const file = formData.get("photo") as File | null;
  const familyId = formData.get("family_id") as string | null;

  if (!file) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (!familyId) return NextResponse.json({ error: "family_id_required" }, { status: 400 });
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Same gate the browser applies before spending a minute on the upload, so
  // the two cannot drift. HEIC comes back with its own reason, because for an
  // iPhone household it is not an edge case but every photo they own.
  const check = checkPhotoUpload({ type: file.type, size: file.size });
  if (!check.ok) {
    return NextResponse.json({ error: check.reason, detail: check }, { status: 415 });
  }

  const input = Buffer.from(await file.arrayBuffer());

  let normalised: Buffer;
  let thumbnail: Buffer;
  let width: number | null = null;
  let height: number | null = null;
  let takenAt: string | null = null;

  try {
    const source = sharp(input, { failOn: "error" });
    const metadata = await source.metadata();

    // `.rotate()` with no argument applies the EXIF orientation flag and drops
    // it, so the stored pixels are upright. This is done before measuring: a
    // photo whose EXIF says "rotate 90" is 4032x3024 on disk and 3024x4032 on
    // screen, and storing the wrong one of those would make every orientation
    // decision in RFC-009 §3.4 wrong for exactly the photos it exists for.
    normalised = await sharp(input, { failOn: "error" }).rotate().toBuffer();

    const rotated = await sharp(normalised).metadata();
    width = rotated.width ?? null;
    height = rotated.height ?? null;

    thumbnail = await sharp(normalised)
      .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    takenAt = exifTakenAt(
      (metadata as { exif?: Buffer }).exif
        ? // sharp exposes raw EXIF as a Buffer; the tag is plain ASCII inside it.
          Buffer.from((metadata as unknown as { exif: Buffer }).exif)
            .toString("latin1")
            .match(/\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/)?.[0]
        : undefined,
    );
  } catch (err) {
    console.error("[photos/upload] decode failed:", err);
    return NextResponse.json({ error: "undecodable" }, { status: 415 });
  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `${familyId}/${stamp}.${EXTENSION[file.type] ?? "jpg"}`;
  const thumbnailPath = `${familyId}/${stamp}-thumb.webp`;

  const supabase = createAdminClient();

  const original = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, normalised, { contentType: file.type, upsert: false });
  if (original.error) {
    console.error("[photos/upload] storage error:", original.error);
    return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  }

  const thumb = await supabase.storage
    .from(BUCKET)
    .upload(thumbnailPath, thumbnail, { contentType: "image/webp", upsert: false });
  // A missing thumbnail is a degraded photo, not a failed upload — the row
  // falls back to the original. Storing the row anyway beats discarding a
  // photo somebody already waited for.
  const storedThumbnail = thumb.error ? null : thumbnailPath;
  if (thumb.error) console.error("[photos/upload] thumbnail failed:", thumb.error);

  const { data: row, error } = await (supabase as never as {
    from: (t: string) => {
      insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown; error: unknown }> } };
    };
  })
    .from("family_photos")
    .insert({
      family_id: familyId,
      storage_path: storagePath,
      thumbnail_path: storedThumbnail,
      mime_type: file.type,
      byte_size: normalised.byteLength,
      width,
      height,
      taken_at: takenAt,
    })
    .select("*")
    .single();

  if (error) {
    // Leave no orphan: the objects are useless without the row that names them.
    await supabase.storage.from(BUCKET).remove([storagePath, thumbnailPath]);
    console.error("[photos/upload] insert failed:", error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ photo: row });
}
