import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  RETRY_INTERVAL_MS,
  dismissUpdateStatus,
  decideOperator,
  parseUpdateStatus,
  retryAllowed,
  showsRollbackNotice,
  showsUpdatedLine,
  withoutDetails,
} from "../src/lib/update-status";
import { missingFromSchema } from "../src/lib/schema-check";

/**
 * The Settings half of RFC-023 §4.11.4: the status record the self-update
 * writes into instance_settings (kinboard-self-update.sh, write_status), the
 * route that reads it, and the notice. And the deep health check's schema
 * comparison, which decides a rollback.
 */

// Exactly what the script writes, json_str and all.
const ROLLED_BACK =
  '{"status":"rolled_back","at":"2026-11-26T03:12:00Z","from":"1.17.0","to":"1.18.0","services":"webapp",' +
  '"backup":"pre-upgrade-20261126-031000.sql.gz","backup_dir":"/opt/kinboard/data/backups","backup_at":"2026-11-26T03:10:05Z",' +
  '"migration":"094_tags.sql","severe":true,"log_file":"/var/lib/kinboard-update/kinboard-update.log","log":"--- webapp\\n[migrate] FAILED: 094_tags.sql"}';

test.describe("the status record", () => {
  test("is read field by field from what the script writes", () => {
    const s = parseUpdateStatus(ROLLED_BACK);
    expect(s).toMatchObject({
      status: "rolled_back",
      from: "1.17.0",
      to: "1.18.0",
      backup: "pre-upgrade-20261126-031000.sql.gz",
      backupDir: "/opt/kinboard/data/backups",
      migration: "094_tags.sql",
      severe: true,
      dismissedAt: "",
    });
    expect(s!.log).toBe("--- webapp\n[migrate] FAILED: 094_tags.sql");
  });

  test("anything else is no record", () => {
    for (const raw of ["", "not json", "[]", "null", '{"status":"exploded"}', '{"at":"x"}']) {
      expect(parseUpdateStatus(raw), raw).toBeNull();
    }
    expect(parseUpdateStatus('{"status":"updated","to":5}')!.to, "a wrong type reads as empty").toBe("");
  });

  test("a rollback shows until dismissed; a dismissal keeps the record", () => {
    expect(showsRollbackNotice(parseUpdateStatus(ROLLED_BACK))).toBe(true);
    const dismissed = dismissUpdateStatus(ROLLED_BACK, new Date("2026-11-26T08:00:00Z"))!;
    expect(JSON.parse(dismissed)).toMatchObject({ status: "rolled_back", to: "1.18.0", dismissed_at: "2026-11-26T08:00:00.000Z" });
    expect(showsRollbackNotice(parseUpdateStatus(dismissed))).toBe(false);
    expect(showsRollbackNotice(parseUpdateStatus('{"status":"rollback_failed"}'))).toBe(true);
  });

  test("a successful update is a line under the version for a week, never the notice", () => {
    const updated = parseUpdateStatus('{"status":"updated","at":"2026-11-26T03:12:00Z","from":"1.17.0","to":"1.18.0"}');
    expect(showsRollbackNotice(updated)).toBe(false);
    expect(showsUpdatedLine(updated, new Date("2026-11-26T08:00:00Z"))).toBe(true);
    expect(showsUpdatedLine(updated, new Date("2026-12-04T08:00:00Z"))).toBe(false);
  });
});

