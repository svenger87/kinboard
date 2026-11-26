import { test, expect } from "@playwright/test";
import { spawnSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

/**
 * install.sh: the git install as it was, and the one-file install behind an
 * opt-in (RFC-023 §4.9, PR 8).
 *
 * compose.yml needs an image with kinboard-init, i.e. Kinboard 1.18, so until
 * the 1.18 release flips the default (RELEASE.md) the one-file path runs only
 * with --one-file or KINBOARD_INSTALL_MODE=one-file, and refuses any image
 * older than 1.18: by the tag when it is a version, else by the pulled image's
 * version label, else by whether the image carries kinboard-init at all.
 *
 * The script runs for real, with `docker`, `curl`, `git` and `openssl`
 * replaced by stand-ins that log their calls, so "never clones" and "pulls
 * nothing" are counts, not readings.
 */

const REPO = resolve(__dirname, "../..");
const INSTALL = join(REPO, "install.sh");
const COMPOSE = join(REPO, "compose.yml");
const LATEST = "https://github.com/svenger87/kinboard/releases/latest/download/compose.yml";

const GIT_UPDATE = (dir: string) => `cd "${dir}" && git pull && cd webapp/docker && ./start.sh up`;
const ONE_FILE_UPDATE = (dir: string) => `cd "${dir}" && docker compose pull && docker compose up -d`;

type Sandbox = { dir: string; bin: string; log: string; target: string };
type Run = { code: number | null; out: string; calls: string[] };

function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "install-sh-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // docker: answers what install.sh asks; STUB_* steer it. Compose calls log
  // the folder they ran in, so "up in the install folder" is checkable.
  stub(
    "docker",
    `case "$1" in compose) echo "docker $* [in $(basename "$PWD")]" >> "${log}" ;; *) echo "docker $*" >> "${log}" ;; esac
case "$*" in
  "compose version") exit 0 ;;
  "ps -a --format"*) printf '%s' "\${STUB_CONTAINERS:-}" | tr ',' '\\n'; exit 0 ;;
  "volume ls -q") printf '%s' "\${STUB_VOLUMES:-}" | tr ',' '\\n'; exit 0 ;;
  "image inspect"*) printf '%s\\n' "\${STUB_LABEL-1.18.0}"; exit 0 ;;
  "run --rm --entrypoint /bin/sh"*) [ -n "\${STUB_NO_INIT:-}" ] && exit 1; exit 0 ;;
  "compose -p kinboard-install pull") [ -n "\${STUB_PULL_FAIL:-}" ] && exit 1; exit 0 ;;
  "compose up -d") [ -n "\${STUB_UP_FAIL:-}" ] && exit 1; exit 0 ;;
esac
exit 0`,
  );
  // curl: the download copies STUB_COMPOSE (or fails like a 404); health answers.
  stub(
    "curl",
    `echo "curl $*" >> "${log}"
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2 ;; --retry|--max-time) shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac
done
case "$url" in */api/health) [ -n "\${STUB_UNHEALTHY:-}" ] && exit 7; exit 0 ;; esac
[ -n "\${STUB_404:-}" ] && { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
cp "\${STUB_COMPOSE}" "$out"`,
  );
  // git clone makes a checkout whose setup.sh and start.sh only log.
  stub(
    "git",
    `echo "git $*" >> "${log}"
if [ "$1" = clone ]; then
  for d; do target="$d"; done
  mkdir -p "$target/webapp/docker"
  printf '#!/bin/sh\\necho "setup.sh $*" >> "${log}"\\n' > "$target/setup.sh"
  printf '#!/bin/sh\\necho "start.sh $*" >> "${log}"\\n' > "$target/webapp/docker/start.sh"
  chmod +x "$target/setup.sh" "$target/webapp/docker/start.sh"
  echo "SITE_URL=" > "$target/webapp/docker/.env"
fi`,
  );
  stub("openssl", `echo "openssl $*" >> "${log}"`);
  return { dir, bin, log, target: join(dir, "kinboard") };
}

