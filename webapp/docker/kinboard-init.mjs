#!/usr/bin/env node
/**
 * kinboard-init: the one-shot step that fills in the secrets store before
 * anything else starts (RFC-023 §4.1). Run from the webapp image as
 * `command: ["kinboard-init"]`; `db` waits for it to complete successfully,
 * so a refusal here stops the stack before the database opens.
 *
 * Mounts it expects:
 *   /kinboard      the config volume, read-write. Secrets go to /kinboard/secrets.
 *   /kinboard-db   the database volume, read-only. Only looked at: whether a
 *                  cluster exists (PG_VERSION), and what filesystem it is on.
 *
 * In order:
 *   1. Refuse a data location PostgreSQL cannot use (FAT, SMB, 9p, drvfs,
 *      fuseblk) or that does not survive a reboot (tmpfs, ramfs).
 *   2. Decide every secret: a value in the environment (from an existing .env)
 *      wins and is written into the file; otherwise the file is kept;
 *      otherwise one is generated. Two refusals, both about the database
 *      password, which the database took at its first start and never reads
 *      again: the environment and the file disagree, or the file is missing
 *      while a cluster already exists. Nothing is written when anything is
 *      refused.
 *   3. Write what changed, each file through a temporary name and a rename.
 *      A file whose bytes the database and the webapp would read differently
 *      (a byte-order mark, a Windows line ending) is rewritten as its value.
 *   4. Write db_uri for PostgREST's `@file` from the database password, to
 *      the host in POSTGRES_HOST (`db` when unset: the compose service name;
 *      a store whose apps share one network names the container instead).
 *   5. Set the directory to 0750 and every file to 0640, owner root:0
 *      (PostgREST runs as uid 1000, gid 0), and read them back; a share that
 *      ignores chmod gets a warning naming the files (RFC-023 §6.3).
 *
 * One log line per secret; never a value. A second run with nothing changed
 * writes nothing and touches no file.
 */
import { createECDH, randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, constants, copyFileSync, fsyncSync, lchownSync, linkSync, lstatSync, mkdirSync, openSync,
  readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STORED, fileValue } from "./secrets-store.mjs";

export const DIR_MODE = 0o750;
export const FILE_MODE = 0o640;
export const DB_URI_FILE = "db_uri";

/** Where PostgREST finds the database, as the legacy file's PGRST_DB_URI has it. */
export const DEFAULT_DB_HOST = "db";
const DB_URI_TAIL = "5432/postgres";
/** A host name or IPv4 address; nothing that could end the URI early. */
const HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,251}[A-Za-z0-9])?$/;

/**
 * Filesystems the database directory must not be on, and why. Matched against
 * the mount's type in /proc/self/mountinfo, which names FUSE mounts by their
 * subtype: Unraid's user shares are `fuse.shfs`, where PostgreSQL works, while
 * an NTFS disk through ntfs-3g is `fuseblk`. statfs cannot tell those apart
 * (both are FUSE_SUPER_MAGIC), so it is not used.
 */
export const REFUSED_FOR_DB = {
  vfat: "fat", msdos: "fat", exfat: "fat",
  cifs: "share", smb3: "share",
  "9p": "windows", drvfs: "windows", fuseblk: "windows", ntfs: "windows", ntfs3: "windows",
  vboxsf: "vm",
  tmpfs: "volatile", ramfs: "volatile",
};
/** The config volume only has to survive a reboot. */
export const REFUSED_FOR_CONFIG = { tmpfs: "volatile", ramfs: "volatile" };

const present = (v) => typeof v === "string" && v !== "";

/** The RFC's file name for each stored secret, by variable. */
const FILE_OF = Object.fromEntries(STORED.map((s) => [s.env, s.file]));

/* ------------------------------------------------------------------ mounts */

