import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";
import { serverAnonKey } from "../src/lib/supabase/api-base";

/**
 * RFC-023 §4.1: the webapp's entrypoint reads the secrets store.
 *
 * Per secret, the environment wins; otherwise /kinboard/secrets/<name> from
 * the config volume; otherwise (anon and service-role keys only) a key minted
 * from JWT_SECRET, never stored. POSTGRES_PASSWORD and JWT_SECRET are
 * required: missing everywhere, the container stops and names them.
 *
 * Every existing install sets every secret in its environment
 * (docker-compose.yml passes them from .env), so the case that matters most is
 * "full environment, no file": the store must not even be looked at.
 *
 * Imported dynamically: Playwright's require hook mangles a statically
 * imported .mjs (see holiday-data.spec.ts).
 */
interface Resolved {
  values: Record<string, string>;
  exports: Record<string, string>;
  log: string[];
  errors: string[];
}
interface StoreModule {
  STORED: { env: string; file: string; required: boolean }[];
  resolveSecrets(env: Record<string, string>, opts?: { dir?: string; read?: (path: string) => string | null }): Resolved;
  deriveKey(role: string, secret: string): string;
  signHs256(payloadJson: string, secret: string): string;
}
const store: Promise<StoreModule> = import("../docker/secrets-store.mjs");

const DOCKER = join(__dirname, "..", "docker");
const SCRIPT = join(DOCKER, "secrets-store.mjs");
const DIR = "/kinboard/secrets";

type Read = (path: string) => string | null;

/** A store backed by a map of file name -> content; records what was read. */
function fakeStore(files: Record<string, string>) {
  const reads: string[] = [];
  const read: Read = (path) => {
    reads.push(path);
    const name = path.slice(DIR.length + 1);
    return name in files ? files[name] : null;
  };
  return { read, reads };
}

const STORED: [string, string, boolean][] = [
  ["POSTGRES_PASSWORD", "postgres_password", true],
  ["JWT_SECRET", "jwt_secret", true],
  ["CRON_SECRET", "cron_secret", false],
  ["PRESENCE_SENSOR_TOKEN", "presence_sensor_token", false],
  ["VAPID_PUBLIC_KEY", "vapid_public_key", false],
  ["VAPID_PRIVATE_KEY", "vapid_private_key", false],
];

/** Enough for the required secrets, so a test can look at one other secret alone. */
const BASE_ENV = { POSTGRES_PASSWORD: "pg-env", JWT_SECRET: "jwt-env" };

