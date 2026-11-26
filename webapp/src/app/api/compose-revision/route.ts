import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { isInstallOperator } from "@/lib/install-operator";
import { composeRevisionStatus } from "@/lib/compose-revision";

export const dynamic = "force-dynamic";

/**
 * Whether the install's compose.yml is older than this image needs
 * (RFC-023 §4.6, §4.11.3), for the notice in Settings.
 *
 * The file is the install's, not a family's, so the answer is for the
 * install's operator only, by the same gate as the updater's status
 * (lib/install-operator.ts). Anyone else gets `{ revision: null }`, the same
 * as a git install, whose compose file declares no revision.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const status = composeRevisionStatus(process.env.KINBOARD_COMPOSE_REVISION);
  if (!status) return NextResponse.json({ revision: null });
  try {
    if (!(await isInstallOperator(auth.session.familyId))) return NextResponse.json({ revision: null });
  } catch (err) {
    console.error("compose-revision: operator check failed:", err);
    return NextResponse.json({ revision: null });
  }
  return NextResponse.json({ revision: status });
}