/** Undo mountinfo's octal escapes (`\040` for a space, and so on). */
function unescapeMount(s) {
  return s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

/** /proc/self/mountinfo as [{ mountPoint, fsType, source }], in file order. */
export function parseMountinfo(text) {
  const mounts = [];
  for (const line of text.split("\n")) {
    const sep = line.indexOf(" - ");
    if (sep < 0) continue;
    const left = line.slice(0, sep).split(" ");
    const right = line.slice(sep + 3).split(" ");
    if (left.length < 5 || right.length < 2) continue;
    mounts.push({ mountPoint: unescapeMount(left[4]), fsType: right[0], source: unescapeMount(right[1]) });
  }
  return mounts;
}

/** The mount a path lives on: the longest mount point that contains it (the last one wins when stacked). */
export function mountOf(path, mounts) {
  let best = null;
  for (const m of mounts) {
    const mp = m.mountPoint;
    const inside = mp === "/" || path === mp || path.startsWith(mp.endsWith("/") ? mp : `${mp}/`);
    if (inside && (!best || mp.length >= best.mountPoint.length)) best = m;
  }
  return best;
}

function fsMessage(kind, what, path, fsType) {
  const where = `${path} is on ${fsType}`;
  const variable = what === "database" ? "KINBOARD_DB_DIR" : "KINBOARD_CONFIG_DIR";
  switch (kind) {
    case "fat":
      return `PostgreSQL can't keep its data on a FAT filesystem (a USB flash drive?): ${where}. ` +
        `Set ${variable} to a folder on a real disk (on Unraid, a folder under /mnt/user/appdata).`;
    case "share":
      return `PostgreSQL can't keep its data on a Windows/SMB network share: ${where}. ` +
        `Set ${variable} to a folder on a local disk of the machine that runs Docker, or leave it unset for a Docker volume.`;
    case "windows":
      return `PostgreSQL can't keep its data on a Windows drive: ${where}. ` +
        `On WSL, use a folder inside the WSL filesystem (not /mnt/c), or leave ${variable} unset for a Docker volume.`;
    case "vm":
      return `PostgreSQL can't keep its data in a VirtualBox shared folder: ${where}. ` +
        `Use a folder on the virtual machine's own disk, or leave ${variable} unset for a Docker volume.`;
    default:
      return `The ${what} would be lost at the next reboot: ${where}. ` +
        `Set ${variable} to a folder on a disk, or leave it unset for a Docker volume.`;
  }
}

/** Step 1: every refusal for where the data and the config live. Empty means fine. */
export function checkFilesystems({ dbDir, configDir, mounts }) {
  const errors = [];
  const db = mountOf(dbDir, mounts);
  if (db && REFUSED_FOR_DB[db.fsType]) errors.push(fsMessage(REFUSED_FOR_DB[db.fsType], "database", dbDir, db.fsType));
  const cfg = mountOf(configDir, mounts);
  if (cfg && REFUSED_FOR_CONFIG[cfg.fsType]) errors.push(fsMessage(REFUSED_FOR_CONFIG[cfg.fsType], "configuration (and its secrets)", configDir, cfg.fsType));
  return errors;
}

/* -------------------------------------------------------------- generation */

/** 32 random bytes, hex: URL-safe, as setup.sh makes them (`openssl rand -hex 32`). */
export function randomHex() {
  return randomBytes(32).toString("hex");
}

/**
 * A VAPID key pair in web-push's format: the P-256 public key uncompressed
 * (65 bytes) and the private scalar (32 bytes), both unpadded base64url. The
 * same thing `web-push generate-vapid-keys` prints, without needing the
 * library on the path.
 */
export function generateVapid() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  let priv = ecdh.getPrivateKey();
  // getPrivateKey drops leading zero bytes; web-push wants exactly 32.
  if (priv.length < 32) priv = Buffer.concat([Buffer.alloc(32 - priv.length), priv]);
  return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: priv.toString("base64url") };
}

/** Whether a public key belongs to a private key. Anything unparsable is a mismatch. */
export function vapidPairMatches(publicKey, privateKey) {
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
    return ecdh.getPublicKey().toString("base64url") === publicKey;
  } catch {
    return false;
  }
}

/** PostgREST's connection string; the password URL-encoded, so any character is safe. */
export function dbUri(password, host = DEFAULT_DB_HOST) {
  return `postgres://authenticator:${encodeURIComponent(password)}@${host}:${DB_URI_TAIL}`;
}

/**
 * The database's host for db_uri: POSTGRES_HOST, as the webapp and
 * kinboard-db-init read it, or `db`. Umbrel runs every app on one shared
 * network, where `db` can answer from another app's database, so its listing
 * names the container (RFC-024 §5.4). Returns { host } or { error }.
 */