test.describe("who may see and act on the install's updates", () => {
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";

  const op = (id: string, familyCount: number, recorded: string | null, env: Record<string, string> = {}) =>
    decideOperator(id, { familyCount, recorded, env });

  test("a household install: its one family, recorded the first time it asks", () => {
    expect(op(A, 1, null)).toEqual({ operator: true, record: true });
    expect(op(A, 1, A)).toEqual({ operator: true, record: false });
  });

  test("a second family can neither take over nor lock the household out", () => {
    // Anyone who can reach /api/session/create can add a family.
    expect(op(B, 2, A)).toEqual({ operator: false, record: false });
    expect(op(A, 2, A), "the recorded household keeps it").toEqual({ operator: true, record: false });
  });

  test("several families and nobody recorded: nobody, unless one is named", () => {
    expect(op(A, 2, null).operator).toBe(false);
    expect(op(B, 2, null).operator).toBe(false);
    expect(op(A, 2, null, { INSTANCE_ADMIN_FAMILY_ID: A }).operator).toBe(true);
    expect(op(B, 2, null, { INSTANCE_ADMIN_FAMILY_ID: A }).operator).toBe(false);
  });

  test("a named operator wins over a recorded one; a public demo never claims its only family", () => {
    expect(op(A, 1, A, { INSTANCE_ADMIN_FAMILY_ID: B }).operator).toBe(false);
    expect(op(A, 1, null, { KINBOARD_DEMO_FAMILY_CODE: "DEMO01" })).toEqual({ operator: false, record: false });
    expect(op(A, 1, null, { KINBOARD_DEMO_FAMILY_CODE: "DEMO01", INSTANCE_ADMIN_FAMILY_ID: A }).operator).toBe(true);
  });

  test("without the settings unlocked, the operator sees what happened, not the log or the paths", () => {
    const s = withoutDetails(parseUpdateStatus(ROLLED_BACK)!);
    expect(s).toMatchObject({ status: "rolled_back", from: "1.17.0", to: "1.18.0", migration: "094_tags.sql" });
    expect([s.log, s.logFile, s.backupDir, s.backup, s.services]).toEqual(["", "", "", "", ""]);
  });

  test("Try again: once per 10 minutes per install", () => {
    const now = new Date("2026-11-26T10:00:00Z");
    expect(retryAllowed(null, now)).toBe(true);
    expect(retryAllowed(new Date(now.getTime() - 60_000).toISOString(), now)).toBe(false);
    expect(retryAllowed(new Date(now.getTime() - RETRY_INTERVAL_MS + 1000).toISOString(), now)).toBe(false);
    expect(retryAllowed(new Date(now.getTime() - RETRY_INTERVAL_MS).toISOString(), now)).toBe(true);
    expect(retryAllowed("garbage", now)).toBe(true);
    expect(retryAllowed(new Date(now.getTime() + 3_600_000).toISOString(), now), "a clock that jumped back").toBe(true);
  });
});

