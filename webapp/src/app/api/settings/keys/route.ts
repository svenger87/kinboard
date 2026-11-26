import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import {
  apiKeysStatus,
  clearFamilyKey,
  generatePresenceToken,
  setFamilyKey,
} from "@/lib/api-keys";
import {
  API_KEY_FIELDS,
  API_KEY_VALUE,
  PRESENCE_TOKEN_MIN_LENGTH,
  isApiKeyName,
  type ApiKeysStatus,
} from "@/lib/api-key-status";

export const dynamic = "force-dynamic";

/**
 * The install keys a family sets in Settings (RFC-023 §4.4): the
 * OpenWeatherMap key, the Google OAuth client and the presence sensor's token.
 *
 *   GET                       → { keys }: per key, where the value in force
 *                               comes from and a masked hint. Never a value.
 *   PUT    { key, values }    → store the family's own value (behind the PIN)
 *   DELETE { key }            → remove it; the server's environment applies again
 *   POST   { key: "presence_sensor", action: "generate" }
 *                             → a new random token, stored, and returned this
 *                               once so it can be given to the sensor
 *
 * The family is always the session's: nothing here reads a family id from the
 * request, so one family can neither see nor change another's keys. Changing
 * a key needs the settings unlock, as every other stored credential does
 * (lib/settings-pin.ts); with no PIN set, the family is unlocked.
 */

async function status(familyId: string) {
  return NextResponse.json({ keys: await apiKeysStatus(familyId) });
}

/**
 * The status after a change that has already been stored. A failure to read
 * it back must not turn the stored change into an error ("store_failed"
 * would be a lie), nor lose a generated token that is shown only now: the
 * answer is then `keys: null`, and the screen reads the status again.
 */
async function statusAfterWrite(familyId: string): Promise<ApiKeysStatus | null> {
  try {
    return await apiKeysStatus(familyId);
  } catch (err) {
    console.error("settings/keys: stored, but the status could not be read back:", err);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    return await status(auth.session.familyId);
  } catch (err) {
    console.error("settings/keys GET:", err);
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
}

async function body(request: NextRequest): Promise<Record<string, unknown> | null> {
  const parsed = await request.json().catch(() => null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const input = await body(request);
  if (!input || !isApiKeyName(input.key)) return NextResponse.json({ error: "bad_key" }, { status: 400 });
  const name = input.key;
  const supplied = input.values;
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) {
    return NextResponse.json({ error: "bad_values" }, { status: 400 });
  }
  const values: string[] = [];
  for (const field of API_KEY_FIELDS[name]) {
    const raw = (supplied as Record<string, unknown>)[field];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!API_KEY_VALUE.test(value)) return NextResponse.json({ error: "bad_value", field }, { status: 400 });
    if (name === "presence_sensor" && value.length < PRESENCE_TOKEN_MIN_LENGTH) {
      return NextResponse.json({ error: "token_too_short", field }, { status: 400 });
    }
    values.push(value);
  }

  try {
    await setFamilyKey(auth.session.familyId, name, values);
  } catch (err) {
    console.error("settings/keys PUT:", err);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  return NextResponse.json({ keys: await statusAfterWrite(auth.session.familyId) });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const input = await body(request);
  if (!input || !isApiKeyName(input.key)) return NextResponse.json({ error: "bad_key" }, { status: 400 });

  try {
    await clearFamilyKey(auth.session.familyId, input.key);
  } catch (err) {
    console.error("settings/keys DELETE:", err);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  return NextResponse.json({ keys: await statusAfterWrite(auth.session.familyId) });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const input = await body(request);
  if (!input || input.key !== "presence_sensor" || input.action !== "generate") {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }

  const token = generatePresenceToken();
  try {
    await setFamilyKey(auth.session.familyId, "presence_sensor", [token]);
  } catch (err) {
    console.error("settings/keys POST:", err);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  // The one time the value leaves the server: the sensor needs it, and the
  // PIN guarded the request. Not cached anywhere on the way, and returned
  // even if the status can't be read back, or the family would be left with
  // a token nobody has seen.
  const keys = await statusAfterWrite(auth.session.familyId);
  return NextResponse.json({ keys, token }, { headers: { "Cache-Control": "no-store" } });
}
