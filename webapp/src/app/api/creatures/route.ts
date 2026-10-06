import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { UUID } from "@/lib/home/action-requests";
import { isSpecies, startingStyle } from "@/lib/creatures/rules";
import { personInFamily } from "@/lib/creatures/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/creatures -- every creature of the session's family, switched on
 * or off (RFC-017). The screens read the table directly (family-scoped RLS,
 * live through realtime); this is the same list for a caller without a
 * database token.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await (createAdminClient() as any)
    .from("creatures")
    .select("*")
    .eq("family_id", auth.session.familyId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ creatures: data ?? [] });
}

/**
 * POST /api/creatures  body: { person_id, species? }
 *
 * Switches a child's creature on: a parent's choice, behind the settings PIN
 * (RFC-017 §2.1). A child who never had one gets a new creature -- the
 * species picked, or the dragon; growing with points; the shop on. A child
 * whose creature was switched off gets the same one back, at the same stage
 * and in the same look; a species sent along changes only the species.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const body = (await request.json().catch(() => null)) as { person_id?: unknown; species?: unknown } | null;
  const personId = body?.person_id;
  if (typeof personId !== "string" || !UUID.test(personId)) {
    return NextResponse.json({ error: "person_id required" }, { status: 400 });
  }
  if (body?.species !== undefined && !isSpecies(body.species)) {
    return NextResponse.json({ error: `unknown species: ${String(body.species)}` }, { status: 400 });
  }
  const species = body?.species as string | undefined;

  const familyId = auth.session.familyId;
  const db = createAdminClient() as any;
  const person = await personInFamily(db, familyId, personId);
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!person.is_child) return NextResponse.json({ error: "not_a_child" }, { status: 400 });

  const { data: existing, error: readErr } = await db
    .from("creatures")
    .select("person_id")
    .eq("person_id", personId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  if (existing) {
    const { data, error } = await db
      .from("creatures")
      .update({ enabled: true, ...(species ? { species } : {}) })
      .eq("person_id", personId)
      .eq("family_id", familyId)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ creature: data });
  }

  const chosen = species ?? "dragon";
  const { data, error } = await db
    .from("creatures")
    .insert({ person_id: personId, family_id: familyId, species: chosen, style: startingStyle(chosen) })
    .select()
    .single();
  if (error) {
    // Two screens switching the same child on at once: the other one won.
    if ((error as { code?: string }).code === "23505") return NextResponse.json({ error: "already_exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ creature: data }, { status: 201 });
}
