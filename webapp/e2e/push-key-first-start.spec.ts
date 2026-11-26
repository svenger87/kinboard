import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { devicesNeedingPush, type SubscriptionKeyRow } from "../src/lib/push-key";

/**
 * Migration 095 on a real PostgreSQL: what kinboard.push_key_check does to
 * the push subscriptions an install already has (RFC-023 §6.4).
 *
 * The case that matters for every existing install: subscriptions made before
 * 095 carry no fingerprint, and the install has none recorded. The first start
 * after the update must take them as made with the key it runs with, stamp
 * them, and leave every one of them on. Only a later key change may switch
 * any off.
 *
 * Runs the repository's own 065 and 095 against a throwaway postgres:15-alpine
 * container (no ports, removed afterwards), one database per test. Skipped
 * where there is no Docker.
 */

const MIGRATIONS = join(__dirname, "..", "docker", "migrations");
const NAME = `kb-pushkey-spec-${process.pid}`;
const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;

const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

/** The push_subscriptions table as migrations/001_base.sql creates it, before 095. */
const PRE_095 = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS kinboard;
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID NOT NULL,
  family_id UUID NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

function psql(db: string, sql: string): string {
  return execFileSync("docker", ["exec", "-i", NAME, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|"], {
    input: sql,
    encoding: "utf8",
  }).trim();
}

let n = 0;
/** A fresh database with 065 and the pre-095 table, rows inserted, then 095 applied (the update). */
function install(rows: Array<{ device: string; endpoint: string; active: boolean }>): string {
  const db = `t${++n}`;
  psql("postgres", `CREATE DATABASE ${db};`);
  psql(db, PRE_095 + readFileSync(join(MIGRATIONS, "065_instance_settings.sql"), "utf8"));
  for (const r of rows) {
    psql(
      db,
      `INSERT INTO public.push_subscriptions (device_id, family_id, endpoint, p256dh_key, auth_key, is_active)
       VALUES ('${r.device}', '00000000-0000-0000-0000-0000000000f1', '${r.endpoint}', 'p', 'a', ${r.active});`,
    );
  }
  psql(db, readFileSync(join(MIGRATIONS, "095_push_key_fingerprint.sql"), "utf8"));
  return db;
}

/** What the entrypoint does at every start: previous|backfilled|deactivated|removed. */
const start = (db: string, fp: string) => psql(db, `SELECT coalesce(previous, '-'), backfilled, deactivated, removed FROM kinboard.push_key_check('${fp}');`);

const rows = (db: string) =>
  psql(db, `SELECT endpoint, is_active, coalesce(vapid_key_fingerprint, 'NULL'), vapid_key_retired_at IS NOT NULL FROM public.push_subscriptions ORDER BY endpoint;`)
    .split("\n")
    .filter(Boolean);

const keyRows = (db: string): SubscriptionKeyRow[] =>
  psql(db, `SELECT device_id, is_active, vapid_key_fingerprint, vapid_key_retired_at FROM public.push_subscriptions;`)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [device_id, active, fp, retired] = l.split("|");
      return { device_id, is_active: active === "t", vapid_key_fingerprint: fp || null, vapid_key_retired_at: retired || null };
    });

const KITCHEN = "00000000-0000-0000-0000-00000000000a";
const PHONE = "00000000-0000-0000-0000-00000000000b";
const HALL = "00000000-0000-0000-0000-00000000000c";
const BEFORE_095 = [
  { device: KITCHEN, endpoint: "https://push.example/kitchen", active: true },
  { device: PHONE, endpoint: "https://push.example/phone", active: true },
  { device: HALL, endpoint: "https://push.example/hall", active: false },
];

test.describe("kinboard.push_key_check on PostgreSQL", () => {
  test.skip(!hasDocker, "needs Docker for a throwaway PostgreSQL");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    execFileSync("docker", ["run", "-d", "--rm", "--name", NAME, "-e", "POSTGRES_PASSWORD=spec", "postgres:15-alpine"], { stdio: "ignore" });
    for (let i = 0; i < 120; i++) {
      // The image restarts once after its init scripts; wait for the final server.
      const logs = spawnSync("docker", ["logs", NAME], { encoding: "utf8" });
      const ready = (logs.stdout + logs.stderr).split("database system is ready to accept connections").length - 1;
      if (ready >= 2 && spawnSync("docker", ["exec", NAME, "pg_isready", "-U", "postgres"]).status === 0) return;
      execFileSync("sleep", ["0.5"]);
    }
    throw new Error("PostgreSQL did not start");
  });
  test.afterAll(() => {
    spawnSync("docker", ["rm", "-f", NAME], { stdio: "ignore" });
  });

  test("first start after the update: every pre-095 subscription stays on, is stamped with the current key, and none is listed", () => {
    const db = install(BEFORE_095);
    expect(rows(db), "before the first start: no fingerprints").toEqual([
      "https://push.example/hall|f|NULL|f",
      "https://push.example/kitchen|t|NULL|f",
      "https://push.example/phone|t|NULL|f",
    ]);

    expect(start(db, A)).toBe("-|3|0|0");

    expect(rows(db)).toEqual([
      `https://push.example/hall|f|${A}|f`,
      `https://push.example/kitchen|t|${A}|f`,
      `https://push.example/phone|t|${A}|f`,
    ]);
    expect(psql(db, `SELECT value FROM public.instance_settings WHERE key = 'push_vapid_key';`)).toBe(A);
    expect(devicesNeedingPush(keyRows(db), A), "nothing for Settings to list").toEqual([]);
  });

  test("the next starts with the same key change nothing", () => {
    const db = install(BEFORE_095);
    start(db, A);
    const after = rows(db);
    expect(start(db, A)).toBe(`${A}|0|0|0`);
    expect(start(db, A)).toBe(`${A}|0|0|0`);
    expect(rows(db)).toEqual(after);
  });

  test("a row an older image writes later (no fingerprint) is taken as the recorded key's", () => {
    const db = install(BEFORE_095);
    start(db, A);
    psql(db, `INSERT INTO public.push_subscriptions (device_id, family_id, endpoint, p256dh_key, auth_key) VALUES ('${HALL}', '00000000-0000-0000-0000-0000000000f1', 'https://push.example/hall-2', 'p', 'a');`);
    expect(start(db, A)).toBe(`${A}|1|0|0`);
    expect(rows(db)).toContain(`https://push.example/hall-2|t|${A}|f`);
    expect(devicesNeedingPush(keyRows(db), A)).toEqual([]);
  });

  test("only a later key change switches subscriptions off, and only those that were on are listed", () => {
    const db = install(BEFORE_095);
    start(db, A);
    expect(start(db, B)).toBe(`${A}|0|2|1`);
    expect(rows(db)).toEqual([`https://push.example/kitchen|f|${A}|t`, `https://push.example/phone|f|${A}|t`]);
    expect(devicesNeedingPush(keyRows(db), B)).toEqual([KITCHEN, PHONE].sort());
  });

  test("a start without a VAPID key touches nothing", () => {
    const db = install(BEFORE_095);
    expect(start(db, "")).toBe("-|0|0|0");
    expect(rows(db)).toEqual([
      "https://push.example/hall|f|NULL|f",
      "https://push.example/kitchen|t|NULL|f",
      "https://push.example/phone|t|NULL|f",
    ]);
  });
});
