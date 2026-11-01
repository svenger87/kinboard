import { NextRequest, NextResponse } from "next/server";
import { FilesNotConfiguredError, putObject } from "@/lib/files/store";
import { publicStorageUrl } from "@/lib/supabase/public-url";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// The uploaded file lands in a folder named after family_id, so an
// unauthenticated caller could write recipe photos into any family's
// storage prefix — and fill the disk of an instance they don't own.
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;
    const familyId = formData.get("family_id") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No image file provided" },
        { status: 400 }
      );
    }

    if (!familyId) {
      return NextResponse.json(
        { error: "Family ID is required" },
        { status: 400 }
      );
    }

    if (!familyMatchesSession(auth.session, familyId)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: JPEG, PNG, WebP" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB" },
        { status: 400 }
      );
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const extension = file.type.split("/")[1];
    const filename = `${familyId}/${timestamp}-${randomId}.${extension}`;

    try {
      await putObject("recipe-images", filename, new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      console.error("Storage upload error:", error);
      if (error instanceof FilesNotConfiguredError) {
        return NextResponse.json({ error: "Uploads need the storage volume (see UPGRADING.md)" }, { status: 503 });
      }
      return NextResponse.json(
        { error: "Failed to upload image" },
        { status: 500 }
      );
    }

    // Relative, like every stored URL: see lib/supabase/public-url.ts.
    return NextResponse.json({
      url: publicStorageUrl("recipe-images", filename),
      path: filename,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
