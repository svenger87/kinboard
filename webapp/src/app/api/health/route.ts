import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Same tiny reader as api/version-check/route.ts — duplicated rather than
// shared so this route has zero dependency surface beyond fs/path.
async function readCurrentVersion(): Promise<string> {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const DB_PROBE_TIMEOUT_MS = 3000;

// Cheap, bounded liveness probe: a head/count select (no rows returned)
// against `families`, raced against a timeout so a hung DB connection
// fails fast instead of hanging the healthcheck (and, transitively, the
// container's healthy/unhealthy signal) indefinitely.
async function probeDb(): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const query = supabase
      .from("families")
      .select("id", { head: true, count: "exact" });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("db probe timeout")), DB_PROBE_TIMEOUT_MS);
    });
    const { error } = await Promise.race([query, timeout]);
    return !error;
  } catch {
    return false;
  }
}

// GET /api/health — unauthenticated liveness probe for the Docker
// healthcheck. No family/user data in the response: {status, version, db}
// only.
//
// NOTE: this route intentionally breaks the project's "always return 200,
// degrade gracefully" API convention. A container healthcheck needs a
// real failure signal to trigger orchestration behavior (Docker marking
// the container unhealthy, restart policies, etc.) — a 200 with
// `db: false` buried in the body wouldn't do that. This is the one
// documented exception; see CLAUDE.md.
export async function GET() {
  const [version, dbOk] = await Promise.all([readCurrentVersion(), probeDb()]);

  if (!dbOk) {
    return NextResponse.json(
      { status: "degraded", version, db: false },
      { status: 503 }
    );
  }

  return NextResponse.json({ status: "ok", version, db: true });
}