export function dbHost(env) {
  const raw = env.POSTGRES_HOST ?? "";
  if (raw === "") return { host: DEFAULT_DB_HOST };
  if (!HOST_NAME.test(raw)) return { error: `POSTGRES_HOST "${raw}" is not a host name; PostgREST could not reach the database with it.` };
  return { host: raw };
}

/**
 * Whether the database and the webapp would read different values from these
 * bytes. The database (`POSTGRES_PASSWORD_FILE`, docker-library's file_env)
 * drops trailing `\n` and nothing else; the webapp (fileValue) also drops a
 * leading byte-order mark and trailing `\r`. So a file is canonical when
 * stripping its trailing `\n`s gives exactly its value.
 */
export function needsRewrite(raw) {
  return raw.replace(/\n+$/, "") !== fileValue(raw);
}

/** Whether PostgREST (uid 1000, gid 0, no other groups) may enter a folder with these stats. */
export function postgrestCanEnter({ mode, uid, gid }) {
  const bit = uid === 1000 ? 0o100 : gid === 0 ? 0o010 : 0o001;
  return (mode & bit) !== 0;
}

/** A UTC timestamp for `<name>.previous-<timestamp>`. */
export function stamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/* -------------------------------------------------------------------- plan */

function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Steps 2 and 4, without touching the disk: what to write, and every refusal.
 *
 * `current` maps a file name to its raw content (null: no file). `env` is the
 * container's environment. `cluster` says whether the database volume already
 * holds a cluster. `gen` supplies new values (swappable for tests).
 *
 * Returns { writes: [{ file, value, previous }], lines, warnings, errors }.
 * `previous: true` means the old file is kept as `<file>.previous-<stamp>`.
 */
