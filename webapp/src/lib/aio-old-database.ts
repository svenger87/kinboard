import { constants as fsc } from "node:fs";
import { lstat, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * The database folder a PostgreSQL major upgrade leaves behind in the
 * all-in-one image (RFC-024 §4.3 step 4, §4.7), for the notice in Settings
 * and its Delete button.
 *
 * The image's start step (image/aio/…/pg-lib.sh, upgrade_cluster) switches by
 * rename: the upgraded cluster becomes /data/db and the one before it
 * /data/db.old, and it records the upgrade in /data/config/updater/pg-upgrade
 * (key=value: phase, from, to, switched_at, switched_epoch, confirmed_at).
 * Until the new version has run healthy for a minute (healthwatch sets
 * confirmed_at), starting the previous image puts db.old back
 * (rollback_unconfirmed): on its own for a day after the switch
 * (KINBOARD_PG_ROLLBACK_WINDOW), after that with KINBOARD_PG_ROLLBACK=1. That
 * is the rollback window this module mirrors: inside it the folder is the way
 * back and is never deleted; after it, it is a second copy of the database
 * that nothing reads.
 *
 * Only in the all-in-one image (KINBOARD_AIO=1, set by its Dockerfile and by
 * nothing a compose install runs). Everything else gets null.
 *
 * The webapp runs as PUID:PGID, the user init-db ran the upgrade as, so
 * db.old is its own folder and it removes it itself: no root step, no
 * request file. What it removes is checked first and checked again after it
 * has been renamed out of the way, so a link or another folder planted at
 * that name is refused and what it points at is never touched.
 *
 * Server only.
 */

export const OLD_DIR = "db.old";
/** Where db.old is moved before it is removed: a fixed name, one at a time. */
export const TRASH_DIR = ".db.old.deleting";
const NEW_DIR = "db.new";
const LIVE_DIR = "db";
const STATE_FILE = join("config", "updater", "pg-upgrade");
const LAST_GOOD_FILE = join("config", "updater", "last-good");
const MARKER = "KINBOARD_AIO";
const DEFAULT_WINDOW_S = 86400;

export interface UpgradeRecord {
  phase: string;
  from: string;
  to: string;
  switchedAt: string;
  switchedEpoch: number | null;
  confirmedAt: string;
}

export interface OldDatabaseStatus {
  /** PostgreSQL major of the folder kept (the one before the upgrade). */
  fromMajor: string;
  /** PostgreSQL major the database runs on now. */
  toMajor: string;
  /** When the upgrade switched folders (ISO), or "" when the record has no time. */
  upgradedAt: string;
  /** Disk space the folder takes, in bytes (allocated blocks, cached). */
  sizeBytes: number;
  /**
   * Going back is still possible: the upgrade has not been confirmed by a
   * healthy minute. The previous image puts the folder back on its own until
   * `rollbackUntil`, and after that with KINBOARD_PG_ROLLBACK=1. It is kept,
   * and Delete is refused.
   */
  rollbackOpen: boolean;
  /** Until when the previous image goes back on its own (ISO); null once that has passed, or when unknown. */
  rollbackUntil: string | null;
  /** The Kinboard version that ran on the old database, when last-good still names it. */
  previousVersion: string | null;
  /** A delete was cut off (the container stopped): the folder is half removed, under its other name. */
  interrupted: boolean;
}

export interface AioEnv {
  KINBOARD_AIO?: string;
  KINBOARD_DATA?: string;
  PG_MAJOR?: string;
  KINBOARD_PG_ROLLBACK_WINDOW?: string;
}

/** The data folder, only in the all-in-one image. */
export function aioDataDir(env: AioEnv = process.env as AioEnv): string | null {
  if (env.KINBOARD_AIO !== "1") return null;
  const dir = env.KINBOARD_DATA?.trim() || "/data";
  return dir.startsWith("/") ? dir : null;
}

/** key=value lines, the first value of each key, as common.sh's kv_get reads them. */
export function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i);
    if (!(key in out)) out[key] = line.slice(i + 1).replace(/\r$/, "");
  }
  return out;
}

