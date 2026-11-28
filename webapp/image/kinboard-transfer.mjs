#!/usr/bin/env node
/**
 * kinboard export / kinboard import: moving an install between the two shapes
 * (RFC-024 §4.4). Never by sharing a data folder: a compose install runs
 * supabase/postgres (glibc, PostgreSQL 15), the all-in-one image Alpine's
 * PostgreSQL 17 (musl), and a folder opens only under the major that wrote it,
 * and even then text indexes built under another C library can be silently
 * out of order. So the move is logical, and the same command runs in both
 * images:
 *
 *   kinboard export [<file> | -]   one archive (.tar.gz): every table of the
 *                                  `public` and `kinboard` schemas, the
 *                                  uploaded files and the secrets that must
 *                                  travel (the JWT secret, so tokens and keys
 *                                  stay valid; the VAPID pair, so push keeps
 *                                  working; the cron secret and the presence
 *                                  sensor token, which other systems hold)
 *   kinboard import <file | ->     restores it into a FRESH install of the same
 *                                  Kinboard version, before its first family:
 *                                  refuses a database with a family in it, an
 *                                  archive from another version, a files
 *                                  folder that is not empty
 *
 * The archive (format 1):
 *   manifest.json   the version, the source's PostgreSQL, the migrations it
 *                   had (name and checksum), and per table its columns (by
 *                   name; since 1.18.0-rc.2 sorted, with their types), row
 *                   count and checksum; per sequence its value; per file its
 *                   size and SHA-256
 *   data/NNNN.copy  each table in COPY text format, its columns in the
 *                   manifest's order, read in one repeatable-read snapshot
 *
 * Columns go by name, never by position: an install that gained a column
 * through a migration has it at the end, a fresh install where its CREATE
 * TABLE put it, so the same table can hold the same columns in another order
 * on the two sides. The export lists them (and COPYs and checksums them) in
 * one order, the import COPYs into and checksums them in the archive's order,
 * whatever the order of its own table. An archive from 1.18.0-rc.1 lists them
 * in its source's order, which its data and checksums follow, so it imports
 * the same way.
 *   files/…         the uploaded files (FILES_DIR)
 *   secrets/…       the secrets above, one value per file. Never the database
 *                   password: the target keeps its own, which its cluster was
 *                   created with.
 *
 * Nothing from an archive is executed as SQL. The import builds every
 * statement from the target's own catalog (its tables, columns, sequences)
 * and feeds the archive's rows only through COPY, so an archive made by hand
 * cannot run code as the superuser. It runs in one transaction with triggers
 * off (session_replication_role = replica, as pg_restore's
 * --disable-triggers): TRUNCATE everything, COPY everything, set the
 * sequences, then recompute every table's count and checksum and roll the
 * whole transaction back on the first difference. Files and secrets go in
 * before that commit and are taken out again when it fails.
 *
 * The archive holds every family's data and the keys that sign their logins:
 * it is written 0600, and the export says to keep it private.
 *
 * Env (the images set them; a `docker exec` sees them):
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB   the database (db, 5432, postgres)
 *   POSTGRES_PASSWORD / the secrets store       the superuser's password
 *   KINBOARD_SECRETS_DIR                        the secrets store (/kinboard/secrets)
 *   FILES_DIR                                   the uploaded files (/var/lib/storage/files)
 *   KINBOARD_AIO                                set in the all-in-one image: the import
 *                                               restarts PostgREST and the webapp itself
 */
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, chownSync, closeSync, constants, copyFileSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, statfsSync, writeFileSync, writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SECRETS_DIR, STORED, resolveSecrets } from "./secrets-store.mjs";

export const FORMAT = "kinboard-export";
export const FORMAT_VERSION = 1;
const TAG = "[kinboard]";

