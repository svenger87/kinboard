import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { isInstallOperator } from "@/lib/install-operator";
import { deleteInstanceKey, readInstanceKey, writeInstanceKey } from "@/lib/instance-settings";
import { forgetInstanceConfig } from "@/lib/instance-config";
import { isVapidConfigured } from "@/lib/push-sender";
import { aioDataDir } from "@/lib/aio-old-database";
import {
  INSTANCE_FIRST_RUN_KEY,
  INSTANCE_SITE_URL_KEY,
  INSTANCE_VAPID_SUBJECT_KEY,
  firstRunFamily,
  firstRunRecord,
  normaliseSiteUrl,
  normaliseVapidSubject,
  resolveInstanceValue,
  subjectForDisplay,
} from "@/lib/first-run";

export const dynamic = "force-dynamic";

/**
 * The install's own settings from the first-run sequence (RFC-024 §8): the
 * address calendar links are built from (SITE_URL's replacement) and the
 * contact push services are given (VAPID_SUBJECT's). Both belong to the
 * install, so only its operator sees or changes them — the rule #547 set
 * for the update notice (lib/install-operator.ts): INSTANCE_ADMIN_FAMILY_ID,
 * or the household's first and only family. Every other family gets
 * `{ operator: false }` and a 403, and its wizard has no install steps.
 *
 *   GET                                   → where each value comes from, and
 *                                           whether the install's steps are due
 *   PUT  { site_url?, vapid_subject? }    → save; "" or null removes. Behind
 *                                           the settings PIN, as every setting.
 *   POST { action: "done" }               → the install's steps were seen
 *
 * The environment still wins: a value saved here is only used while the
 * variable is unset, and the answer says which applies.
 */

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    if (!(await isInstallOperator(auth.session.familyId))) return NextResponse.json({ operator: false });
    const [site, subject, done] = await Promise.all([
      readInstanceKey(INSTANCE_SITE_URL_KEY),
      readInstanceKey(INSTANCE_VAPID_SUBJECT_KEY),
      readInstanceKey(INSTANCE_FIRST_RUN_KEY),
    ]);
    const siteUrl = resolveInstanceValue(process.env.SITE_URL, site);
    const vapid = resolveInstanceValue(process.env.VAPID_SUBJECT, subject);
    return NextResponse.json({
      operator: true,
      firstRunDone: !!done,
      firstRunMine: !!done && firstRunFamily(done) === auth.session.familyId,
      siteUrl,
      pushContact: { value: vapid.value ? subjectForDisplay(vapid.value) : null, source: vapid.source },
      pushReady: isVapidConfigured(),
      // The all-in-one image (KINBOARD_AIO=1): its data is the folder mapped
      // to /data, not a compose install's DATA_DIR.
      aio: aioDataDir() !== null,
    });
  } catch (err) {
    console.error("setup/instance GET:", err);
    // Not the operator's steps on an error: a wizard that cannot tell goes
    // straight to the family's steps, which is what an existing install sees.
    return NextResponse.json({ operator: false, error: "read_failed" }, { status: 500 });
  }
}

async function gate(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return { response: auth.response };
  try {
    if (!(await isInstallOperator(auth.session.familyId))) {
      return { response: NextResponse.json({ error: "only the install's operator can do this" }, { status: 403 }) };
    }
  } catch (err) {
    console.error("setup/instance: operator check failed:", err);
    return { response: NextResponse.json({ error: "could not check" }, { status: 500 }) };
  }
  return { session: auth.session };
}

export async function PUT(request: NextRequest) {
  const g = await gate(request);
  if (!g.session) return g.response;
  const locked = await requireSettingsUnlock(g.session);
  if (locked) return locked;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const writes: Array<() => Promise<void>> = [];
  for (const [field, key, normalise] of [
    ["site_url", INSTANCE_SITE_URL_KEY, normaliseSiteUrl],
    ["vapid_subject", INSTANCE_VAPID_SUBJECT_KEY, normaliseVapidSubject],
  ] as const) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      writes.push(() => deleteInstanceKey(key));
      continue;
    }
    const value = normalise(raw);
    if (!value) return NextResponse.json({ error: "bad_value", field }, { status: 400 });
    writes.push(() => writeInstanceKey(key, value));
  }
  if (writes.length === 0) return NextResponse.json({ error: "nothing_to_save" }, { status: 400 });

  try {
    for (const w of writes) await w();
  } catch (err) {
    console.error("setup/instance PUT:", err);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  } finally {
    forgetInstanceConfig();
  }
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const g = await gate(request);
  if (!g.session) return g.response;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "done") return NextResponse.json({ error: "action must be done" }, { status: 400 });
  try {
    if (!(await readInstanceKey(INSTANCE_FIRST_RUN_KEY))) {
      await writeInstanceKey(INSTANCE_FIRST_RUN_KEY, firstRunRecord(g.session.familyId, new Date()));
    }
  } catch (err) {
    console.error("setup/instance POST:", err);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