export function parseUpgradeRecord(text: string): UpgradeRecord {
  const kv = parseKv(text);
  const epoch = kv.switched_epoch ?? "";
  return {
    phase: kv.phase ?? "",
    from: kv.from ?? "",
    to: kv.to ?? "",
    switchedAt: kv.switched_at ?? "",
    switchedEpoch: /^\d{1,12}$/.test(epoch) ? Number(epoch) : null,
    confirmedAt: kv.confirmed_at ?? "",
  };
}

function windowSeconds(env: AioEnv): number {
  const raw = env.KINBOARD_PG_ROLLBACK_WINDOW ?? "";
  // Any number, as the shell's `-gt "$window"` takes it.
  return /^\d+$/.test(raw) ? Number(raw) : DEFAULT_WINDOW_S;
}

/**
 * The rollback window, from rollback_unconfirmed in pg-lib.sh. Going back is
 * possible (`open`) as long as the upgrade is switched and not confirmed by a
 * healthy minute: on its own (`automatic`) no more than the window after the
 * switch (a record without the switch's time, or one in the future after a
 * clock went backwards, is outside it there, and so here), and after that
 * with KINBOARD_PG_ROLLBACK=1 on the previous image. The folder is kept, and
 * Delete refused, while going back is possible at all: an install whose new
 * version never ran healthy for a minute must keep its way back, even past a
 * day. Once confirmed, the previous image refuses to go back whatever is set.
 */
export function rollbackWindow(
  rec: UpgradeRecord,
  now: Date,
  env: AioEnv = {},
): { open: boolean; automatic: boolean; until: string | null } {
  const open = rec.phase === "switched" && rec.confirmedAt === "";
  const nowS = Math.floor(now.getTime() / 1000);
  const automatic = open && rec.switchedEpoch !== null && nowS >= rec.switchedEpoch
    && nowS - rec.switchedEpoch <= windowSeconds(env);
  const until = automatic ? new Date((rec.switchedEpoch! + windowSeconds(env)) * 1000).toISOString() : null;
  return { open, automatic, until };
}

/** A small regular file, never through a link: null when it is anything else. */
async function readPlainFile(path: string, max = 4096): Promise<string | null> {
  let fh;
  try {
    fh = await open(path, fsc.O_RDONLY | fsc.O_NOFOLLOW | (fsc.O_NONBLOCK ?? 0));
  } catch {
    return null;
  }
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.size > max) return null;
    return (await fh.readFile("utf8")) as string;
  } finally {
    await fh.close();
  }
}

async function lstatOrNull(path: string) {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

const myUid = () => (typeof process.getuid === "function" ? process.getuid() : -1);

/**
 * Is `path` the cluster the record names? A real folder (not a link), owned
 * by this process's user, with the image's marker, and PG_VERSION the
 * record's `from`. A half-removed folder (`partial`) needs only the first two.
 */
export async function checkOldCluster(
  path: string,
  from: string,
  partial = false,
): Promise<{ ok: true; dev: number; ino: number } | { ok: false; reason: string }> {
  const st = await lstatOrNull(path);
  if (!st) return { ok: false, reason: "missing" };
  if (st.isSymbolicLink()) return { ok: false, reason: "symlink" };
  if (!st.isDirectory()) return { ok: false, reason: "not_a_folder" };
  if (st.uid !== myUid()) return { ok: false, reason: "not_owner" };
  if (!partial) {
    const version = (await readPlainFile(join(path, "PG_VERSION")))?.trim();
    if (!version || version !== from) return { ok: false, reason: "not_the_recorded_cluster" };
    const marker = await readPlainFile(join(path, MARKER));
    if (!marker || !marker.split("\n").includes(`major=${from}`)) return { ok: false, reason: "not_the_recorded_cluster" };
  }
  return { ok: true, dev: st.dev, ino: st.ino };
}

/** Is anything under `path` on another filesystem (a mount inside it)? fs.rm would empty it. */
export async function crossesDevice(path: string, dev: number, maxEntries = 500_000): Promise<boolean> {
  let seen = 0;
  const walk = async (dir: string): Promise<boolean> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (++seen > maxEntries) return true;
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      const st = await lstat(p);
      if (st.dev !== dev) return true;
      if (await walk(p)) return true;
    }
    return false;
  };
  return walk(path);
}