/** The secrets that travel with an install, by variable. Never POSTGRES_PASSWORD. */
export const TRANSFERRED_SECRETS = ["JWT_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "CRON_SECRET", "PRESENCE_SENSOR_TOKEN"];
const FILE_OF = Object.fromEntries(STORED.map((s) => [s.env, s.file]));

/** Tables that are not data: the target's own record of its schema. */
export const EXCLUDED_TABLES = ["kinboard.schema_migrations"];

/**
 * Tables an install that started before 1.15 may still have and a fresh one
 * never has, by name, with why. public.schema_migrations (one column,
 * `version varchar(14)` on the household that found this) is bookkeeping
 * from the stack before 1.15, with no family's data; nothing reads it since. An archive that holds one imports without it
 * (said in the log) when this install has no such table; when it has one, it
 * is imported like any other. Any other table the archive has and this
 * install lacks is still refused: an install with a table we don't know is
 * not the same version, or not ours.
 */
export const LEFTOVER_TABLES = {
  "public.schema_migrations": "a migration record that installs from before 1.15 still have (Kinboard keeps its own in kinboard.schema_migrations)",
};

/**
 * What an import has put in place before its commit. Kept in the SECRETS
 * folder, written as its owner: whoever could forge it could change the
 * secrets anyway. Never in FILES_DIR, which on compose belongs to the
 * server's user while the secrets belong to root: a record there would let
 * that user make the import remove or swap root's secrets.
 */
export const PENDING = ".kinboard-import-pending.json";

/**
 * Before an import: an earlier one cut off before its commit is undone (its
 * files and secrets taken out again) when the database has no family, or its
 * record just removed when it had committed. Only a record in the secrets
 * folder counts. Returns a sentence for the log, or "".
 */
export function resumeLeftover({ filesDir, secretsDir, families, dbNonce = "" }) {
  const pending = join(secretsDir, PENDING);
  if (!existsSync(secretsDir) || !existsSync(pending)) return "";
  const rec = JSON.parse(asOwnerOf(secretsDir, () => readPlain(pending, "utf8")));
  if (typeof rec?.nonce === "string" && rec.nonce !== "" && rec.nonce === dbNonce) {
    asOwnerOf(secretsDir, () => rmSync(pending, { force: true }));
    return "an earlier import had committed before it was cut off; its record is removed.";
  }
  if (Number(families) > 0) {
    throw new Error(`an earlier import was cut off before its commit, and this install has a family since. Its files (${(rec.files ?? []).join(", ")}) are still in ${filesDir} and its secrets replaced (the earlier values are kept as <name>.previous-*): check them, then remove ${pending}.`);
  }
  undoPlaced(rec, filesDir, secretsDir);
  asOwnerOf(secretsDir, () => rmSync(pending, { force: true }));
  return `an earlier import was cut off before its commit: its ${rec.files?.length ?? 0} file(s) and ${rec.secrets?.length ?? 0} secret(s) are taken out again.`;
}

/**
 * Takes out what an import put in place before its commit: the files it
 * renamed into FILES_DIR (top-level names) and the secrets it replaced (put
 * back from their kept copy, or removed when there was none).
 */
export function undoPlaced(rec, filesDir, secretsDir) {
  for (const n of rec.files ?? []) {
    if (typeof n !== "string" || !safeRelative(n) || n.includes("/")) continue;
    asOwnerOf(filesDir, () => rmSync(join(filesDir, n), { recursive: true, force: true }));
  }
  for (const sec of rec.secrets ?? []) {
    const file = sec?.file;
    if (!Object.values(FILE_OF).includes(file)) continue;
    asOwnerOf(secretsDir, () => {
      const keep = typeof sec.keep === "string" && resolve(dirname(sec.keep)) === resolve(secretsDir) && basename(sec.keep).startsWith(`${file}.previous-`) ? sec.keep : null;
      if (keep && existsSync(keep)) renameSync(keep, join(secretsDir, file));
      else rmSync(join(secretsDir, file), { force: true });
    });
  }
}

/**
 * At a start of the all-in-one image, before PostgREST and the webapp read
 * the secrets (db-ready.sh, as PUID): an import cut off before its commit
 * (the container killed, the power gone) is undone here rather than only by
 * the next `kinboard import`. Until then the install ran, with no family, on
 * the archive's keys (a VAPID pair possibly half of one install and half of
 * the other) and with the other install's photos in its files folder; a
 * household that gave up on the import and created a family kept them for
 * good. Also removes a files staging folder an import left (its files were
 * never placed). Returns sentences for the log, or "".
 */
export function resumeAtStart({ env = process.env } = {}) {
  const secretsDir = env.KINBOARD_SECRETS_DIR || DEFAULT_SECRETS_DIR;
  const filesDir = env.FILES_DIR || "/var/lib/storage/files";
  const said = [];
  if (existsSync(filesDir) && !lstatSync(filesDir).isSymbolicLink()) {
    const staged = readdirSync(filesDir).filter((n) => n.startsWith(".kinboard-import-"));
    for (const n of staged) asOwnerOf(filesDir, () => rmSync(join(filesDir, n), { recursive: true, force: true }));
    if (staged.length) said.push(`removed ${staged.length} staging folder(s) an import cut off before placing its files had left in ${filesDir}.`);
  }
  if (existsSync(secretsDir) && existsSync(join(secretsDir, PENDING))) {
    const { pg } = dbEnv(env);
    const families = Number(psql(pg, "SELECT count(*) FROM public.families;\n").trim());
    const done = resumeLeftover({ filesDir, secretsDir, families, dbNonce: readNonce(pg) });
    if (done) said.push(done);
  }
  return said.join(" ");
}

/* ------------------------------------------------------------ free space */

const MB = 1024 * 1024;
const mb = (n) => `${Math.ceil(n / MB)} MB`;

/**
 * Whether the disks an import writes to have room for it, before anything is
 * written. `needs` is a list of { path, bytes, what }; paths on the same
 * filesystem are added up. Returns sentences, empty when everything fits.
 * The database's need is an estimate (its table data about twice over: the
 * rows, their indexes and the write-ahead log of one transaction), so a
 * import that would run the disk full is refused up front rather than by
 * PostgreSQL half-way, which then stops with "No space left on device".
 */
export function spaceProblems(needs, { statfs = statfsSync, dev = (p) => statSync(p).dev } = {}) {
  const byDisk = new Map();
  for (const n of needs) {
    if (!n.bytes) continue;
    let at = n.path;
    while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
    const key = String(dev(at));
    const d = byDisk.get(key) ?? { paths: [], bytes: 0, what: [], at };
    d.paths.push(n.path); d.bytes += n.bytes; d.what.push(`${n.what} ${mb(n.bytes)}`);
    byDisk.set(key, d);
  }
  const p = [];
  for (const d of byDisk.values()) {
    const st = statfs(d.at);
    const free = Number(st.bavail) * Number(st.bsize);
    if (free < d.bytes) {
      p.push(`not enough free space: ${d.paths.join(" and ")} ${d.paths.length > 1 ? "(one disk) have" : "has"} ${mb(free)} free, and this import needs about ${mb(d.bytes)} there (${d.what.join(", ")}). Free some space or give it a bigger disk, then run the import again`);
    }
  }
  return p;
}

/** The size of every entry in a busybox `tar -tvzf` listing, added up. */
export function listedBytes(listing) {
  let n = 0;
  for (const line of listing.split("\n")) {
    const size = Number(line.split(/\s+/)[2]);
    if (Number.isSafeInteger(size) && size > 0) n += size;
  }
  return n;
}

/** The nonce the last committed import wrote, or "". */
function readNonce(pg) {
  return psql(pg, "SELECT coalesce((SELECT value FROM public.instance_settings WHERE key = 'import_nonce'), '');\n").trim();
}

/** The archive's top-level entries; anything else is refused. */
const TOP_LEVEL = new Set(["manifest.json", "data", "secrets", "files"]);

/**
 * The session both sides compute checksums in, so a row's text is the same
 * on PostgreSQL 15 and 17 whatever the server's own defaults.
 */
export const SESSION_SQL = [
  "SET TimeZone = 'UTC';",
  "SET DateStyle = 'ISO, MDY';",
  "SET IntervalStyle = 'postgres';",
  "SET extra_float_digits = 1;",
  "SET bytea_output = 'hex';",
  "SET client_encoding = 'UTF8';",
].join("\n");

/* ------------------------------------------------------------- SQL pieces */

/** A double-quoted identifier. */
export const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
/** A single-quoted literal. */
export const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;
const qualified = (t) => `${ident(t.schema)}.${ident(t.table)}`;
const keyOf = (t) => `${t.schema}.${t.table}`;

/** The row count and checksum of a table over its listed columns, as one SELECT. */
export function checksumSelect(t) {
  const row = `md5(ROW(${t.columns.map(ident).join(", ")})::text)`;
  return `SELECT count(*)::bigint AS n, coalesce(md5(string_agg(${row}, '' ORDER BY ${row})), '') AS h FROM ${qualified(t)}`;
}

/**
 * The catalog query: every table with data in the two schemas, its columns
 * sorted by name (bytewise) with their types in the same order, and every
 * sequence.
 */
export const CATALOG_SQL = `
SELECT json_build_object(
  'tables', coalesce((
    SELECT json_agg(json_build_object(
      'schema', n.nspname, 'table', c.relname,
      'columns', (SELECT coalesce(json_agg(a.attname ORDER BY a.attname COLLATE "C"), '[]'::json) FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''),
      'types', (SELECT coalesce(json_agg(format_type(a.atttypid, a.atttypmod) ORDER BY a.attname COLLATE "C"), '[]'::json) FROM pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''))
      ORDER BY n.nspname, c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname IN ('public', 'kinboard')
       AND (n.nspname || '.' || c.relname) <> ALL (ARRAY[${EXCLUDED_TABLES.map(literal).join(", ")}])), '[]'::json),
  'sequences', coalesce((
    SELECT json_agg(json_build_object('schema', schemaname, 'name', sequencename, 'last_value', last_value::text,
                                      'start_value', start_value::text) ORDER BY schemaname, sequencename)
      FROM pg_sequences WHERE schemaname IN ('public', 'kinboard')), '[]'::json),
  'migrations', coalesce((SELECT json_agg(json_build_object('name', name, 'checksum', checksum) ORDER BY name)
      FROM kinboard.schema_migrations), '[]'::json),
  'server', current_setting('server_version'),
  'families', (SELECT count(*) FROM public.families),
  'devices', (SELECT count(*) FROM public.devices)
)`;

/* --------------------------------------------------------------- checks */

const HEX32 = /^[0-9a-f]{32}$/;
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const DATA_FILE = /^data\/\d{4}\.copy$/;
const BIGINT = /^-?\d{1,19}$/;

/**
 * Every problem with a manifest, as sentences. Empty means it is one of ours,
 * well-formed. (It is still checked against the target before anything is
 * written.)
 */
export function manifestProblems(m) {
  const p = [];
  if (!m || typeof m !== "object") return ["manifest.json is not a JSON object"];
  if (m.format !== FORMAT) p.push(`not a Kinboard export (format ${JSON.stringify(m.format)})`);
  if (m.formatVersion !== FORMAT_VERSION) p.push(`export format ${m.formatVersion}, this Kinboard reads ${FORMAT_VERSION}`);
  if (typeof m.kinboard?.version !== "string") p.push("no Kinboard version");
  if (!Array.isArray(m.migrations)) p.push("no migration list");
  if (!Array.isArray(m.tables) || m.tables.length === 0) p.push("no tables");
  for (const t of m.tables ?? []) {
    const name = `${t?.schema}.${t?.table}`;
    if (typeof t?.schema !== "string" || typeof t?.table !== "string") { p.push("a table without a name"); continue; }
    if (!Array.isArray(t.columns) || !t.columns.every((c) => typeof c === "string")) p.push(`${name}: no column list`);
    else if (new Set(t.columns).size !== t.columns.length) p.push(`${name}: a column listed twice`);
    // Since 1.18.0-rc.2; an archive from rc.1 has none.
    if (t.types !== undefined && !(Array.isArray(t.types) && t.types.length === t.columns?.length && t.types.every((c) => typeof c === "string"))) p.push(`${name}: the column types don't match the column list`);
    if (!isCount(t.rows)) p.push(`${name}: no row count`);
    if (!(t.checksum === "" || HEX32.test(t.checksum ?? ""))) p.push(`${name}: no checksum`);
    if (!DATA_FILE.test(t.file ?? "")) p.push(`${name}: data file ${JSON.stringify(t.file)} is not data/NNNN.copy`);
  }
  for (const s of m.sequences ?? []) {
    if (typeof s?.schema !== "string" || typeof s?.name !== "string") p.push("a sequence without a name");
    else if (!(s.last_value === null || BIGINT.test(String(s.last_value)))) p.push(`${s.schema}.${s.name}: last value is not a number`);
  }
  for (const f of m.files ?? []) {
    if (!safeRelative(f?.path ?? "")) p.push(`file ${JSON.stringify(f?.path)} is not a plain relative path`);
    if (!isCount(f?.size) || !/^[0-9a-f]{64}$/.test(f?.sha256 ?? "")) p.push(`file ${f?.path}: no size or SHA-256`);
  }
  for (const s of m.secrets ?? []) if (!TRANSFERRED_SECRETS.includes(s)) p.push(`secret ${s} is not one that travels`);
  return p;
}

/** A relative path with no `..`, no leading `/`, no empty or `.` part. */
export function safeRelative(path) {
  if (typeof path !== "string" || path === "" || path.startsWith("/") || path.includes("\0") || path.includes("\\")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/**
 * The archive's tables this install lacks that an import leaves out: the
 * known leftovers of older installs (LEFTOVER_TABLES), only when this install
 * has no such table. As "schema.table".
 */
export function skippedTables(manifest, target) {
  const have = new Set(target.tables.map(keyOf));
  return manifest.tables.map(keyOf).filter((k) => !have.has(k) && Object.hasOwn(LEFTOVER_TABLES, k));
}

/**
 * A table's columns in the archive against this install's: the same names
 * (in any order) and, when the archive records them, the same types.
 * Sentences, empty when they match. Not their NOT NULL: an install that grew
 * through the migrations can lack one a fresh install has (public.settings'
 * value on a household from before 1.15), and PostgreSQL itself refuses a
 * NULL there during the COPY, which rolls the whole import back.
 */
export function columnProblems(k, want, have) {
  const here = new Set(have.columns);
  const there = new Set(want.columns);
  const onlyThere = want.columns.filter((c) => !here.has(c));
  const onlyHere = have.columns.filter((c) => !there.has(c));
  if (onlyThere.length || onlyHere.length) {
    return [`table ${k} has other columns here (only in the archive: ${onlyThere.join(", ") || "none"}; only here: ${onlyHere.join(", ") || "none"})`];
  }
  if (!Array.isArray(want.types) || !Array.isArray(have.types)) return [];
  const typeHere = new Map(have.columns.map((c, i) => [c, have.types[i]]));
  return want.columns.flatMap((c, i) => (typeHere.get(c) === want.types[i] ? []
    : [`table ${k}: column ${c} is ${want.types[i]} in the archive and ${typeHere.get(c)} here`]));
}

/**
 * The target's table `h` with its columns in the archive table `t`'s order,
 * the order its data and checksum follow, each name as the target's catalog
 * has it. Throws when the two sets differ (targetProblems refuses that first).
 */
export function inArchiveOrder(t, h) {
  const named = new Map(h.columns.map((c) => [c, c]));
  const columns = t.columns.map((c) => named.get(c));
  if (columns.some((c) => c === undefined) || columns.length !== h.columns.length || new Set(columns).size !== columns.length) {
    throw new Error(`table ${keyOf(t)}: the archive's columns are not this install's`);
  }
  return { ...h, columns };
}

/**
 * What the target must be for an import: the same migrations (the same
 * Kinboard version: rows seeded by a migration the source never had would be
 * lost to the TRUNCATE, and a column it lacks would not restore), no family
 * and no device yet, the same tables with the same columns (by name and type;
 * their order does not matter). A known leftover of an older
 * install (LEFTOVER_TABLES) this install lacks is no problem: it is left out.
 */
export function targetProblems(manifest, target) {
  const p = [];
  const mig = (list) => list.map((x) => `${x.name} ${x.checksum}`).sort();
  const a = mig(manifest.migrations);
  const b = mig(target.migrations);
  const onlySource = a.filter((x) => !b.includes(x));
  const onlyTarget = b.filter((x) => !a.includes(x));
  if (onlySource.length || onlyTarget.length) {
    p.push(
      `the archive is from Kinboard ${manifest.kinboard.version} and this install runs another version: ` +
      `${onlySource.length} migration(s) only in the archive, ${onlyTarget.length} only here` +
      `${onlySource[0] ? ` (e.g. ${onlySource[0].split(" ")[0]})` : onlyTarget[0] ? ` (e.g. ${onlyTarget[0].split(" ")[0]})` : ""}. ` +
      "Export and import with the same Kinboard version: update the old install first, or install this one at the archive's version.",
    );
  }
  if (Number(target.families) > 0 || Number(target.devices) > 0) {
    p.push(`this install already has ${target.families} family(ies) and ${target.devices} device(s); an import goes into a fresh install only, before the first family is created`);
  }
  const want = new Map(manifest.tables.map((t) => [keyOf(t), t]));
  const have = new Map(target.tables.map((t) => [keyOf(t), t]));
  const skipped = new Set(skippedTables(manifest, target));
  for (const [k, t] of want) {
    const h = have.get(k);
    if (!h) { if (!skipped.has(k)) p.push(`table ${k} is in the archive but not in this install`); }
    else p.push(...columnProblems(k, t, h));
  }
  for (const k of have.keys()) if (!want.has(k)) p.push(`table ${k} is in this install but not in the archive`);
  return p;
}

/* ---------------------------------------------------------- the database */

function dbEnv(env) {
  const { values, errors } = resolveSecrets(env, { dir: env.KINBOARD_SECRETS_DIR || DEFAULT_SECRETS_DIR });
  if (!values.POSTGRES_PASSWORD) throw new Error(`no database password: ${errors.join("; ") || "not in the environment or the secrets store"}`);
  return {
    values,
    pg: {
      ...env,
      PGHOST: env.POSTGRES_HOST || "db",
      PGPORT: env.POSTGRES_PORT || "5432",
      PGDATABASE: env.POSTGRES_DB || "postgres",
      PGUSER: "supabase_admin",
      PGPASSWORD: values.POSTGRES_PASSWORD,
      PGOPTIONS: "-c client_min_messages=warning",
    },
  };
}

/** psql with a script on stdin; throws with its error output. */
function psql(pgEnv, script, extra = []) {
  const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA", ...extra], {
    env: pgEnv, input: script, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `psql exited ${r.status}`).trim());
  return r.stdout;
}

function readCatalog(pgEnv) {
  return JSON.parse(psql(pgEnv, `${CATALOG_SQL};\n`).trim());
}

/* -------------------------------------------------------------- the files */

/**
 * The SHA-256 of a plain file, opened without following a link and checked on
 * the descriptor: root hashes files in folders their owner can change, and a
 * link swapped in after a listing must not have a root-only file hashed into
 * a manifest.
 */
function sha256File(path) {
  const h = createHash("sha256");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`${path} is not a plain file`);
    const buf = Buffer.allocUnsafe(1 << 20);
    let n;
    while ((n = readSync(fd, buf)) > 0) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

/** Every regular file under a folder, as { path, size, sha256 }, sorted. Symlinks are reported, not followed. */
export function listFiles(root, warn = () => {}) {
  const out = [];
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push({ path: relative(root, p).split(sep).join("/"), size: st.size, sha256: sha256File(p) });
      else warn(`skipped ${p}: not a regular file`);
    }
  };
  walk(root);
  return out;
}

