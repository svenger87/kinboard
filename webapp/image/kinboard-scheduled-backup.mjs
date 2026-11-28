#!/usr/bin/env node
/**
 * One scheduled backup of the all-in-one image: a `kinboard export` archive,
 * read back and checked, then given its real name, then the oldest beyond
 * the kept number removed. Run by the webapp's backup scheduler
 * (src/lib/scheduled-backup/), as PUID, under the backup lock
 * (KINBOARD_BACKUP_LOCK, which kinboard-backup.sh takes too):
 *
 *   node kinboard-scheduled-backup.mjs --dir <folder> --keep <n>
 *
 * Why an export archive and not a dump plus the files: the archive already
 * is the database (every table of `public` and `kinboard`, with each table's
 * row count and checksum), the uploaded files (with each one's SHA-256) and
 * the keys that must travel (the login key, the push keys, the cron secret,
 * the presence token), in one file, and `kinboard import` restores it into a
 * fresh install, verifying every table before it commits. That restore path
 * is tested end to end (scripts/rigs/test-migration-aio.sh), and it is the
 * one the wiki already documents. A pg_dumpall would add a second, untested
 * way back, and the files and keys would still have to come from elsewhere.
 * The database password is not in it, as with any export: a fresh install
 * keeps the one its cluster was created with.
 *
 * What makes it safe to keep:
 *   - written under a dot-name (`.kinboard-backup-<stamp>.partial`), created
 *     new (O_EXCL, O_NOFOLLOW), 0600 in a folder this run made 0700;
 *   - read back in full before it is named: every entry a plain file or
 *     folder under the four names an export has, the manifest well-formed,
 *     every table's data file holding exactly the rows the manifest counts,
 *     every uploaded file's size and SHA-256 as the manifest says, every
 *     listed secret present. Read from the archive's bytes, so a file changed
 *     while it was being archived, or a write cut short by a full disk, is
 *     found here and not by a restore;
 *   - fsynced, renamed to `kinboard-backup-<stamp>-<version>.tar.gz`, the
 *     folder fsynced;
 *   - only then are older ones removed, newest first kept; a failed run
 *     removes only its own dot-file, so the last good backup stays;
 *   - a run cut off (the container stopped) leaves only a dot-file, which
 *     never counts as a backup, and the next run removes.
 *
 * The last line on stdout is one JSON object: { ok, file, bytes, ... } or
 * { ok: false, error }. Exit 0 when a verified backup was written, 1 when not.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, createReadStream, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestProblems, safeRelative } from "./kinboard-transfer.mjs";

const TAG = "[backup]";

/** A finished, verified scheduled backup. The stamp sorts by time; the version says which image restores it. */
export const BACKUP_NAME = /^kinboard-backup-(\d{8}T\d{6}Z)(?:-([0-9A-Za-z][0-9A-Za-z.+-]{0,63}))?\.tar\.gz$/;
/** A run's own file before it is verified. Never a backup. */
export const PARTIAL_NAME = /^\.kinboard-backup-\d{8}T\d{6}Z(?:-\d+)?\.partial$/;

export const DEFAULT_KEEP = 7;
export const MAX_KEEP = 365;