function run(sb: Sandbox, args: string[] = [], env: Record<string, string> = {}): Run {
  // The parent's environment minus anything install.sh or compose reads, with
  // the stand-ins first on PATH, then what this test sets.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, PATH: `${sb.bin}:/usr/bin:/bin`, STUB_COMPOSE: COMPOSE };
  for (const k of Object.keys(childEnv)) {
    if (/^KINBOARD_/.test(k) || k === "WEBAPP_PORT" || k.startsWith("COMPOSE_")) delete childEnv[k];
  }
  Object.assign(childEnv, env);
  // No terminal: stdin is not a tty, so nothing is asked and defaults apply.
  const r = spawnSync("/bin/bash", [INSTALL, ...args], {
    encoding: "utf8",
    cwd: sb.dir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
  });
  const calls = readFileSync(sb.log, "utf8").split("\n").filter(Boolean);
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), calls };
}

function withSandbox(fn: (sb: Sandbox) => void) {
  const sb = sandbox();
  try {
    fn(sb);
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

/** What a refused one-file run must leave: no folder, no staging, no pull, no start. */
function expectNothingDone(sb: Sandbox, r: Run) {
  expect(existsSync(sb.target), r.out).toBe(false);
  expect(readdirSync(sb.dir).filter((f) => f.startsWith(".kinboard-install"))).toEqual([]);
  expect(r.calls.filter((c) => /^git /.test(c) || / compose (pull|up)/.test(c))).toEqual([]);
}

test.describe("without the opt-in: the git install, as before", () => {
  test("clones, runs setup.sh headless and start.sh up, and never downloads compose.yml", () => {
    withSandbox((sb) => {
      const r = run(sb);
      expect(r.code, r.out).toBe(0);
      expect(r.calls).toEqual([
        "docker compose version [in " + sb.dir.split("/").pop() + "]",
        `git clone --depth 1 https://github.com/svenger87/kinboard.git ${sb.target}`,
        "setup.sh --non-interactive",
        "start.sh up",
      ]);
      expect(r.out).toContain(`Installing Kinboard in ${sb.target}`);
      expect(r.out).toContain("Kinboard is ready: http://localhost:3001");
      expect(r.out).toContain("Keep that directory: it contains your configuration and upgrade tools.");
    });
  });

  test("KINBOARD_URL, KINBOARD_REPOSITORY and KINBOARD_INSTALL_MODE=git work as they did", () => {
    withSandbox((sb) => {
      const r = run(sb, [], {
        KINBOARD_URL: "http://192.168.1.50:3001",
        KINBOARD_REPOSITORY: "https://example.invalid/fork.git",
        KINBOARD_INSTALL_MODE: "git",
        // Environment the one-file install reads means nothing here, as before.
        WEBAPP_PORT: "4000",
        KINBOARD_DATA_DIR: "/srv/x",
        KINBOARD_VERSION: "1.17.0",
      });
      expect(r.code, r.out).toBe(0);
      expect(r.calls).toContain(`git clone --depth 1 https://example.invalid/fork.git ${sb.target}`);
      expect(r.calls).toContain("setup.sh --non-interactive --url http://192.168.1.50:3001");
      expect(r.calls.filter((c) => c.startsWith("curl"))).toEqual([]);
    });
  });

  test("still needs git and openssl", () => {
    withSandbox((sb) => {
      rmSync(join(sb.bin, "openssl"));
      // /usr/bin may have a real openssl; a PATH of only the stand-ins and
      // what bash needs makes the missing one missing.
      const tools = join(sb.dir, "tools");
      mkdirSync(tools);
      for (const t of ["dirname", "basename", "grep", "head", "cut", "cat"]) {
        const p = ["/usr/bin", "/bin"].map((d) => join(d, t)).find(existsSync);
        if (p) writeFileSync(join(tools, t), `#!/bin/sh\nexec ${p} "$@"\n`, { mode: 0o755 });
      }
      const r = run(sb, [], { PATH: `${sb.bin}:${tools}` });
      expect(r.code).toBe(1);
      expect(r.out).toContain("'openssl' is required");
      expect(r.calls.filter((c) => c.startsWith("git"))).toEqual([]);
    });
  });
});

test.describe("with the opt-in: compose.yml, no git", () => {
  for (const [how, args, env] of [
    ["--one-file", ["--one-file"], {}],
    ["KINBOARD_INSTALL_MODE=one-file", [], { KINBOARD_INSTALL_MODE: "one-file" }],
  ] as [string, string[], Record<string, string>][]) {
    test(`${how}: downloads the newest release's file, pulls, starts, waits for health; never clones`, () => {
      withSandbox((sb) => {
        const r = run(sb, args, env);
        expect(r.code, r.out).toBe(0);
        expect(r.calls.filter((c) => /^(git|openssl|setup\.sh|start\.sh)\b/.test(c))).toEqual([]);
        const curls = r.calls.filter((c) => c.startsWith("curl"));
        expect(curls[0]).toBe(`curl -fsSL --retry 2 -o ${curls[0].split(" ")[5]} ${LATEST}`);
        expect(curls.at(-1)).toBe("curl -fsS -o /dev/null --max-time 5 http://localhost:3001/api/health");
        // Pulled in the staging folder, started in the install folder.
        const compose = r.calls.filter((c) => c.startsWith("docker compose") && !c.includes("version"));
        expect(compose).toEqual([
          expect.stringMatching(/^docker compose -p kinboard-install pull \[in \.kinboard-install\.\w+\]$/),
          "docker compose up -d [in kinboard]",
        ]);
        expect(r.calls).toContain(
          "docker run --rm --entrypoint /bin/sh ghcr.io/svenger87/kinboard:latest -c test -x /usr/local/bin/kinboard-init",
        );
        // The folder holds the file, byte for byte, and its variables; nothing secret.
        expect(readdirSync(sb.target).sort()).toEqual([".env", "compose.yml"]);
        expect(readFileSync(join(sb.target, "compose.yml"), "utf8")).toBe(readFileSync(COMPOSE, "utf8"));
        const dotenv = readFileSync(join(sb.target, ".env"), "utf8");
        expect(dotenv).toBe("# Written by install.sh. Every line is optional; compose.yml explains them.\nWEBAPP_PORT=3001\n");
        expect(dotenv).not.toMatch(/PASSWORD|SECRET|KEY|TOKEN/);
        expect(readdirSync(sb.dir).filter((f) => f.startsWith(".kinboard-install"))).toEqual([]);
        expect(r.out).toMatch(/Kinboard is ready: http:\/\/\S+:3001/);
        expect(r.out).toContain("create your family");
        expect(r.out).toContain("kinboard-db, kinboard-storage and kinboard-config");
        expect(r.out).toContain(`Update: ${ONE_FILE_UPDATE(sb.target)}`);
      });
    });
  }

  test("--port and --data-dir become the file's variables; a relative folder is made absolute", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--one-file", "--port", "3077", "--data-dir=data"], { KINBOARD_URL: "http://kb.lan:3077" });
      expect(r.code, r.out).toBe(0);
      const data = join(sb.dir, "data");
      expect(readFileSync(join(sb.target, ".env"), "utf8")).toBe(
        [
          "# Written by install.sh. Every line is optional; compose.yml explains them.",
          "WEBAPP_PORT=3077",
          "SITE_URL=http://kb.lan:3077",
          `KINBOARD_DB_DIR=${data}/db`,
          `KINBOARD_STORAGE_DIR=${data}/storage`,
          `KINBOARD_CONFIG_DIR=${data}/config`,
          "",
        ].join("\n"),
      );
      expect(existsSync(data)).toBe(true);
      expect(r.calls).toContain("curl -fsS -o /dev/null --max-time 5 http://localhost:3077/api/health");
      expect(r.out).toContain("Kinboard is ready: http://kb.lan:3077");
      expect(r.out).toContain(`${data} (db, storage, config)`);
      // With a folder, Docker volumes are none of its business.
      expect(r.calls).not.toContain("docker volume ls -q");
    });
  });

  test("--version takes that release's file and pins its image", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--one-file", "--version", "v1.18.2"]);
      expect(r.code, r.out).toBe(0);
      expect(r.calls.find((c) => c.startsWith("curl"))).toContain(
        "https://github.com/svenger87/kinboard/releases/download/v1.18.2/compose.yml",
      );
      expect(readFileSync(join(sb.target, ".env"), "utf8")).toContain("KINBOARD_TAG=1.18.2\n");
      expect(r.calls).toContain("docker image inspect --format {{ index .Config.Labels \"org.opencontainers.image.version\" }} ghcr.io/svenger87/kinboard:1.18.2");
    });
  });

  test("KINBOARD_IMAGE and KINBOARD_TAG reach the file's variables and the image check", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--one-file"], { KINBOARD_IMAGE: "registry.lan/kinboard", KINBOARD_TAG: "next", STUB_LABEL: "1.18.0-rc.1" });
      expect(r.code, r.out).toBe(0);
      const dotenv = readFileSync(join(sb.target, ".env"), "utf8");
      expect(dotenv).toContain("KINBOARD_TAG=next\n");
      expect(dotenv).toContain("KINBOARD_IMAGE=registry.lan/kinboard\n");
      expect(r.calls.some((c) => c.includes("registry.lan/kinboard:next -c test -x /usr/local/bin/kinboard-init"))).toBe(true);
    });
  });
});