export function planSecrets({ env, current, cluster, gen = { hex: randomHex, vapid: generateVapid } }) {
  const lines = [];
  const warnings = [];
  const errors = [];
  /** @type {Record<string, { status: string, value: string | null, write: boolean, previous: boolean, source: "env" | "file" | "new" }>} */
  const decided = {};

  for (const { env: name, file } of STORED) {
    const raw = current[file] ?? null;
    const stored = raw === null ? null : fileValue(raw);
    const have = present(stored) ? stored : null;
    const fromEnv = present(env[name]) ? env[name] : null;

    if (fromEnv !== null && fromEnv !== fileValue(fromEnv)) {
      errors.push(`${name} in the environment starts with a byte-order mark or ends in a line break; ` +
        `the database and the webapp would read it differently. Remove that from .env.`);
      continue;
    }

    if (name === "POSTGRES_PASSWORD") {
      if (fromEnv !== null && have !== null && fromEnv !== have) {
        errors.push(
          "POSTGRES_PASSWORD in the environment (.env, or the Compose UI's variables) differs from the " +
          `stored secrets/${file}. The database took its password at its first start and never reads it ` +
          "again, so one of the two is wrong, and kinboard-init will not guess which. If the database was " +
          `created with the stored file, remove POSTGRES_PASSWORD from .env. If it was created with the .env value, ` +
          `delete secrets/${file} in the config volume and start again. Nothing was changed.`,
        );
        continue;
      }
      if (fromEnv === null && have === null && cluster) {
        errors.push(
          `The database volume already holds a PostgreSQL cluster, but secrets/${file} is missing and ` +
          "POSTGRES_PASSWORD is not set. A new password would not match the database. Restore " +
          `config/secrets/${file} from your backup, or set POSTGRES_PASSWORD to the database's password. Nothing was changed.`,
        );
        continue;
      }
    }

    if (fromEnv !== null) {
      if (have === fromEnv) {
        decided[name] = { status: "kept", value: fromEnv, write: needsRewrite(raw), previous: false, source: "env" };
      } else if (have === null) {
        decided[name] = { status: "taken from .env", value: fromEnv, write: true, previous: false, source: "env" };
      } else {
        decided[name] = { status: "replaced from .env (previous kept)", value: fromEnv, write: true, previous: true, source: "env" };
        warnings.push(`${file}: the value in .env differs from the stored one; .env wins, the old file is kept as ${file}.previous-<time>.`);
      }
    } else if (have !== null) {
      decided[name] = { status: "kept", value: have, write: needsRewrite(raw), previous: false, source: "file" };
    } else {
      decided[name] = { status: "generated", value: null, write: true, previous: raw !== null && raw !== "", source: "new" };
    }
  }

  // VAPID keys are a pair: generating one half next to a kept other half
  // would give a pair that signs nothing a browser accepts.
  const pub = decided.VAPID_PUBLIC_KEY;
  const priv = decided.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    const newPub = pub.source === "new";
    const newPriv = priv.source === "new";
    if (newPub !== newPriv) {
      const kept = newPub ? priv : pub;
      const keptName = newPub ? "VAPID_PRIVATE_KEY" : "VAPID_PUBLIC_KEY";
      const missingName = newPub ? "VAPID_PUBLIC_KEY" : "VAPID_PRIVATE_KEY";
      if (kept.source === "env") {
        errors.push(`${keptName} is set in .env but ${missingName} is set nowhere. The two are a pair; set both, or neither.`);
      } else {
        // Only the stored half exists: replace both, keeping the old file.
        kept.status = "generated";
        kept.source = "new";
        kept.write = true;
        kept.previous = true;
        warnings.push(`${FILE_OF[missingName]} was missing, so the VAPID pair was generated again; devices must enable notifications again.`);
      }
    }
    if (pub.source === "new" && priv.source === "new") {
      const pair = gen.vapid();
      pub.value = pair.publicKey;
      priv.value = pair.privateKey;
    } else if (pub.value && priv.value && !vapidPairMatches(pub.value, priv.value)) {
      warnings.push("VAPID_PUBLIC_KEY does not belong to VAPID_PRIVATE_KEY; push notifications will be refused until they match.");
    }
  }

  const where = dbHost(env);
  if (where.error) errors.push(where.error);

  if (errors.length > 0) return { writes: [], lines: [], warnings, errors };

  const writes = [];
  for (const { env: name, file } of STORED) {
    const d = decided[name];
    if (d.value === null) d.value = gen.hex();
    const status = d.status === "kept" && d.write ? "kept (rewritten without a byte-order mark or Windows line ending)" : d.status;
    lines.push(`${file}: ${status}`);
    if (d.write) writes.push({ file, value: d.value, previous: d.previous });
  }

  const uri = dbUri(decided.POSTGRES_PASSWORD.value, where.host);
  if (current[DB_URI_FILE] !== uri) {
    writes.push({ file: DB_URI_FILE, value: uri, previous: false });
    lines.push(`${DB_URI_FILE}: written from postgres_password`);
  } else {
    lines.push(`${DB_URI_FILE}: kept`);
  }

  return { writes, lines, warnings, errors };
}

/* --------------------------------------------------------------------- run */

/** An interrupted run's temporary file for a secret. */
const tmpName = (file) => `.${file}.init-tmp`;

/** fsync a directory, so the renames in it survive a power cut. */
function syncDir(dir) {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes a file through a temporary name and a rename, so a reader never sees
 * half of it. The temporary file is created new (never through a symlink a
 * host folder might hold) and fsynced before the rename; the caller fsyncs
 * the directory.
 */
function writeAtomic(dir, file, value) {
  const tmp = join(dir, tmpName(file));
  rmSync(tmp, { force: true });
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE);
  try {
    writeSync(fd, value);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, join(dir, file));
}

/**
 * Keeps a copy of a file as `<file>.previous-<stamp>` before it is replaced,
 * without ever removing the live file: a hard link (or a copy where links
 * are not possible), so a crash in between leaves both. A second replacement
 * in the same second gets its own name.
 */
function keepPrevious(dir, file, now) {
  const base = `${file}.previous-${stamp(now)}`;
  for (let n = 1; ; n++) {
    const target = join(dir, n === 1 ? base : `${base}-${n}`);
    try {
      linkSync(join(dir, file), target);
      return;
    } catch (err) {
      if (err && err.code === "EEXIST") continue;
      try {
        copyFileSync(join(dir, file), target, constants.COPYFILE_EXCL);
        return;
      } catch (err2) {
        if (err2 && err2.code === "EEXIST") continue;
        throw err2;
      }
    }
  }
}

