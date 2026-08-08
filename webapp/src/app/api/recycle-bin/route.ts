import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import {
  RECYCLABLE,
  isRecyclable,
  type DeletedRow,
  type RecyclableTable,
} from "@/lib/recycle-bin";

/**
 * The recycle bin.
 *
 * These rows are deliberately invisible to the browser: the RLS policy on every
 * recyclable table carries `deleted_at IS NULL`, which is what makes the bin
 * work without touching the seventeen files that read through PostgREST. So the
 * bin has to be served here, with the service role, which bypasses RLS. That
 * also means this route *is* the family boundary — nothing below it re-checks.
 */

/** Resolve the ids of the rows in this family, for tables scoped one hop away. */
async function idsInFamily(
  supabase: ReturnType<typeof createAdminClient>,
  scope: string,
  familyId: string,
): Promise<string[] | null> {
  const [fk, parent] = scope.split(":");
  if (!parent) return null; // direct family_id, no lookup needed
  const { data, error } = await (supabase as never as {
    from: (t: string) => {
      select: (c: string) => { eq: (a: string, b: string) => Promise<{ data: { id: string }[] | null; error: unknown }> };
    };
  })
    .from(parent)
    .select("id")
    .eq("family_id", familyId);
  if (error || !data) return [];
  void fk;
  return data.map((r) => r.id);
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const familyId = familyIdFrom(request, {});
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const items: DeletedRow[] = [];

  for (const [table, cfg] of Object.entries(RECYCLABLE)) {
    const cols = ["id", "deleted_at", cfg.title, cfg.subtitle].filter(Boolean).join(",");
     
    let q = (supabase as any).from(table).select(cols).not("deleted_at", "is", null);

    if (cfg.scope === "family_id") {
      q = q.eq("family_id", familyId);
    } else {
      const parentIds = await idsInFamily(supabase, cfg.scope, familyId);
      const fk = cfg.scope.split(":")[0];
      if (!parentIds || parentIds.length === 0) continue;
      q = q.in(fk, parentIds);
    }

    const { data, error } = await q.order("deleted_at", { ascending: false }).limit(200);
    if (error || !data) continue;

    for (const row of data as Record<string, unknown>[]) {
      const raw = row[cfg.title];
      items.push({
        table: table as RecyclableTable,
        id: String(row.id),
        // A note's body can be long; the bin only needs enough to recognise it.
        title: raw == null || raw === "" ? "—" : String(raw).slice(0, 120),
        subtitle: cfg.subtitle && row[cfg.subtitle] != null ? String(row[cfg.subtitle]).slice(0, 120) : null,
        deleted_at: String(row.deleted_at),
      });
    }
  }

  items.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  return NextResponse.json({ items });
}

/** Restore (deleted_at = null) or purge (delete for real). */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as {
    family_id?: string;
    table?: string;
    id?: string;
    action?: "restore" | "purge";
  };

  const familyId = familyIdFrom(request, body);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { table, id, action = "restore" } = body;
  if (!table || !isRecyclable(table)) {
    return NextResponse.json({ error: "unknown table" }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const cfg = RECYCLABLE[table];

  // The service role bypasses RLS, so ownership is checked here or nowhere.
   
  const owner = (supabase as any).from(table).select("id").eq("id", id);
  if (cfg.scope === "family_id") {
    owner.eq("family_id", familyId);
  } else {
    const parentIds = await idsInFamily(supabase, cfg.scope, familyId);
    const fk = cfg.scope.split(":")[0];
    if (!parentIds || parentIds.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    owner.in(fk, parentIds);
  }
  const { data: found } = await owner.maybeSingle();
  if (!found) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (action === "restore") {
     
    const { error } = await (supabase as any).from(table).update({ deleted_at: null }).eq("id", id);
    if (error) {
      return NextResponse.json({ error: "restore failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action: "restore" });
  }

  // Purge, through the database function rather than a plain delete.
  //
  // A plain delete would get through — the trigger steps aside for a row that is
  // already in the bin — but its ON DELETE CASCADEs would not: each cascaded
  // child hits its own trigger with deleted_at still NULL, gets soft-deleted
  // instead of removed, and is left pointing at a parent that no longer exists.
  // Postgres does not re-check the constraint after a cascade is suppressed, so
  // nothing complains. purge_deleted() sets kinboard.hard_delete for the whole
  // transaction, which is the only way every trigger stands down at once.

  const { error } = await (supabase as any).rpc("purge_deleted", { p_table: table, p_id: id });
  if (error) {
    return NextResponse.json({ error: "purge failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: "purge" });
}