test.describe("the version refusal: nothing older than 1.18", () => {
  for (const [what, args, env, shown] of [
    ["--version 1.17.0", ["--one-file", "--version", "1.17.0"], {}, "1.17.0"],
    ["--version v1.9.3", ["--one-file", "--version=v1.9.3"], {}, "1.9.3"],
    ["KINBOARD_TAG=1.17.0", ["--one-file"], { KINBOARD_TAG: "1.17.0" }, "1.17.0"],
    ["KINBOARD_TAG=1.17", ["--one-file"], { KINBOARD_TAG: "1.17" }, "1.17"],
    ["KINBOARD_TAG=0.99.0", ["--one-file"], { KINBOARD_TAG: "0.99.0" }, "0.99.0"],
  ] as [string, string[], Record<string, string>, string][]) {
    test(`${what} is refused before anything is downloaded`, () => {
      withSandbox((sb) => {
        const r = run(sb, args, env);
        expect(r.code).toBe(1);
        expect(r.out).toContain(`Kinboard ${shown} is older than 1.18, the first release with the one-file install`);
        expect(r.out).toContain("Install it without --one-file");
        expect(r.calls.filter((c) => c.startsWith("curl"))).toEqual([]);
        expectNothingDone(sb, r);
      });
    });
  }

  test("a channel tag whose image says 1.17.0 is refused after the pull, and nothing starts", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--one-file"], { STUB_LABEL: "1.17.0" });
      expect(r.code).toBe(1);
      expect(r.out).toContain("Kinboard 1.17.0 (image ghcr.io/svenger87/kinboard:latest) is older than 1.18");
      expect(r.calls.some((c) => c.startsWith("docker compose -p kinboard-install pull"))).toBe(true);
      expect(existsSync(sb.target)).toBe(false);
      expect(r.calls.filter((c) => c.startsWith("docker compose up"))).toEqual([]);
      expect(readdirSync(sb.dir).filter((f) => f.startsWith(".kinboard-install"))).toEqual([]);
    });
  });

  test("an image with no version (main, sha-) and no kinboard-init is refused", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--one-file"], { KINBOARD_TAG: "main", STUB_LABEL: "main", STUB_NO_INIT: "1" });
      expect(r.code).toBe(1);
      expect(r.out).toContain("Kinboard in ghcr.io/svenger87/kinboard:main is older than 1.18");
      expect(existsSync(sb.target)).toBe(false);
      expect(r.calls.filter((c) => c.startsWith("docker compose up"))).toEqual([]);
    });
  });

  for (const [tag, label] of [
    ["1.18.0", "1.18.0"],
    ["1.18.0-rc.1", "1.18.0-rc.1"],
    ["v1.18", "1.18.0"],
    ["1.100.0", "1.100.0"],
    ["2.0.0", "2.0.0"],
    ["main", "main"],
    ["sha-abc1234", "<no value>"],
    ["1", "1.18.0"],
  ]) {
    test(`KINBOARD_TAG=${tag} (image label ${label}) is accepted`, () => {
      withSandbox((sb) => {
        const r = run(sb, ["--one-file"], { KINBOARD_TAG: tag, STUB_LABEL: label });
        expect(r.code, r.out).toBe(0);
        expect(r.calls).toContain("docker compose up -d [in kinboard]");
      });
    });
  }

  test("no compose.yml in the newest release (1.17 has none) says why, and leaves nothing", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--one-file"], { STUB_404: "1" });
      expect(r.code).toBe(1);
      expect(r.out).toContain(`couldn't download compose.yml (${LATEST})`);
      expect(r.out).toContain("needs Kinboard 1.18 or newer; if the newest release is older, install without --one-file");
      expectNothingDone(sb, r);
    });
  });

  test("a downloaded file that is not Kinboard's compose.yml is refused", () => {
    withSandbox((sb) => {
      const other = join(sb.dir, "other.yml");
      writeFileSync(other, "services:\n  web:\n    image: nginx\n");
      const r = run(sb, ["--one-file"], { STUB_COMPOSE: other });
      expect(r.code).toBe(1);
      expect(r.out).toContain("is not Kinboard's compose.yml");
      expectNothingDone(sb, r);
    });
  });
});

