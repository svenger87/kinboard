import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { isInstallOperator } from "@/lib/install-operator";
import { familyHasPin, verifySettingsPin } from "@/lib/settings-pin";
import { currentConfig, readStatus, runBackup, writeStoredConfig } from "@/lib/scheduled-backup/runner";
import { backupDataDir, listBackupFiles, resolveBackupDir } from "@/lib/scheduled-backup/store";
import { issueTicket, scheduledBackupRequest } from "@/lib/scheduled-backup/request";

export const dynamic = "force-dynamic";

/**
 * The all-in-one image's scheduled backups, for Settings → Data & safety.
 *
 * GET → { scheduledBackup: ScheduledBackupStatus | null }: the schedule (and
 * whether the server sets it), where the backups go, the last one, the last
 * error, the next run. Null on a compose install (no KINBOARD_AIO) and for
 * every family but the install's operator: the backups are the install's.
 *
 * POST { action: "save", config, pin } | { action: "run", pin } |
 * { action: "download", pin }: the install's operator, with the settings PIN
 * typed then and there (lib/scheduled-backup/request.ts has the gates).
 * "download" answers a one-time link to the newest backup, which
 * ./download/route.ts serves to the same family's session.
 */

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  if (!backupDataDir()) return NextResponse.json({ scheduledBackup: null });
  try {
    if (!(await isInstallOperator(auth.session.familyId))) return NextResponse.json({ scheduledBackup: null });
    return NextResponse.json({ scheduledBackup: await readStatus() });
  } catch (err) {
    console.error("scheduled-backup: read failed:", err);
    return NextResponse.json({ scheduledBackup: null });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  try {
    const result = await scheduledBackupRequest(
      { familyId: auth.session.familyId, deviceId: auth.session.deviceId, body },
      {
        isAio: () => backupDataDir() !== null,
        isOperator: (familyId) => isInstallOperator(familyId),
        hasPin: (familyId) => familyHasPin(familyId),
        verifyPin: (familyId, pin) => verifySettingsPin(familyId, pin),
        config: () => currentConfig(),
        save: (cfg) => writeStoredConfig(JSON.stringify(cfg)),
        runNow: async () => {
          const data = backupDataDir();
          const location = resolveBackupDir();
          if (!data || !location) return "unavailable";
          const cfg = await currentConfig();
          const run = runBackup("manual", { data, location, keep: cfg.keep, slot: null });
          // The first moment tells "busy" apart; the rest runs on, and Settings polls.
          const first = await Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), 250))]);
          return first?.status === "busy" ? "busy" : "started";
        },
        issueDownload: async (familyId) => {
          const location = resolveBackupDir();
          if (!location) return null;
          const newest = (await listBackupFiles(location.dir))[0];
          if (!newest) return null;
          const token = issueTicket(familyId, location.dir, newest.name);
          return { url: `/api/scheduled-backup/download?token=${token}`, file: newest.name };
        },
        log: (line) => console.info(`[scheduled-backup] ${line}`),
      },
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("scheduled-backup: request failed:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
