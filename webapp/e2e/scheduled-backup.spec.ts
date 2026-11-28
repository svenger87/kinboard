import { test, expect } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  arm,
  decide,
  EMPTY_STATE,
  finished,
  latestSlot,
  markCutOff,
  MAX_ATTEMPTS_PER_SLOT,
  nextRunAt,
  nextSlot,
  parseConfig,
  resolveConfig,
  started,
  zonedInstant,
  type BackupState,
  type ResolvedConfig,
} from "../src/lib/scheduled-backup/schedule";
import { isMountPoint, resolveBackupDir, listBackupFiles } from "../src/lib/scheduled-backup/store";
import { issueTicket, redeemTicket, scheduledBackupRequest, DOWNLOAD_TTL_MS, type BackupRequestDeps } from "../src/lib/scheduled-backup/request";
import { LOCKED, runBackup as runScheduled, type ChildResult, type RunDeps } from "../src/lib/scheduled-backup/runner";

/**
 * The all-in-one image's scheduled backups: the schedule and its env
 * override (lib/scheduled-backup/schedule.ts), retention, the files' modes,
 * atomicity and the read-back check (image/kinboard-scheduled-backup.mjs),
 * the lock shared with kinboard-backup.sh, and the gates of the Settings
 * route (lib/scheduled-backup/request.ts). Real folders and real tar
 * archives in a temp dir; fakes for the operator, the PIN and the clock.
 */

const WEBAPP = join(__dirname, "..");
const ROOT = join(WEBAPP, "..");
const IMAGE = join(WEBAPP, "image");
const ENGINE = join(IMAGE, "kinboard-scheduled-backup.mjs");
const read = (p: string) => readFileSync(p, "utf8");

interface Engine {
  runBackup(o: { dir: string; keep?: number; version?: string; now?: () => Date; exportTo: (out: string) => Promise<void>; log?: (s: string) => void }): Promise<{ ok: boolean; file?: string; bytes?: number; error?: string; removed?: string[] }>;
  verifyArchive(p: string): Promise<{ problems: string[] }>;
  listBackups(dir: string): { name: string; bytes: number }[];
  pruneList(names: string[], keep: number, current?: string | null): string[];
  removeExportLeftovers(o: { filesDir: string; tmp?: string; olderThanMs?: number; now?: number }): string[];
  BACKUP_NAME: RegExp;
}
const engine = import("../image/kinboard-scheduled-backup.mjs") as unknown as Promise<Engine>;

const BERLIN = "Europe/Berlin";
const at = (iso: string) => Date.parse(iso);
const cfg = (c: Partial<ResolvedConfig> = {}): ResolvedConfig => ({ frequency: "daily", time: "03:00", day: 0, keep: 7, source: "settings", error: null, ...c });

/* ----------------------------------------------------- archives on disk */

