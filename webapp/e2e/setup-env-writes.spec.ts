import { test, expect } from "@playwright/test";
import { execFileSync, spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * How setup.sh writes .env (and diun.yml), after #539's vanishing .env.
 *
 * It used to write every change as `awk … > "$file.tmp" && mv "$file.tmp" "$file"`:
 *
 *   - The self-update runs `setup.sh --non-interactive` as root inside the
 *     webhook container, so the renamed copy was a new file owned by root,
 *     mode 0644: a household's `dev 664` .env became `root 644` after every
 *     update, and the household could no longer edit its own settings.
 *   - The temp name was shared, so two runs at once (the self-update and one
 *     started by hand) wrote into the same file, and one renamed the other's
 *     half-written copy over .env.
 *   - Nothing checked the result: an empty copy replaced .env like a good one.
 *
 * These run the real script on a copy of the tracked files, with a .env that
 * already has every secret, so a correct run changes no byte of it.
 *
 * And start.sh: its #545 guard tells people how to put .env back; start.sh
 * itself must never write the file. Checked from the source and by running it.
 */

const REPO = resolve(__dirname, "../..");
const REAL_AWK = execFileSync("bash", ["-c", "command -v awk"], { encoding: "utf8" }).trim();
const ME = { uid: process.getuid?.() ?? -1, gid: process.getgid?.() ?? -1 };
const SUDO = ME.uid !== 0 && spawnSync("sudo", ["-n", "true"]).status === 0;
const IS_ROOT = ME.uid === 0;

/** Every key setup.sh would otherwise fill, already set: a correct re-run changes nothing. */
const SECRETS: Record<string, string> = {
  POSTGRES_PASSWORD: "a".repeat(64),
  JWT_SECRET: "b".repeat(64),
  CRON_SECRET: "c".repeat(64),
  PRESENCE_SENSOR_TOKEN: "d".repeat(64),
  DIUN_WEBHOOK_SECRET: "e".repeat(64),
  ANON_KEY: "eyJhbGciOiJIUzI1NiJ9.anon.sig",
  SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9.service.sig",
  VAPID_PUBLIC_KEY: "BPublicKeyForTheTest",
  VAPID_PRIVATE_KEY: "privateKeyForTheTest",
  SITE_URL: "http://192.0.2.10:3001",
};

/** A copy of the tracked files as they are in the working tree, with a complete .env. */
function install(): { dir: string; env: string; diun: string; kong: string } {
  const dir = mkdtempSync(join(tmpdir(), "setup-writes-"));
  execFileSync("bash", ["-c", `cd "$1" && git ls-files -z | tar --null -T - -c | tar -x -C "$2"`, "_", REPO, dir]);
  const env = join(dir, "webapp/docker/.env");
  const values: Record<string, string> = { ...SECRETS, KINBOARD_PROJECT_DIR: dir };
  const lines = readFileSync(join(dir, "webapp/docker/.env.example"), "utf8")
    .split("\n")
    .map((l) => {
      const k = l.match(/^([A-Z_][A-Z0-9_]*)=/)?.[1];
      return k && k in values ? `${k}=${values[k]}` : l;
    });
  // A key a household added itself, which no example has.
  writeFileSync(env, `${lines.join("\n").trimEnd()}\nMY_OWN_SETTING=keep me\n`);
  // setup.sh would create it; present, so the run leaves nothing new behind.
  writeFileSync(join(dir, "webapp/.env.local"), "");
  return { dir, env, diun: join(dir, "webapp/docker/diun/diun.yml"), kong: join(dir, "webapp/docker/kong.yml") };
}

/** A folder on PATH ahead of the system's, holding an `awk` stand-in. */
function awkStub(dir: string, body: string): string {
  const bin = join(dir, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "awk"), `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(join(bin, "awk"), 0o755);
  return bin;
}

function childEnv(extraPath?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${extraPath ? `${extraPath}:` : ""}${process.env.PATH}` };
  delete env.KINBOARD_URL;
  return env;
}

function setup(dir: string, opts: { root?: boolean; path?: string } = {}): SpawnSyncReturns<string> {
  if (opts.root && !IS_ROOT) {
    // sudo resets PATH (secure_path); hand the stub folder over explicitly.
    return spawnSync("sudo", ["-n", "env", `PATH=${opts.path ? `${opts.path}:` : ""}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`, "./setup.sh", "--non-interactive"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 120_000,
    });
  }
  return spawnSync("./setup.sh", ["--non-interactive"], { cwd: dir, encoding: "utf8", timeout: 120_000, env: childEnv(opts.path) });
}