test.describe("existing installs are refused, with their own update command", () => {
  const shapes: [string, (dir: string) => void, (dir: string) => string[]][] = [
    [
      "a git install",
      (d) => {
        mkdirSync(join(d, "webapp/docker"), { recursive: true });
        writeFileSync(join(d, "webapp/docker/start.sh"), "#!/bin/sh\n");
      },
      (d) => ["It is a git install; update it with:", GIT_UPDATE(d)],
    ],
    [
      "a one-file install",
      (d) => {
        mkdirSync(d);
        writeFileSync(join(d, "compose.yml"), "services: {}\n");
      },
      (d) => ["It is a one-file install; update it with:", ONE_FILE_UPDATE(d)],
    ],
    [
      "any other folder",
      (d) => mkdirSync(d),
      (d) => ["choose another folder with KINBOARD_DIR", GIT_UPDATE(d), ONE_FILE_UPDATE(d)],
    ],
  ];
  for (const [shape, make, says] of shapes) {
    for (const [mode, args] of [
      ["git mode", []],
      ["one-file mode", ["--one-file"]],
    ] as [string, string[]][]) {
      test(`${shape}, ${mode}`, () => {
        withSandbox((sb) => {
          make(sb.target);
          const before = readdirSync(sb.target, { recursive: true }).sort();
          const r = run(sb, args);
          expect(r.code).toBe(1);
          expect(r.out).toContain(`${sb.target} already exists. This installer never changes an existing installation.`);
          for (const s of says(sb.target)) expect(r.out).toContain(s);
          expect(r.calls.filter((c) => !c.startsWith("docker compose version"))).toEqual([]);
          expect(readdirSync(sb.target, { recursive: true }).sort()).toEqual(before);
        });
      });
    }
  }

  test("Kinboard containers already on this machine (either shape) are refused", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--one-file"], { STUB_CONTAINERS: "other,kinboard-db,kinboard-webapp" });
      expect(r.code).toBe(1);
      expect(r.out).toContain("Kinboard already runs on this machine (found: kinboard-db kinboard-webapp)");
      expect(r.out).toContain("./start.sh up");
      expect(r.out).toContain("docker compose pull && docker compose up -d");
      expectNothingDone(sb, r);
      expect(r.calls.filter((c) => c.startsWith("curl"))).toEqual([]);
    });
  });

  test("an earlier install's volumes are refused, not adopted", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--one-file"], { STUB_VOLUMES: "kinboard-config,unrelated" });
      expect(r.code).toBe(1);
      expect(r.out).toContain("the Docker volume(s) kinboard-config already exist");
      expectNothingDone(sb, r);
    });
  });

  test("a data folder that already holds a database is refused", () => {
    withSandbox((sb) => {
      mkdirSync(join(sb.dir, "srv/db"), { recursive: true });
      writeFileSync(join(sb.dir, "srv/db/PG_VERSION"), "15\n");
      const r = run(sb, ["--one-file", "--data-dir", join(sb.dir, "srv")]);
      expect(r.code).toBe(1);
      expect(r.out).toContain(`${join(sb.dir, "srv")}/db already holds data`);
      expectNothingDone(sb, r);
    });
  });
});