const stampOf = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** The backups in a folder, newest first: only finished ones, by name. */
export function listBackups(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const m = BACKUP_NAME.exec(name);
    if (!m) continue;
    const st = lstatSync(join(dir, name));
    if (!st.isFile()) continue;
    out.push({ name, stamp: m[1], version: m[2] ?? null, bytes: st.size, mtimeMs: st.mtimeMs });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/**
 * Which backups to remove so that `keep` remain: the oldest by name. Never
 * the newest, whatever `keep` says (at least one is always kept), and never
 * `current`, the one this run has just written: a file whose name sorts
 * after it (a clock that once ran ahead, a backup copied back in) takes one
 * of the other places, not this one's.
 */
export function pruneList(names, keep, current = null) {
  const n = Number(keep);
  const k = Math.max(1, Math.floor(Number.isFinite(n) ? n : DEFAULT_KEEP));
  const sorted = names.filter((x) => BACKUP_NAME.test(x) && x !== current).sort().reverse();
  return sorted.slice(current ? k - 1 : k);
}

/* ------------------------------------------------------------ verifying */

/**
 * Reads a .tar.gz from start to end without unpacking it, and calls
 * onEntry({ name, type, size }) for each entry and onData(chunk) with its
 * bytes. Knows ustar (with its prefix), GNU long names ('L', 'K') and pax
 * headers ('x', 'g'): what busybox and GNU tar write. Any other entry type is
 * passed on with its flag, for the caller to refuse.
 */
export function readTar(path, { onEntry, onData, onEnd }) {
  return new Promise((resolvePromise, reject) => {
    let buf = Buffer.alloc(0);
    let remaining = 0; // bytes of the current entry's data still to come
    let padding = 0; // zero bytes after it, up to the next 512
    let pending = null; // a long name / pax header being collected
    let longName = null;
    let paxPath = null;
    let ended = false;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      reject(err);
    };
    const header = (h) => {
      if (h.every((b) => b === 0)) {
        ended = true;
        return;
      }
      // The checksum: the header's bytes summed with the checksum field as spaces.
      const sumField = h.subarray(148, 156).toString("latin1").replace(/\0.*$/s, "").trim();
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
      if (parseInt(sumField, 8) !== sum) throw new Error("a damaged tar header (checksum)");
      const str = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
      const sizeField = h.subarray(124, 136);
      let size;
      if (sizeField[0] & 0x80) {
        // GNU base-256 for sizes of 8 GiB and more.
        size = 0;
        for (let i = 1; i < 12; i++) size = size * 256 + sizeField[i];
      } else {
        size = parseInt(sizeField.toString("latin1").replace(/\0.*$/s, "").trim() || "0", 8);
      }
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("a damaged tar header (size)");
      const type = String.fromCharCode(h[156] || 48);
      let name = str(0, 100);
      const magic = h.subarray(257, 263).toString("latin1");
      if (magic.startsWith("ustar")) {
        const prefix = str(345, 500);
        if (prefix && magic === "ustar\0") name = `${prefix}/${name}`;
      }
      remaining = size;
      padding = (512 - (size % 512)) % 512;
      if (type === "L" || type === "K" || type === "x" || type === "g") {
        if (size > 1024 * 1024) throw new Error("a tar extension header larger than 1 MB");
        pending = { type, chunks: [] };
        return;
      }
      if (longName !== null) name = longName;
      if (paxPath !== null) name = paxPath;
      longName = null;
      paxPath = null;
      onEntry({ name, type, size });
    };
    const finishPending = () => {
      const data = Buffer.concat(pending.chunks).toString("utf8");
      if (pending.type === "L") longName = data.replace(/\0.*$/s, "");
      if (pending.type === "x") {
        // "<len> key=value\n" records.
        for (const rec of data.split("\n")) {
          const m = /^\d+ path=(.*)$/s.exec(rec);
          if (m) paxPath = m[1];
        }
      }
      pending = null;
    };
    const gunzip = createGunzip();
    const input = createReadStream(path);
    input.on("error", fail);
    gunzip.on("error", (err) => fail(new Error(`the archive does not decompress: ${err.message}`)));
    gunzip.on("data", (chunk) => {
      if (failed) return;
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        let off = 0;
        for (;;) {
          if (ended) {
            off = buf.length;
            break;
          }
          if (remaining > 0) {
            const n = Math.min(remaining, buf.length - off);
            if (n === 0) break;
            const part = buf.subarray(off, off + n);
            if (pending) pending.chunks.push(Buffer.from(part));
            else onData(part);
            remaining -= n;
            off += n;
            if (remaining > 0) break;
          }
          if (padding > 0) {
            const n = Math.min(padding, buf.length - off);
            padding -= n;
            off += n;
            if (padding > 0) break;
          }
          if (pending && remaining === 0) finishPending();
          if (buf.length - off < 512) break;
          header(buf.subarray(off, off + 512));
          off += 512;
        }
        buf = buf.subarray(off);
      } catch (err) {
        fail(err);
        input.destroy();
        gunzip.destroy();
      }
    });
    gunzip.on("end", () => {
      if (failed) return;
      if (remaining > 0 || pending) return fail(new Error("the archive ends in the middle of an entry (cut short?)"));
      if (!ended) return fail(new Error("the archive has no end-of-archive marker (cut short?)"));
      try {
        onEnd?.();
      } catch (err) {
        return fail(err);
      }
      resolvePromise();
    });
    input.pipe(gunzip);
  });
}

/**
 * Every problem with an export archive, read from its bytes: [] when it is a
 * backup a restore can use. Also returns the manifest it read.
 */