test.describe("the route", () => {
  const src = readFileSync("src/app/api/update-status/route.ts", "utf8");
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  const post = src.slice(src.indexOf("export async function POST"));

  test("reading needs a session, and anyone but the operator gets nothing, before anything is read", () => {
    expect(get).toContain("requireSession(request)");
    const gate = get.indexOf("if (!(await operator(auth.session.familyId))) return NextResponse.json({ status: null })");
    expect(gate, "the operator gate").toBeGreaterThan(-1);
    expect(gate).toBeLessThan(get.indexOf("readKey("));
  });

  test("the log and the paths only with the settings unlocked", () => {
    expect(get).toMatch(/const locked = await requireSettingsUnlock\(auth\.session\);\s*return NextResponse\.json\(\{ status: locked \? withoutDetails\(status\) : status/);
  });

  test("the operator is recorded once and then compared, not recounted", () => {
    const fn = src.slice(src.indexOf("async function operator("), src.indexOf("export async function GET"));
    expect(fn).toContain("readKey(UPDATE_OPERATOR_KEY)");
    expect(fn).toContain("if (decision.record) await writeKey(UPDATE_OPERATOR_KEY, familyId)");
  });

  test("dismissing changes only the record it read", () => {
    const dismiss = post.slice(post.indexOf('action === "dismiss"'), post.indexOf('action === "retry"'));
    expect(dismiss).toContain('.eq("updated_at", current.updatedAt)');
  });

  test("dismissing and trying again need the operator and the settings PIN, before any write", () => {
    expect(post).toContain("requireSession(request)");
    const gate = post.indexOf("if (!(await operator(auth.session.familyId)))");
    expect(gate).toBeGreaterThan(-1);
    expect(post.slice(gate, gate + 200)).toContain("status: 403");
    expect(gate).toBeLessThan(post.indexOf("requireSettingsUnlock(auth.session)"));
    expect(post.indexOf("requireSettingsUnlock")).toBeLessThan(post.indexOf("writeKey("));
  });

  test("Try again is rate-limited and says who pressed it", () => {
    const retry = post.slice(post.indexOf('action === "retry"'));
    expect(retry).toMatch(
      /if \(!retryAllowed\(await readKey\(UPDATE_RETRY_LAST_KEY\), now\)\) \{\s*return NextResponse\.json\(\{ error: "retry_too_soon" \}, \{ status: 429 \}\);/,
    );
    expect(retry.indexOf("retryAllowed(")).toBeLessThan(retry.indexOf("writeKey("));
    expect(retry).toContain("auth.session.familyId");
  });

  test("uses the keys the script reads and writes", () => {
    const script = readFileSync("docker/kinboard-self-update.sh", "utf8");
    const lib = readFileSync("src/lib/update-status.ts", "utf8");
    expect(lib).toContain('UPDATE_STATUS_KEY = "update_status"');
    expect(lib).toContain('UPDATE_RETRY_KEY = "update_retry"');
    expect(script).toContain("VALUES ('update_status'");
    expect(script).toContain("WHERE key = 'update_retry'");
  });
});

test.describe("the notice", () => {
  const KEYS = [
    "rolledBackTitle",
    "dataBody",
    "dataBodyNoBackup",
    "migrationBody",
    "retryLaterBody",
    "rollbackFailedTitle",
    "rollbackFailedBody",
    "details",
    "detailsLog",
    "tryAgain",
    "retryQueued",
    "retryPending",
    "dismiss",
    "actionFailed",
    "retryTooSoon",
    "updatedLine",
  ];
  for (const locale of ["en", "de", "fr", "zh"]) {
    test(`is written in ${locale}, with the same placeholders as English`, () => {
      const all = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
      const en = JSON.parse(readFileSync("messages/en.json", "utf8")).settings.updateStatus;
      const m = all.settings.updateStatus;
      for (const k of KEYS) {
        expect(typeof m?.[k], `${locale} settings.updateStatus.${k}`).toBe("string");
        const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
        expect(holes(m[k]), `${locale} ${k}`).toEqual(holes(en[k]));
      }
    });
  }

  test("English says what the RFC says", () => {
    const en = JSON.parse(readFileSync("messages/en.json", "utf8")).settings.updateStatus;
    expect(en.rolledBackTitle).toBe("The update to {version} didn't start, so Kinboard went back to {previous}.");
    expect(en.dataBody).toBe("Your data is as it was before the update; a backup from {time} is in {folder}.");
    expect(en.migrationBody).toBe(
      "The database update {file} failed partway. Kinboard runs normally on the older version; the next release retries it.",
    );
    expect(en.retryLaterBody).toBe("Kinboard will try again when a newer version is published.");
    expect(en.tryAgain).toBe("Try again now");
  });
});

test.describe("the deep health check's schema comparison", () => {
  test("names a missing table and a missing (renamed) column, and nothing else", () => {
    const expected = { todos: ["id", "title"], people: ["id"], families: ["id"] };
    const defs = { todos: { properties: { id: {}, name: {} } }, families: { properties: { id: {}, extra: {} } } };
    expect(missingFromSchema(expected, defs)).toEqual(["todos.title", "people"]);
    expect(missingFromSchema(expected, { ...defs, todos: { properties: { id: {}, title: {} } }, people: { properties: { id: {} } } })).toEqual([]);
  });

  test("schema-expectations.json is what src/types/database.ts declares", () => {
    execFileSync("node", ["scripts/generate-schema-expectations.mjs", "--check"], { stdio: "pipe" });
  });

  test("deep mode is behind CRON_SECRET; the plain check is unchanged", () => {
    const src = readFileSync("src/app/api/health/route.ts", "utf8");
    const deep = src.slice(src.indexOf('get("deep")'), src.indexOf("const [version, dbOk"));
    expect(deep).toContain("`Bearer ${secret}`");
    expect(deep).toContain("status: 401");
  });
});