test.describe("precedence, per stored secret", () => {
  test("the module lists exactly the RFC's files", async () => {
    const { STORED: list } = await store;
    expect(list.map((s) => [s.env, s.file, s.required])).toEqual(STORED);
  });

  for (const [name, file, required] of STORED) {
    test(`${name}: environment only -> the environment, nothing exported`, async () => {
      const { resolveSecrets } = await store;
      const { read } = fakeStore({});
      const r = resolveSecrets({ ...BASE_ENV, [name]: "from-env" }, { read });
      expect(r.values[name]).toBe("from-env");
      expect(r.exports[name]).toBeUndefined();
      expect(r.log).toContain(`${name}: from the environment`);
      expect(r.errors).toEqual([]);
    });

    test(`${name}: file only -> the file, exported`, async () => {
      const { resolveSecrets } = await store;
      const env: Record<string, string> = { ...BASE_ENV };
      delete env[name];
      const { read } = fakeStore({ [file]: "from-file\n" });
      const r = resolveSecrets(env, { read });
      expect(r.values[name]).toBe("from-file");
      expect(r.exports[name]).toBe("from-file");
      expect(r.log).toContain(`${name}: from ${DIR}/${file}`);
      expect(r.errors).toEqual([]);
    });

    test(`${name}: both -> the environment wins, and the file is not even read`, async () => {
      const { resolveSecrets } = await store;
      const { read, reads } = fakeStore({ [file]: "from-file" });
      const r = resolveSecrets({ ...BASE_ENV, [name]: "from-env" }, { read });
      expect(r.values[name]).toBe("from-env");
      expect(r.exports[name]).toBeUndefined();
      expect(reads).not.toContain(`${DIR}/${file}`);
    });

    test(`${name}: an empty environment value counts as unset (compose's \${X} with X unset)`, async () => {
      const { resolveSecrets } = await store;
      const { read } = fakeStore({ [file]: "from-file" });
      const r = resolveSecrets({ ...BASE_ENV, [name]: "" }, { read });
      expect(r.values[name]).toBe("from-file");
    });

    test(`${name}: neither -> ${required ? "refused, naming it and the file" : "left unset, no error"}`, async () => {
      const { resolveSecrets } = await store;
      const env: Record<string, string> = { ...BASE_ENV };
      delete env[name];
      const { read } = fakeStore({ [file]: "\n" }); // an empty file is no value
      const r = resolveSecrets(env, { read });
      expect(r.values[name]).toBeUndefined();
      expect(r.exports[name]).toBeUndefined();
      if (required) {
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]).toContain(`${name} is not set`);
        expect(r.errors[0]).toContain(`${DIR}/${file}`);
      } else {
        expect(r.errors).toEqual([]);
        expect(r.log).toContain(`${name}: not set`);
      }
    });
  }

  test("a file's trailing line breaks are not part of the value; anything else is", async () => {
    const { resolveSecrets } = await store;
    const { read } = fakeStore({ postgres_password: "  p'a$s`w\"d  \r\n\n", jwt_secret: "abc" });
    const r = resolveSecrets({}, { read });
    expect(r.values.POSTGRES_PASSWORD).toBe("  p'a$s`w\"d  ");
    expect(r.values.JWT_SECRET).toBe("abc");
  });

  test("a file that exists but cannot be read is an error naming it, never a silent skip", async () => {
    const { resolveSecrets } = await store;
    const read: Read = (path) => {
      if (path.endsWith("/jwt_secret")) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return "pg";
    };
    const r = resolveSecrets({}, { read });
    expect(r.errors).toEqual([`JWT_SECRET: cannot read ${DIR}/jwt_secret (EACCES)`]);
  });

  test("the store's directory can be moved (KINBOARD_SECRETS_DIR, for tests)", async () => {
    const { resolveSecrets } = await store;
    const reads: string[] = [];
    resolveSecrets({}, { dir: "/elsewhere", read: (p: string) => (reads.push(p), null) });
    expect(reads).toContain("/elsewhere/postgres_password");
  });
});