test.describe("arguments", () => {
  for (const [args, env, says] of [
    [["--frobnicate"], {}, "unknown option '--frobnicate'"],
    [["--port", "3002"], {}, "--port belongs to the one-file install. Add --one-file"],
    [["--data-dir=/srv/kb"], {}, "--data-dir belongs to the one-file install"],
    [["--version", "1.18.0"], {}, "--version belongs to the one-file install"],
    [[], { KINBOARD_INSTALL_MODE: "docker" }, "KINBOARD_INSTALL_MODE must be 'git' or 'one-file', not 'docker'"],
    [["--one-file", "--port"], {}, "--port needs a value"],
    [["--one-file", "--port", "abc"], {}, "the port must be a number from 1 to 65535, not 'abc'"],
    [["--one-file", "--port", "70000"], {}, "not '70000'"],
    [["--one-file", "--port", "0"], {}, "not '0'"],
    [["--one-file", "--version", "latest"], {}, "--version wants a release number such as 1.18.0, not 'latest'"],
  ] as [string[], Record<string, string>, string][]) {
    test(`${[...Object.entries(env).map(([k, v]) => `${k}=${v}`), ...args].join(" ")} -> refused`, () => {
      withSandbox((sb) => {
        const r = run(sb, args, env);
        expect(r.code).toBe(1);
        expect(r.out).toContain(says);
        expectNothingDone(sb, r);
        expect(r.calls.filter((c) => c.startsWith("curl"))).toEqual([]);
      });
    });
  }

  test("--help prints the options and runs nothing", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--help"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("--one-file             KINBOARD_INSTALL_MODE=one-file");
      expect(r.calls).toEqual([]);
    });
  });
});