/* ------------------------------------------------- whose rights to write with */

/**
 * Runs fn with the effective user, group and only group of a folder's owner
 * when this process is root (a `docker exec` into the all-in-one image), so a
 * symlink that owner planted in the folder (or a compromised server running
 * as that owner) leads nowhere they could not write anyway. Not root: fn runs
 * as is. The folder itself must not be a symlink.
 *
 * @template T
 * @param {string} dir
 * @param {(ids: { uid: number, gid: number } | null) => T} fn
 * @returns {T}
 */
export function asOwnerOf(dir, fn) {
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${dir} is not a plain folder (a symlink?); refusing to write into it`);
  if (typeof process.getuid !== "function" || process.getuid() !== 0 || st.uid === 0) return fn(null);
  const groups = process.getgroups();
  process.setgroups([st.gid]);
  process.setegid(st.gid);
  process.seteuid(st.uid);
  try {
    return fn({ uid: st.uid, gid: st.gid });
  } finally {
    process.seteuid(0);
    process.setegid(0);
    process.setgroups(groups);
  }
}

/** The {uid, gid} to spawn a child with as a folder's owner, from root; {} otherwise. */
export function ownerIds(dir) {
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${dir} is not a plain folder (a symlink?)`);
  if (typeof process.getuid !== "function" || process.getuid() !== 0 || st.uid === 0) return {};
  return { uid: st.uid, gid: st.gid };
}

