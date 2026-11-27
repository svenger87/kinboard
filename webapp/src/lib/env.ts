import { createHmac } from "node:crypto";

/**
 * Server settings under a new name, with the old names still read (RFC-024
 * §4.6, phase 7 step 1).
 *
 * `env("KINBOARD_X", "SUPABASE_X")` is the first of those variables that is
 * set and not empty, or undefined. When the value came from an old name, it
 * says so once per process, naming both, and never the value.
 *
 * Server-only, and never inlined: the name is looked up when the function
 * runs, so Next has no `process.env.NAME` expression to replace at build time
 * with whatever the build machine had (the trap lib/db/legacy-kong.ts documents).
 * `node:crypto` keeps it out of any browser bundle; the guard spec
 * (e2e/env-helper.spec.ts) checks that no client component imports it.
 */
type EnvLike = Record<string, string | undefined>;

const present = (v: string | undefined): v is string => typeof v === "string" && v !== "";

const announced = new Set<string>();

export function env(newName: string, ...oldNames: string[]): string | undefined {
  return envFrom(process.env, newName, ...oldNames);
}

/** `env`, over a given environment (for tests and callers that pass one in). */
export function envFrom(source: EnvLike, newName: string, ...oldNames: string[]): string | undefined {
  const own = source[newName];
  if (present(own)) return own;
  for (const old of oldNames) {
    const value = source[old];
    if (!present(value)) continue;
    const note = `${old}>${newName}`;
    if (!announced.has(note)) {
      announced.add(note);
      console.info(`[env] ${newName} is not set; using ${old}, its older name. Both keep working.`);
    }
    return value;
  }
  return undefined;
}

/** For tests: forget which old names were already announced. */
export function forgetEnvNotices(): void {
  announced.clear();
}

/**
 * The service-role key's names, newest first. `SUPABASE_SERVICE_ROLE_KEY` is
 * what docker-compose.yml (the pre-1.18 file) gives the container from
 * `.env`'s `SERVICE_ROLE_KEY`, and stays read for as long as that file is in
 * use; `SERVICE_ROLE_KEY` is the `.env` name itself.
 */
export const SERVICE_ROLE_KEY_NAMES = ["KINBOARD_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"] as const;

/**
 * The service-role key minted from the JWT secret: HS256 over a fixed payload,
 * no `iat`, no `exp`, so the same secret always gives the same key. Byte for
 * byte what image/secrets-store.mjs `deriveKey("service_role", …)` makes at
 * container start (RFC-023 §4.1); e2e/env-helper.spec.ts holds the two equal.
 */
export function deriveServiceRoleKey(secret: string): string {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const input = `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64('{"role":"service_role","iss":"kinboard"}')}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

/**
 * The key server code reaches PostgREST with, bypassing row-level security.
 * In order: `KINBOARD_SERVICE_ROLE_KEY`; `SUPABASE_SERVICE_ROLE_KEY`, then
 * `SERVICE_ROLE_KEY`; otherwise derived from `JWT_SECRET` (or
 * `PGRST_JWT_SECRET`, as lib/family-jwt.ts reads it). In the container the
 * entrypoint has already settled this and set the new name; the fallbacks
 * here are for `next dev` and the test runner.
 *
 * The only place in the app that reads the key's variables. It never leaves
 * the server: /rest/v1 refuses it from outside (lib/rest-proxy.ts).
 */
export function serviceRoleKey(source: EnvLike = process.env): string {
  const named = envFrom(source, ...SERVICE_ROLE_KEY_NAMES);
  if (named) return named;
  const secret = source.JWT_SECRET || source.PGRST_JWT_SECRET;
  if (present(secret)) return deriveServiceRoleKey(secret);
  throw new Error("KINBOARD_SERVICE_ROLE_KEY is not set, and there is no JWT_SECRET to derive it from");
}
