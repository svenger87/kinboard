import { test, expect } from "@playwright/test";
import { hasServiceKey } from "./helpers/service-key";
import { NextRequest } from "next/server";
import { createAdminClient } from "../src/lib/supabase/server";
import { SESSION_COOKIE } from "../src/lib/session";
import { POST as createFamily } from "../src/app/api/session/create/route";
import { POST as pinRoute } from "../src/app/api/pin/route";
import { GET as instanceGet, PUT as instancePut, POST as instancePost } from "../src/app/api/setup/instance/route";
import { GET as stateGet } from "../src/app/api/setup/state/route";
import { POST as completePost } from "../src/app/api/setup/complete/route";
import { POST as joinFamily } from "../src/app/api/session/join/route";
import { GET as updateStatusGet } from "../src/app/api/update-status/route";
import { forgetInstanceConfig, instanceSiteUrl, instanceVapidSubject } from "../src/lib/instance-config";
import {
  INSTANCE_FIRST_RUN_KEY,
  INSTANCE_SITE_URL_KEY,
  INSTANCE_VAPID_SUBJECT_KEY,
  firstRunFamily,
} from "../src/lib/first-run";
import { UPDATE_OPERATOR_KEY } from "../src/lib/update-status";

/**
 * RFC-024 §8 against a real database, in process with real session cookies:
 * who may see and change the install's first-run settings, the PIN in front
 * of a change, the environment winning, and the marker that closes the steps.
 *
 * Runs on an install that already has families (the dev stack), so the
 * throwaway families here are never "the first and only": they are made the
 * operator through INSTANCE_ADMIN_FAMILY_ID, as #547's rule allows. The
 * instance_settings rows it touches are put back as they were.
 *
 * Needs KINBOARD_SERVICE_ROLE_KEY and POSTGREST_URL (or SUPABASE_URL); skipped
 * without. Families are `claude-firstrun-*` and deleted afterwards.
 */

const HAS_STACK =
  hasServiceKey() && !!(process.env.POSTGREST_URL || process.env.SUPABASE_URL);
test.skip(!HAS_STACK, "needs KINBOARD_SERVICE_ROLE_KEY and POSTGREST_URL for a running stack");
test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const TOUCHED = [INSTANCE_FIRST_RUN_KEY, INSTANCE_SITE_URL_KEY, INSTANCE_VAPID_SUBJECT_KEY, UPDATE_OPERATOR_KEY];
const ENV_KEYS = ["INSTANCE_ADMIN_FAMILY_ID", "SITE_URL", "VAPID_SUBJECT", "KINBOARD_DEMO_FAMILY_CODE"];

interface Fam {
  id: string;
  cookie: string;
}
let db: any;
let A: Fam;
let B: Fam;
const made: string[] = [];
const rowsBefore = new Map<string, { value: string; updated_at: string } | null>();
const envBefore: Record<string, string | undefined> = {};

