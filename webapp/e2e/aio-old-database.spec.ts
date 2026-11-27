import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TRASH_DIR,
  clearSizeCache,
  deleteOldDatabase,
  parseUpgradeRecord,
  readOldDatabaseStatus,
  rollbackWindow,
  type DeleteResult,
} from "../src/lib/aio-old-database";
import { deleteOldDatabaseRequest, type OldDatabaseDeleteDeps } from "../src/lib/aio-old-database-request";

/**
 * The database folder a PostgreSQL major upgrade keeps in the all-in-one
 * image (RFC-024 §4.3 step 4, §4.7): the record Settings reads, the rollback
 * window it mirrors from pg-lib.sh, the delete and its gates, and the
 * previous image's refusal once the folder is gone. Real folders in a temp
 * dir for everything that touches the disk; fakes for the operator and PIN.
 */

const ROOT = join(__dirname, "..", "..");
const LIB = join(__dirname, "..", "image", "aio", "rootfs", "usr", "local", "lib", "kinboard-aio");
const read = (p: string) => readFileSync(p, "utf8");
const NOW = new Date("2026-11-27T12:00:00Z");
const nowS = Math.floor(NOW.getTime() / 1000);

function fakeData() {
  const dir = mkdtempSync(join(tmpdir(), "kb-olddb-"));
  const data = join(dir, "data");
  mkdirSync(join(data, "config", "updater"), { recursive: true });
  const cluster = (name: string, major: string, marker = true) => {
    mkdirSync(join(data, name, "base", "1"), { recursive: true });
    writeFileSync(join(data, name, "PG_VERSION"), `${major}\n`);
    writeFileSync(join(data, name, "base", "1", "1259"), Buffer.alloc(64 * 1024, 7));
    if (marker) writeFileSync(join(data, name, "KINBOARD_AIO"), `kinboard-aio\nmajor=${major}\nlibc=musl\n`);
  };
  const state = (body: string) => writeFileSync(join(data, "config", "updater", "pg-upgrade"), body);
  const switched = (opts: { ageS?: number; confirmed?: boolean; phase?: string } = {}) =>
    state(
      `phase=${opts.phase ?? "switched"}\nfrom=17\nto=18\ndump=/data/backups/pre-pg18-upgrade-x.sql.gz\nat=2026-11-27T11:00:00Z\n` +
        `switched_at=2026-11-27T11:00:00Z\nswitched_epoch=${nowS - (opts.ageS ?? 60)}\n` +
        `confirmed_at=${opts.confirmed ? "2026-11-27T11:01:05Z" : ""}\n`,
    );
  const env = { KINBOARD_AIO: "1", KINBOARD_DATA: data, PG_MAJOR: "18" };
  const has = (name: string) => existsSync(join(data, name));
  cluster("db", "18");
  return { dir, data, cluster, state, switched, env, has, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test.beforeEach(() => clearSizeCache());

/* -------------------------------------------------------------- the record */

test.describe("the record Settings reads", () => {
  test("parses pg-lib.sh's key=value record; the first value of a key wins, as kv_get reads it", () => {
    const r = parseUpgradeRecord("phase=switched\nfrom=17\nto=18\nswitched_epoch=1700000000\nconfirmed_at=\nphase=failed\n");
    expect(r).toEqual({ phase: "switched", from: "17", to: "18", switchedAt: "", switchedEpoch: 1700000000, confirmedAt: "" });
    expect(parseUpgradeRecord("switched_epoch=12abc\n").switchedEpoch).toBeNull();
  });

  test("the rollback window is rollback_unconfirmed's: switched, unconfirmed, within a day, not in the future", () => {
    const rec = (s: string) => parseUpgradeRecord(s);
    const base = `phase=switched\nfrom=17\nto=18\nconfirmed_at=\n`;
    expect(rollbackWindow(rec(`${base}switched_epoch=${nowS - 60}\n`), NOW)).toEqual({
      open: true,
      until: new Date((nowS - 60 + 86400) * 1000).toISOString(),
    });
    expect(rollbackWindow(rec(`${base}switched_epoch=${nowS - 86401}\n`), NOW).open, "a day and a second").toBe(false);
    expect(rollbackWindow(rec(`${base}switched_epoch=${nowS + 3600}\n`), NOW).open, "clock went backwards").toBe(false);
    expect(rollbackWindow(rec(base), NOW).open, "no switch time").toBe(false);
    expect(rollbackWindow(rec(`phase=switched\nfrom=17\nto=18\nconfirmed_at=2026-11-27T11:01:05Z\nswitched_epoch=${nowS - 60}\n`), NOW).open, "confirmed").toBe(false);
    expect(rollbackWindow(rec(`${base}switched_epoch=${nowS - 7200}\n`), NOW, { KINBOARD_PG_ROLLBACK_WINDOW: "3600" }).open, "the image's window setting").toBe(false);
    // The same default as pg-lib.sh.
    expect(read(join(LIB, "pg-lib.sh"))).toContain('window="${KINBOARD_PG_ROLLBACK_WINDOW:-86400}"');
  });

  test("inside the window: kept, until when, and the version to go back to from last-good", async () => {
    const f = fakeData();
    try {
      f.cluster("db.old", "17");
      f.switched({ ageS: 60 });
      writeFileSync(join(f.data, "config", "updater", "last-good"), "version=1.17.0\nrevision=abc\npg_major=17\nat=x\n");
      const s = await readOldDatabaseStatus(f.env, NOW);
      expect(s).toMatchObject({ fromMajor: "17", toMajor: "18", upgradedAt: "2026-11-27T11:00:00Z", rollbackOpen: true, previousVersion: "1.17.0", interrupted: false });
      expect(s!.rollbackUntil).toBe(new Date((nowS - 60 + 86400) * 1000).toISOString());
      expect(s!.sizeBytes).toBeGreaterThanOrEqual(64 * 1024);
      // last-good of the new version (after the healthy minute) names no version to go back to.
      writeFileSync(join(f.data, "config", "updater", "last-good"), "version=1.18.0\npg_major=18\n");
      expect((await readOldDatabaseStatus(f.env, NOW))!.previousVersion).toBeNull();
    } finally { f.done(); }
  });

  test("after the window: deletable (confirmed, or a day old)", async () => {
    const f = fakeData();
    try {
      f.cluster("db.old", "17");
      f.switched({ confirmed: true });
      expect((await readOldDatabaseStatus(f.env, NOW))!.rollbackOpen).toBe(false);
      f.switched({ ageS: 90000 });
      expect((await readOldDatabaseStatus(f.env, NOW))!.rollbackOpen).toBe(false);
    } finally { f.done(); }
  });

  test("the size is cached: a second read does not walk the folder again", async () => {
    const f = fakeData();
    try {
      f.cluster("db.old", "17");
      f.switched({ confirmed: true });
      const first = (await readOldDatabaseStatus(f.env, NOW))!.sizeBytes;
      writeFileSync(join(f.data, "db.old", "base", "1", "big"), Buffer.alloc(512 * 1024, 1));
      expect((await readOldDatabaseStatus(f.env, new Date(NOW.getTime() + 1000)))!.sizeBytes).toBe(first);
      clearSizeCache();
      expect((await readOldDatabaseStatus(f.env, NOW))!.sizeBytes).toBeGreaterThan(first);
    } finally { f.done(); }
  });

  test("nothing to say: no folder, another phase, another cluster, no marker, or a link", async () => {
    const f = fakeData();
    const outside = mkdtempSync(join(tmpdir(), "kb-olddb-out-"));
    try {
      f.switched({ confirmed: true });
      expect(await readOldDatabaseStatus(f.env, NOW), "no db.old").toBeNull();
      f.cluster("db.old", "16");
      expect(await readOldDatabaseStatus(f.env, NOW), "db.old is not the record's from").toBeNull();
      rmSync(join(f.data, "db.old"), { recursive: true });
      f.cluster("db.old", "17", false);
      expect(await readOldDatabaseStatus(f.env, NOW), "no marker").toBeNull();
      rmSync(join(f.data, "db.old"), { recursive: true });
      f.cluster("db.old", "17");
      f.switched({ phase: "failed" });
      expect(await readOldDatabaseStatus(f.env, NOW), "phase failed").toBeNull();
      f.switched({ confirmed: true });
      expect(await readOldDatabaseStatus(f.env, NOW), "green: the same folder, switched").not.toBeNull();
      rmSync(join(f.data, "db.old"), { recursive: true });
      mkdirSync(join(outside, "c"));
      writeFileSync(join(outside, "c", "PG_VERSION"), "17\n");
      writeFileSync(join(outside, "c", "KINBOARD_AIO"), "kinboard-aio\nmajor=17\n");
      symlinkSync(join(outside, "c"), join(f.data, "db.old"));
      expect(await readOldDatabaseStatus(f.env, NOW), "a link to a cluster elsewhere").toBeNull();
    } finally { f.done(); rmSync(outside, { recursive: true, force: true }); }
  });

  test("a delete cut off half-way is shown again, to be finished", async () => {
    const f = fakeData();
    try {
      f.cluster(TRASH_DIR, "17");
      rmSync(join(f.data, TRASH_DIR, "PG_VERSION"));
      f.switched({ confirmed: true });
      expect(await readOldDatabaseStatus(f.env, NOW)).toMatchObject({ interrupted: true, rollbackOpen: false });
      const r = await deleteOldDatabase(f.env, NOW);
      expect(r.ok).toBe(true);
      expect(f.has(TRASH_DIR)).toBe(false);
      expect(f.has("db")).toBe(true);
    } finally { f.done(); }
  });
});

/* ------------------------------------------------------ compose installs */

test.describe("a compose install never sees it", () => {
  test("without KINBOARD_AIO there is no status and no delete, whatever /data holds", async () => {
    const f = fakeData();
    try {
      f.cluster("db.old", "17");
      f.switched({ confirmed: true });
      const compose = { KINBOARD_DATA: f.data, PG_MAJOR: "18" };
      expect(await readOldDatabaseStatus(compose, NOW)).toBeNull();
      expect(await readOldDatabaseStatus({ ...compose, KINBOARD_AIO: "true" }, NOW), "only the image's exact value").toBeNull();
      expect(await deleteOldDatabase(compose, NOW)).toEqual({ ok: false, refusal: "not_aio" });
      expect(f.has("db.old")).toBe(true);
      // Green: the same folder in the all-in-one image.
      expect(await readOldDatabaseStatus(f.env, NOW)).not.toBeNull();
    } finally { f.done(); }
  });

  test("only the all-in-one Dockerfile sets KINBOARD_AIO; no compose file, listing or the webapp image does", () => {
    expect(read(join(__dirname, "..", "image", "aio", "Dockerfile"))).toMatch(/^ENV KINBOARD_AIO=1 \\$/m);
    const files = [
      join(ROOT, "compose.yml"),
      join(__dirname, "..", "image", "Dockerfile"),
      ...readdirSync(join(__dirname, "..", "docker")).filter((n) => /\.ya?ml$/.test(n)).map((n) => join(__dirname, "..", "docker", n)),
      ...readdirSync(join(ROOT, "dist")).filter((n) => /\.(ya?ml|json|xml)$/.test(n)).map((n) => join(ROOT, "dist", n)),
    ].filter((p) => existsSync(p));
    expect(files.length).toBeGreaterThan(3);
    for (const p of files) expect(read(p), p).not.toMatch(/KINBOARD_AIO\s*[:=]/);
  });

  test("the route answers null before it asks who is the operator, and 404s a delete", () => {
    const src = read(join(__dirname, "..", "src", "app", "api", "old-database", "route.ts"));
    const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    expect(get.indexOf("if (!aioDataDir()) return NextResponse.json({ oldDatabase: null })")).toBeGreaterThan(0);
    expect(get.indexOf("aioDataDir()")).toBeLessThan(get.indexOf("isInstallOperator"));
    expect(src).toContain("isAio: () => aioDataDir() !== null");
  });
});

/* ------------------------------------------------------------- the delete */

test.describe("deleting db.old", () => {
  test("after the window: removed, the live database and a link's target untouched", async () => {
    const f = fakeData();
    const outside = mkdtempSync(join(tmpdir(), "kb-olddb-canary-"));
    try {
      f.cluster("db.old", "17");
      writeFileSync(join(outside, "canary"), "keep me");
      // A tablespace link inside the cluster (pg_tblspc holds them): unlinked, never followed.
      mkdirSync(join(f.data, "db.old", "pg_tblspc"));
      symlinkSync(outside, join(f.data, "db.old", "pg_tblspc", "16384"));
      f.switched({ confirmed: true });
      const r = await deleteOldDatabase(f.env, NOW);
      expect(r).toMatchObject({ ok: true, fromMajor: "17" });
      expect((r as { bytes: number }).bytes).toBeGreaterThanOrEqual(64 * 1024);
      expect(f.has("db.old")).toBe(false);
      expect(f.has(TRASH_DIR)).toBe(false);
      expect(read(join(f.data, "db", "PG_VERSION")).trim()).toBe("18");
      expect(read(join(outside, "canary"))).toBe("keep me");
      expect(await readOldDatabaseStatus(f.env, NOW), "the notice is gone").toBeNull();
      expect(await deleteOldDatabase(f.env, NOW)).toEqual({ ok: false, refusal: "nothing_to_delete" });
    } finally { f.done(); rmSync(outside, { recursive: true, force: true }); }
  });

  test("red: inside the rollback window it is refused and kept", async () => {
    const f = fakeData();
    try {
      f.cluster("db.old", "17");
      f.switched({ ageS: 60 });
      expect(await deleteOldDatabase(f.env, NOW)).toEqual({ ok: false, refusal: "rollback_window" });
      expect(read(join(f.data, "db.old", "PG_VERSION")).trim()).toBe("17");
    } finally { f.done(); }
  });

  test("red: during an upgrade or a switch (or with a db.new beside it) it is refused", async () => {
    const f = fakeData();
    try {
      f.cluster("db.old", "17");
      for (const phase of ["started", "switching"]) {
        f.switched({ phase, confirmed: true });
        expect(await deleteOldDatabase(f.env, NOW), phase).toEqual({ ok: false, refusal: "upgrade_in_progress" });
      }
      f.switched({ confirmed: true });
      f.cluster("db.new", "18");
      expect(await deleteOldDatabase(f.env, NOW)).toEqual({ ok: false, refusal: "upgrade_in_progress" });
      expect(f.has("db.old")).toBe(true);
    } finally { f.done(); }
  });

  test("red: a link planted at db.old is refused, and what it points at is untouched", async () => {
    const f = fakeData();
    const outside = mkdtempSync(join(tmpdir(), "kb-olddb-target-"));
    try {
      // A target that passes every content check: only the link itself gives it away.
      writeFileSync(join(outside, "PG_VERSION"), "17\n");
      writeFileSync(join(outside, "KINBOARD_AIO"), "kinboard-aio\nmajor=17\n");
      writeFileSync(join(outside, "precious"), "household photos");
      symlinkSync(outside, join(f.data, "db.old"));
      f.switched({ confirmed: true });
      expect(await deleteOldDatabase(f.env, NOW)).toEqual({ ok: false, refusal: "symlink" });
      expect(read(join(outside, "precious"))).toBe("household photos");
      expect(readdirSync(outside).sort()).toEqual(["KINBOARD_AIO", "PG_VERSION", "precious"]);
      // Nor a link at the fixed name it is moved to.
      rmSync(join(f.data, "db.old"));
      f.cluster("db.old", "17");
      symlinkSync(outside, join(f.data, TRASH_DIR));
      expect(await deleteOldDatabase(f.env, NOW)).toMatchObject({ ok: false, refusal: "symlink" });
      expect(read(join(outside, "precious"))).toBe("household photos");
      expect(f.has("db.old")).toBe(true);
    } finally { f.done(); rmSync(outside, { recursive: true, force: true }); }
  });

  test("red: a folder that is not the recorded cluster, or a live database that is not the upgraded one", async () => {
    const f = fakeData();
    try {
      f.cluster("db.old", "16");
      f.switched({ confirmed: true });
      expect(await deleteOldDatabase(f.env, NOW)).toEqual({ ok: false, refusal: "not_the_recorded_cluster" });
      rmSync(join(f.data, "db.old"), { recursive: true });
      f.cluster("db.old", "17", false);
      expect(await deleteOldDatabase(f.env, NOW)).toEqual({ ok: false, refusal: "not_the_recorded_cluster" });
      expect(f.has("db.old")).toBe(true);
      // The marker and PG_VERSION must both name it.
      writeFileSync(join(f.data, "db.old", "KINBOARD_AIO"), "kinboard-aio\nmajor=17\n");
      writeFileSync(join(f.data, "db.old", "PG_VERSION"), "16\n");
      expect(await deleteOldDatabase(f.env, NOW)).toEqual({ ok: false, refusal: "not_the_recorded_cluster" });
      expect(f.has("db.old")).toBe(true);
      rmSync(join(f.data, "db.old"), { recursive: true });
      f.cluster("db.old", "17");
      writeFileSync(join(f.data, "db", "PG_VERSION"), "17\n");
      expect(await deleteOldDatabase(f.env, NOW)).toMatchObject({ ok: false, refusal: "not_the_recorded_cluster" });
      writeFileSync(join(f.data, "db", "PG_VERSION"), "18\n");
      expect(await deleteOldDatabase({ ...f.env, PG_MAJOR: "17" }, NOW)).toMatchObject({ ok: false, refusal: "not_the_recorded_cluster" });
      expect(f.has("db.old")).toBe(true);
    } finally { f.done(); }
  });
});

/* -------------------------------------------------------- the route gates */

test.describe("who may delete it", () => {
  function deps(over: Partial<OldDatabaseDeleteDeps> = {}) {
    const calls = { remove: 0, verify: 0, logs: [] as string[] };
    const d: OldDatabaseDeleteDeps = {
      isAio: () => true,
      isOperator: async () => true,
      hasPin: async () => true,
      verifyPin: async (_f, pin) => { calls.verify++; return pin === "1234" ? "valid" : "invalid"; },
      remove: async (): Promise<DeleteResult> => { calls.remove++; return { ok: true, fromMajor: "17", bytes: 50 * 1048576 }; },
      log: (l) => calls.logs.push(l),
      ...over,
    };
    return { d, calls };
  }
  const ask = (d: OldDatabaseDeleteDeps, body: unknown = { pin: "1234" }) =>
    deleteOldDatabaseRequest({ familyId: "fam", deviceId: "dev", body }, d);

  test("green: the operator with the right PIN deletes it, and it is logged", async () => {
    const { d, calls } = deps();
    expect(await ask(d)).toEqual({ status: 200, body: { ok: true, freedBytes: 50 * 1048576 } });
    expect(calls.remove).toBe(1);
    expect(calls.logs[0]).toContain("deleted the database folder from before the PostgreSQL upgrade (PostgreSQL 17, 50 MB freed), asked by family fam, device dev");
  });

  test("red: a compose install 404s, before anything else is asked", async () => {
    const { d, calls } = deps({ isAio: () => false, isOperator: async () => { throw new Error("not asked"); } });
    expect(await ask(d)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(calls.remove).toBe(0);
  });

  test("red: any family but the install's operator: 403, the PIN never tried", async () => {
    const { d, calls } = deps({ isOperator: async () => false });
    expect(await ask(d)).toEqual({ status: 403, body: { error: "not_operator" } });
    expect(calls.verify).toBe(0);
    expect(calls.remove).toBe(0);
  });

  test("red: no PIN in the request, a family without a PIN, a wrong PIN, too many tries", async () => {
    for (const body of [null, {}, { pin: "" }, { pin: 1234 }, { pin: "x".repeat(33) }]) {
      const { d, calls } = deps();
      expect((await ask(d, body)).status, JSON.stringify(body)).toBe(400);
      expect(calls.remove).toBe(0);
    }
    {
      const { d, calls } = deps({ hasPin: async () => false });
      expect(await ask(d)).toEqual({ status: 403, body: { error: "pin_not_set" } });
      expect(calls.remove).toBe(0);
    }
    {
      const { d, calls } = deps();
      expect(await ask(d, { pin: "0000" })).toEqual({ status: 403, body: { error: "pin_invalid" } });
      expect(calls.remove).toBe(0);
    }
    {
      const { d, calls } = deps({ verifyPin: async () => "rate_limited" });
      expect(await ask(d)).toEqual({ status: 429, body: { error: "rate_limited" } });
      expect(calls.remove).toBe(0);
    }
  });

  test("red: inside the window and during an upgrade the delete's own refusal is a 409, and logged", async () => {
    for (const refusal of ["rollback_window", "upgrade_in_progress", "symlink"] as const) {
      const { d, calls } = deps({ remove: async () => ({ ok: false, refusal }) });
      expect(await ask(d)).toEqual({ status: 409, body: { error: refusal } });
      expect(calls.logs[0]).toContain(`NOT deleted (${refusal})`);
    }
  });

  test("the live route wires the shared PIN limiter and the operator check", () => {
    const src = read(join(__dirname, "..", "src", "app", "api", "old-database", "route.ts"));
    expect(src).toContain("verifyPin: (familyId, pin) => verifySettingsPin(familyId, pin)");
    expect(src).toContain("hasPin: (familyId) => familyHasPin(familyId)");
    expect(src).toContain("isOperator: (familyId) => isInstallOperator(familyId)");
    expect(src).toContain("const auth = await requireSession(request);");
  });
});

/* ------------------------------------------------ the previous image's side */

test.describe("going back after db.old was deleted", () => {
  test("refused with its own reason, and nothing is moved", () => {
    const f = fakeData();
    try {
      const build = join(f.dir, "build");
      writeFileSync(build, "version=9.9.9\nrevision=test\npg_major=17\npg_previous_majors=\n");
      // The previous image (17) on an 18 database whose record was never
      // confirmed, forced past the window: the old folder is gone.
      f.state(`phase=switched\nfrom=17\nto=18\ndump=/data/backups/pre-pg18-upgrade-x.sql.gz\nswitched_epoch=${Math.floor(Date.now() / 1000) - 90000}\nconfirmed_at=\n`);
      const env = { ...process.env, KINBOARD_DATA: f.data, KINBOARD_AIO_BUILD: build, KINBOARD_PG_ROLLBACK: "1",
        PUID: String(process.getuid?.() ?? 1000), PGID: String(process.getgid?.() ?? 1000) };
      const r = spawnSync("sh", [join(LIB, "init-db.sh")], { encoding: "utf8", env });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("the database from before that upgrade");
      expect(r.stderr).toContain("is no longer there: it was deleted, so there is nothing to go back to");
      expect(r.stderr).toContain("pre-pg18-upgrade-x.sql.gz");
      expect(readdirSync(f.data).sort()).toEqual(["config", "db"]);
      expect(read(join(f.data, "db", "PG_VERSION")).trim()).toBe("18");
      expect(read(join(f.data, "config", "updater", "pg-upgrade"))).toContain("phase=switched");
    } finally { f.done(); }
  });
});