export async function verifyArchive(path) {
  const problems = [];
  const entries = new Map(); // name -> { type, size, lines, sha256 }
  let manifestText = null;
  let cur = null;
  const DATA = /^data\/\d{4}\.copy$/;
  await readTar(path, {
    onEntry: ({ name, type, size }) => {
      const clean = name.replace(/^\.\//, "").replace(/\/$/, "");
      cur = null;
      if (clean === "" || clean === ".") return;
      if (type !== "0" && type !== "5") {
        problems.push(`${clean}: not a plain file or folder (tar type ${JSON.stringify(type)})`);
        return;
      }
      // As kinboard import's own listing check (archiveEntryProblems): what it would refuse, this does too.
      if (/[\u0000-\u001f\u007f]/.test(clean)) {
        problems.push(`${JSON.stringify(clean)}: a control character in a name`);
        return;
      }
      if (!safeRelative(clean) || !["manifest.json", "data", "secrets", "files"].includes(clean.split("/")[0])) {
        problems.push(`${clean}: not an entry an export has`);
        return;
      }
      if (type === "5") return;
      if (entries.has(clean)) problems.push(`${clean}: twice in the archive`);
      cur = { name: clean, size, seen: 0, lines: 0, hash: clean.startsWith("files/") ? createHash("sha256") : null, text: clean === "manifest.json" ? [] : null };
      entries.set(clean, cur);
    },
    onData: (chunk) => {
      if (!cur) return;
      cur.seen += chunk.length;
      if (cur.hash) cur.hash.update(chunk);
      else if (cur.text) cur.text.push(Buffer.from(chunk));
      else if (DATA.test(cur.name)) {
        for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) cur.lines++;
      }
    },
    onEnd: () => {
      for (const e of entries.values()) {
        if (e.hash) e.sha256 = e.hash.digest("hex");
        if (e.text) manifestText = Buffer.concat(e.text).toString("utf8");
      }
    },
  });
  let manifest = null;
  if (manifestText === null) problems.push("no manifest.json");
  else {
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      problems.push("manifest.json is not JSON");
    }
  }
  if (manifest) {
    problems.push(...manifestProblems(manifest));
    if (!problems.length) {
      const fam = manifest.tables.find((t) => t.schema === "public" && t.table === "families");
      if (!fam) problems.push("the archive has no public.families table");
      // A fresh install (a restore about to happen, sharing the backup folder)
      // must not rotate a household's backups out with empty ones.
      else if (fam.rows === 0) problems.push("this install has no family yet, so there is nothing to back up (the backups already there are kept)");
      for (const t of manifest.tables) {
        const e = entries.get(t.file);
        if (!e) problems.push(`${t.schema}.${t.table}: its data (${t.file}) is missing`);
        else if (e.lines !== t.rows) problems.push(`${t.schema}.${t.table}: ${e.lines} row(s) in ${t.file}, the manifest says ${t.rows}`);
      }
      for (const f of manifest.files) {
        const e = entries.get(`files/${f.path}`);
        if (!e) problems.push(`files/${f.path}: missing`);
        else if (e.seen !== f.size || e.sha256 !== f.sha256) problems.push(`files/${f.path}: differs from the manifest (changed while it was archived?)`);
      }
      const listed = new Set(manifest.files.map((f) => `files/${f.path}`));
      for (const name of entries.keys()) if (name.startsWith("files/") && !listed.has(name)) problems.push(`${name}: not in the manifest`);
      for (const s of manifest.secrets) {
        const file = `secrets/${s.toLowerCase()}`;
        if (!entries.has(file)) problems.push(`${file}: listed in the manifest, missing`);
      }
    }
  }
  return { problems, manifest };
}

/* -------------------------------------------------------------- running */

/** Free bytes where a path is (its nearest existing parent). */
function freeBytes(path) {
  let at = path;
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  const st = statfsSync(at);
  return Number(st.bavail) * Number(st.bsize);
}

/**
 * The folder backups go into: made 0700 when this makes it, refused when it
 * is a symlink or not a folder, and checked writable by writing to it.
 */
