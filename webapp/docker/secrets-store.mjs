#!/usr/bin/env node
/**
 * secrets-store.mjs: where the webapp's secrets come from (RFC-023 §4.1).
 *
 * Run by webapp-entrypoint.sh before anything else. For each secret, in order:
 *
 *   1. the environment, when the variable is set and not empty. Every
 *      existing install sets every secret there (docker-compose.yml passes
 *      them from .env), so for them nothing changes;
 *   2. otherwise the file of the same name in the secrets store,
 *      /kinboard/secrets/<name> (the `kinboard-config` volume, mounted
 *      read-only). One value per file; a trailing newline is not part of it;
 *   3. otherwise, for the anon and service-role keys only: minted from
 *      JWT_SECRET. Those two are never stored (§4.1, "Not stored").
 *
 * POSTGRES_PASSWORD and JWT_SECRET are required. Without them the server
 * cannot reach its database or sign a family token, so this refuses and names
 * the missing one, rather than starting a server that skips its migrations
 * or cannot hand a screen the token it reads its data with.
 *
 * Output: on stdout, one `export NAME='value'` line for each value that did
 * not come from the environment, for the entrypoint to eval. On stderr, one
 * line per secret saying where it came from. Values are never logged.
 *
 * A file's value is its content without a leading byte-order mark and
 * without trailing line breaks; spaces and tabs count (see fileValue).
 *
 * This module only reads. Creating the files is the init step's job (RFC-023
 * PR 2), and nothing here writes to the store.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the config volume's secrets are mounted in the webapp container. */
export const DEFAULT_SECRETS_DIR = "/kinboard/secrets";

/** The stored secrets the webapp reads: variable, file, and whether it can run without it. */
export const STORED = [
  { env: "POSTGRES_PASSWORD", file: "postgres_password", required: true },
  { env: "JWT_SECRET", file: "jwt_secret", required: true },
  { env: "CRON_SECRET", file: "cron_secret", required: false },
  { env: "PRESENCE_SENSOR_TOKEN", file: "presence_sensor_token", required: false },
  { env: "VAPID_PUBLIC_KEY", file: "vapid_public_key", required: false },
  { env: "VAPID_PRIVATE_KEY", file: "vapid_private_key", required: false },
];

/**
 * The two keys that are minted, never stored. `env` is the name the app reads
 * (lib/env.ts `serviceRoleKey`, app/layout.tsx); `older` are names read in its
 * place, in order, when it is not set. For the service-role key (RFC-024
 * §4.6): SUPABASE_SERVICE_ROLE_KEY, the name docker-compose.yml (the pre-1.18
 * file) passes, then SERVICE_ROLE_KEY, the name .env and setup.sh use. The
 * value is exported under `env` whichever name it came from, so the server
 * reads one name.
 */
