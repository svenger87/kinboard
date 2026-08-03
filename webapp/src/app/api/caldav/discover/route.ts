import { NextRequest, NextResponse } from "next/server";
import {
  discoverCaldavCalendars,
  CaldavAuthError,
  type DiscoveredCaldavCalendar,
} from "@/lib/caldav-client";
import { getCaldavCredentials } from "@/lib/caldav-credentials";

// tsdav reaches for Node's http/https stack through its fetch shim, and
// discovery is inherently per-request — same constraints as the ICS routes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Probe a CalDAV server and list the calendars its principal can see.
 *
 * Backs the "Connect" step of /settings/caldav: the user types a server
 * URL and credentials, we walk current-user-principal → calendar-home-set
 * and hand back the collections so they can pick which ones to add.
 *
 * The credentials in the request body are used for this one round-trip
 * and deliberately not persisted — they're only stored once the user
 * actually adds a calendar (POST /api/caldav/calendars). The one
 * exception is re-discovery for an existing calendar: passing
 * `calendar_id` instead of a password reuses the stored one, so the
 * settings UI can refresh a calendar list without asking the user to
 * retype a 30-character app password.
 *
 * Auth model: family_id in the body, matching every other family-scoped
 * POST in this app (see /api/calendar/sync-ics for the rationale — RLS is
 * off and the device-cookie + join-code pairing is the real boundary).
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const familyId = typeof body.family_id === "string" ? body.family_id : "";
  const serverUrl = typeof body.server_url === "string" ? body.server_url.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  let password = typeof body.password === "string" ? body.password : "";

  if (!familyId) {
    return NextResponse.json(
      { ok: false, error: "family_id is required" },
      { status: 400 },
    );
  }
  if (!serverUrl || !username) {
    return NextResponse.json(
      { ok: false, error: "server_url and username are required" },
      { status: 400 },
    );
  }

  // Re-discovery path: no password in the body, but a calendar we already
  // hold credentials for.
  if (!password && typeof body.calendar_id === "string" && body.calendar_id) {
    const stored = await getCaldavCredentials(familyId, body.calendar_id);
    if (stored) password = stored.password;
  }

  if (!password) {
    return NextResponse.json(
      { ok: false, error: "password is required" },
      { status: 400 },
    );
  }

  let calendars: DiscoveredCaldavCalendar[];
  try {
    calendars = await discoverCaldavCalendars({ serverUrl, username, password });
  } catch (err) {
    const message = describeDiscoveryError(err);
    // Logged without the server URL's userinfo or any credential material.
    console.warn(`[caldav-discover] Discovery failed: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }

  return NextResponse.json({ ok: true, calendars });
}

/**
 * Turn a transport failure into something a person can act on. tsdav
 * surfaces raw fetch errors, and "fetch failed" in a toast tells a user
 * nothing about whether they typed the host wrong or the password wrong.
 */
function describeDiscoveryError(err: unknown): string {
  if (err instanceof CaldavAuthError) return err.message;

  const raw = err instanceof Error ? err.message : String(err);

  if (/401|unauthor/i.test(raw)) {
    return "Authentication failed — check the username and password";
  }
  if (/404/.test(raw)) {
    return "No CalDAV service at that URL — try the server root, e.g. https://cloud.example.com/remote.php/dav";
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return "Server not found — check the hostname";
  }
  if (/ECONNREFUSED/i.test(raw)) {
    return "Connection refused — check the port and that the server is running";
  }
  if (/certificate|self.signed|SSL|TLS/i.test(raw)) {
    return "TLS certificate rejected — a self-signed certificate needs to be trusted by the Kinboard container";
  }
  if (/abort|timeout/i.test(raw)) {
    return "Timed out while contacting the server";
  }
  return raw;
}
