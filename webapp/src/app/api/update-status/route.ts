import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import {
  UPDATE_RETRY_KEY,
  UPDATE_STATUS_KEY,
  dismissUpdateStatus,
  parseUpdateStatus,
} from "@/lib/update-status";

export const dynamic = "force-dynamic";

/**
 * What the last automatic update did (RFC-023 §4.11.4), for Settings.
 *
 * The record belongs to the install, not to a family: kinboard-self-update.sh
 * writes it into instance_settings, which the browser roles cannot read, so it
 * is read here with the service role. Any signed-in screen may see it; it
 * names versions, a backup's folder on the host and a log excerpt.
 *
 * POST { action: "dismiss" } hides the notice; { action: "retry" } asks the
 * self-update to try a version it held back after a rollback (its next run or
 * tick picks that up and removes it). Both need the settings PIN, like every
 * other parent's setting.
 */

async function readKey(key: string): Promise<string | null> {
  const { data, error } = await (createAdminClient() as any)
    .from("instance_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.value === "string" ? data.value : null;
}

async function writeKey(key: string, value: string): Promise<void> {
  const { error } = await (createAdminClient() as any)
    .from("instance_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const [raw, retry] = await Promise.all([readKey(UPDATE_STATUS_KEY), readKey(UPDATE_RETRY_KEY)]);
    return NextResponse.json({ status: raw ? parseUpdateStatus(raw, retry ?? "") : null });
  } catch (err) {
    console.error("update-status: read failed:", err);
    return NextResponse.json({ status: null });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  let action: unknown;
  try {
    action = ((await request.json()) as { action?: unknown })?.action;
  } catch {
    action = undefined;
  }

  try {
    if (action === "dismiss") {
      const raw = await readKey(UPDATE_STATUS_KEY);
      if (!raw) return NextResponse.json({ ok: true });
      const next = dismissUpdateStatus(raw, new Date());
      if (next) await writeKey(UPDATE_STATUS_KEY, next);
      return NextResponse.json({ ok: true });
    }
    if (action === "retry") {
      await writeKey(UPDATE_RETRY_KEY, new Date().toISOString());
      return NextResponse.json({ ok: true });
    }
  } catch (err) {
    console.error("update-status: write failed:", err);
    return NextResponse.json({ error: "could not save" }, { status: 500 });
  }
  return NextResponse.json({ error: "action must be dismiss or retry" }, { status: 400 });
}
