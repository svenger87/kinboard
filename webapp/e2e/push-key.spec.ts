import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  devicesNeedingPush,
  KEY_CHANGED_ERROR,
  keyFromBytes,
  PUSH_KEY_SETTING,
  subscribeKeyVerdict,
  vapidKeyFingerprint,
} from "../src/lib/push-key";

/**
 * RFC-023 §6.4 and §6.5: when the VAPID key pair in use is not the one the
 * stored push subscriptions were made with (a restore without the config
 * folder, regenerated keys), every subscription silently stops working.
 *
 * The install now records a fingerprint of the public key with each
 * subscription and in instance_settings, compares at start, and Settings asks
 * for push to be turned on again on the devices that had it.
 */

/** A real VAPID-shaped public key: the uncompressed P-256 point, base64url. */
function vapidPublicKey(): string {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return raw.toString("base64url");
}

const A = vapidPublicKey();
const B = vapidPublicKey();

test.describe("the fingerprint", () => {
  test("is SHA-256 of the key's bytes, and only of the public key", () => {
    const fp = vapidKeyFingerprint(A)!;
    expect(fp).toBe(`sha256:${createHash("sha256").update(Buffer.from(A, "base64url")).digest("hex")}`);
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fp).not.toContain(A);
  });

  test("tells two keys apart, and one key written two ways is the same key", () => {
    expect(vapidKeyFingerprint(A)).not.toBe(vapidKeyFingerprint(B));
    const std = Buffer.from(A, "base64url").toString("base64"); // + / and = padding
    expect(vapidKeyFingerprint(std)).toBe(vapidKeyFingerprint(A));
    expect(vapidKeyFingerprint(` ${A}\n`)).toBe(vapidKeyFingerprint(A));
    expect(keyFromBytes(new Uint8Array(Buffer.from(A, "base64url")))).toBe(A);
  });

  test("no key, no fingerprint", () => {
    for (const k of [undefined, null, "", "   "]) expect(vapidKeyFingerprint(k)).toBeNull();
  });

  test("the entrypoint computes the same value as the app", () => {
    const entry = readFileSync("image/webapp-entrypoint.sh", "utf8");
    const m = entry.match(/push_fp="\$\(PUSH_PUBLIC_KEY="[^"]*" node -e '([\s\S]*?)' 2>\/dev\/null/);
    expect(m, "the entrypoint's fingerprint snippet").not.toBeNull();
    for (const key of [A, B, Buffer.from(A, "base64url").toString("base64"), ""]) {
      const r = spawnSync("node", ["-e", m![1]], { encoding: "utf8", env: { ...process.env, PUSH_PUBLIC_KEY: key } });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe(vapidKeyFingerprint(key) ?? "");
    }
  });

  test("the entrypoint fingerprints the key the server sends with, VAPID_PUBLIC_KEY before NEXT_PUBLIC_", () => {
    const entry = readFileSync("image/webapp-entrypoint.sh", "utf8");
    expect(entry).toContain('PUSH_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}}"');
    const sender = readFileSync("src/lib/push-sender.ts", "utf8");
    expect(sender).toContain("env.VAPID_PUBLIC_KEY || env.NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    // After the secrets are read (a one-file install's key lives in the store), after the migrations (095 defines the check).
    expect(entry.indexOf("push_fp=")).toBeGreaterThan(entry.indexOf('eval "$secrets_env"'));
    expect(entry.indexOf("push_fp=")).toBeGreaterThan(entry.indexOf("sh /app/migrate.sh"));
    expect(entry).toContain("FROM kinboard.push_key_check(:'fp')");
  });
});

test.describe("the subscribe route's verdict", () => {
  const cur = vapidKeyFingerprint(A);
  const old = vapidKeyFingerprint(B);

  test("a subscription made with the current key, or one that can't be judged, is taken", () => {
    expect(subscribeKeyVerdict(cur, null, null)).toBe("ok");
    expect(subscribeKeyVerdict(cur, cur, null)).toBe("ok");
    expect(subscribeKeyVerdict(cur, null, cur)).toBe("ok");
    expect(subscribeKeyVerdict(cur, cur, cur)).toBe("ok");
    // A push service that hands the same endpoint back for a new subscription with the new key.
    expect(subscribeKeyVerdict(cur, old, cur), "the browser's word decides").toBe("ok");
    expect(subscribeKeyVerdict(null, old, old), "push not configured: nothing to compare").toBe("ok");
  });

  test("a row recorded under an earlier key, or a browser naming one, is refused", () => {
    expect(subscribeKeyVerdict(cur, old, null)).toBe("key_changed");
    expect(subscribeKeyVerdict(cur, null, old)).toBe("key_changed");
    expect(subscribeKeyVerdict(cur, cur, old)).toBe("key_changed");
  });

  test("the route checks before it writes, answers 409, and records the key on insert and update", () => {
    const src = readFileSync("src/app/api/notifications/subscribe/route.ts", "utf8");
    expect(src).toMatch(
      /if \(subscribeKeyVerdict\(currentKey, existing\?\.vapid_key_fingerprint \?\? null, clientKey\) === "key_changed"\) \{\n\s+return NextResponse\.json\(/,
    );
    const check = src.indexOf("subscribeKeyVerdict(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(src.indexOf(".update({ is_active: false })"));
    expect(check).toBeLessThan(src.indexOf(".insert(insertData)"));
    expect(src).toContain("{ status: 409 }");
    expect(src).toContain("error: KEY_CHANGED_ERROR");
    expect(KEY_CHANGED_ERROR).toBe("vapid_key_changed");
    expect(src).toMatch(/vapid_key_fingerprint: currentKey,\n/);
    expect(src).toContain("...(currentKey ? { vapid_key_fingerprint: currentKey, vapid_key_retired_at: null } : {})");
    expect(src).toContain('select("id, vapid_key_fingerprint")');
  });

  test("every subscribe call from the browser says which key it was made with", () => {
    const hook = readFileSync("src/hooks/use-push-notifications.ts", "utf8");
    const posts = hook.split('fetch("/api/notifications/subscribe"').length - 1;
    expect(posts).toBe(3);
    expect(hook.split("applicationServerKey: subscriptionServerKey(subscription)").length - 1).toBe(posts);
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain("applicationServerKey: serverKeyOf(subscription)");
  });
});

test.describe("which devices Settings lists", () => {
  const cur = vapidKeyFingerprint(A)!;
  const old = vapidKeyFingerprint(B)!;
  const T = "2026-11-26T10:00:00Z";
  const row = (device_id: string, fp: string | null, is_active: boolean, retired: string | null = null) => ({
    device_id,
    vapid_key_fingerprint: fp,
    is_active,
    vapid_key_retired_at: retired,
  });

  test("devices with a subscription from the earlier key and none with the current one", () => {
    expect(
      devicesNeedingPush(
        [
          row("kitchen", old, false, T), // switched off at start: had push
          row("hallway", old, false), // was already off when the key changed
          row("phone", old, false, T),
          row("phone", cur, true), // turned on again since
          row("tablet", cur, true), // subscribed after the change
          row("old-laptop", null, true), // from before fingerprints, not judged
        ],
        cur,
      ),
    ).toEqual(["kitchen"]);
  });

  test("an old subscription still active (a dump restored into a running install) counts too", () => {
    expect(devicesNeedingPush([row("kitchen", old, true)], cur)).toEqual(["kitchen"]);
  });

  test("a device whose current subscription is inactive still needs push turned on", () => {
    expect(devicesNeedingPush([row("kitchen", old, false, T), row("kitchen", cur, false)], cur)).toEqual(["kitchen"]);
  });

  test("the same key everywhere, or no key at all: nothing to show", () => {
    expect(devicesNeedingPush([row("kitchen", cur, true), row("phone", cur, false)], cur)).toEqual([]);
    expect(devicesNeedingPush([row("kitchen", old, false, T)], null)).toEqual([]);
  });

  test("a device that had turned push off before the key changed is not listed", () => {
    expect(devicesNeedingPush([row("hallway", old, false)], cur)).toEqual([]);
  });

  test("the route answers for the signed-in family only, and a dismiss removes only that family's dead subscriptions", () => {
    const src = readFileSync("src/app/api/notifications/push-reset/route.ts", "utf8");
    expect(src.split('.eq("family_id", auth.session.familyId)').length - 1).toBe(3);
    expect(src).not.toMatch(/searchParams|familyId\s*=\s*body/);
    expect(src).toContain('.neq("vapid_key_fingerprint", current)');
    expect(src).toContain('.not("vapid_key_fingerprint", "is", null)');
    expect(src).toContain('select("device_id, is_active, vapid_key_fingerprint, vapid_key_retired_at")');
  });
});

test.describe("the migration and the start", () => {
  const sql = readFileSync("docker/migrations/095_push_key_fingerprint.sql", "utf8");

  test("additive: two nullable columns and a function nobody but its owner may call", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS vapid_key_fingerprint TEXT;");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS vapid_key_retired_at TIMESTAMPTZ;");
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN)|NOT NULL/i);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION kinboard.push_key_check(p_fingerprint TEXT)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION kinboard.push_key_check(TEXT) FROM PUBLIC;");
    expect(sql).not.toMatch(/SECURITY DEFINER/i);
  });

  test("records the key under the same instance_settings key the app reads", () => {
    expect(sql).toContain(`key = '${PUSH_KEY_SETTING}'`);
    expect(sql).toContain(`VALUES ('${PUSH_KEY_SETTING}', p_fingerprint)`);
  });

  test("removes rows of another key that were already off, and marks the ones it switches off", () => {
    expect(sql).toMatch(/DELETE FROM public\.push_subscriptions\s+WHERE vapid_key_fingerprint <> p_fingerprint\s+AND is_active IS NOT TRUE\s+AND vapid_key_retired_at IS NULL;/);
    expect(sql).toMatch(/SET is_active = false, vapid_key_retired_at = now\(\), updated_at = now\(\)\s+WHERE vapid_key_fingerprint <> p_fingerprint AND is_active IS TRUE;/);
    // The delete runs first: a row switched off in this run is marked and stays.
    expect(sql.indexOf("DELETE FROM public.push_subscriptions")).toBeLessThan(sql.indexOf("SET is_active = false"));
  });

  test("the start logs a change in words, and goes on when the check fails", () => {
    const entry = readFileSync("image/webapp-entrypoint.sh", "utf8");
    expect(entry).toContain("Push needs to be turned on again on each device");
    expect(entry).toContain("could not check the push key against the subscriptions");
  });
});

test.describe("the Settings notice", () => {
  const LOCALES = ["en", "de", "fr", "zh"] as const;
  const load = (l: string) =>
    (JSON.parse(readFileSync(`messages/${l}.json`, "utf8")) as { settings: { pushReset: Record<string, string> } }).settings.pushReset;

  test("is translated in every language, with the same keys and placeholders", () => {
    const en = load("en");
    expect(Object.keys(en).sort()).toEqual(["body", "devices", "dismiss", "dismissFailed", "open", "thisDevice", "title"]);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const l of LOCALES) {
      const m = load(l);
      expect(Object.keys(m).sort(), l).toEqual(Object.keys(en).sort());
      for (const k of Object.keys(en)) expect(ph(m[k]), `${l}.${k}`).toEqual(ph(en[k]));
    }
    expect(en.body).toContain("Push needs to be turned on again on each device");
  });

  test("sits at the top of Settings, next to the update notice", () => {
    const page = readFileSync("src/app/settings/page.tsx", "utf8");
    expect(page).toContain("<PushResetNotice devices={pushReset} currentDeviceId={device?.id} />");
    expect(page.indexOf("<PushResetNotice")).toBeLessThan(page.indexOf("<SettingsSearch"));
  });
});