/**
 * Reads a file that must be a plain file with one name: opened without
 * following a link (O_NOFOLLOW), then checked on the open descriptor
 * (fstat), so nothing swapped in between a check and the read is read.
 */
export function readPlain(path, encoding) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error(`${path} is not a plain file`);
    if (st.nlink !== 1) throw new Error(`${path} has other names (a hard link)`);
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = readSync(fd, buf, off, st.size - off, off);
      if (n === 0) break;
      off += n;
    }
    const out = buf.subarray(0, off);
    return encoding ? out.toString(encoding) : out;
  } finally {
    closeSync(fd);
  }
}

/**
 * The extracted archive taken over by root before root reads any of it:
 * every entry owned by root and writable by nobody else, the top folder 0700
 * (so the unprivileged user that unpacked it can no longer swap anything in),
 * and only then checked: plain files with one name each, and folders.
 */
export function takeOver(x) {
  // Checked before the chown too: a hard link unpacked by 65534 must not get its inode re-owned.
  checkExtracted(x);
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    const r = spawnSync("chown", ["-R", "-h", "0:0", x]);
    if (r.status !== 0) throw new Error(`could not take the extracted archive over: ${String(r.stderr)}`);
    spawnSync("chmod", ["-R", "go-w", x]);
  }
  chmodSync(x, 0o700);
  checkExtracted(x);
}

