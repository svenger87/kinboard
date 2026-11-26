import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  dismissUpdateStatus,
  parseUpdateStatus,
  showsRollbackNotice,
  showsUpdatedLine,
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

test.describe("the route", () => {
  const src = readFileSync("src/app/api/update-status/route.ts", "utf8");

  test("reading needs a session; dismissing and trying again need the settings PIN too", () => {
    const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    const post = src.slice(src.indexOf("export async function POST"));
    expect(get).toContain("requireSession(request)");
    expect(post).toContain("requireSession(request)");
    expect(post).toContain("requireSettingsUnlock(auth.session)");
    expect(post.indexOf("requireSettingsUnlock")).toBeLessThan(post.indexOf("writeKey("));
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