function meta(file: string) {
  const s = statSync(file);
  return { uid: s.uid, gid: s.gid, mode: (s.mode & 0o7777).toString(8) };
}

function cleanUp(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

/** Files setup.sh left next to .env or diun.yml: temp copies, the lock aside. */
function leftovers(dir: string): string[] {
  const docker = join(dir, "webapp/docker");
  return [
    ...readdirSync(docker).filter((f) => f.startsWith(".env.") && ![".env.example", ".env.lock"].includes(f)),
    ...readdirSync(join(docker, "diun")).filter((f) => f.startsWith("diun.yml.")),
  ];
}

test.describe("setup.sh run as root (the self-update in the webhook container)", () => {
  test.skip(!SUDO && !IS_ROOT, "needs root: passwordless sudo, as on the CI runner");

  test("keeps .env's owner and mode, and every byte of it", () => {
    const i = install();
    try {
      chmodSync(i.env, 0o640);
      const before = { meta: meta(i.env), text: readFileSync(i.env, "utf8") };
      expect(before.meta.uid).not.toBe(0);

      const r = setup(i.dir, { root: true });
      expect(r.status, r.stdout + r.stderr).toBe(0);

      expect(meta(i.env)).toEqual(before.meta);
      expect(readFileSync(i.env, "utf8")).toBe(before.text);
      expect(leftovers(i.dir)).toEqual([]);
    } finally {
      cleanUp(i.dir);
    }
  });

  test("a .env that does not exist yet belongs to the checkout's owner, mode 0600", () => {
    const i = install();
    try {
      rmSync(i.env);
      const r = setup(i.dir, { root: true });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const folder = statSync(join(i.dir, "webapp/docker"));
      expect(meta(i.env)).toEqual({ uid: folder.uid, gid: folder.gid, mode: "600" });
      // The lock file it made is not root's either, so the next run as the
      // household's user can take it.
      const lock = statSync(join(i.dir, "webapp/docker/.env.lock"));
      expect([lock.uid, lock.gid]).toEqual([folder.uid, folder.gid]);
      const again = setup(i.dir);
      expect(again.status, again.stdout + again.stderr).toBe(0);
    } finally {
      cleanUp(i.dir);
    }
  });
});

for (const asRoot of [false, true]) {
  test.describe(`skip-worktree files on an existing install (${asRoot ? "as root" : "as the user"})`, () => {
    test.skip(asRoot && !SUDO && !IS_ROOT, "needs root: passwordless sudo, as on the CI runner");

    test("kong.yml and an already-filled diun.yml keep every byte and their mode", () => {
      const i = install();
      try {
        // As on prod and older installs: the real secrets, private modes.
        writeFileSync(i.kong, readFileSync(i.kong, "utf8").replace(/^/, "# real keys live here\n"));
        chmodSync(i.kong, 0o600);
        writeFileSync(i.diun, readFileSync(i.diun, "utf8").replace(/REPLACE_WITH_DIUN_WEBHOOK_SECRET/g, SECRETS.DIUN_WEBHOOK_SECRET));
        chmodSync(i.diun, 0o640);
        const kong = { meta: meta(i.kong), text: readFileSync(i.kong) };
        const diun = { meta: meta(i.diun), text: readFileSync(i.diun) };

        const r = setup(i.dir, { root: asRoot });
        expect(r.status, r.stdout + r.stderr).toBe(0);

        expect(meta(i.kong)).toEqual(kong.meta);
        expect(readFileSync(i.kong).equals(kong.text)).toBe(true);
        expect(meta(i.diun)).toEqual(diun.meta);
        expect(readFileSync(i.diun).equals(diun.text)).toBe(true);
      } finally {
        cleanUp(i.dir);
      }
    });

    test("a diun.yml still holding the placeholder gets the secret and nothing else, mode kept", () => {
      const i = install();
      try {
        chmodSync(i.diun, 0o640);
        const before = { meta: meta(i.diun), text: readFileSync(i.diun, "utf8") };
        expect(before.text).toContain("REPLACE_WITH_DIUN_WEBHOOK_SECRET");

        const r = setup(i.dir, { root: asRoot });
        expect(r.status, r.stdout + r.stderr).toBe(0);

        expect(meta(i.diun)).toEqual(before.meta);
        expect(readFileSync(i.diun, "utf8")).toBe(before.text.replace(/REPLACE_WITH_DIUN_WEBHOOK_SECRET/g, SECRETS.DIUN_WEBHOOK_SECRET));
        expect(leftovers(i.dir)).toEqual([]);
      } finally {
        cleanUp(i.dir);
      }
    });
  });
}

test("an .env that is a symlink stays one, and the file it points at keeps its mode", () => {
  const i = install();
  try {
    const real = join(i.dir, "elsewhere.env");
    writeFileSync(real, readFileSync(i.env, "utf8").replace(/^SITE_URL=.*$/m, "SITE_URL=http://old.example:3001"));
    chmodSync(real, 0o640);
    rmSync(i.env);
    execFileSync("ln", ["-s", real, i.env]);
    const r = spawnSync("./setup.sh", ["--non-interactive", "--url", "http://new.example:3001"], { cwd: i.dir, encoding: "utf8", env: childEnv() });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(lstatSync(i.env).isSymbolicLink()).toBe(true);
    expect(meta(real).mode).toBe("640");
    expect(readFileSync(real, "utf8")).toMatch(/^SITE_URL=http:\/\/new\.example:3001$/m);
  } finally {
    cleanUp(i.dir);
  }
});

test("two setup.sh at once leave .env complete", async () => {
  test.setTimeout(120_000);
  const i = install();
  try {
    // One secret still empty, as on a first run or after a release added a
    // key: exactly one of the two runs may mint it. Minting it twice means
    // the second value overwrites the first after something may have
    // started on it (a database initialised with the first password).
    writeFileSync(i.env, readFileSync(i.env, "utf8").replace(/^CRON_SECRET=.*$/m, "CRON_SECRET="));
    const before = readFileSync(i.env, "utf8");
    // awk that takes its time: half its output, a pause, the rest. Two runs
    // sharing one temp file then write into each other's. The second is a
    // hand-started run that moves the address, as `./setup.sh --url` does
    // while the self-update runs; it starts last, so its address wins.
    const bin = awkStub(
      i.dir,
      `out="$(${REAL_AWK} "$@"; printf x)"; out="\${out%x}"
h=$(( \${#out} / 2 ))
printf '%s' "\${out:0:h}"; sleep 1; printf '%s' "\${out:h}"`,
    );
    const run = (...args: string[]) =>
      new Promise<{ code: number | null; out: string }>((done) => {
        const c = spawn("./setup.sh", ["--non-interactive", ...args], { cwd: i.dir, env: childEnv(bin) });
        let out = "";
        c.stdout.on("data", (d) => (out += d));
        c.stderr.on("data", (d) => (out += d));
        c.on("close", (code) => done({ code, out }));
      });
    const first = run();
    await new Promise((r) => setTimeout(r, 300));
    const url = "http://kinboard.home.example:3001";
    const results = await Promise.all([first, run("--url", url)]);

    const after = readFileSync(i.env, "utf8");
    const cron = after.match(/^CRON_SECRET=([0-9a-f]{64})$/m)?.[1];
    expect(cron, "CRON_SECRET minted").toBeTruthy();
    expect(after).toBe(before.replace(/^SITE_URL=.*$/m, `SITE_URL=${url}`).replace(/^CRON_SECRET=$/m, `CRON_SECRET=${cron}`));
    for (const r of results) expect(r.code, r.out).toBe(0);
    expect(results.filter((r) => r.out.includes("set CRON_SECRET")).length, results.map((r) => r.out).join("\n---\n")).toBe(1);
    expect(leftovers(i.dir)).toEqual([]);
  } finally {
    cleanUp(i.dir);
  }
});

for (const [name, body] of [
  // Each one trips a different check: nothing at all; the same number of
  // lines but a secret gone; every key still there but lines missing; awk
  // itself failing.
  ["comes out empty", "cat >/dev/null; exit 0"],
  ["loses a key", `${REAL_AWK} "$@" | sed 's/^JWT_SECRET=.*/# gone/'`],
  ["is cut short", `${REAL_AWK} "$@" | grep -v '^#'`],
  ["fails", `${REAL_AWK} "$@"; exit 2`],
] as const) {
  test(`a rewrite of .env that ${name} keeps the original and stops with an error`, () => {
    const i = install();
    try {
      chmodSync(i.env, 0o640);
      const before = { meta: meta(i.env), text: readFileSync(i.env, "utf8") };
      const r = setup(i.dir, { path: awkStub(i.dir, body) });
      expect(r.status, r.stdout + r.stderr).not.toBe(0);
      expect(r.stderr).toMatch(/error: .*(kept the original|could not rewrite)/);
      expect(readFileSync(i.env, "utf8")).toBe(before.text);
      expect(meta(i.env)).toEqual(before.meta);
      expect(leftovers(i.dir)).toEqual([]);
    } finally {
      cleanUp(i.dir);
    }
  });
}

test("a second setup.sh waits for the first instead of writing beside it", () => {
  const i = install();
  try {
    // Hold the lock as a running setup.sh would, and give up quickly.
    const lock = join(i.dir, "webapp/docker/.env.lock");
    writeFileSync(lock, "");
    const r = spawnSync("bash", ["-c", `exec 8<"$1"; flock -n 8 || exit 9; KINBOARD_SETUP_LOCK_WAIT=2 ./setup.sh --non-interactive`, "_", lock], {
      cwd: i.dir,
      encoding: "utf8",
      env: childEnv(),
      timeout: 60_000,
    });
    test.skip(r.status === 9, "no flock on this machine");
    // setup.sh opened its own descriptor of the same file, so the shell's lock blocks it.
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("another setup.sh is running; waiting");
    expect(r.stderr).toContain("nothing was changed");
  } finally {
    cleanUp(i.dir);
  }
});

test.describe("start.sh never writes .env", () => {
  const START = join(REPO, "webapp/docker/start.sh");

  test("no line of it redirects into, moves, copies, edits or deletes .env", () => {
    const code = readFileSync(START, "utf8")
      .split("\n")
      .map((line, n) => ({ n: n + 1, line: line.replace(/(^|\s)#.*$/, "") }));
    // A heredoc is text the script prints, not commands it runs.
    let inHeredoc: string | null = null;
    const offenders: string[] = [];
    const ENV = String.raw`["']?(\$\{?SCRIPT_DIR\}?/|\./)?\.env["']?(\s|$|;|\))`;
    const writes = [
      new RegExp(String.raw`>>?\|?\s*` + ENV),
      new RegExp(String.raw`\b(mv|cp|install|ln|rm|truncate|tee|dd|touch|chmod|chown)\b[^|;&]*\s` + ENV),
      new RegExp(String.raw`\bsed\b[^|;&]*\s-i[^|;&]*` + ENV),
      new RegExp(String.raw`\b(ENV_FILE|of)=["']?(\./)?\.env\b[^|;&]*\b(setup|write|tee)`),
    ];
    for (const { n, line } of code) {
      if (inHeredoc !== null) {
        if (line.trim() === inHeredoc) inHeredoc = null;
        continue;
      }
      const h = line.match(/<<-?\s*['"]?([A-Za-z_]+)['"]?/);
      if (h) inHeredoc = h[1];
      if (writes.some((re) => re.test(line))) offenders.push(`${n}: ${line.trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  test("running it, also when it fails, leaves .env as it was", () => {
    const i = install();
    try {
      const docker = join(i.dir, "webapp/docker");
      const bin = join(i.dir, "stub-bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "docker"), `#!/bin/sh\n[ -n "$FAIL_DOCKER" ] && exit 1\ncase "$*" in *version*) echo "Docker Compose version v2.30.0";; logs*) echo "[entrypoint] starting Next.js server";; esac\nexit 0\n`);
      chmodSync(join(bin, "docker"), 0o755);
      chmodSync(i.env, 0o640);
      const before = { meta: meta(i.env), text: readFileSync(i.env, "utf8"), ino: statSync(i.env).ino, mtime: statSync(i.env).mtimeMs };
      for (const [args, extra] of [
        [["up"], {}],
        [["up"], { FAIL_DOCKER: "1" }],
        [["down"], {}],
        [["migrate"], { FAIL_DOCKER: "1" }],
        [["nonsense"], {}],
      ] as const) {
        spawnSync("./start.sh", [...args], {
          cwd: docker,
          encoding: "utf8",
          timeout: 60_000,
          env: { ...childEnv(bin), ...extra, KINBOARD_RIG: "", DATA_DIR: join(i.dir, "data") },
        });
        const s = statSync(i.env);
        expect({ ...meta(i.env), ino: s.ino, mtime: s.mtimeMs }, `./start.sh ${args.join(" ")}`).toEqual({ ...before.meta, ino: before.ino, mtime: before.mtime });
        expect(readFileSync(i.env, "utf8")).toBe(before.text);
      }
      expect(existsSync(join(docker, ".env"))).toBe(true);
    } finally {
      cleanUp(i.dir);
    }
  });
});