function checkExtracted(x) {
  const odd = oddEntries(x);
  if (odd.length) throw new Error(`refusing this archive: not plain files or folders: ${odd.slice(0, 5).join(", ")}`);
  const linked = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.nlink !== 1) linked.push(relative(x, p));
    }
  };
  walk(x);
  if (linked.length) throw new Error(`refusing this archive: hard links: ${linked.slice(0, 5).join(", ")}`);
}

/** Every entry under a folder that is neither a plain file nor a folder (a symlink, a socket…). */
export function oddEntries(root) {
  const out = [];
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (!st.isFile()) out.push(p);
    }
  };
  walk(root);
  return out;
}

/* ---------------------------------------------------------------- export */

export function exportArchive({ out, env = process.env, log = (s) => process.stderr.write(`${TAG} ${s}\n`) }) {
  const { values, pg } = dbEnv(env);
  const filesDir = env.FILES_DIR || "/var/lib/storage/files";
  const work = mkdtempSync(join(tmpdir(), "kinboard-export-"));
  let stage = "";
  const oldUmask = process.umask(0o077);
  try {
    const catalog = readCatalog(pg);
    mkdirSync(join(work, "data"));
    const tables = catalog.tables.map((t, i) => ({ ...t, file: `data/${String(i + 1).padStart(4, "0")}.copy` }));
    // One snapshot for every table, the checksums included.
    const script = [
      SESSION_SQL,
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;",
      ...tables.map((t) => `\\copy (SELECT ${t.columns.map(ident).join(", ") || "NULL"} FROM ${qualified(t)}) TO ${literal(join(work, t.file))}`),
      ...tables.map((t) => `SELECT ${literal(keyOf(t))} || ' ' || n || ' ' || h FROM (${checksumSelect(t)}) s;`),
      "COMMIT;",
    ].join("\n");
    const sums = psql(pg, `${script}\n`).trim().split("\n").filter(Boolean);
    const byKey = new Map(sums.map((line) => { const [k, n, h] = line.split(" "); return [k, { rows: Number(n), checksum: h ?? "" }]; }));
    for (const t of tables) Object.assign(t, byKey.get(keyOf(t)));

    const files = listFiles(filesDir, log);
    mkdirSync(join(work, "secrets"));
    const secrets = [];
    for (const name of TRANSFERRED_SECRETS) {
      if (!values[name]) continue;
      writeFileSync(join(work, "secrets", FILE_OF[name]), values[name], { mode: 0o600 });
      secrets.push(name);
    }
    const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "package.json"), "utf8"));
    const manifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      kinboard: { version: pkg.version, shape: env.KINBOARD_AIO === "1" ? "all-in-one" : "compose" },
      postgres: catalog.server,
      migrations: catalog.migrations,
      tables,
      sequences: catalog.sequences.map((s) => ({ schema: s.schema, name: s.name, last_value: s.last_value })),
      files,
      secrets,
    };
    writeFileSync(join(work, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`, { mode: 0o600 });
    // The uploaded files go in under files/. busybox tar honours only its
    // last -C and has no --transform, so with files the whole archive is
    // staged in one folder next to FILES_DIR (the same filesystem: the files
    // as hard links, no copy, no extra space), everything in it written as
    // that folder's owner, and tar reads it as that owner too: root makes no
    // link, copy or read where a link points.
    let args = ["-czf", "-", "-C", work, "manifest.json", "data", "secrets"];
    let tarAs = {};
    if (files.length) {
      const parent = dirname(filesDir);
      // The folder made with the owner's effective ids; the children spawned
      // from root with the owner's ids (a child spawned while the euid is
      // dropped could not take a gid: no capability left to do so).
      const as = ownerIds(parent);
      stage = asOwnerOf(parent, () => mkdtempSync(join(parent, ".kinboard-export-")));
      tarAs = as;
      const ok = (spawnSync("cp", ["-al", filesDir, join(stage, "files")], as).status === 0
          || spawnSync("cp", ["-a", filesDir, join(stage, "files")], as).status === 0)
        // Only what the manifest lists: a link in the files folder is left
        // out (listFiles reported it), or the archive's own import refuses it.
        && spawnSync("find", [join(stage, "files"), "!", "-type", "f", "!", "-type", "d", "-delete"], as).status === 0;
      if (!ok) throw new Error(`could not stage ${filesDir} for the archive`);
      // The rest of the archive into the same folder, read as root, written as its owner.
      const copyIn = (rel) => {
        const srcPath = join(work, rel);
        if (lstatSync(srcPath).isDirectory()) {
          asOwnerOf(stage, () => mkdirSync(join(stage, rel), { mode: 0o700 }));
          for (const n of readdirSync(srcPath)) copyIn(join(rel, n));
        } else {
          const bytes = readFileSync(srcPath);
          asOwnerOf(stage, () => writeFileSync(join(stage, rel), bytes, { flag: "wx", mode: 0o600 }));
        }
      };
      for (const rel of ["manifest.json", "data", "secrets"]) copyIn(rel);
      args = ["-czf", "-", "-C", stage, "manifest.json", "data", "secrets", "files"];
    }
    // A file of our own, created new (O_EXCL, O_NOFOLLOW) as the owner of the
    // folder it goes into: never over an existing file or through a link
    // planted at the predictable default name in /data/backups.
    let fd = 1;
    if (out !== "-") {
      const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
      fd = asOwnerOf(dirname(resolve(out)), () => openSync(out, flags, 0o600));
    }
    let r;
    try {
      r = spawnSync("tar", args, { stdio: ["ignore", fd, "pipe"], encoding: "utf8", ...tarAs });
    } finally {
      if (out !== "-") closeSync(fd);
    }
    if (r.status !== 0) {
      if (out !== "-") asOwnerOf(dirname(resolve(out)), () => rmSync(out, { force: true }));
      throw new Error(`tar failed: ${(r.stderr || "").trim()}`);
    }
    const rows = tables.reduce((n, t) => n + t.rows, 0);
    log(`exported Kinboard ${pkg.version}: ${tables.length} tables (${rows} rows), ${files.length} file(s), ${secrets.length} secret(s)${out === "-" ? "" : ` to ${out}`}.`);
    log("The archive holds every family's data and the keys that sign their logins: keep it private, and delete it once it is imported.");
    return manifest;
  } finally {
    process.umask(oldUmask);
    rmSync(work, { recursive: true, force: true });
    if (stage) {
      try { asOwnerOf(dirname(stage), () => rmSync(stage, { recursive: true, force: true })); } catch { /* reported by nothing: a leftover dot-folder */ }
    }
  }
}

/* ---------------------------------------------------------------- import */

/**
 * Lists an archive and refuses anything but plain files and folders under
 * the four expected names, before a byte of it is extracted.
 */
export function archiveEntryProblems(listing) {
  const p = [];
  for (const line of listing.split("\n").filter(Boolean)) {
    // busybox `tar -tvzf`: "<mode> <owner> <size> <date> <time> <name>[ -> <target>]"
    const mode = line[0];
    const name = line.replace(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+/, "").replace(/^\.\//, "");
    if (mode !== "-" && mode !== "d") { p.push(`${name}: not a plain file or folder (type ${mode})`); continue; }
    // busybox lists a hard link as a plain file "name -> target".
    if (name.includes(" -> ")) { p.push(`${name}: a link`); continue; }
    if (/[\u0000-\u001f\u007f]/.test(name)) { p.push(`${JSON.stringify(name)}: a control character in a name`); continue; }
    if (name === "" || name === ".") continue;
    const clean = name.replace(/\/$/, "");
    if (!safeRelative(clean)) { p.push(`${name}: not a plain relative path`); continue; }
    if (!TOP_LEVEL.has(clean.split("/")[0])) p.push(`${name}: unexpected entry`);
  }
  return p;
}

function writeSecretFile(dir, file, value, like) {
  const tmp = join(dir, `.${file}.import-tmp`);
  rmSync(tmp, { force: true });
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, like?.mode ?? 0o600);
  try {
    writeSync(fd, value);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (like) {
    chmodSync(tmp, like.mode);
    try { chownSync(tmp, like.uid, like.gid); } catch { /* not root: it is ours already */ }
  }
  renameSync(tmp, join(dir, file));
}

export function importArchive({ archive, env = process.env, restart = true, log = (s) => process.stderr.write(`${TAG} ${s}\n`) }) {
  const { pg } = dbEnv(env);
  const filesDir = env.FILES_DIR || "/var/lib/storage/files";
  const secretsDir = env.KINBOARD_SECRETS_DIR || DEFAULT_SECRETS_DIR;
  const work = mkdtempSync(join(tmpdir(), "kinboard-import-"));
  const oldUmask = process.umask(0o077);
  const undo = [];
  let pendingWritten = false;
  let cleanupX = "";
  let stage = "";
  try {
    // 1. The archive, listed and checked before it is extracted.
    let path = archive;
    if (archive === "-") {
      path = join(work, "archive.tar.gz");
      const fd = openSync(path, "w", 0o600);
      const r = spawnSync("cat", [], { stdio: ["inherit", fd, "inherit"] });
      closeSync(fd);
      if (r.status !== 0) throw new Error("could not read the archive from standard input");
    }
    const list = spawnSync("tar", ["-tvzf", path], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (list.status !== 0) {
      // What a household has in hand then: a copy cut short, or the text a
      // failed `docker exec … > file` wrote into the file instead of an archive.
      const head = (() => {
        try {
          const fd = openSync(path, "r");
          try { const b = Buffer.alloc(120); return b.subarray(0, readSync(fd, b, 0, 120, 0)).toString("utf8"); } finally { closeSync(fd); }
        } catch { return ""; }
      })();
      // Quoted printable characters only: a crafted file must not put terminal escapes into the operator's shell.
      const said = /^[\x09\x0a\x0d\x20-\x7e]{8,}/.test(head) ? ` It starts with text, not an archive: ${JSON.stringify(head.split("\n")[0].replace(/[^\x20-\x7e]/g, "").slice(0, 100))}; the export that wrote it failed.` : "";
      throw new Error(`not a readable archive (${(list.stderr || "").trim().replace(/\s*\n\s*/g, "; ")}).${said} Nothing was changed. Export again on the old install and copy the whole file.`);
    }
    const entryProblems = archiveEntryProblems(list.stdout);
    if (entryProblems.length) throw new Error(`refusing this archive:\n  - ${entryProblems.slice(0, 10).join("\n  - ")}`);
    // Unpacked into the container's own temporary folder first, not /data.
    const tmpNeed = spaceProblems([{ path: tmpdir(), bytes: listedBytes(list.stdout) + 16 * MB, what: "the archive unpacked" }]);
    if (tmpNeed.length) throw new Error(`refusing to import; nothing was changed: ${tmpNeed.join("; ")} (this is the container's own ${tmpdir()}, on Docker's disk)`);
    // Unpacked by an unprivileged user (nobody) into a folder of its own: as
    // root, a hard link or an odd entry the listing missed could reach a file
    // of the container's. Then everything is checked once more as it landed.
    const x = mkdtempSync(join(tmpdir(), "kinboard-import-x-"));
    cleanupX = x;
    const asRoot = process.getuid?.() === 0;
    // The unpacking user is reserved: nothing of Kinboard's runs as it (the
    // all-in-one image refuses PUID 65534), so no process of ours can race it.
    const UNPACK = 65534;
    if (asRoot) chownSync(x, UNPACK, UNPACK);
    const archiveFd = openSync(path, "r");
    let ex;
    try {
      ex = spawnSync("tar", ["-xzof", "-", "-C", x], { stdio: [archiveFd, "pipe", "pipe"], encoding: "utf8", ...(asRoot ? { uid: UNPACK, gid: UNPACK } : {}) });
    } finally {
      closeSync(archiveFd);
    }
    if (ex.status !== 0) throw new Error(`could not extract the archive: ${(ex.stderr || "").trim()}`);
    takeOver(x);
    const manifest = JSON.parse(readPlain(join(x, "manifest.json"), "utf8"));
    const mp = manifestProblems(manifest);
    if (mp.length) throw new Error(`refusing this archive:\n  - ${mp.join("\n  - ")}`);

    // 2. The target: same version, fresh, same tables. An import cut off
    // before its commit left a record of what it had put in place: taken out
    // again first, so this run starts from the fresh install it was.
    const target0 = readCatalog(pg);
    if (existsSync(filesDir) && lstatSync(filesDir).isSymbolicLink()) throw new Error(`refusing to import; nothing was changed: ${filesDir} is a symlink`);
    if (existsSync(secretsDir) && lstatSync(secretsDir).isSymbolicLink()) throw new Error(`refusing to import; nothing was changed: ${secretsDir} is a symlink`);
    if (existsSync(filesDir)) {
      const ids = lstatSync(filesDir);
      if (ids.uid === UNPACK) throw new Error(`refusing to import: ${filesDir} belongs to uid ${UNPACK}, the user archives are unpacked as`);
      const resumed = resumeLeftover({ filesDir, secretsDir, families: target0.families, dbNonce: readNonce(pg) });
      if (resumed) log(resumed);
      for (const n of readdirSync(filesDir).filter((n) => n.startsWith(".kinboard-import-"))) {
        asOwnerOf(filesDir, () => rmSync(join(filesDir, n), { recursive: true, force: true }));
      }
    }
    const target = readCatalog(pg);
    const tp = targetProblems(manifest, target);
    if (tp.length) throw new Error(`refusing to import; nothing was changed:\n  - ${tp.join("\n  - ")}`);
    for (const k of skippedTables(manifest, target)) {
      const t = manifest.tables.find((x) => keyOf(x) === k);
      log(`leaving out ${k} (${t.rows} row(s)): ${LEFTOVER_TABLES[k]}; this install has no such table.`);
    }
    if (listFiles(filesDir).length > 0) throw new Error(`refusing to import; nothing was changed: ${filesDir} already holds uploaded files (not a fresh install)`);
    const odd = [...oddEntries(filesDir), ...oddEntries(secretsDir)];
    if (odd.length) throw new Error(`refusing to import; nothing was changed: not plain files or folders (symlinks?): ${odd.slice(0, 5).join(", ")}`);
    // Room for the files and, in the all-in-one image, the database (in
    // /data/db; a compose install's database is in another container).
    for (const t of manifest.tables) {
      if (!existsSync(join(x, t.file))) throw new Error(`refusing to import; nothing was changed: ${t.file} (the data of ${keyOf(t)}), listed in the archive's manifest, is missing from the archive. Export again on the old install and copy the whole file.`);
    }
    const dataBytes = manifest.tables.reduce((n, t) => n + lstatSync(join(x, t.file)).size, 0);
    const needs = [{ path: filesDir, bytes: manifest.files.reduce((n, f) => n + f.size, 0) + 16 * MB, what: "uploaded files" }];
    if (env.KINBOARD_AIO === "1" && env.KINBOARD_DATA) needs.push({ path: join(env.KINBOARD_DATA, "db"), bytes: 3 * dataBytes + 64 * MB, what: "the database, about" });
    const sp = spaceProblems(needs);
    if (sp.length) throw new Error(`refusing to import; nothing was changed: ${sp.join("; ")}`);
    if (!existsSync(filesDir)) asOwnerOf(dirname(filesDir), () => mkdirSync(filesDir));
    // Writable by its owner, tried by creating a file as that owner (access(2)
    // would answer for the real uid, root).
    const secretsWritable = existsSync(secretsDir) && asOwnerOf(secretsDir, () => {
      try {
        const probe = join(secretsDir, `.kinboard-import-probe-${process.pid}`);
        writeFileSync(probe, "", { flag: "wx", mode: 0o600 });
        rmSync(probe, { force: true });
        return true;
      } catch { return false; }
    });
    // Always: the import's own record lives there (PENDING).
    if (!secretsWritable) {
      throw new Error(`refusing to import; nothing was changed: the secrets folder ${secretsDir} is not writable here (on a compose install, run the import with the config volume mounted read-write; see the wiki)`);
    }

    // 3. The files, checked against the manifest, written as the folder's
    // owner into a staging folder inside it (the same filesystem), each one
    // new (O_EXCL: never over an existing name or link), and checked again.
    stage = asOwnerOf(filesDir, () => mkdtempSync(join(filesDir, ".kinboard-import-")));
    for (const f of manifest.files) {
      const src = join(x, "files", f.path);
      if (!existsSync(src)) throw new Error(`refusing to import; nothing was changed: files/${f.path}, listed in the archive's manifest, is missing from the archive. Export again on the old install and copy the whole file.`);
      const bytes = readPlain(src);
      if (createHash("sha256").update(bytes).digest("hex") !== f.sha256) throw new Error(`the file ${f.path} differs from what the archive's manifest says`);
      const dst = join(stage, f.path);
      asOwnerOf(stage, () => {
        mkdirSync(dirname(dst), { recursive: true, mode: 0o755 });
        writeFileSync(dst, bytes, { flag: "wx", mode: 0o644 });
      });
    }
    for (const f of manifest.files) {
      if (asOwnerOf(stage, () => sha256File(join(stage, f.path))) !== f.sha256) throw new Error(`the file ${f.path} did not arrive intact`);
    }

    // 4. Before the commit, everything else into place, with a record of
    // what was placed (PENDING): a run cut off anywhere from here to the
    // commit is undone by the next one, and nothing of it survives a failure.
    const secretValues = Object.fromEntries(manifest.secrets.map((n) => [n, readPlain(join(x, "secrets", FILE_OF[n]), "utf8")]));
    // The nonce is also written inside the transaction: the next run knows
    // for certain whether this one committed (instance_settings.import_nonce).
    const record = { nonce: randomBytes(16).toString("hex"), files: readdirSync(stage), secrets: [] };
    if (existsSync(join(secretsDir, PENDING))) throw new Error(`refusing to import: ${join(secretsDir, PENDING)} is still there`);
    asOwnerOf(secretsDir, () => writeSecretFile(secretsDir, PENDING, JSON.stringify(record), null));
    pendingWritten = true;
    asOwnerOf(filesDir, () => {
      for (const n of record.files) {
        renameSync(join(stage, n), join(filesDir, n));
        undo.push(() => asOwnerOf(filesDir, () => rmSync(join(filesDir, n), { recursive: true, force: true })));
      }
      rmSync(stage, { recursive: true, force: true });
    });
    stage = "";

    // The secrets, each one like the database password's file (mode, owner),
    // as the folder's owner (the all-in-one image's PUID; root on compose,
    // whose config folder belongs to root). The value replaced is kept as
    // <name>.previous-<stamp>[-n].
    const like = (() => { try { return lstatSync(join(secretsDir, FILE_OF.POSTGRES_PASSWORD)); } catch { return null; } })();
    const stampNow = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    for (const name of manifest.secrets) {
      const file = FILE_OF[name];
      const value = secretValues[name];
      const current = join(secretsDir, file);
      const previous = asOwnerOf(secretsDir, () => (existsSync(current) ? readPlain(current, "utf8") : null));
      if (previous === value) continue;
      let keep = null;
      if (previous !== null) {
        keep = asOwnerOf(secretsDir, () => {
          for (let n = 0; ; n++) {
            const k = join(secretsDir, `${file}.previous-${stampNow}${n ? `-${n}` : ""}`);
            try { writeFileSync(k, previous, { flag: "wx", mode: 0o600 }); return k; } catch (err) { if (err?.code !== "EEXIST" || n > 50) throw err; }
          }
        });
      }
      // Recorded before it is written, so a run cut off in between still puts it back.
      record.secrets.push({ file, keep });
      asOwnerOf(secretsDir, () => writeSecretFile(secretsDir, PENDING, JSON.stringify(record), null));
      undo.push(() => undoPlaced({ files: [], secrets: [{ file, keep }] }, filesDir, secretsDir));
      asOwnerOf(secretsDir, () => writeSecretFile(secretsDir, file, value, like));
      if (env[name] && env[name] !== value) log(`warning: ${name} is set in this container's environment, which wins over the imported value; remove it there.`);
    }

    // 5. The database, in one transaction, verified before it commits. Each
    // table's columns in the archive's order (its data and checksum follow
    // it), as this install's catalog names them: the same names, checked above.
    const have = new Map(target.tables.map((t) => [keyOf(t), t]));
    const imported = manifest.tables.filter((t) => have.has(keyOf(t)));
    const seqs = new Map(target.sequences.map((s) => [`${s.schema}.${s.name}`, s]));
    const lines = [SESSION_SQL, "BEGIN;", "SET LOCAL session_replication_role = replica;"];
    lines.push(`TRUNCATE ${target.tables.map(qualified).join(", ")};`);
    for (const t of imported) {
      const h = inArchiveOrder(t, have.get(keyOf(t)));
      const src = join(x, t.file);
      // x is root's and 0700 since takeOver: nothing can be swapped in before psql reads it.
      const st = lstatSync(src);
      if (!st.isFile() || st.nlink !== 1) throw new Error(`the archive lacks the data of ${keyOf(t)}`);
      lines.push(`\\copy ${qualified(h)} (${h.columns.map(ident).join(", ")}) FROM ${literal(src)}`);
    }
    for (const sq of manifest.sequences) {
      const h = seqs.get(`${sq.schema}.${sq.name}`);
      if (!h) continue;
      const called = sq.last_value !== null;
      const v = called ? String(sq.last_value) : String(h.start_value);
      if (!BIGINT.test(v)) throw new Error(`sequence ${sq.schema}.${sq.name}: not a number`);
      lines.push(`SELECT setval(${literal(`${ident(h.schema)}.${ident(h.name)}`)}, ${v}, ${called});`);
    }
    lines.push("DO $kinboard_verify$ DECLARE n bigint; h text; BEGIN");
    for (const t of imported) {
      const h = inArchiveOrder(t, have.get(keyOf(t)));
      const sel = checksumSelect(h).replace(/^SELECT count\(\*\)::bigint AS n, (.*) AS h FROM/, "SELECT count(*)::bigint, $1 INTO n, h FROM");
      lines.push(`  ${sel};`);
      lines.push(`  IF n <> ${Number(t.rows)} OR h <> ${literal(t.checksum)} THEN RAISE EXCEPTION 'table % differs after the import: % rows, the archive says ${Number(t.rows)}', ${literal(keyOf(t))}, n; END IF;`);
    }
    // NOTIFY inside: it is delivered on commit, and psql's exit status is then the commit's.
    lines.push("END $kinboard_verify$;",
      `INSERT INTO public.instance_settings (key, value) VALUES ('import_nonce', ${literal(record.nonce)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
      "NOTIFY pgrst, 'reload schema';", "COMMIT;");
    try {
      psql(pg, `${lines.join("\n")}\n`);
    } catch (err) {
      throw new Error(`the database import failed and was rolled back, and the files and secrets were taken out again: nothing of it was kept: ${err.message}`);
    }
    undo.length = 0;
    pendingWritten = false;
    // Committed: the previous values are history now, the record is done.
    try { asOwnerOf(secretsDir, () => rmSync(join(secretsDir, PENDING), { force: true })); } catch { /* the next import removes it */ }

    const rows = imported.reduce((n, t) => n + t.rows, 0);
    log(`imported Kinboard ${manifest.kinboard.version} (${manifest.kinboard.shape ?? "?"}, PostgreSQL ${manifest.postgres}): ${imported.length} tables, ${rows} rows, every table's count and checksum verified; ${manifest.files.length} file(s); ${manifest.secrets.length} secret(s).`);
    if (env.KINBOARD_AIO === "1" && restart && existsSync("/run/service/webapp")) {
      for (const svc of ["postgrest", "webapp"]) spawnSync("s6-svc", ["-r", `/run/service/${svc}`]);
      log("PostgREST and the webapp restart with the imported keys; the app is back in a few seconds.");
    } else {
      log("Restart Kinboard now, so it runs with the imported keys (compose: `docker compose restart rest webapp`; all-in-one: restart the container).");
    }
    return manifest;
  } catch (err) {
    let undoFailed = 0;
    for (const fn of undo.reverse()) { try { fn(); } catch { undoFailed++; } }
    // The record stays while anything could not be taken out, so the next run tries again.
    if (pendingWritten && undoFailed === 0) { try { asOwnerOf(secretsDir, () => rmSync(join(secretsDir, PENDING), { force: true })); } catch { /* the next run removes it */ } }
    if (undoFailed) err = new Error(`${err?.message ?? err}\n(${undoFailed} step(s) of putting things back failed; the next \`kinboard import\` tries again)`);
    throw err;
  } finally {
    process.umask(oldUmask);
    rmSync(work, { recursive: true, force: true });
    if (cleanupX) rmSync(cleanupX, { recursive: true, force: true });
    if (stage) { try { asOwnerOf(filesDir, () => rmSync(stage, { recursive: true, force: true })); } catch { /* reported above */ } }
  }
}