export const DERIVED = [
  { env: "NEXT_PUBLIC_SUPABASE_ANON_KEY", older: ["ANON_KEY"], role: "anon" },
  { env: "KINBOARD_SERVICE_ROLE_KEY", older: ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"], role: "service_role" },
];

/** The header setup.sh's jwt_sign writes, byte for byte. */
const HEADER = '{"alg":"HS256","typ":"JWT"}';

const b64url = (s) => Buffer.from(s).toString("base64url");

/**
 * An HS256 JWT over an exact payload string: the same bytes setup.sh's
 * `jwt_sign` produces for the same payload (header, unpadded base64url,
 * HMAC-SHA256 over `header.payload`).
 */
export function signHs256(payloadJson, secret) {
  const input = `${b64url(HEADER)}.${b64url(payloadJson)}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

/**
 * The anon or service-role key for a JWT secret. A fixed payload, no `iat`
 * and no `exp`, so the same secret always gives the same key: the anon key a
 * page holds in window.__ENV survives a restart, and nothing expires on a
 * household that never re-runs anything (RFC-023 §4.1).
 */
export function deriveKey(role, secret) {
  return signHs256(JSON.stringify({ role, iss: "kinboard" }), secret);
}

const present = (v) => typeof v === "string" && v !== "";

/**
 * A file's value: its content without a leading byte-order mark (Windows
 * Notepad writes one) and without the trailing line breaks an editor adds.
 * Spaces and tabs are part of the value, wherever they are: the database's
 * own POSTGRES_PASSWORD_FILE keeps them too, and a password the two read
 * differently would lock the webapp out of its database.
 */
export function fileValue(content) {
  return content.replace(/^\uFEFF/, "").replace(/[\r\n]+$/, "");
}

/** Reads a file, or returns null when it is not there. Any other failure is thrown. */
function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return null;
    throw err;
  }
}

/**
 * Decide every secret. Pure apart from `read` (path -> content or null).
 *
 * Returns `values` (every secret that has one), `exports` (those that did not
 * come from the environment), `log` (one line per secret) and `errors`
 * (non-empty means: refuse to start).
 */
export function resolveSecrets(env, { dir = DEFAULT_SECRETS_DIR, read = readIfPresent } = {}) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {Record<string, string>} */
  const exports = {};
  /** @type {string[]} */
  const log = [];
  /** @type {string[]} */
  const errors = [];

  for (const { env: name, file, required } of STORED) {
    if (present(env[name])) {
      values[name] = env[name];
      log.push(`${name}: from the environment`);
      continue;
    }
    const path = join(dir, file);
    let content;
    try {
      content = read(path);
    } catch (err) {
      errors.push(`${name}: cannot read ${path} (${err?.code ?? err?.message ?? err})`);
      continue;
    }
    const value = content === null ? "" : fileValue(content);
    if (present(value)) {
      values[name] = exports[name] = value;
      log.push(`${name}: from ${path}`);
    } else if (required) {
      errors.push(
        `${name} is not set. Set it in the environment (webapp/docker/.env) or put it in ${path}.`,
      );
    } else {
      log.push(`${name}: not set`);
    }
  }

  for (const { env: name, older, role } of DERIVED) {
    const alias = older.find((n) => present(env[n]));
    if (present(env[name])) {
      values[name] = env[name];
      log.push(`${name}: from the environment`);
    } else if (alias) {
      values[name] = exports[name] = env[alias];
      log.push(`${name}: from ${alias} in the environment`);
    } else if (present(values.JWT_SECRET)) {
      values[name] = exports[name] = deriveKey(role, values.JWT_SECRET);
      log.push(`${name}: derived from JWT_SECRET`);
    }
    // No JWT_SECRET: already an error above, and nothing to derive from.
  }

  return { values, exports, log, errors };
}

/** A value as one single-quoted shell word: safe to eval whatever it holds. */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * `secrets-store.mjs --get NAME`: print one secret's value, by the same rules,
 * for the scripts `docker exec` runs (the cron jobs). Those see the
 * container's configured environment, not the entrypoint's exports, so a
 * secret that exists only in the store would otherwise be empty there.
 */
function get(name) {
  const dir = process.env.KINBOARD_SECRETS_DIR || DEFAULT_SECRETS_DIR;
  const { values } = resolveSecrets(process.env, { dir });
  if (!present(values[name])) {
    process.stderr.write(`${name} is not set, in the environment or in ${dir}\n`);
    process.exit(1);
  }
  process.stdout.write(values[name]);
}

function main() {
  if (process.argv[2] === "--get") return get(process.argv[3] ?? "");
  const dir = process.env.KINBOARD_SECRETS_DIR || DEFAULT_SECRETS_DIR;
  const { exports, log, errors } = resolveSecrets(process.env, { dir });
  for (const line of log) process.stderr.write(`[entrypoint] secret ${line}\n`);
  if (errors.length > 0) {
    for (const line of errors) process.stderr.write(`[entrypoint] ${line}\n`);
    process.stderr.write(`[entrypoint] refusing to start without ${errors.length > 1 ? "them" : "it"}; nothing else has run.\n`);
    process.exit(1);
  }
  for (const [name, value] of Object.entries(exports)) {
    process.stdout.write(`export ${name}=${shellQuote(value)}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