test.describe("an existing install: every secret in the environment, no file", () => {
  const FULL = {
    POSTGRES_PASSWORD: "pg",
    JWT_SECRET: "jwt",
    CRON_SECRET: "cron",
    PRESENCE_SENSOR_TOKEN: "presence",
    VAPID_PUBLIC_KEY: "vpub",
    VAPID_PRIVATE_KEY: "vpriv",
    // what docker-compose.yml maps ANON_KEY / SERVICE_ROLE_KEY onto
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-from-env",
    SUPABASE_SERVICE_ROLE_KEY: "service-from-env",
  };

  test("nothing is read, nothing is exported, nothing is derived", async () => {
    const { resolveSecrets } = await store;
    const reads: string[] = [];
    const r = resolveSecrets(FULL, { read: (p: string) => (reads.push(p), null) });
    expect(reads).toEqual([]);
    expect(r.exports).toEqual({});
    expect(r.errors).toEqual([]);
    expect(r.values).toEqual(FULL);
  });

  test("an install without push keys or a presence token still starts, as today", async () => {
    // setup.sh skips VAPID without Node on the host; PRESENCE_SENSOR_TOKEN is `:-` in compose.
    const { resolveSecrets } = await store;
    const r = resolveSecrets(
      { ...FULL, VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", PRESENCE_SENSOR_TOKEN: "", CRON_SECRET: "" },
      { read: () => null },
    );
    expect(r.errors).toEqual([]);
    expect(r.exports).toEqual({});
  });
});

test.describe("the anon and service-role keys", () => {
  const cases: [string, string, string][] = [
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "ANON_KEY", "anon"],
    ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "service_role"],
  ];
  for (const [name, alias, role] of cases) {
    test(`${name}: the app's own name wins over ${alias}, which wins over deriving`, async () => {
      const { resolveSecrets, deriveKey } = await store;
      const read = () => null;
      const own = resolveSecrets({ ...BASE_ENV, [name]: "own", [alias]: "alias" }, { read });
      expect(own.values[name]).toBe("own");
      expect(own.exports[name]).toBeUndefined();

      const viaAlias = resolveSecrets({ ...BASE_ENV, [name]: "", [alias]: "alias" }, { read });
      expect(viaAlias.values[name]).toBe("alias");
      expect(viaAlias.exports[name]).toBe("alias");

      const derived = resolveSecrets({ ...BASE_ENV, [name]: "", [alias]: "" }, { read });
      expect(derived.exports[name]).toBe(deriveKey(role, "jwt-env"));
      expect(derived.log).toContain(`${name}: derived from JWT_SECRET`);
    });

    test(`${name}: derived from the file's jwt_secret when that is where JWT_SECRET came from`, async () => {
      const { resolveSecrets, deriveKey } = await store;
      const { read } = fakeStore({ jwt_secret: "jwt-file\n" });
      const r = resolveSecrets({ POSTGRES_PASSWORD: "pg" }, { read });
      expect(r.exports[name]).toBe(deriveKey(role, "jwt-file"));
    });

    test(`${name}: never read from the store`, async () => {
      const { resolveSecrets } = await store;
      const reads: string[] = [];
      resolveSecrets({ ...BASE_ENV }, { read: (p: string) => (reads.push(p), null) });
      expect(reads.some((p) => /anon|service/i.test(p))).toBe(false);
    });
  }

  test("no JWT_SECRET anywhere: one error, and no key minted from nothing", async () => {
    const { resolveSecrets } = await store;
    const r = resolveSecrets({ POSTGRES_PASSWORD: "pg" }, { read: () => null });
    expect(r.errors).toEqual([`JWT_SECRET is not set. Set it in the environment (webapp/docker/.env) or put it in ${DIR}/jwt_secret.`]);
    expect(r.exports.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeUndefined();
    expect(r.exports.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  test("a derived key: HS256 over the RFC's fixed payload, no iat, no exp, the same on every start", async () => {
    const { deriveKey } = await store;
    const secret = "0123456789abcdef0123456789abcdef";
    for (const role of ["anon", "service_role"]) {
      const token = deriveKey(role, secret);
      const [h, p, s] = token.split(".");
      expect(Buffer.from(h, "base64url").toString()).toBe('{"alg":"HS256","typ":"JWT"}');
      expect(Buffer.from(p, "base64url").toString()).toBe(`{"role":"${role}","iss":"kinboard"}`);
      expect(s).toBe(createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url"));
      expect(token).not.toContain("=");
      expect(deriveKey(role, secret)).toBe(token);
      expect(deriveKey(role, secret + "x")).not.toBe(token);
    }
  });

  test("the signer is byte-identical to setup.sh's jwt_sign for the same secret, payload and iat", async () => {
    // setup.sh's own functions, run in bash with its clock pinned. The payload
    // shape is setup.sh's ({"role","iss":"supabase","iat","exp"}); the derived
    // keys use the RFC's fixed one, so a household's page key does not change
    // on every restart. PostgREST checks the signature, role and exp (when
    // present), not iss or iat: both shapes are accepted (verified on a stack).
    const { signHs256 } = await store;
    const setup = readFileSync(join(__dirname, "..", "..", "setup.sh"), "utf8");
    const fn = (name: string) => {
      const m = new RegExp(`\\n  ${name}\\(\\) \\{\\n[\\s\\S]*?\\n  \\}\\n`).exec(setup);
      expect(m, `setup.sh no longer defines ${name}()`).not.toBeNull();
      return m![0];
    };
    const secret = "f00dfeed".repeat(8);
    const iat = 1764115200;
    const exp = iat + 10 * 365 * 24 * 3600;
    for (const role of ["anon", "service_role"]) {
      const bash = `date() { echo ${iat}; }\nJWT_SECRET_NOW='${secret}'\n${fn("b64url")}${fn("jwt_sign")}jwt_sign ${role}`;
      const fromSetup = execFileSync("bash", ["-c", bash], { encoding: "utf8" });
      const ours = signHs256(`{"role":"${role}","iss":"supabase","iat":${iat},"exp":${exp}}`, secret);
      expect(fromSetup).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(ours).toBe(fromSetup);
    }
  });
});

test.describe("as the entrypoint runs it", () => {
  let dir: string;
  test.beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-secrets-"));
    mkdirSync(join(dir, "secrets"));
  });
  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** The entrypoint's own lines: run the reader, stop on failure, eval its output. */
  const ENTRY = `if ! secrets_env="$(node "$SCRIPT")"; then exit 1; fi\neval "$secrets_env"\n`;

  function run(env: Record<string, string>, after: string) {
    const clean: Record<string, string> = { PATH: process.env.PATH ?? "", SCRIPT, KINBOARD_SECRETS_DIR: join(dir, "secrets"), ...env };
    return spawnSync("sh", ["-c", ENTRY + after], { env: clean as NodeJS.ProcessEnv, encoding: "utf8" });
  }

  test("values from files survive the shell untouched, whatever they hold", () => {
    const awkward = `it's $HOME \`id\` "q" \\ ; done`;
    writeFileSync(join(dir, "secrets", "postgres_password"), awkward + "\n");
    writeFileSync(join(dir, "secrets", "jwt_secret"), "jwt-from-file");
    const r = run({}, 'printf "%s|%s|%s" "$POSTGRES_PASSWORD" "$JWT_SECRET" "$NEXT_PUBLIC_SUPABASE_ANON_KEY"');
    expect(r.status, r.stderr).toBe(0);
    const [pg, jwt, anon] = r.stdout.split("|");
    expect(pg).toBe(awkward);
    expect(jwt).toBe("jwt-from-file");
    expect(anon.split(".")).toHaveLength(3);
    // One line per secret, and never a value.
    expect(r.stderr).toContain("[entrypoint] secret POSTGRES_PASSWORD: from ");
    expect(r.stderr).toContain("[entrypoint] secret NEXT_PUBLIC_SUPABASE_ANON_KEY: derived from JWT_SECRET");
    expect(r.stderr).not.toContain("jwt-from-file");
    expect(r.stderr).not.toContain(anon);
  });

  test("the environment wins over a file in the same run", () => {
    writeFileSync(join(dir, "secrets", "jwt_secret"), "jwt-from-file");
    const r = run({ POSTGRES_PASSWORD: "pg", JWT_SECRET: "jwt-from-env" }, 'printf %s "$JWT_SECRET"');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("jwt-from-env");
  });

  test("a missing required secret stops the shell before the next line, naming it", () => {
    writeFileSync(join(dir, "secrets", "jwt_secret"), "jwt-from-file");
    const r = run({}, "echo STARTED");
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("STARTED");
    expect(r.stderr).toContain("POSTGRES_PASSWORD is not set");
    expect(r.stderr).toContain(join(dir, "secrets", "postgres_password"));
    expect(r.stderr).not.toContain("jwt-from-file");
  });

  test("no store directory at all and a full environment: exports nothing", () => {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "", KINBOARD_SECRETS_DIR: join(dir, "absent"), POSTGRES_PASSWORD: "pg", JWT_SECRET: "j",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s",
    };
    const r = spawnSync("node", [SCRIPT], { env: env as NodeJS.ProcessEnv, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("");
  });
});

test.describe("wiring", () => {
  const entry = readFileSync(join(DOCKER, "webapp-entrypoint.sh"), "utf8");

  test("the entrypoint reads the store first, and stops when it refuses", () => {
    const call = entry.indexOf('secrets_env="$(node /app/secrets-store.mjs)"');
    expect(call, "the entrypoint does not run the secrets-store reader").toBeGreaterThan(0);
    expect(entry).toMatch(/if ! secrets_env="\$\(node \/app\/secrets-store\.mjs\)"; then\n\s+exit 1\nfi\neval "\$secrets_env"/);
    for (const later of ["pg_isready", "/app/migrate.sh", "start_server\n"]) {
      const at = entry.indexOf(later, entry.indexOf("set -e"));
      expect(at, `${later} runs before the secrets are read`).toBeGreaterThan(call);
    }
    // The old way round: start without migrations when the password is missing.
    expect(entry).not.toContain("POSTGRES_PASSWORD not set; skipping migrations");
  });

  test("the image carries the reader where the entrypoint looks for it", () => {
    const dockerfile = readFileSync(join(DOCKER, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/COPY [^\n]*docker\/secrets-store\.mjs [^\n]*\.\/\n/);
    expect(dockerfile).toMatch(/WORKDIR \/app/);
  });

  test("the page's anon key goes through serverAnonKey", () => {
    const layout = readFileSync(join(__dirname, "..", "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("publicApiEnv(serverAnonKey())");
  });

  test("serverAnonKey reads what the container was given", () => {
    expect(serverAnonKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "runtime" })).toBe("runtime");
    expect(serverAnonKey({})).toBe("");
  });
});

/** Every .ts/.tsx file under a directory. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Lines of webapp/src that read a NEXT_PUBLIC_ value in a form Next replaces at build time. */
function inlinableReads(root: string): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(root)) {
    const code = codeOnly(readFileSync(file, "utf8"));
    code.split("\n").forEach((line, i) => {
      // process.env.NEXT_PUBLIC_X and process.env["NEXT_PUBLIC_X"]. The app's
      // version is the one value that is meant to be fixed by the build
      // (next.config.mjs `env`).
      if (/process\.env(\.|\[\s*["'`])NEXT_PUBLIC_(?!APP_VERSION\b)\w+/.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      // A secret under a NEXT_PUBLIC_ name is shipped to every browser.
      if (/NEXT_PUBLIC_(POSTGRES_PASSWORD|JWT_SECRET|CRON_SECRET|PRESENCE_SENSOR_TOKEN|VAPID_PRIVATE_KEY|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)\b/.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

test.describe("nothing a build could bake in", () => {
  const SRC = join(__dirname, "..", "src");

  test("no file in webapp/src reads a NEXT_PUBLIC_ value as process.env.NEXT_PUBLIC_*, nor names a secret NEXT_PUBLIC_", () => {
    // Next replaces `process.env.NEXT_PUBLIC_X` at build time, server code
    // included (main built with a fake anon key served it over the runtime
    // one, PR #546). Read such values through a parameter, as serverAnonKey
    // and push-sender's getVapidConfig do.
    expect(inlinableReads(SRC)).toEqual([]);
  });

  test("the guard sees each form it forbids", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-inline-"));
    try {
      writeFileSync(join(dir, "a.ts"), "const k = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;\n");
      writeFileSync(join(dir, "b.tsx"), "const v = process.env['NEXT_PUBLIC_VAPID_PUBLIC_KEY'];\n");
      writeFileSync(join(dir, "c.ts"), "const s = env.NEXT_PUBLIC_JWT_SECRET;\n");
      writeFileSync(join(dir, "ok.ts"), "// process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY in a comment\nconst v = process.env.NEXT_PUBLIC_APP_VERSION;\nconst a = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;\n");
      expect(inlinableReads(dir).map((h) => h.slice(dir.length + 1, dir.length + 6))).toEqual(["a.ts:", "b.tsx", "c.ts:"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe("a secret file's exact value", () => {
  test("a leading byte-order mark is dropped; spaces and tabs are kept", async () => {
    const { fileValue } = (await store) as unknown as { fileValue(s: string): string };
    expect(fileValue("﻿abc\r\n")).toBe("abc");
    expect(fileValue("a﻿b")).toBe("a﻿b"); // only a leading one
    expect(fileValue(" a\tb \t\n\n")).toBe(" a\tb \t");
    expect(fileValue("\t lead")).toBe("\t lead");
  });

  test("through the store: a Notepad-saved file reads as its value", async () => {
    const { resolveSecrets } = await store;
    const { read } = fakeStore({ postgres_password: "﻿pw\r\n", jwt_secret: "jwt " });
    const r = resolveSecrets({}, { read });
    expect(r.values.POSTGRES_PASSWORD).toBe("pw");
    expect(r.values.JWT_SECRET).toBe("jwt ");
  });
});

/**
 * A child process's whole environment, nothing inherited but PATH. Typed via a
 * plain record: this project's ProcessEnv requires NODE_ENV, so an object
 * literal cast straight to it does not compile (the #544/#545 CI failure).
 */
function envOf(vars: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", ...vars };
  return env as NodeJS.ProcessEnv;
}

test.describe("the cron jobs, which docker exec runs outside the entrypoint", () => {
  let dir: string;
  let bin: string;
  test.beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-cron-"));
    mkdirSync(join(dir, "secrets"));
    bin = join(dir, "bin");
    mkdirSync(bin);
    // A curl that records what it was asked, instead of calling anything.
    writeFileSync(join(bin, "curl"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(dir, "curl-args")}"\n`);
    chmodSync(join(bin, "curl"), 0o755);
  });
  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const CALL = join(DOCKER, "cron-call.sh");
  function call(vars: Record<string, string>) {
    return spawnSync("sh", [CALL, "purge-domain-events"], {
      env: envOf({ PATH: `${bin}:${process.env.PATH ?? ""}`, KINBOARD_SECRETS_READER: SCRIPT, KINBOARD_SECRETS_DIR: join(dir, "secrets"), ...vars }),
      encoding: "utf8",
    });
  }
  const curlArgs = () => readFileSync(join(dir, "curl-args"), "utf8").split("\n");

  test("the environment's CRON_SECRET, as on every install today", () => {
    writeFileSync(join(dir, "secrets", "cron_secret"), "from-file");
    const r = call({ CRON_SECRET: "from-env" });
    expect(r.status, r.stderr).toBe(0);
    expect(curlArgs()).toContain("Authorization: Bearer from-env");
    expect(curlArgs()).toContain("http://localhost:3000/api/cron/purge-domain-events");
  });

  test("an empty environment value: the store's cron_secret, read as the entrypoint reads it", () => {
    writeFileSync(join(dir, "secrets", "cron_secret"), "﻿from-file\r\n");
    const r = call({ CRON_SECRET: "" });
    expect(r.status, r.stderr).toBe(0);
    expect(curlArgs()).toContain("Authorization: Bearer from-file");
  });

  test("neither: no call with an empty token; the job fails and says why", () => {
    const r = call({});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no CRON_SECRET");
    expect(() => readFileSync(join(dir, "curl-args"))).toThrow();
  });

  test("every job script in the image goes through cron-call.sh", () => {
    const dockerfile = readFileSync(join(DOCKER, "Dockerfile"), "utf8");
    expect(dockerfile).not.toContain("$CRON_SECRET");
    const scripts = [...dockerfile.matchAll(/echo '#!\/bin\/sh' > \/usr\/local\/bin\/([a-z-]+)/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThanOrEqual(18);
    for (const name of scripts) {
      expect(dockerfile, name).toMatch(new RegExp(`echo 'exec /app/cron-call\\.sh [a-z-]+' >> /usr/local/bin/${name}\\b`));
    }
    expect(dockerfile).toMatch(/COPY [^\n]*docker\/cron-call\.sh \.\/\n/);
    // Every job ofelia runs is one of those scripts.
    const compose = readFileSync(join(DOCKER, "docker-compose.yml"), "utf8");
    const jobs = [...compose.matchAll(/\.command: "\/usr\/local\/bin\/([a-z-]+)"/g)].map((m) => m[1]);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) expect(scripts, job).toContain(job);
  });
});

test.describe("start.sh, watching the webapp come up", () => {
  /** wait_for_migrations from start.sh, run in bash against a docker that answers with `logs`. */
  function waitFor(logs: string) {
    const startSh = readFileSync(join(DOCKER, "start.sh"), "utf8");
    const fn = /\nwait_for_migrations\(\) \{\n[\s\S]*?\n\}\n/.exec(startSh);
    expect(fn, "start.sh no longer defines wait_for_migrations").not.toBeNull();
    const dir = mkdtempSync(join(tmpdir(), "kb-wait-"));
    try {
      writeFileSync(join(dir, "logs"), logs);
      const script =
        `docker() { case "$1" in inspect) echo 2026-11-26T00:00:00Z ;; logs) cat "${join(dir, "logs")}" ;; esac; }\n` +
        `sleep() { echo slept >> "${join(dir, "slept")}"; }\n` +
        fn![0] + "wait_for_migrations\n";
      const r = spawnSync("bash", ["-c", script], { env: envOf({}), encoding: "utf8" });
      let sleeps = 0;
      try { sleeps = readFileSync(join(dir, "slept"), "utf8").split("\n").filter(Boolean).length; } catch { /* none */ }
      return { status: r.status, out: r.stdout, err: r.stderr, sleeps };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("a refused start is reported at once, with the entrypoint's own lines, and fails", () => {
    const refusal = [
      "[entrypoint] secret POSTGRES_PASSWORD: from the environment",
      "[entrypoint] JWT_SECRET is not set. Set it in the environment (webapp/docker/.env) or put it in /kinboard/secrets/jwt_secret.",
      "[entrypoint] refusing to start without it; nothing else has run.",
    ].join("\n");
    // Restarted by docker: the same lines twice.
    const r = waitFor(`${refusal}\n${refusal}\n`);
    expect(r.status).toBe(1);
    expect(r.sleeps, "it waited instead of reporting").toBe(0);
    expect(r.err).toContain("JWT_SECRET is not set");
    expect(r.err.match(/JWT_SECRET is not set/g)).toHaveLength(1);
    expect(r.err).toContain("missing a secret it cannot start without");
    expect(r.err).not.toContain("after 6 minutes");
    expect(r.err).not.toContain("secret POSTGRES_PASSWORD: from"); // the per-secret lines stay in the log
  });

  test("a normal start still reads as one", () => {
    const r = waitFor("[entrypoint] secret JWT_SECRET: from the environment\n[entrypoint] starting Next.js server\n");
    expect(r.status).toBe(0);
    expect(r.out).toContain("migrations applied");
  });

  test("nothing greps for the line the entrypoint no longer prints", () => {
    const startSh = codeOnly(readFileSync(join(DOCKER, "start.sh"), "utf8").replace(/^\s*#.*$/gm, ""));
    expect(startSh).not.toContain("POSTGRES_PASSWORD not set");
  });
});

test.describe("the real webapp-entrypoint.sh", () => {
  test("the store's values reach the process it execs", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-entry-"));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      mkdirSync(join(dir, "secrets"));
      writeFileSync(join(dir, "secrets", "postgres_password"), "pw-from-file\n");
      writeFileSync(join(dir, "secrets", "jwt_secret"), "jwt-from-file\n");
      const stub = (name: string, body: string) => {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
      };
      // node: the entrypoint's reader is run for real (from the repo, not /app);
      // `node server.js` writes its environment down instead of serving.
      stub("node", [
        `if [ "$1" = /app/secrets-store.mjs ]; then shift; exec "${process.execPath}" "${SCRIPT}" "$@"; fi`,
        `env > "${join(dir, "server-env")}"`,
        `echo "$@" > "${join(dir, "server-args")}"`,
      ].join("\n"));
      stub("su-exec", 'shift; exec "$@"');
      stub("pg_isready", "exit 0");
      stub("psql", "exit 0");
      stub("id", 'echo 1000');
      const r = spawnSync("sh", [join(DOCKER, "webapp-entrypoint.sh")], {
        env: envOf({ PATH: `${bin}:${process.env.PATH ?? ""}`, KINBOARD_SECRETS_DIR: join(dir, "secrets"), JWT_SECRET: "" }),
        encoding: "utf8",
      });
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(join(dir, "server-args"), "utf8").trim()).toBe("server.js");
      const env = Object.fromEntries(
        readFileSync(join(dir, "server-env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      );
      expect(env.POSTGRES_PASSWORD).toBe("pw-from-file");
      expect(env.JWT_SECRET).toBe("jwt-from-file");
      expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.split(".")).toHaveLength(3);
      expect(env.SUPABASE_SERVICE_ROLE_KEY?.split(".")).toHaveLength(3);
      expect(env.secrets_env, "the reader's raw output leaks into the server's environment").toBeUndefined();
      expect(env.PGPASSWORD, "the migration password outlives the migrations").toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
