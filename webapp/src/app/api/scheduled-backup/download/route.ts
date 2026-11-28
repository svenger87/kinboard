import { constants as fsc } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { isInstallOperator } from "@/lib/install-operator";
import { redeemTicket } from "@/lib/scheduled-backup/request";
import { BACKUP_NAME, backupDataDir } from "@/lib/scheduled-backup/store";

export const dynamic = "force-dynamic";

/**
 * GET ?token=… → the newest scheduled backup, as a file download. The token
 * is the one POST /api/scheduled-backup { action: "download", pin } handed
 * out: for this family's session only, within two minutes, once. The family
 * must still be the install's operator. The file is opened without following
 * a link and must be a plain file with a backup's name.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  if (!backupDataDir()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ticket = redeemTicket(request.nextUrl.searchParams.get("token"), auth.session.familyId);
  if (!ticket || !BACKUP_NAME.test(ticket.file)) return NextResponse.json({ error: "link_expired" }, { status: 404 });
  try {
    if (!(await isInstallOperator(auth.session.familyId))) return NextResponse.json({ error: "not_operator" }, { status: 403 });
    const fh = await open(join(ticket.dir, ticket.file), fsc.O_RDONLY | fsc.O_NOFOLLOW);
    const st = await fh.stat();
    if (!st.isFile()) {
      await fh.close();
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const stream = Readable.toWeb(fh.createReadStream()) as unknown as ReadableStream<Uint8Array>;
    console.info(`[scheduled-backup] ${ticket.file} downloaded by family ${auth.session.familyId}, device ${auth.session.deviceId ?? "unknown"}`);
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(st.size),
        "Content-Disposition": `attachment; filename="${ticket.file}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("scheduled-backup: download failed:", err);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