/** Allocated bytes under a folder, never following a link. */
export async function folderSize(path: string, maxEntries = 500_000): Promise<number> {
  let total = 0;
  let seen = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++seen > maxEntries) return;
      const p = join(dir, e.name);
      const st = await lstatOrNull(p);
      if (!st) continue;
      total += st.blocks * 512;
      if (st.isDirectory()) await walk(p);
    }
  };
  const top = await lstatOrNull(path);
  if (!top || !top.isDirectory()) return 0;
  total += top.blocks * 512;
  await walk(path);
  return total;
}

// The size is read once per folder (by inode and change time) and kept for
// ten minutes: Settings asks on every visit, the folder never changes.
const SIZE_TTL_MS = 10 * 60_000;
let sizeCache: { key: string; bytes: number; at: number } | null = null;
async function cachedSize(path: string, dev: number, ino: number, now: number): Promise<number> {
  const st = await lstatOrNull(path);
  const key = `${path}:${dev}:${ino}:${st?.ctimeMs ?? 0}`;
  if (sizeCache && sizeCache.key === key && now - sizeCache.at < SIZE_TTL_MS) return sizeCache.bytes;
  const bytes = await folderSize(path);
  sizeCache = { key, bytes, at: now };
  return bytes;
}
export function clearSizeCache() {
  sizeCache = null;
}

async function readRecord(data: string): Promise<UpgradeRecord | null> {
  const text = await readPlainFile(join(data, STATE_FILE));
  return text === null ? null : parseUpgradeRecord(text);
}

/**
 * What Settings shows: null when there is nothing to say (not the
 * all-in-one image, no folder, or a folder the record does not name).
 */
export async function readOldDatabaseStatus(
  env: AioEnv = process.env as AioEnv,
  now: Date = new Date(),
): Promise<OldDatabaseStatus | null> {
  const data = aioDataDir(env);
  if (!data) return null;
  const rec = await readRecord(data);
  if (!rec || rec.phase !== "switched" || !/^\d+$/.test(rec.from) || !/^\d+$/.test(rec.to)) return null;

  let path = join(data, OLD_DIR);
  let interrupted = false;
  let check = await checkOldCluster(path, rec.from);
  if (!check.ok && check.reason === "missing") {
    const trash = await checkOldCluster(join(data, TRASH_DIR), rec.from, true);
    if (!trash.ok) return null;
    path = join(data, TRASH_DIR);
    interrupted = true;
    check = trash;
  }
  if (!check.ok) return null;

  const win = rollbackWindow(rec, now, env);
  let previousVersion: string | null = null;
  if (win.open) {
    // Before the first healthy minute last-good still names the version
    // that ran on the old database; after it, this one.
    const lg = parseKv((await readPlainFile(join(data, LAST_GOOD_FILE))) ?? "");
    if (lg.pg_major === rec.from && /^[0-9A-Za-z.+-]{1,64}$/.test(lg.version ?? "")) previousVersion = lg.version;
  }
  return {
    fromMajor: rec.from,
    toMajor: rec.to,
    upgradedAt: rec.switchedAt,
    sizeBytes: await cachedSize(path, check.dev, check.ino, now.getTime()),
    rollbackOpen: win.open,
    rollbackUntil: win.until,
    previousVersion,
    interrupted,
  };
}

export type DeleteRefusal =
  | "not_aio"
  | "nothing_to_delete"
  | "upgrade_in_progress"
  | "rollback_window"
  | "not_the_recorded_cluster"
  | "symlink"
  | "not_a_folder"
  | "not_owner"
  | "busy"
  | "failed";

