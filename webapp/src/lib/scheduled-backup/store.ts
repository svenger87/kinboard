import { constants as fsc, readFileSync } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  parseState,
  type BackupState,
  EMPTY_STATE,
} from "./schedule";

/**
 * Where the all-in-one image's scheduled backups go, the state the scheduler
 * keeps, and the backups already there. Server only.
 *
 * Only in the all-in-one image (KINBOARD_AIO=1 and KINBOARD_DATA, both set by
 * its Dockerfile). A compose install has no scheduled backups: its webapp
 * gets the config volume read-only and no folder of its own off the
 * database's disk, and its store listings back up their folders their own
 * way (wiki: Compose UIs). A git install keeps its scripts.
 *
 * The folder, in this order:
 *   1. KINBOARD_BACKUP_PATH, when set: an absolute path in the container;
 *   2. /backups, when something is mounted there (Unraid's template offers
 *      the field: a share on another disk, mapped to /backups);
 *   3. /data/backups/scheduled.
 * The first two put the backups where a failing disk under /data does not
 * take them along; the third is better than nothing and Settings says so.
 */

export const BACKUP_NAME = /^kinboard-backup-(\d{8}T\d{6}Z)(?:-([0-9A-Za-z][0-9A-Za-z.+-]{0,63}))?\.tar\.gz$/;
export const MOUNT_TARGET = "/backups";
export const STATE_FILE = join("config", "scheduled-backup.json");
export const SETTINGS_KEY = "scheduled_backup";

/** Reads KINBOARD_AIO, KINBOARD_DATA and KINBOARD_BACKUP_PATH. */
export type AioBackupEnv = Record<string, string | undefined>;

/** The data folder when this is the all-in-one image, else null. */
export function backupDataDir(env: AioBackupEnv = process.env): string | null {
  if (env.KINBOARD_AIO !== "1") return null;
  const d = env.KINBOARD_DATA;
  return d && d.startsWith("/") ? d : null;
}

/** Whether a path is a mount point, from /proc/self/mountinfo (field 5 is the mount point, octal-escaped). */
export function isMountPoint(path: string, mountinfo?: string): boolean {
  let text = mountinfo;
  if (text === undefined) {
    try {
      text = readFileSync("/proc/self/mountinfo", "utf8");
    } catch {
      return false;
    }
  }
  const unescape = (s: string) => s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
  return text.split("\n").some((line) => unescape(line.split(" ")[4] ?? "") === path);
}

export interface BackupLocation {
  dir: string;
  /** "env": KINBOARD_BACKUP_PATH; "mount": a folder mapped to /backups; "data": inside the data folder. */
  source: "env" | "mount" | "data";
  /** Why this folder is refused (backups then fail and say so), or absent. */
  problem?: string;
}

export function resolveBackupDir(env: AioBackupEnv = process.env, mounted: (p: string) => boolean = (p) => isMountPoint(p)): BackupLocation | null {
  const data = backupDataDir(env);
  if (!data) return null;
  const p = (env.KINBOARD_BACKUP_PATH ?? "").trim();
  if (p !== "") {
    const dir = p.replace(/\/+$/, "") || "/";
    const inside = (a: string, b: string) => a === b || a.startsWith(`${b}/`);
    // Inside /data, only under /data/backups: in the files folder each backup
    // would be archived into the next, in the database folder worse.
    if (!dir.startsWith("/")) return { dir, source: "env", problem: `KINBOARD_BACKUP_PATH=${p} is not an absolute path` };
    if (inside(dir, data) && !inside(dir, join(data, "backups"))) {
      return { dir, source: "env", problem: `KINBOARD_BACKUP_PATH=${p} is inside ${data} but not under ${join(data, "backups")}; backups there would back themselves up` };
    }
    return { dir, source: "env" };
  }
  if (mounted(MOUNT_TARGET)) return { dir: MOUNT_TARGET, source: "mount" };
  return { dir: join(data, "backups", "scheduled"), source: "data" };
}

/** Whether the backup folder is on the same disk (device) as the data folder; null when it can't be told yet. */
export async function sameDiskAsData(dir: string, data: string): Promise<boolean | null> {
  try {
    const [a, b] = await Promise.all([stat(dir), stat(data)]);
    return a.dev === b.dev;
  } catch {
    return null;
  }
}

export interface BackupFile {
  name: string;
  bytes: number;
  /** The version in the name: the image tag a restore starts. */
  version: string | null;
  /** When it was taken (from the name's stamp, UTC). */
  takenAt: string;
}

/** The finished backups in a folder, newest first. Not a folder (yet): none. */
export async function listBackupFiles(dir: string): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: BackupFile[] = [];
  for (const name of names) {
    const m = BACKUP_NAME.exec(name);
    if (!m) continue;
    try {
      const st = await lstat(join(dir, name));
      if (!st.isFile()) continue;
      const s = m[1];
      out.push({
        name,
        bytes: st.size,
        version: m[2] ?? null,
        takenAt: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`,
      });
    } catch {
      /* removed meanwhile */
    }
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/* --------------------------------------------------------------- state */

export async function readState(data: string): Promise<BackupState> {
  try {
    return parseState(JSON.parse(await readFile(join(data, STATE_FILE), "utf8")));
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** Written through a new temporary file (0600, never through a link) and a rename. */
export async function writeState(data: string, state: BackupState): Promise<void> {
  const file = join(data, STATE_FILE);
  await mkdir(join(data, "config"), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const fh = await open(tmp, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL | fsc.O_NOFOLLOW, 0o600);
  try {
    await fh.writeFile(`${JSON.stringify(state, null, 1)}\n`);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