export function prepareFolder(dir) {
  if (!dir.startsWith("/")) throw new Error(`the backup folder must be an absolute path, not ${JSON.stringify(dir)}`);
  if (existsSync(dir) || lstatExists(dir)) {
    const st = lstatSync(dir);
    if (st.isSymbolicLink()) throw new Error(`the backup folder ${dir} is a symlink; use the folder itself`);
    if (!st.isDirectory()) throw new Error(`the backup folder ${dir} is not a folder`);
  } else {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const probe = join(dir, `.kinboard-backup-probe-${process.pid}`);
  try {
    closeSync(openSync(probe, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600));
  } catch (err) {
    const st = statSync(dir);
    const ids = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid()}` : "?";
    throw new Error(`the backup folder ${dir} is not writable for Kinboard (it runs as ${ids}, the folder belongs to ${st.uid}:${st.gid}, mode ${(st.mode & 0o777).toString(8)}): ${err.code ?? err.message}`);
  } finally {
    rmSync(probe, { force: true });
  }
}

function lstatExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Removes dot-files earlier runs that were cut off left behind. Only ours, by name. */
export function removeLeftovers(dir) {
  const removed = [];
  for (const name of readdirSync(dir)) {
    if (!PARTIAL_NAME.test(name)) continue;
    const p = join(dir, name);
    if (!lstatSync(p).isFile()) continue;
    rmSync(p, { force: true });
    removed.push(name);
  }
  return removed;
}

/**
 * What an export cut off before its end leaves (kinboard-transfer.mjs,
 * exportArchive): its work folder in the temporary folder (the table data
 * and the keys) and its staging folder beside the uploaded files (a hard
 * link to every photo, so a photo deleted since lives on there). Only ours,
 * by name, and only older than `olderThanMs`: a `kinboard export` someone
 * runs by hand beside a scheduled backup is not taken from under it.
 */
export function removeExportLeftovers({ filesDir, tmp = tmpdir(), olderThanMs = 6 * 3600_000, now = Date.now() }) {
  const removed = [];
  const sweep = (parent, pattern) => {
    let names = [];
    try {
      names = readdirSync(parent);
    } catch {
      return;
    }
    for (const name of names) {
      if (!pattern.test(name)) continue;
      const p = join(parent, name);
      try {
        const st = lstatSync(p);
        if (!st.isDirectory() || now - st.mtimeMs < olderThanMs) continue;
        rmSync(p, { recursive: true, force: true });
        removed.push(p);
      } catch {
        /* not ours to remove (another owner): left */
      }
    }
  };
  sweep(tmp, /^kinboard-export-[A-Za-z0-9]{6}$/);
  if (filesDir) sweep(dirname(filesDir), /^\.kinboard-export-[A-Za-z0-9]{6}$/);
  return removed;
}

function fsyncPath(path, flags = constants.O_RDONLY) {
  const fd = openSync(path, flags);
  try {
    fsyncSync(fd);
  } catch {
    /* a folder on a filesystem that refuses fsync: the rename is still atomic */
  } finally {
    closeSync(fd);
  }
}

/**
 * One backup. `exportTo(path)` writes the archive (kinboard-transfer.mjs's
 * exportArchive in the image; a fake in the specs). Returns the result
 * object; never throws.
 */
export async function runBackup({ dir, keep = DEFAULT_KEEP, version = "", now = () => new Date(), exportTo, filesDir = "", log = (s) => process.stderr.write(`${TAG} ${s}\n`) }) {
  const started = Date.now();
  let partial = "";
  const oldUmask = process.umask(0o077);
  try {
    prepareFolder(dir);
    const left = removeLeftovers(dir);
    if (left.length) log(`removed ${left.length} unfinished backup(s) a run that was cut off had left: ${left.join(", ")}`);
    const stale = removeExportLeftovers({ filesDir });
    if (stale.length) log(`removed what ${stale.length} export(s) cut off before their end had left: ${stale.join(", ")}`);

    // Room for it: about as much as the last one took, plus a margin.
    const last = listBackups(dir)[0];
    if (last) {
      const need = Math.ceil(last.bytes * 1.1) + 16 * 1024 * 1024;
      const free = freeBytes(dir);
      if (free < need) {
        throw new Error(`not enough free space in ${dir}: ${Math.floor(free / 1048576)} MB free, the last backup took ${Math.ceil(last.bytes / 1048576)} MB. Free some space or point the backups at a bigger disk; the backups already there are kept`);
      }
    }

    const at = now();
    const stamp = stampOf(at);
    let n = 0;
    for (;;) {
      partial = join(dir, `.kinboard-backup-${stamp}${n ? `-${n}` : ""}.partial`);
      if (!lstatExists(partial)) break;
      if (++n > 50) throw new Error("could not find a free temporary name");
    }
    await exportTo(partial);
    const st = lstatSync(partial);
    if (!st.isFile() || st.size === 0) throw new Error("the export wrote nothing");
    if ((st.mode & 0o077) !== 0) throw new Error(`the archive was written with mode ${(st.mode & 0o777).toString(8)}, not 0600`);

    const { problems, manifest } = await verifyArchive(partial);
    if (problems.length) throw new Error(`the archive did not verify: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? ` (and ${problems.length - 5} more)` : ""}`);

    // The version, and the build (`sha-<revision>`, a tag every published image has): the image a restore starts.
    const v = String(version || manifest.kinboard.version || "").replace(/[^0-9A-Za-z.+-]/g, "").slice(0, 64);
    let finalName = `kinboard-backup-${stamp}${v ? `-${v}` : ""}.tar.gz`;
    if (lstatExists(join(dir, finalName))) finalName = `kinboard-backup-${stampOf(new Date(at.getTime() + 1000))}${v ? `-${v}` : ""}.tar.gz`;
    if (!BACKUP_NAME.test(finalName)) throw new Error(`internal: ${finalName} is not a backup name`);
    const final = join(dir, finalName);
    if (lstatExists(final)) throw new Error(`${final} already exists`);
    fsyncPath(partial, constants.O_RDONLY);
    renameSync(partial, final);
    partial = "";
    fsyncPath(dir);

    const removed = [];
    for (const old of pruneList(listBackups(dir).map((b) => b.name), keep, finalName)) {
      try {
        rmSync(join(dir, old), { force: true });
        removed.push(old);
      } catch (err) {
        log(`could not remove the old backup ${old}: ${err.message}`);
      }
    }
    if (removed.length) fsyncPath(dir);

    const rows = manifest.tables.reduce((s, t) => s + t.rows, 0);
    const result = {
      ok: true,
      file: finalName,
      dir,
      bytes: lstatSync(final).size,
      version: manifest.kinboard.version,
      tables: manifest.tables.length,
      rows,
      files: manifest.files.length,
      secrets: manifest.secrets.length,
      removed,
      durationMs: Date.now() - started,
    };
    log(`verified: ${final} (${result.tables} tables, ${rows} rows, ${result.files} file(s), ${result.secrets} key(s), ${result.bytes} bytes)${removed.length ? `; removed ${removed.join(", ")}` : ""}`);
    return result;
  } catch (err) {
    let msg = err?.message ?? String(err);
    if (err?.code === "ENOSPC" || /No space left on device/i.test(msg)) {
      // The tool's own words (tar, gzip) to the log; Settings gets the plain one.
      log(`the disk ran full: ${msg}`);
      msg = `the disk with ${dir} is full. Free some space there or use a bigger disk; the backups already there are kept`;
    }
    if (partial) {
      try {
        rmSync(partial, { force: true });
      } catch {
        /* the next run removes it */
      }
    }
    log(`NOT a backup: ${msg}`);
    return { ok: false, error: msg, dir, durationMs: Date.now() - started };
  } finally {
    process.umask(oldUmask);
  }
}

/* ------------------------------------------------------------------ main */

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv) {
  if (argv[0] === "--clean-exports") {
    // At the all-in-one image's start (db-ready.sh), before anything can export.
    for (const p of removeExportLeftovers({ filesDir: process.env.FILES_DIR || "", olderThanMs: 0 })) process.stderr.write(`${TAG} removed ${p}, left by an export that was cut off\n`);
    return 0;
  }
  const dir = argValue(argv, "--dir");
  const keep = Number(argValue(argv, "--keep") ?? DEFAULT_KEEP);
  if (!dir || !Number.isSafeInteger(keep) || keep < 1 || keep > MAX_KEEP) {
    process.stderr.write("usage: kinboard-scheduled-backup.mjs --dir <absolute folder> --keep <1-365>\n");
    return 2;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  let version = "";
  try {
    version = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version ?? "";
  } catch {
    /* the manifest's version is used */
  }
  try {
    const rev = /^revision=([0-9a-f]{7,40})$/m.exec(readFileSync(process.env.KINBOARD_AIO_BUILD || "/etc/kinboard-aio/build", "utf8"))?.[1];
    if (rev && version) version = `${version}-sha-${rev.slice(0, 7)}`;
  } catch {
    /* not the all-in-one image: the version alone */
  }
  const { exportArchive } = await import("./kinboard-transfer.mjs");
  const result = await runBackup({
    dir: resolve(dir),
    keep,
    version,
    filesDir: process.env.FILES_DIR || "",
    exportTo: async (out) => {
      exportArchive({ out, log: (s) => process.stderr.write(`${TAG} ${s}\n`) });
    },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
    process.exit(1);
  });
}