/**
 * Sets a mode and owner only when they differ, so an unchanged run touches
 * nothing. A filesystem that refuses chmod or chown (FAT, some SMB and NFS
 * mounts) is not an error here: the read-back below reports it (RFC-023 §6.3).
 */
function settle(path, mode, asRoot, chmod) {
  const st = lstatSync(path);
  try {
    if ((st.mode & 0o7777) !== mode) chmod(path, mode);
  } catch { /* reported by the read-back */ }
  try {
    if (asRoot && (st.uid !== 0 || st.gid !== 0)) lchownSync(path, 0, 0);
  } catch { /* reported by the read-back */ }
}

/** Reads a secret file: null when absent; refuses anything but a plain file. */
function readSecret(path) {
  let st;
  try {
    st = lstatSync(path);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
  if (!st.isFile()) {
    const e = new Error(`${path} is not a plain file (a symlink or a folder?); replace it with the file itself, or remove it`);
    e.code = "NOTFILE";
    throw e;
  }
  return readFileSync(path, "utf8");
}

/**
 * The whole step. Paths and the clock are parameters so tests can run it
 * against a temporary directory. Returns { ok, lines, warnings, errors }.
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   configDir?: string,
 *   dbDir?: string,
 *   mountinfo?: string | null,
 *   now?: Date,
 *   asRoot?: boolean,
 *   gen?: { hex: () => string, vapid: () => { publicKey: string, privateKey: string } },
 *   chmod?: (path: string, mode: number) => void,
 * }} [options]
 */
export function runInit({
  env = process.env,
  configDir = "/kinboard",
  dbDir = "/kinboard-db",
  mountinfo = null,
  now = new Date(),
  asRoot = typeof process.getuid === "function" && process.getuid() === 0,
  gen,
  // Swappable so a test can be a filesystem that ignores or refuses chmod.
  chmod = chmodSync,
} = {}) {
  const secretsDir = join(configDir, "secrets");
  const warnings = [];
  const fail = (errors) => ({ ok: false, lines: [], warnings, errors });

  // 1. Where the data lives. Nothing below writes before every check has passed.
  const table = mountinfo ?? readIfPresent("/proc/self/mountinfo");
  if (table === null) warnings.push("/proc/self/mountinfo is missing; the filesystem checks were skipped.");
  const mounts = parseMountinfo(table ?? "");
  const fsErrors = checkFilesystems({ dbDir: resolve(dbDir), configDir: resolve(configDir), mounts });
  if (fsErrors.length > 0) return fail(fsErrors);

  let cluster;
  try {
    if (!statSync(dbDir).isDirectory()) return fail([`${dbDir} is not a directory; mount the database volume there (read-only).`]);
    cluster = readIfPresent(join(dbDir, "PG_VERSION")) !== null;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return fail([`The database volume is not mounted at ${dbDir}. kinboard-init needs it (read-only) to tell a new install from an existing one.`]);
    }
    return fail([`Cannot tell whether ${dbDir} already holds a database (${err?.code ?? err}). Nothing was changed.`]);
  }

  let dirExists = true;
  try {
    if (!lstatSync(secretsDir).isDirectory()) return fail([`${secretsDir} exists but is not a folder (a symlink or a file?). Nothing was changed.`]);
  } catch (err) {
    if (!err || err.code !== "ENOENT") return fail([`Cannot read ${secretsDir} (${err?.code ?? err}). Nothing was changed.`]);
    dirExists = false;
  }

  // 2. Decide.
  const current = {};
  try {
    for (const file of [...STORED.map((s) => s.file), DB_URI_FILE]) {
      current[file] = dirExists ? readSecret(join(secretsDir, file)) : null;
    }
  } catch (err) {
    return fail([err?.code === "NOTFILE" ? `${err.message}. Nothing was changed.` : `Cannot read the secrets in ${secretsDir} (${err?.code ?? err}). Nothing was changed.`]);
  }
  // A power cut between the rename and the directory reaching the disk can
  // leave only the temporary file. For the database password that may be the
  // only copy of what the database took at its first start: never delete it.
  if (dirExists && current.postgres_password === null && readIfPresent(join(secretsDir, tmpName("postgres_password"))) !== null) {
    return fail([
      `An interrupted start left ${join(secretsDir, tmpName("postgres_password"))}, and postgres_password itself is missing. ` +
      "That file may hold the database's password. If it is complete, rename it to postgres_password; " +
      "otherwise remove it (and set POSTGRES_PASSWORD if the database already exists). Nothing was changed.",
    ]);
  }
  const plan = planSecrets({ env, current, cluster, gen });
  warnings.push(...plan.warnings);
  if (plan.errors.length > 0) return fail(plan.errors);

  // 3 and 4. Write.
  if (!dirExists) mkdirSync(secretsDir, { recursive: true, mode: DIR_MODE });
  // A temporary file left by an interrupted run is never a secret anyone reads.
  for (const name of readdirSync(secretsDir)) {
    if (/^\..+\.init-tmp$/.test(name)) rmSync(join(secretsDir, name), { force: true });
  }
  for (const w of plan.writes) {
    if (w.previous && current[w.file] !== null) keepPrevious(secretsDir, w.file, now);
    writeAtomic(secretsDir, w.file, w.value);
  }
  if (plan.writes.length > 0 || !dirExists) {
    syncDir(secretsDir);
    if (!dirExists) syncDir(configDir);
  }

  // 5. Modes and owner, then read them back. Only plain files are touched:
  // anything else in the folder is reported, never followed.
  settle(secretsDir, DIR_MODE, asRoot, chmod);
  const entries = readdirSync(secretsDir);
  const files = entries.filter((n) => lstatSync(join(secretsDir, n)).isFile());
  for (const name of files) settle(join(secretsDir, name), FILE_MODE, asRoot, chmod);

  const loose = [];
  const check = (path, mode) => {
    const st = lstatSync(path);
    if ((st.mode & 0o777) !== mode || (asRoot && (st.uid !== 0 || st.gid !== 0))) {
      loose.push(`${path} (${(st.mode & 0o777).toString(8).padStart(4, "0")} ${st.uid}:${st.gid})`);
    }
  };
  check(secretsDir, DIR_MODE);
  for (const name of files) check(join(secretsDir, name), FILE_MODE);
  if (loose.length > 0) {
    warnings.push(
      `These did not keep their permissions (wanted ${DIR_MODE.toString(8)} for the folder and ${FILE_MODE.toString(8)} ` +
      `for the files, owner root:0); the filesystem probably ignores chmod, so whoever can read it can read the secrets: ${loose.join(", ")}`,
    );
  }
  const others = entries.filter((n) => !files.includes(n));
  if (others.length > 0) warnings.push(`Left alone, not plain files: ${others.map((n) => join(secretsDir, n)).join(", ")}`);
  // PostgREST (uid 1000, gid 0) must be able to get through the config folder to secrets/.
  const top = statSync(configDir);
  if (!postgrestCanEnter(top)) {
    warnings.push(`${configDir} is ${(top.mode & 0o777).toString(8).padStart(4, "0")} ${top.uid}:${top.gid}: PostgREST (uid 1000, group 0) cannot enter it to read its secrets. Give the group or others execute permission (e.g. 0755).`);
  }

  return { ok: true, lines: plan.lines, warnings, errors: [] };
}

function main() {
  const tag = "[kinboard-init]";
  let result;
  try {
    result = runInit({
      configDir: process.env.KINBOARD_CONFIG_ROOT || "/kinboard",
      dbDir: process.env.KINBOARD_DB_MOUNT || "/kinboard-db",
    });
  } catch (err) {
    process.stderr.write(`${tag} failed: ${err?.message ?? err}\n`);
    process.exit(1);
  }
  for (const line of result.lines) process.stdout.write(`${tag} secret ${line}\n`);
  for (const line of result.warnings) process.stderr.write(`${tag} warning: ${line}\n`);
  if (!result.ok) {
    for (const line of result.errors) process.stderr.write(`${tag} ${line}\n`);
    process.stderr.write(`${tag} refusing to continue; the stack will not start until this is fixed.\n`);
    process.exit(1);
  }
  process.stdout.write(`${tag} done\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