test.describe("after the start", () => {
  test("a stack that fails to start keeps its folder and says how to retry", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--one-file"], { STUB_UP_FAIL: "1" });
      expect(r.code).toBe(1);
      expect(r.out).toContain(`the stack did not start; the lines above say why. The install is in ${sb.target}`);
      expect(r.calls).toContain("docker compose logs --no-color --tail 20 init db-init [in kinboard]");
      expect(readdirSync(sb.target).sort()).toEqual([".env", "compose.yml"]);
    });
  });

  test("health that never comes gives up after the timeout", () => {
    withSandbox((sb) => {
      const r = run(sb, ["--one-file"], { STUB_UNHEALTHY: "1", KINBOARD_HEALTH_TIMEOUT: "0" });
      expect(r.code).toBe(1);
      expect(r.out).toContain("Kinboard did not answer on port 3001 within 0s");
      expect(r.calls).toContain("docker compose ps -a [in kinboard]");
    });
  });
});

test("RELEASE.md's 1.18 checklist flips the default to the one-file install", () => {
  const release = readFileSync(join(REPO, "RELEASE.md"), "utf8");
  const item = release.split("\n").find((l) => l.includes("1.18.0 only") && l.includes("install.sh"));
  expect(item, "a 1.18.0-only checklist item for install.sh").toBeTruthy();
  expect(item).toContain("KINBOARD_INSTALL_MODE");
  // The default it names is the one install.sh has today.
  expect(readFileSync(INSTALL, "utf8")).toContain('INSTALL_MODE="${KINBOARD_INSTALL_MODE:-git}"');
});