function tmp(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Writes an export archive the way `kinboard export` lays it out, at `out`.
 * `tamper` breaks one thing after the manifest is written.
 */
function makeArchive(out: string, opts: { rows?: number; photo?: Buffer; tamper?: "rows" | "file" | "no-families" | "extra-entry" | "control-char" } = {}) {
  const w = tmp("kb-sb-arch-");
  try {
    mkdirSync(join(w, "data"));
    mkdirSync(join(w, "secrets"));
    mkdirSync(join(w, "files", "family-photos"), { recursive: true });
    const rows = opts.rows ?? 3;
    writeFileSync(join(w, "data", "0001.copy"), Array.from({ length: rows }, (_, i) => `id-${i}\tfamily ${i}\\nwith a newline\n`).join(""));
    writeFileSync(join(w, "data", "0002.copy"), "");
    writeFileSync(join(w, "secrets", "jwt_secret"), "s3cret");
    const photo = opts.photo ?? Buffer.from("not really a jpeg");
    writeFileSync(join(w, "files", "family-photos", "a.jpg"), photo);
    const manifest = {
      format: "kinboard-export",
      formatVersion: 1,
      kinboard: { version: "1.18.0" },
      migrations: [{ name: "001_base.sql", checksum: "a" }],
      tables: [
        { schema: "public", table: opts.tamper === "no-families" ? "people" : "families", columns: ["id", "name"], rows, checksum: "", file: "data/0001.copy" },
        { schema: "public", table: "notes", columns: ["id"], rows: 0, checksum: "", file: "data/0002.copy" },
      ],
      sequences: [],
      files: [{ path: "family-photos/a.jpg", size: photo.length, sha256: createHash("sha256").update(photo).digest("hex") }],
      secrets: ["JWT_SECRET"],
    };
    writeFileSync(join(w, "manifest.json"), JSON.stringify(manifest));
    if (opts.tamper === "rows") writeFileSync(join(w, "data", "0001.copy"), "only one row\n");
    if (opts.tamper === "file") writeFileSync(join(w, "files", "family-photos", "a.jpg"), "changed while it was archived");
    const entries = ["manifest.json", "data", "secrets", "files"];
    if (opts.tamper === "control-char") {
      writeFileSync(join(w, "files", "family-photos", "a\u001b[2Jb.jpg"), "x");
    }
    if (opts.tamper === "extra-entry") {
      writeFileSync(join(w, "extra.sh"), "echo hi");
      entries.push("extra.sh");
    }
    const r = spawnSync("tar", ["-czf", out, "-C", w, ...entries]);
    if (r.status !== 0) throw new Error(`tar: ${r.stderr}`);
  } finally {
    rmSync(w, { recursive: true, force: true });
  }
}

const exportOk = (opts: Parameters<typeof makeArchive>[1] = {}) => async (out: string) => makeArchive(out, opts);
let clock = at("2026-11-28T02:00:00Z");
const tick = () => new Date((clock += 60_000));

/* ------------------------------------------------------------- schedule */

test.describe("the schedule: settings, the server's variables, and the times", () => {
  test("off unless switched on; Settings' choice applies when the server sets nothing", () => {
    expect(resolveConfig({}, null)).toMatchObject({ frequency: "off", source: "default", error: null, keep: 7, time: "03:00" });
    expect(resolveConfig({}, JSON.stringify({ frequency: "weekly", time: "4:30", day: 3, keep: 4 }))).toMatchObject({ frequency: "weekly", time: "04:30", day: 3, keep: 4, source: "settings" });
    expect(resolveConfig({}, "{not json"), "a damaged stored value is off, not a guess").toMatchObject({ frequency: "off", source: "default" });
    expect(resolveConfig({}, JSON.stringify({ frequency: "hourly", time: "03:00", day: 0, keep: 7 })).frequency).toBe("off");
  });

  test("KINBOARD_BACKUP_SCHEDULE, when set, wins over Settings; empty is unset (Unraid passes empty fields)", () => {
    const stored = JSON.stringify({ frequency: "weekly", time: "05:00", day: 2, keep: 3 });
    expect(resolveConfig({ KINBOARD_BACKUP_SCHEDULE: "daily" }, stored)).toEqual({ frequency: "daily", time: "03:00", day: 0, keep: 7, source: "server", error: null });
    expect(resolveConfig({ KINBOARD_BACKUP_SCHEDULE: " Weekly ", KINBOARD_BACKUP_TIME: "23:15", KINBOARD_BACKUP_DAY: "fri", KINBOARD_BACKUP_KEEP: "12" }, stored)).toEqual({
      frequency: "weekly", time: "23:15", day: 5, keep: 12, source: "server", error: null,
    });
    expect(resolveConfig({ KINBOARD_BACKUP_SCHEDULE: "off" }, stored)).toMatchObject({ frequency: "off", source: "server" });
    expect(resolveConfig({ KINBOARD_BACKUP_SCHEDULE: "", KINBOARD_BACKUP_TIME: "" }, stored)).toMatchObject({ frequency: "weekly", source: "settings" });
  });

  test("a server value it doesn't understand switches the backups off and says which", () => {
    const r = resolveConfig({ KINBOARD_BACKUP_SCHEDULE: "nightly", KINBOARD_BACKUP_TIME: "25:00", KINBOARD_BACKUP_KEEP: "0" }, null);
    expect(r.frequency).toBe("off");
    expect(r.source).toBe("server");
    expect(r.error).toContain('KINBOARD_BACKUP_SCHEDULE="nightly"');
    expect(r.error).toContain('KINBOARD_BACKUP_TIME="25:00"');
    expect(r.error).toContain('KINBOARD_BACKUP_KEEP="0"');
    expect(decide(r, EMPTY_STATE, at("2026-11-28T12:00:00Z"), BERLIN)).toEqual({ due: false, reason: "invalid" });
    expect(resolveConfig({ KINBOARD_BACKUP_SCHEDULE: "daily", KINBOARD_BACKUP_DAY: "someday" }, null).error).toContain("KINBOARD_BACKUP_DAY");
  });

  test("Settings' input is checked field by field", () => {
    expect(parseConfig({ frequency: "daily", time: "03:00", day: 0, keep: 7 })).not.toBeNull();
    for (const bad of [
      { frequency: "daily", time: "3", day: 0, keep: 7 },
      { frequency: "daily", time: "03:00", day: 7, keep: 7 },
      { frequency: "daily", time: "03:00", day: 0, keep: 0 },
      { frequency: "daily", time: "03:00", day: 0, keep: 366 },
      { frequency: "sometimes", time: "03:00", day: 0, keep: 7 },
      null,
      "daily",
    ]) expect(parseConfig(bad), JSON.stringify(bad)).toBeNull();
  });

  test("03:00 is the household's wall clock, across both DST changes", () => {
    expect(new Date(zonedInstant(2026, 7, 1, 3, 0, BERLIN)).toISOString()).toBe("2026-07-01T01:00:00.000Z");
    expect(new Date(zonedInstant(2026, 1, 15, 3, 0, BERLIN)).toISOString()).toBe("2026-01-15T02:00:00.000Z");
    // 02:30 does not exist on 29 March: the first minute that does, 03:00 CEST.
    expect(new Date(zonedInstant(2026, 3, 29, 2, 30, BERLIN)).toISOString()).toBe("2026-03-29T01:00:00.000Z");
    // 02:30 happens twice on 25 October: the first.
    expect(new Date(zonedInstant(2026, 10, 25, 2, 30, BERLIN)).toISOString()).toBe("2026-10-25T00:30:00.000Z");
    const daily = cfg();
    expect(new Date(latestSlot(daily, at("2026-11-28T12:00:00Z"), BERLIN)!).toISOString()).toBe("2026-11-28T02:00:00.000Z");
    expect(new Date(nextSlot(daily, at("2026-11-28T12:00:00Z"), BERLIN)!).toISOString()).toBe("2026-11-29T02:00:00.000Z");
    const weekly = cfg({ frequency: "weekly", day: 3, time: "22:45" });
    expect(new Date(nextSlot(weekly, at("2026-11-28T12:00:00Z"), BERLIN)!).toISOString()).toBe("2026-12-02T21:45:00.000Z");
    expect(new Date(latestSlot(weekly, at("2026-11-28T12:00:00Z"), BERLIN)!).toISOString()).toBe("2026-11-25T21:45:00.000Z");
    expect(latestSlot(cfg({ frequency: "off" }), Date.now(), BERLIN)).toBeNull();
  });
});

test.describe("when a backup is due", () => {
  const armedAt = (iso: string, c = cfg()) => arm(c, EMPTY_STATE, at(iso));

  test("switched on in the afternoon, the first backup is the next night's, not the slot already past", () => {
    const s = armedAt("2026-11-28T14:00:00Z");
    expect(decide(cfg(), s, at("2026-11-28T14:05:00Z"), BERLIN)).toEqual({ due: false, reason: "not_yet" });
    expect(decide(cfg(), s, at("2026-11-29T01:59:00Z"), BERLIN).due).toBe(false);
    expect(decide(cfg(), s, at("2026-11-29T02:00:00Z"), BERLIN)).toEqual({ due: true, slot: at("2026-11-29T02:00:00Z") });
  });

  test("changing the time re-arms; turning it off disarms", () => {
    const s = armedAt("2026-11-01T00:00:00Z");
    const changed = arm(cfg({ time: "04:00" }), s, at("2026-11-28T02:30:00Z"));
    expect(changed.armedAt).toBe("2026-11-28T02:30:00.000Z");
    expect(decide(cfg({ time: "04:00" }), changed, at("2026-11-28T02:31:00Z"), BERLIN).due, "03:00's slot predates the change").toBe(false);
    expect(arm(cfg(), s, at("2026-11-28T00:00:00Z")), "unchanged: the same object").toBe(s);
    expect(arm(cfg({ frequency: "off" }), s, Date.now())).toMatchObject({ armedAt: null, armedKey: null });
  });

  test("done once per slot; a slot missed while the container was stopped runs once at the next look", () => {
    let s = armedAt("2026-11-20T12:00:00Z");
    s = finished(started(s, "schedule", at("2026-11-26T02:00:05Z"), at("2026-11-26T02:00:00Z")), at("2026-11-26T02:03:00Z"), { ok: true, file: "f", dir: "/d", bytes: 1 });
    expect(decide(cfg(), s, at("2026-11-26T09:00:00Z"), BERLIN)).toEqual({ due: false, reason: "done" });
    // Stopped from the 26th's evening to the 28th at noon: one run, for the 28th's slot.
    expect(decide(cfg(), s, at("2026-11-28T12:00:00Z"), BERLIN)).toEqual({ due: true, slot: at("2026-11-28T02:00:00Z") });
  });

  test("a failure is retried an hour later, three times per slot at most, then the next slot tries again", () => {
    const slot = at("2026-11-28T02:00:00Z");
    let s = armedAt("2026-11-20T12:00:00Z");
    let now = slot;
    for (let n = 1; n <= MAX_ATTEMPTS_PER_SLOT; n++) {
      expect(decide(cfg(), s, now, BERLIN), `attempt ${n}`).toEqual({ due: true, slot });
      s = finished(started(s, "schedule", now, slot), now + 60_000, { ok: false, error: "disk full" });
      expect(decide(cfg(), s, now + 30 * 60_000, BERLIN), "half an hour later").toMatchObject({ due: false, reason: n < MAX_ATTEMPTS_PER_SLOT ? "retry_later" : "gave_up" });
      now += 61 * 60_000 + 60_000;
    }
    expect(s.slotAttempts).toBe(MAX_ATTEMPTS_PER_SLOT);
    expect(decide(cfg(), s, now + 3 * 3_600_000, BERLIN)).toEqual({ due: false, reason: "gave_up" });
    expect(decide(cfg(), s, at("2026-11-29T02:00:00Z"), BERLIN), "the next night").toEqual({ due: true, slot: at("2026-11-29T02:00:00Z") });
    expect(s.failingSince).toBe(new Date(slot + 60_000).toISOString());
    expect(nextRunAt(cfg(), s, at("2026-11-28T12:00:00Z"), BERLIN)).toBe(at("2026-11-29T02:00:00Z"));
  });

  test("a run cut off by a stop is recorded as such at the next start, and retried ten minutes later", () => {
    const slot = at("2026-11-28T02:00:00Z");
    let s = started(armedAt("2026-11-20T12:00:00Z"), "schedule", slot, slot);
    expect(decide(cfg(), s, slot + 60_000, BERLIN)).toEqual({ due: false, reason: "running" });
    s = markCutOff(s, slot + 5 * 60_000);
    expect(s.lastAttempt).toMatchObject({ ok: false, cutOff: true });
    expect(s.lastAttempt?.error).toContain("cut off");
    expect(decide(cfg(), s, slot + 10 * 60_000, BERLIN).due).toBe(false);
    expect(decide(cfg(), s, slot + 16 * 60_000, BERLIN)).toEqual({ due: true, slot });
    expect(markCutOff(s, Date.now()), "a finished attempt is left alone").toBe(s);
  });

  test("a success clears the failure; a manual run does not use up a slot's attempts", () => {
    let s: BackupState = armedAt("2026-11-20T12:00:00Z");
    s = finished(started(s, "manual", at("2026-11-28T01:00:00Z"), null), at("2026-11-28T01:01:00Z"), { ok: false, error: "x" });
    expect(s.slotAttempts).toBe(0);
    expect(s.failingSince).not.toBeNull();
    s = finished(started(s, "manual", at("2026-11-28T01:30:00Z"), null), at("2026-11-28T01:31:00Z"), { ok: true, file: "f", dir: "/d", bytes: 9 });
    expect(s.failingSince).toBeNull();
    expect(decide(cfg(), s, at("2026-11-28T02:00:00Z"), BERLIN).due, "a manual backup before the slot doesn't replace it").toBe(true);
  });
});

/* --------------------------------------------------- where they go */

test.describe("where the backups go", () => {
  const env = { KINBOARD_AIO: "1", KINBOARD_DATA: "/data" };
  test("KINBOARD_BACKUP_PATH, then a folder mounted at /backups, then /data/backups/scheduled; nothing outside the all-in-one image", () => {
    expect(resolveBackupDir({ ...env, KINBOARD_BACKUP_PATH: "/mnt/x/" }, () => true)).toEqual({ dir: "/mnt/x", source: "env" });
    expect(resolveBackupDir(env, (p) => p === "/backups")).toEqual({ dir: "/backups", source: "mount" });
    expect(resolveBackupDir(env, () => false)).toEqual({ dir: "/data/backups/scheduled", source: "data" });
    expect(resolveBackupDir({ KINBOARD_DATA: "/data" }, () => true)).toBeNull();
    expect(resolveBackupDir({ ...env, KINBOARD_BACKUP_PATH: "/data/backups/elsewhere" }, () => false)).toEqual({ dir: "/data/backups/elsewhere", source: "env" });
    for (const bad of ["/data", "/data/storage/files/b", "/data/db/x", "relative/path"]) {
      expect(resolveBackupDir({ ...env, KINBOARD_BACKUP_PATH: bad }, () => false)?.problem, bad).toBeTruthy();
    }
  });
  test("a mount point is read from mountinfo, escapes included", () => {
    const mi = "36 35 98:0 /mnt1 /backups rw,noatime master:1 - ext3 /dev/root rw\n37 35 98:0 / /my\\040backups rw - ext4 /dev/sda1 rw\n";
    expect(isMountPoint("/backups", mi)).toBe(true);
    expect(isMountPoint("/my backups", mi)).toBe(true);
    expect(isMountPoint("/data", mi)).toBe(false);
  });
});

/* ------------------------------------------------- one backup, on disk */

test.describe("one backup: verified, atomic, private, pruned", () => {
  test("written 0600 into a folder it made 0700, named with its stamp and version, verified", async () => {
    const e = await engine;
    const root = tmp("kb-sb-");
    try {
      const dir = join(root, "scheduled");
      const r = await e.runBackup({ dir, keep: 7, version: "1.18.0", now: tick, exportTo: exportOk(), log: () => {} });
      expect(r.ok, r.error).toBe(true);
      expect(r.file).toMatch(/^kinboard-backup-\d{8}T\d{6}Z-1\.18\.0\.tar\.gz$/);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, r.file!)).mode & 0o777).toBe(0o600);
      expect(readdirSync(dir)).toEqual([r.file]);
      expect((await e.verifyArchive(join(dir, r.file!))).problems).toEqual([]);
      expect((await listBackupFiles(dir))[0]).toMatchObject({ name: r.file, version: "1.18.0" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps the newest N and removes the older ones only after the new one verified", async () => {
    const e = await engine;
    const dir = tmp("kb-sb-keep-");
    try {
      const names: string[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await e.runBackup({ dir, keep: 3, version: "1.18.0", now: tick, exportTo: exportOk(), log: () => {} });
        expect(r.ok).toBe(true);
        names.push(r.file!);
      }
      expect(e.listBackups(dir).map((b) => b.name)).toEqual(names.slice(2).reverse());
      // A failing run removes nothing, even with keep 1.
      const bad = await e.runBackup({ dir, keep: 1, now: tick, exportTo: exportOk({ tamper: "rows" }), log: () => {} });
      expect(bad.ok).toBe(false);
      expect(e.listBackups(dir).map((b) => b.name)).toEqual(names.slice(2).reverse());
      // Somebody else's files in the folder are never touched.
      writeFileSync(join(dir, "notes.txt"), "mine");
      writeFileSync(join(dir, "kinboard-backup-old.tar.gz"), "not one of ours by name");
      const r = await e.runBackup({ dir, keep: 1, version: "1.18.0", now: tick, exportTo: exportOk(), log: () => {} });
      expect(r.removed).toHaveLength(3);
      expect(readdirSync(dir).sort()).toEqual(["kinboard-backup-old.tar.gz", "notes.txt", r.file!].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the retention list keeps the newest, at least one, and only names that are backups", async () => {
    const e = await engine;
    const n = (s: string) => `kinboard-backup-2026112${s}T030000Z-1.18.0.tar.gz`;
    expect(e.pruneList([n("1"), n("3"), n("2"), n("4")], 2)).toEqual([n("2"), n("1")]);
    expect(e.pruneList([n("1"), n("2")], 0), "0 still keeps the newest").toEqual([n("1")]);
    expect(e.pruneList([n("1"), ".kinboard-backup-20261121T030000Z.partial", "x.tar.gz"], 1)).toEqual([]);
    // A file from the future (a clock that once ran ahead, a backup copied back in) never pushes out the one just written.
    const future = "kinboard-backup-20991231T000000Z-1.18.0.tar.gz";
    expect(e.pruneList([n("1"), n("2"), future], 1, n("2"))).toEqual([future, n("1")]);
    expect(e.pruneList([n("1"), n("2"), future], 2, n("2"))).toEqual([n("1")]);
  });

  test("an archive that doesn't verify is never named a backup, and the last good one stays", async () => {
    const e = await engine;
    const dir = tmp("kb-sb-verify-");
    try {
      const good = await e.runBackup({ dir, keep: 7, now: tick, exportTo: exportOk(), log: () => {} });
      expect(good.ok).toBe(true);
      const cases: [string, (out: string) => Promise<void>, RegExp][] = [
        ["a row missing from a table", exportOk({ tamper: "rows" }), /1 row\(s\) in data\/0001\.copy, the manifest says 3/],
        ["a photo changed while it was archived", exportOk({ tamper: "file" }), /files\/family-photos\/a\.jpg: differs/],
        ["no families table", exportOk({ tamper: "no-families" }), /no public\.families/],
        ["an entry an export doesn't have", exportOk({ tamper: "extra-entry" }), /extra\.sh: not an entry/],
        ["a name kinboard import would refuse (a control character)", exportOk({ tamper: "control-char" }), /a control character in a name/],
        ["an install with no family yet (a fresh one, about to be restored into)", exportOk({ rows: 0 }), /no family yet, so there is nothing to back up/],
        ["cut short by a full disk", async (out) => { makeArchive(out, { photo: Buffer.alloc(200_000, 7) }); const b = readFileSync(out); writeFileSync(out, b.subarray(0, b.length >> 1)); }, /does not decompress|cut short/],
        ["the disk ran full", async () => { throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }); }, /the disk with .* is full\..*already there are kept/],
        ["the export failed", async () => { throw new Error("pg is down"); }, /pg is down/],
      ];
      for (const [what, exportTo, msg] of cases) {
        const r = await e.runBackup({ dir, keep: 1, now: tick, exportTo, log: () => {} });
        expect(r.ok, what).toBe(false);
        expect(r.error, what).toMatch(msg);
        expect(readdirSync(dir), `${what}: only the good one is left`).toEqual([good.file]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a backup killed half-way leaves no file that counts, and the next run clears it away", async () => {
    const e = await engine;
    const dir = tmp("kb-sb-kill-");
    let child: ChildProcess | null = null;
    try {
      const good = await e.runBackup({ dir, keep: 7, now: tick, exportTo: exportOk(), log: () => {} });
      const script = join(dir, "..", `kb-sb-kill-${process.pid}.mjs`);
      writeFileSync(
        script,
        `import { writeFileSync } from "node:fs";\n` +
          `const { runBackup } = await import(${JSON.stringify(ENGINE)});\n` +
          `await runBackup({ dir: ${JSON.stringify(dir)}, keep: 1, exportTo: async (out) => { writeFileSync(out, Buffer.alloc(4096, 1)); console.log("WRITING"); await new Promise(() => setInterval(() => {}, 1000)); } });\n`,
      );
      child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
      await new Promise<void>((resolve) => child!.stdout!.on("data", (b: Buffer) => { if (b.toString().includes("WRITING")) resolve(); }));
      child.kill("SIGKILL");
      await new Promise((r) => child!.on("exit", r));
      rmSync(script, { force: true });
      const left = readdirSync(dir);
      expect(left.filter((n) => n.startsWith(".kinboard-backup-")), "its unfinished file").toHaveLength(1);
      expect(e.listBackups(dir).map((b) => b.name), "counted: only the good one").toEqual([good.file]);
      expect((await listBackupFiles(dir)).map((b) => b.name), "Settings counts the same").toEqual([good.file]);
      const next = await e.runBackup({ dir, keep: 7, now: tick, exportTo: exportOk(), log: () => {} });
      expect(next.ok).toBe(true);
      expect(readdirSync(dir).filter((n) => n.startsWith("."))).toEqual([]);
    } finally {
      child?.kill("SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("what a cut-off export left (its keys in /tmp, links to every photo) is removed, only when stale and only by its name", async () => {
    const e = await engine;
    const root = tmp("kb-sb-exp-");
    try {
      const t = join(root, "tmp");
      const storage = join(root, "storage");
      for (const d of [join(t, "kinboard-export-abc123"), join(t, "kinboard-export-new456"), join(t, "kinboard-import-xyz789"), join(storage, ".kinboard-export-Q1w2E3"), join(storage, "files")]) mkdirSync(d, { recursive: true });
      writeFileSync(join(t, "kinboard-export-abc123", "jwt_secret"), "k");
      const old = Date.now() - 7 * 3600_000;
      spawnSync("touch", ["-d", new Date(old).toISOString(), join(t, "kinboard-export-abc123"), join(storage, ".kinboard-export-Q1w2E3")]);
      const removed = e.removeExportLeftovers({ filesDir: join(storage, "files"), tmp: t });
      expect(removed.sort()).toEqual([join(storage, ".kinboard-export-Q1w2E3"), join(t, "kinboard-export-abc123")].sort());
      expect(readdirSync(t).sort(), "a recent one (an export running by hand) and an import's are left").toEqual(["kinboard-export-new456", "kinboard-import-xyz789"]);
      expect(readdirSync(storage)).toEqual(["files"]);
      expect(e.removeExportLeftovers({ filesDir: join(storage, "files"), tmp: t, olderThanMs: 0 }), "at the start: any age").toEqual([join(t, "kinboard-export-new456")]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a folder that is a symlink, or not writable, is refused with both owners named", async () => {
    const e = await engine;
    const root = tmp("kb-sb-perm-");
    try {
      mkdirSync(join(root, "real"));
      symlinkSync(join(root, "real"), join(root, "link"));
      const viaLink = await e.runBackup({ dir: join(root, "link"), exportTo: exportOk(), log: () => {} });
      expect(viaLink.ok).toBe(false);
      expect(viaLink.error).toContain("is a symlink");
      expect(readdirSync(join(root, "real"))).toEqual([]);
      if (process.getuid?.() !== 0) {
        mkdirSync(join(root, "ro"));
        chmodSync(join(root, "ro"), 0o500);
        const ro = await e.runBackup({ dir: join(root, "ro"), exportTo: exportOk(), log: () => {} });
        expect(ro.ok).toBe(false);
        expect(ro.error).toMatch(/is not writable for Kinboard \(it runs as \d+:\d+, the folder belongs to \d+:\d+/);
        chmodSync(join(root, "ro"), 0o700);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/* -------------------------------------------------------------- the lock */

test.describe("one backup at a time: the lock kinboard-backup.sh shares", () => {
  /** A pg_dumpall that passes kinboard-backup.sh's checks, and leaves a mark when it ran. */
  function fakeDumpall(root: string) {
    const bin = join(root, "pg_dumpall");
    writeFileSync(
      bin,
      `#!/bin/sh\ntouch "${root}/dumped"\necho 'CREATE ROLE authenticator;'\necho 'CREATE TABLE public.families (id int);'\ni=0; while [ $i -lt 60 ]; do echo "CREATE TABLE public.t$i (id int);"; i=$((i+1)); done\n`,
    );
    chmodSync(bin, 0o755);
    return bin;
  }
  const backupSh = (root: string, env: Record<string, string>) =>
    spawnSync("sh", [join(IMAGE, "kinboard-backup.sh"), join(root, "out"), "pre-update"], { env: { ...process.env, PG_DUMPALL: fakeDumpall(root), ...env }, encoding: "utf8" });

  test("the scheduled backup's wrapper says busy (75) while the update's dump holds the lock, and runs when it is free", () => {
    const root = tmp("kb-sb-lock-");
    const lock = join(root, ".lock");
    // One process holding it (flock <file> <cmd> would leave its child holding it after a kill).
    const holder = spawn("sh", ["-c", 'exec 9>>"$0"; flock 9; exec sleep 20', lock], { stdio: "ignore" });
    try {
      // Wait until the holder has it.
      for (let i = 0; i < 50 && spawnSync("flock", ["-n", lock, "true"]).status === 0; i++) spawnSync("sleep", ["0.1"]);
      expect(spawnSync("sh", ["-c", LOCKED, lock, "true"]).status).toBe(75);
      holder.kill("SIGKILL");
      for (let i = 0; i < 50 && spawnSync("flock", ["-n", lock, "true"]).status !== 0; i++) spawnSync("sleep", ["0.1"]);
      expect(spawnSync("sh", ["-c", LOCKED, lock, "true"]).status).toBe(0);
    } finally {
      holder.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("kinboard-backup.sh (the update's dump) waits for a running scheduled backup, and gives up without dumping when it takes too long", () => {
    const root = tmp("kb-sb-lock2-");
    const lock = join(root, ".lock");
    const scheduled = spawn("sh", ["-c", LOCKED, lock, "sleep", "4"], { stdio: "ignore" });
    try {
      for (let i = 0; i < 50 && spawnSync("flock", ["-n", lock, "true"]).status === 0; i++) spawnSync("sleep", ["0.1"]);
      const gaveUp = backupSh(root, { KINBOARD_BACKUP_LOCK: lock, KINBOARD_BACKUP_LOCK_WAIT: "1" });
      expect(gaveUp.status).toBe(1);
      expect(gaveUp.stderr).toContain("waiting for it to finish");
      expect(gaveUp.stderr).toContain("still held the backup lock");
      expect(existsSync(join(root, "dumped")), "no dump while the scheduled backup ran").toBe(false);
      const t0 = Date.now();
      const waited = backupSh(root, { KINBOARD_BACKUP_LOCK: lock, KINBOARD_BACKUP_LOCK_WAIT: "30" });
      expect(waited.status, waited.stderr).toBe(0);
      expect(Date.now() - t0, "it waited for the scheduled backup").toBeGreaterThan(1500);
      expect(existsSync(join(root, "dumped"))).toBe(true);
    } finally {
      scheduled.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("without KINBOARD_BACKUP_LOCK (a compose install, an older caller) it dumps as before", () => {
    const root = tmp("kb-sb-lock3-");
    try {
      const r = backupSh(root, {});
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toMatch(/pre-update-\d{8}T\d{6}Z\.sql\.gz$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the runner records nothing for a run the lock turned away, and says busy", async () => {
    let state: BackupState = { ...EMPTY_STATE, lastAttempt: { startedAt: "2026-11-27T02:00:00.000Z", finishedAt: "2026-11-27T02:01:00.000Z", ok: true, error: null, trigger: "schedule" } };
    const deps: RunDeps = {
      now: () => at("2026-11-28T02:00:00Z"),
      read: async () => state,
      write: async (_d, s) => { state = s; },
      child: async (): Promise<ChildResult> => ({ code: 75, result: null, stderrTail: "" }),
    };
    const before = JSON.stringify(state);
    const r = await runScheduled("schedule", { data: "/data", location: { dir: "/backups", source: "mount" }, keep: 7, slot: at("2026-11-28T02:00:00Z") }, deps);
    expect(r).toEqual({ status: "busy" });
    expect(JSON.stringify(state)).toBe(before);
  });

  test("a refused folder fails the run with its reason, without starting a backup", async () => {
    let state: BackupState = { ...EMPTY_STATE };
    let spawned = 0;
    const deps: RunDeps = { now: () => at("2026-11-28T02:00:00Z"), read: async () => state, write: async (_d, s) => { state = s; }, child: async () => { spawned++; return { code: 0, result: { ok: true, file: "x" }, stderrTail: "" }; } };
    const r = await runScheduled("manual", { data: "/data", location: { dir: "/data/storage/files/b", source: "env", problem: "KINBOARD_BACKUP_PATH=/data/storage/files/b is inside /data" }, keep: 7, slot: null }, deps);
    expect(r).toEqual({ status: "failed", error: "KINBOARD_BACKUP_PATH=/data/storage/files/b is inside /data" });
    expect(spawned).toBe(0);
    expect(state.lastAttempt?.ok).toBe(false);
  });

  test("the runner records a failure with the child's own reason, and a success with its file", async () => {
    let state: BackupState = { ...EMPTY_STATE };
    let child: ChildResult = { code: 1, result: { ok: false, error: "the disk is full (/backups)" }, stderrTail: "" };
    const deps: RunDeps = { now: () => at("2026-11-28T02:00:00Z"), read: async () => state, write: async (_d, s) => { state = s; }, child: async () => child };
    const opts = { data: "/data", location: { dir: "/backups", source: "mount" as const }, keep: 7, slot: at("2026-11-28T02:00:00Z") };
    expect(await runScheduled("schedule", opts, deps)).toEqual({ status: "failed", error: "the disk is full (/backups)" });
    expect(state.lastAttempt).toMatchObject({ ok: false, error: "the disk is full (/backups)" });
    child = { code: 0, result: { ok: true, file: "kinboard-backup-20261128T020000Z-1.18.0.tar.gz", bytes: 1234 }, stderrTail: "" };
    expect(await runScheduled("schedule", opts, deps)).toMatchObject({ status: "ok", bytes: 1234 });
    expect(state.lastSuccess).toMatchObject({ file: "kinboard-backup-20261128T020000Z-1.18.0.tar.gz", bytes: 1234, dir: "/backups" });
    expect(state.failingSince).toBeNull();
  });
});

/* ------------------------------------------------------------- the gates */

test.describe("who may change, start or download them", () => {
  function fakes(over: Partial<BackupRequestDeps> = {}) {
    const calls: string[] = [];
    const deps: BackupRequestDeps = {
      isAio: () => true,
      isOperator: async () => true,
      hasPin: async () => true,
      verifyPin: async (_f, pin) => { calls.push(`pin:${pin}`); return pin === "1234" ? "valid" : "invalid"; },
      config: async () => cfg({ source: "settings" }),
      save: async (c) => { calls.push(`save:${c.frequency}`); },
      runNow: async () => { calls.push("run"); return "started"; },
      issueDownload: async () => { calls.push("download"); return { url: "/api/scheduled-backup/download?token=x", file: "f" }; },
      log: () => {},
      ...over,
    };
    return { deps, calls };
  }
  const req = (body: unknown) => ({ familyId: "fam-1", deviceId: "dev-1", body });
  const save = { action: "save", pin: "1234", config: { frequency: "daily", time: "03:00", day: 0, keep: 7 } };

  test("the operator with the PIN can save, start and download", async () => {
    const { deps, calls } = fakes();
    expect(await scheduledBackupRequest(req(save), deps)).toEqual({ status: 200, body: { ok: true } });
    expect(await scheduledBackupRequest(req({ action: "run", pin: "1234" }), deps)).toEqual({ status: 202, body: { started: true } });
    expect(await scheduledBackupRequest(req({ action: "download", pin: "1234" }), deps)).toEqual({ status: 200, body: { url: "/api/scheduled-backup/download?token=x" } });
    expect(calls).toEqual(["pin:1234", "save:daily", "pin:1234", "run", "pin:1234", "download"]);
  });

  test("not the all-in-one image: 404; not the operator: 403; nothing is done either way", async () => {
    for (const [over, status, error] of [
      [{ isAio: () => false }, 404, "not_found"],
      [{ isOperator: async () => false }, 403, "not_operator"],
    ] as const) {
      const { deps, calls } = fakes(over);
      for (const body of [save, { action: "run", pin: "1234" }, { action: "download", pin: "1234" }]) {
        expect(await scheduledBackupRequest(req(body), deps)).toEqual({ status, body: { error } });
      }
      expect(calls).toEqual([]);
    }
  });

  test("the PIN: wrong 403, none set 403, too many tries 429, missing 400; a malformed request spends no try", async () => {
    let r = fakes();
    expect(await scheduledBackupRequest(req({ ...save, pin: "0000" }), r.deps)).toEqual({ status: 403, body: { error: "pin_invalid" } });
    expect(r.calls).toEqual(["pin:0000"]);
    r = fakes({ hasPin: async () => false });
    expect(await scheduledBackupRequest(req({ action: "run", pin: "1234" }), r.deps)).toEqual({ status: 403, body: { error: "pin_not_set" } });
    expect(r.calls).toEqual([]);
    r = fakes({ verifyPin: async () => "rate_limited" });
    expect(await scheduledBackupRequest(req({ action: "run", pin: "1234" }), r.deps)).toEqual({ status: 429, body: { error: "rate_limited" } });
    r = fakes();
    for (const body of [{ action: "run" }, { action: "run", pin: "" }, { action: "run", pin: 1234 }, { action: "explode", pin: "1234" }, null, { ...save, config: { frequency: "daily" } }]) {
      expect((await scheduledBackupRequest(req(body), r.deps)).status, JSON.stringify(body)).toBe(400);
    }
    expect(r.calls, "no PIN check, nothing done").toEqual([]);
  });

  test("a schedule the server sets is not changed from Settings (409); a busy backup is not started twice (409); no backup, nothing to download (404)", async () => {
    let r = fakes({ config: async () => cfg({ source: "server" }) });
    expect(await scheduledBackupRequest(req(save), r.deps)).toEqual({ status: 409, body: { error: "set_by_server" } });
    expect(r.calls).toEqual(["pin:1234"]);
    r = fakes({ runNow: async () => "busy" });
    expect(await scheduledBackupRequest(req({ action: "run", pin: "1234" }), r.deps)).toEqual({ status: 409, body: { error: "busy" } });
    r = fakes({ issueDownload: async () => null });
    expect(await scheduledBackupRequest(req({ action: "download", pin: "1234" }), r.deps)).toEqual({ status: 404, body: { error: "no_backup" } });
  });

  test("a download link works once, for the family it was given to, for two minutes", () => {
    const t0 = Date.now();
    const a = issueTicket("fam-1", "/backups", "kinboard-backup-20261128T020000Z-1.18.0.tar.gz", t0);
    expect(redeemTicket(a, "fam-2", t0), "another family").toBeNull();
    expect(redeemTicket(a, "fam-1", t0)).toEqual({ dir: "/backups", file: "kinboard-backup-20261128T020000Z-1.18.0.tar.gz" });
    expect(redeemTicket(a, "fam-1", t0), "used up").toBeNull();
    const b = issueTicket("fam-1", "/backups", "f", t0);
    expect(redeemTicket(b, "fam-1", t0 + DOWNLOAD_TTL_MS + 1), "expired").toBeNull();
    expect(redeemTicket("../../etc/passwd", "fam-1")).toBeNull();
  });

  test("the routes take the family from the session only, and the download re-checks the operator", () => {
    const route = read(join(WEBAPP, "src/app/api/scheduled-backup/route.ts"));
    const dl = read(join(WEBAPP, "src/app/api/scheduled-backup/download/route.ts"));
    for (const src of [route, dl]) {
      expect(src).toContain("requireSession(request)");
      expect(src).not.toMatch(/family_id|searchParams\.get\("family/);
    }
    expect(dl).toContain("isInstallOperator(auth.session.familyId)");
    expect(dl).toContain("O_NOFOLLOW");
    expect(dl).toContain("BACKUP_NAME.test(ticket.file)");
  });
});

/* ----------------------------------------------------- the image's wiring */

test.describe("the image", () => {
  test("ships the engine, sets the lock, and leaves compose installs as they are", () => {
    const df = read(join(IMAGE, "Dockerfile"));
    expect(df).toContain("image/kinboard-scheduled-backup.mjs ./");
    const aio = read(join(IMAGE, "aio", "Dockerfile"));
    expect(aio).toContain("KINBOARD_BACKUP_LOCK=/data/backups/.kinboard-backup.lock");
    for (const f of ["compose.yml", "webapp/docker/docker-compose.yml", "dist/portainer/compose.yml"]) {
      expect(read(join(ROOT, f)), f).not.toMatch(/KINBOARD_BACKUP_(SCHEDULE|LOCK|PATH)/);
    }
    const start = read(join(WEBAPP, "src/lib/schedule/start.ts"));
    expect(start).toMatch(/if \(process\.env\.KINBOARD_AIO === "1"\) \{\s*void import\("\.\.\/scheduled-backup\/runner"\)/);
  });

  test("init-perms hands an empty, root-owned backup mount to PUID, and nothing else", () => {
    const src = read(join(IMAGE, "aio/rootfs/usr/local/lib/kinboard-aio/init-perms.sh"));
    const block = src.slice(src.indexOf("for b in /backups"), src.indexOf("\ndone\n", src.indexOf("for b in /backups")));
    expect(block).toContain("/proc/self/mountinfo");
    expect(block).toContain('= "0:0" ] && [ -z "$(ls -A "$b"');
    expect(block).toMatch(/"" \| \/ \| "\$DATA" \| "\$DATA"\/\*\) continue/);
    expect(block).toContain("chown -h");
    expect(block, "a trailing slash is matched like mountinfo writes it").toContain('while [ "${b%/}" != "$b" ]; do b="${b%/}"; done');
    expect(block).not.toContain("chown -R");
  });

  test("the Unraid template offers the backups folder (optional, empty) and the four variables", () => {
    const xml = read(join(ROOT, "dist/unraid/templates/kinboard.xml"));
    expect(xml).toMatch(/<Config Name="Backups \(optional\)" Target="\/backups" Default="" Mode="rw" [^>]*Type="Path" [^>]*Required="false"[^>]*><\/Config>/);
    for (const v of ["KINBOARD_BACKUP_SCHEDULE", "KINBOARD_BACKUP_TIME", "KINBOARD_BACKUP_DAY", "KINBOARD_BACKUP_KEEP"]) {
      expect(xml).toMatch(new RegExp(`Target="${v}" Default=""`));
    }
  });
});
