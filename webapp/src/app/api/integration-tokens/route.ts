import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import {
  INTEGRATION_SCOPES,
  generateIntegrationToken,
  isIntegrationScope,
} from "@/lib/integration-auth";

export const dynamic = "force-dynamic";

/**
 * Managing integration tokens from Settings.
 *
 * This is the browser-facing side, behind `requireSession` — a person at a
 * screen. It is deliberately NOT the Integration API: a machine token must not
 * be able to mint another machine token, or revocation would not be a way to
 * take access away.
 *
 * The table is REVOKEd from anon and authenticated, so this route reads it
 * with the service-role client. That is exactly why it exists rather than the
 * page querying PostgREST directly, as most of the app does.
 *
 * `token_hash` is never selected. There is nothing useful a browser could do
 * with it and every reason not to hand it out.
 */

interface TokenRow {
  id: string;
  name: string;
  scopes: string[] | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export async function GET(request: NextRequest) {
  const session = await requireSession(request);
  if (!session.ok) return session.response;

  const supabase = createAdminClient();

  const { data, error } = await (supabase as any)
    .from("integration_tokens")
    .select("id, name, scopes, created_at, last_used_at, expires_at, revoked_at")
    .eq("family_id", session.session.familyId)
    .order("created_at", { ascending: false });

  if (error) {
    await logApiError("integration-tokens/list", error);
    return NextResponse.json({ error: "Could not list tokens" }, { status: 500 });
  }

  return NextResponse.json({ tokens: (data ?? []) as TokenRow[], scopes: INTEGRATION_SCOPES });
}

/**
 * Create or revoke.
 *
 * Both live on POST rather than POST/DELETE because revocation is not a
 * deletion — the row stays, so the name and last_used_at remain available to
 * answer "what was this, and was it still in use?" after the fact.
 */
export async function POST(request: NextRequest) {
  const session = await requireSession(request);
  if (!session.ok) return session.response;

  const familyId = session.session.familyId;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (body.action === "revoke") {
    const id = typeof body.id === "string" ? body.id : null;
    if (!id) return NextResponse.json({ error: "`id` is required" }, { status: 400 });

    // Scoped by family as well as id: an id from another family must not be
    // revocable, and matching on both means a wrong id simply affects nothing.
    const { error } = await (supabase as any)
      .from("integration_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("family_id", familyId)
      .is("revoked_at", null);

    if (error) {
      await logApiError("integration-tokens/revoke", error);
      return NextResponse.json({ error: "Could not revoke the token" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // --- create ---

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) {
    return NextResponse.json({ error: "A name between 1 and 100 characters is required" }, { status: 400 });
  }

  const requested = Array.isArray(body.scopes) ? body.scopes : [];
  const scopes = requested.filter((s): s is string => typeof s === "string").filter(isIntegrationScope);
  if (scopes.length === 0) {
    return NextResponse.json({ error: "At least one scope is required" }, { status: 400 });
  }

  const { token, hash } = generateIntegrationToken();

  const { data, error } = await (supabase as any)
    .from("integration_tokens")
    .insert({ family_id: familyId, name, token_hash: hash, scopes })
    .select("id, name, scopes, created_at, last_used_at, expires_at, revoked_at")
    .single();

  if (error) {
    await logApiError("integration-tokens/create", error);
    return NextResponse.json({ error: "Could not create the token" }, { status: 500 });
  }

  // The only time the plaintext exists outside the caller's memory. It is not
  // stored, cannot be recovered, and is never returned again — losing it means
  // making a new one, which is the correct trade.
  return NextResponse.json({ token: data as TokenRow, secret: token }, { status: 201 });
}
