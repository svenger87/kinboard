import { NextResponse } from "next/server";

// Minimal probe so the Google settings page can detect when the
// self-hoster hasn't filled in GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// yet — without exposing the actual values to the browser. Returns
// HTTP 200 either way (degrade-gracefully convention from CLAUDE.md).
export async function GET() {
  return NextResponse.json({
    configured: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    ),
  });
}