function req(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.97.${Math.floor(Math.random() * 250)}.1`,
      ...(init.cookie ? { cookie: `${SESSION_COOKIE}=${init.cookie}` } : {}),
    },
  });
}

async function family(name: string): Promise<Fam> {
  const res = await createFamily(
    req("/api/session/create", { method: "POST", body: { familyName: name, deviceName: name, hardwareId: name } }),
  );
  const json = await res.json();
  if (json.family?.id) made.push(json.family.id);
  expect(res.status, JSON.stringify(json)).toBe(200);
  return { id: json.family.id, cookie: res.cookies.get(SESSION_COOKIE)!.value };
}

async function row(key: string): Promise<string | null> {
  const { data } = await db.from("instance_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

const get = async (f: Fam) => (await instanceGet(req("/api/setup/instance", { cookie: f.cookie }))).json();
const put = (f: Fam, body: unknown) => instancePut(req("/api/setup/instance", { method: "PUT", body, cookie: f.cookie }));
const done = (f: Fam) => instancePost(req("/api/setup/instance", { method: "POST", body: { action: "done" }, cookie: f.cookie }));

test.beforeAll(async () => {
  db = createAdminClient();
  for (const k of ENV_KEYS) envBefore[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const key of TOUCHED) {
    const { data } = await db.from("instance_settings").select("value, updated_at").eq("key", key).maybeSingle();
    rowsBefore.set(key, data ?? null);
  }
  // A fresh install's state for the three first-run keys; the operator record stays.
  await db.from("instance_settings").delete().in("key", [INSTANCE_FIRST_RUN_KEY, INSTANCE_SITE_URL_KEY, INSTANCE_VAPID_SUBJECT_KEY]);
  forgetInstanceConfig();
  A = await family(`claude-firstrun-a-${STAMP}`);
  B = await family(`claude-firstrun-b-${STAMP}`);
});

test.afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (envBefore[k] === undefined) delete process.env[k];
    else process.env[k] = envBefore[k];
  }
  if (!db) return;
  for (const [key, before] of rowsBefore) {
    if (before) await db.from("instance_settings").upsert({ key, value: before.value, updated_at: before.updated_at }, { onConflict: "key" });
    else await db.from("instance_settings").delete().eq("key", key);
  }
  try {
    if (made.length) await db.from("families").delete().in("id", made);
    await db.from("families").delete().like("name", "claude-firstrun-%");
  } finally {
    await db.from("devices").delete().like("hardware_id", "claude-firstrun-%");
  }
  forgetInstanceConfig();
});

test("a family on an install that already has others is not its operator: nothing to see, nothing to change", async () => {
  // Two or more families and no INSTANCE_ADMIN_FAMILY_ID: neither is "the first and only".
  expect(await get(A)).toEqual({ operator: false });
  expect((await put(A, { site_url: "http://evil.example" })).status).toBe(403);
  expect((await done(A)).status).toBe(403);
  expect(await row(INSTANCE_SITE_URL_KEY)).toBeNull();
  expect(await row(INSTANCE_FIRST_RUN_KEY)).toBeNull();
  // Without a session at all.
  expect((await instanceGet(req("/api/setup/instance"))).status).toBe(401);
});

test("the operator named by INSTANCE_ADMIN_FAMILY_ID gets the steps, with nothing set yet", async () => {
  process.env.INSTANCE_ADMIN_FAMILY_ID = A.id;
  const view = await get(A);
  expect(view).toMatchObject({
    operator: true,
    firstRunDone: false,
    firstRunMine: false,
    siteUrl: { value: null, source: "none" },
    pushContact: { value: null, source: "none" },
  });
  expect(typeof view.pushReady).toBe("boolean");
  expect(await get(B), "B is still nobody").toEqual({ operator: false });
  // The update notice follows the same rule (the shared check).
  expect((await (await updateStatusGet(req("/api/update-status", { cookie: B.cookie }))).json()).status).toBeNull();
});

test("bad values are refused; good ones are stored normalised, and used for links and pushes", async () => {
  for (const body of [{ site_url: "https://x.example/sub" }, { site_url: "ftp://x" }, { vapid_subject: "not-an-email" }, {}, [1]]) {
    const res = await put(A, body);
    expect(res.status, JSON.stringify(body)).toBe(400);
  }
  expect(await row(INSTANCE_SITE_URL_KEY)).toBeNull();

  const ok = await put(A, { site_url: " https://Kinboard.Example.org/ ", vapid_subject: "claude@example.org" });
  expect(ok.status).toBe(200);
  expect(await row(INSTANCE_SITE_URL_KEY)).toBe("https://kinboard.example.org");
  expect(await row(INSTANCE_VAPID_SUBJECT_KEY)).toBe("mailto:claude@example.org");
  expect(await get(A)).toMatchObject({
    siteUrl: { value: "https://kinboard.example.org", source: "install" },
    pushContact: { value: "claude@example.org", source: "install" },
  });
  expect(await instanceSiteUrl()).toBe("https://kinboard.example.org");
  expect(await instanceVapidSubject()).toBe("mailto:claude@example.org");
});

test("the environment still wins, and says so", async () => {
  process.env.SITE_URL = "http://env.example:3000";
  process.env.VAPID_SUBJECT = "mailto:env@example.org";
  try {
    expect(await get(A)).toMatchObject({
      siteUrl: { value: "http://env.example:3000", source: "environment" },
      pushContact: { value: "env@example.org", source: "environment" },
    });
    expect(await instanceSiteUrl()).toBe("http://env.example:3000");
    expect(await instanceVapidSubject()).toBe("mailto:env@example.org");
  } finally {
    delete process.env.SITE_URL;
    delete process.env.VAPID_SUBJECT;
  }
});

test("emptying a value removes it, back to the request's address and the old default", async () => {
  expect((await put(A, { site_url: "", vapid_subject: null })).status).toBe(200);
  expect(await row(INSTANCE_SITE_URL_KEY)).toBeNull();
  expect(await row(INSTANCE_VAPID_SUBJECT_KEY)).toBeNull();
  expect(await instanceSiteUrl()).toBeNull();
  expect(await instanceVapidSubject()).toBe("mailto:admin@example.com");
});

test("with a settings PIN set, a change needs it entered on this device", async () => {
  expect((await (await stateGet(req(`/api/setup/state?family_id=${A.id}`, { cookie: A.cookie }))).json()).has_pin).toBe(false);
  const set = await pinRoute(req("/api/pin", { method: "POST", body: { family_id: A.id, action: "set", pin: "4321" }, cookie: A.cookie }));
  expect(set.status).toBe(200);
  expect((await (await stateGet(req(`/api/setup/state?family_id=${A.id}`, { cookie: A.cookie }))).json()).has_pin).toBe(true);

  // A second device of the same family, which never entered the PIN.
  const join = await joinFamily(
    req("/api/session/join", {
      method: "POST",
      body: {
        joinCode: (await db.from("families").select("join_code").eq("id", A.id).single()).data.join_code,
        deviceName: `claude-firstrun-a2-${STAMP}`,
        hardwareId: `claude-firstrun-a2-${STAMP}`,
      },
    }),
  );
  expect(join.status).toBe(200);
  const second: Fam = { id: A.id, cookie: join.cookies.get(SESSION_COOKIE)!.value };
  const refused = await put(second, { site_url: "http://other.example" });
  expect(refused.status).toBe(403);
  expect((await refused.json()).error).toBe("pin_required");
  expect(await row(INSTANCE_SITE_URL_KEY)).toBeNull();
  // Reading and closing the steps need no PIN: nothing secret, nothing changed but the marker.
  expect((await get(second)).operator).toBe(true);
});

test("leaving the steps records who did; they are not due again, and stay listed only for that family", async () => {
  expect((await done(A)).status).toBe(200);
  const marker = await row(INSTANCE_FIRST_RUN_KEY);
  expect(firstRunFamily(marker)).toBe(A.id);
  expect(await get(A)).toMatchObject({ firstRunDone: true, firstRunMine: true });
  // A second call changes nothing.
  expect((await done(A)).status).toBe(200);
  expect(await row(INSTANCE_FIRST_RUN_KEY)).toBe(marker);

  // Another operator later (the variable moved to B) sees them done, not its own.
  process.env.INSTANCE_ADMIN_FAMILY_ID = B.id;
  expect(await get(B)).toMatchObject({ operator: true, firstRunDone: true, firstRunMine: false });
  process.env.INSTANCE_ADMIN_FAMILY_ID = A.id;
});

test("finishing the wizard closes them too, for the operator only", async () => {
  await db.from("instance_settings").delete().eq("key", INSTANCE_FIRST_RUN_KEY);
  // B is not the operator: its completion leaves the install's marker alone.
  expect((await completePost(req("/api/setup/complete", { method: "POST", body: { family_id: B.id }, cookie: B.cookie }))).status).toBe(200);
  expect(await row(INSTANCE_FIRST_RUN_KEY)).toBeNull();
  expect((await db.from("families").select("setup_completed").eq("id", B.id).single()).data.setup_completed).toBe(true);
  // A is.
  expect((await completePost(req("/api/setup/complete", { method: "POST", body: { family_id: A.id }, cookie: A.cookie }))).status).toBe(200);
  expect(firstRunFamily(await row(INSTANCE_FIRST_RUN_KEY))).toBe(A.id);
});