/* ------------------------------------------------------------------ main */

function usage() {
  process.stderr.write(
    "usage:\n" +
    "  kinboard export [<file> | -]   write this install to an archive (- for stdout)\n" +
    "  kinboard import <file> | -     restore an archive into this fresh install\n" +
    "        --no-restart             (all-in-one) leave PostgREST and the webapp running\n" +
    "  kinboard resume                undo an import that was cut off before its commit\n" +
    "                                 (the all-in-one image runs it at every start)\n",
  );
}

function main(argv) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "export") {
      const stampNow = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const def = process.env.KINBOARD_AIO === "1" ? `/data/backups/kinboard-export-${stampNow}.tar.gz` : `kinboard-export-${stampNow}.tar.gz`;
      const out = rest[0] ?? def;
      exportArchive({ out });
      if (out !== "-") process.stdout.write(`${out}\n`);
      return 0;
    }
    if (cmd === "import") {
      const archive = rest.find((a) => !a.startsWith("--"));
      if (!archive) { usage(); return 2; }
      importArchive({ archive, restart: !rest.includes("--no-restart") });
      return 0;
    }
    if (cmd === "resume") {
      const said = resumeAtStart();
      if (said) process.stderr.write(`${TAG} ${said}\n`);
      return 0;
    }
    usage();
    return 2;
  } catch (err) {
    let msg = err?.message ?? String(err);
    if (err?.code === "ENOSPC" || /No space left on device/.test(msg)) {
      msg += "\nThe disk ran full. Nothing of this import was kept: free some space (or give it a bigger disk) and run the import again.";
    }
    process.stderr.write(`${TAG} ${msg}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