export type DeleteResult =
  | { ok: true; fromMajor: string; bytes: number }
  | { ok: false; refusal: DeleteRefusal; detail?: string };

let deleting = false;

/**
 * Removes /data/db.old, and only it, when the record says the upgrade is
 * done and the rollback window is over:
 *
 *   1. the record: phase switched (not started or switching), no db.new, the
 *      live /data/db the record's `to`, and the window closed;
 *   2. the folder: a real folder of this user, the record's `from`, with the
 *      image's marker (a link, a file, another cluster: refused);
 *   3. renamed to the fixed name .db.old.deleting (a rename moves a link
 *      itself, never what it points at), then checked again: the same inode
 *      as in 2, or it is renamed back and refused;
 *   4. removed (fs.rm unlinks links inside, never follows them).
 *
 * A delete the container's stop cut off leaves .db.old.deleting, which the
 * notice shows again and the next Delete finishes.
 */
export async function deleteOldDatabase(
  env: AioEnv = process.env as AioEnv,
  now: Date = new Date(),
): Promise<DeleteResult> {
  const data = aioDataDir(env);
  if (!data) return { ok: false, refusal: "not_aio" };
  if (deleting) return { ok: false, refusal: "busy" };
  deleting = true;
  try {
    const rec = await readRecord(data);
    if (!rec || !rec.phase) return { ok: false, refusal: "nothing_to_delete" };
    if (rec.phase === "started" || rec.phase === "switching" || (await lstatOrNull(join(data, NEW_DIR)))) {
      return { ok: false, refusal: "upgrade_in_progress" };
    }
    if (rec.phase !== "switched" || !/^\d+$/.test(rec.from) || !/^\d+$/.test(rec.to)) {
      return { ok: false, refusal: "nothing_to_delete" };
    }
    if (rollbackWindow(rec, now, env).open) return { ok: false, refusal: "rollback_window" };
    // The live database is the upgraded one: never remove the only cluster.
    const live = (await readPlainFile(join(data, LIVE_DIR, "PG_VERSION")))?.trim();
    if (live !== rec.to || (env.PG_MAJOR && env.PG_MAJOR !== rec.to)) {
      return { ok: false, refusal: "not_the_recorded_cluster", detail: `live ${live ?? "none"}, record ${rec.from}->${rec.to}` };
    }

    const old = join(data, OLD_DIR);
    const trash = join(data, TRASH_DIR);

    // A delete cut off earlier: finish it first.
    const leftover = await lstatOrNull(trash);
    if (leftover) {
      const lc = await checkOldCluster(trash, rec.from, true);
      if (!lc.ok) return { ok: false, refusal: lc.reason as DeleteRefusal, detail: TRASH_DIR };
      await rm(trash, { recursive: true, force: false });
    }

    const before = await checkOldCluster(old, rec.from);
    if (!before.ok) {
      if (before.reason === "missing") {
        return leftover ? { ok: true, fromMajor: rec.from, bytes: 0 } : { ok: false, refusal: "nothing_to_delete" };
      }
      return { ok: false, refusal: before.reason as DeleteRefusal };
    }
    if (await crossesDevice(old, before.dev)) return { ok: false, refusal: "not_the_recorded_cluster", detail: "a mount inside it" };
    const bytes = await folderSize(old);
    await rename(old, trash);
    const after = await lstatOrNull(trash);
    if (!after || after.isSymbolicLink() || !after.isDirectory() || after.dev !== before.dev || after.ino !== before.ino) {
      // Something else was put there between the check and the rename.
      await rename(trash, old).catch(() => {});
      return { ok: false, refusal: "not_the_recorded_cluster", detail: "changed while deleting" };
    }
    await rm(trash, { recursive: true, force: false });
    clearSizeCache();
    return { ok: true, fromMajor: rec.from, bytes };
  } catch (err) {
    return { ok: false, refusal: "failed", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    deleting = false;
  }
}
