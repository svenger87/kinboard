import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import {
  UPDATE_OPERATOR_KEY,
  UPDATE_RETRY_KEY,
  UPDATE_RETRY_LAST_KEY,
  UPDATE_STATUS_KEY,
  decideOperator,
  dismissUpdateStatus,
  parseUpdateStatus,
  retryAllowed,
  withoutDetails,
} from "@/lib/update-status";

export const dynamic = "force-dynamic";

/**
 * What the last automatic update did (RFC-023 §4.11.4), for Settings.
 *
 * The record belongs to the install, not to a family: kinboard-self-update.sh
 * writes it into instance_settings, which the browser roles cannot read, so it
 * is read here with the service role. It names versions, the backup folder on
 * the host and a log excerpt, and "Try again" acts on the whole install, so
 * both are for the install's operator only (decideOperator: the family named
 * by INSTANCE_ADMIN_FAMILY_ID, or the household's one family, recorded the
 * first time it asks). Any other family gets `status: null`, the same as an
 * install with no record, and a 403 on POST. The operator's devices see the
 * log excerpt and the paths only with the settings unlocked, as every other
 * parent's setting.
 *
 * POST { action: "dismiss" } hides the notice; { action: "retry" } asks the
 * self-update to try a version it held back after a rollback (its next run or
 * tick picks that up and removes it), at most once per 10 minutes per
 * install. Both also need the settings PIN.
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

async function readKeyWithTime(key: string): Promise<{ value: string; updatedAt: string } | null> {
  const { data, error } = await (createAdminClient() as any)
    .from("instance_settings")
    .select("value, updated_at")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.value === "string" ? { value: data.value, updatedAt: String(data.updated_at) } : null;
}

async function writeKey(key: string, value: string): Promise<void> {
  const { error } = await (createAdminClient() as any)
    .from("instance_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

async function operator(familyId: string): Promise<boolean> {
  const db = createAdminClient() as any;
  const { count, error } = await db.from("families").select("id", { head: true, count: "exact" });
  if (error) throw new Error(error.message);
  let recorded = await readKey(UPDATE_OPERATOR_KEY);
  if (recorded) {
    const { data, error: famError } = await db.from("families").select("id").eq("id", recorded).maybeSingle();
    if (famError) throw new Error(famError.message);
    if (!data) recorded = null; // that family was deleted
  }
  const decision = decideOperator(familyId, {
    familyCount: count ?? 0,
    recorded,
    env: {
      INSTANCE_ADMIN_FAMILY_ID: process.env.INSTANCE_ADMIN_FAMILY_ID,
      KINBOARD_DEMO_FAMILY_CODE: process.env.KINBOARD_DEMO_FAMILY_CODE,
    },
  });
  if (decision.record) await writeKey(UPDATE_OPERATOR_KEY, familyId);
  return decision.operator;
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    if (!(await operator(auth.session.familyId))) return NextResponse.json({ status: null });
    const [raw, retry] = await Promise.all([readKey(UPDATE_STATUS_KEY), readKey(UPDATE_RETRY_KEY)]);
    const status = raw ? parseUpdateStatus(raw, retry ? "pending" : "") : null;
    if (!status) return NextResponse.json({ status: null });
    // The log excerpt and the host paths only with the settings unlocked.
    const locked = await requireSettingsUnlock(auth.session);
    return NextResponse.json({ status: locked ? withoutDetails(status) : status, details: !locked });
  } catch (err) {
    console.error("update-status: read failed:", err);
    return NextResponse.json({ status: null });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    if (!(await operator(auth.session.familyId))) {
      return NextResponse.json({ error: "only the install's operator can do this" }, { status: 403 });
    }
  } catch (err) {
    console.error("update-status: operator check failed:", err);
    return NextResponse.json({ error: "could not check" }, { status: 500 });
  }
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
      const current = await readKeyWithTime(UPDATE_STATUS_KEY);
      if (!current) return NextResponse.json({ ok: true });
      const next = dismissUpdateStatus(current.value, new Date());
      if (next) {
        // Only the record that was read: a rollback recorded in between stays shown.
        const { error } = await (createAdminClient() as any)
          .from("instance_settings")
          .update({ value: next })
          .eq("key", UPDATE_STATUS_KEY)
          .eq("updated_at", current.updatedAt);
        if (error) throw new Error(error.message);
      }
      return NextResponse.json({ ok: true });
    }
    if (action === "retry") {
      const now = new Date();
      if (!retryAllowed(await readKey(UPDATE_RETRY_LAST_KEY), now)) {
        return NextResponse.json({ error: "retry_too_soon" }, { status: 429 });
      }
      const who = `family ${auth.session.familyId}, device ${auth.session.deviceId ?? "unknown"}`;
      // The self-update logs this value when it takes the request.
      await writeKey(UPDATE_RETRY_KEY, `${now.toISOString()} by ${who}`);
      await writeKey(UPDATE_RETRY_LAST_KEY, now.toISOString());
      console.info(`update-status: "Try again now" by ${who}`);
      return NextResponse.json({ ok: true });
    }
  } catch (err) {
    console.error("update-status: write failed:", err);
    return NextResponse.json({ error: "could not save" }, { status: 500 });
  }
  return NextResponse.json({ error: "action must be dismiss or retry" }, { status: 400 });
}
