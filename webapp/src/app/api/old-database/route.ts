import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { isInstallOperator } from "@/lib/install-operator";
import { familyHasPin, verifySettingsPin } from "@/lib/settings-pin";
import { aioDataDir, deleteOldDatabase, readOldDatabaseStatus } from "@/lib/aio-old-database";
import { deleteOldDatabaseRequest } from "@/lib/aio-old-database-request";

export const dynamic = "force-dynamic";

/**
 * The database folder a PostgreSQL major upgrade kept in the all-in-one image
 * (RFC-024 §4.3 step 4, §4.7), for the notice in Settings.
 *
 * GET → { oldDatabase: OldDatabaseStatus | null }. Null on a compose install
 * (no KINBOARD_AIO), with no folder to talk about, and for every family but
 * the install's operator: the folder belongs to the install.
 *
 * POST { pin } deletes it: the install's operator, with the settings PIN
 * typed then and there, outside the rollback window and with no upgrade in
 * progress. lib/aio-old-database-request.ts has the gates,
 * lib/aio-old-database.ts what is checked before anything is removed. A
 * compose install answers 404.
 */

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  if (!aioDataDir()) return NextResponse.json({ oldDatabase: null });
  try {
    if (!(await isInstallOperator(auth.session.familyId))) return NextResponse.json({ oldDatabase: null });
    return NextResponse.json({ oldDatabase: await readOldDatabaseStatus() });
  } catch (err) {
    console.error("old-database: read failed:", err);
    return NextResponse.json({ oldDatabase: null });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  try {
    const result = await deleteOldDatabaseRequest(
      { familyId: auth.session.familyId, deviceId: auth.session.deviceId, body },
      {
        isAio: () => aioDataDir() !== null,
        isOperator: (familyId) => isInstallOperator(familyId),
        hasPin: (familyId) => familyHasPin(familyId),
        verifyPin: (familyId, pin) => verifySettingsPin(familyId, pin),
        remove: () => deleteOldDatabase(),
        log: (line) => console.info(line),
      },
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("old-database: delete failed:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
