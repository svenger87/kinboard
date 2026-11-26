import { test, expect } from "@playwright/test";
import { spawnSync } from "child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

/**
 * The developer rigs are not updaters (#539).
 *
 * A self-hoster ran webapp/docker/test-upgrade.sh to update to 1.17. It sat
 * next to start.sh and read like an updater; it built a throwaway kbupg-*
 * stack beside his own, rewrote his webapp/docker/.env to point at it, and
 * updated nothing. The rigs now live in scripts/rigs/ and refuse to start
 * unless a developer asks (KINBOARD_RIG=1 or --i-am-testing); a stub at the
 * old path only explains; a rig run on purpose still refuses an install's
 * .env; start.sh refuses an .env a rig rewrote; and a rig that fails or is
 * interrupted tears its stack down.
 *
 * Every script runs for real, with `docker`, `git` and `ss` on PATH replaced
 * by stubs that log their calls, so "runs nothing" is a count, not a reading.
 */

const REPO = resolve(__dirname, "../..");
const RIGS = join(REPO, "scripts/rigs");
const STUB = join(REPO, "webapp/docker/test-upgrade.sh");
const START = join(REPO, "webapp/docker/start.sh");
const RIGS_YML = join(REPO, ".github/workflows/rigs.yml");

const RIG_SCRIPTS = readdirSync(RIGS)
  .filter((f) => /^test-.*\.sh$/.test(f) && f !== "test-rig-common.sh")
  .sort();

const UPDATE_CMD = "cd webapp/docker && ./start.sh up";
const WIKI = "https://github.com/svenger87/kinboard/wiki/Self-hosting#updates";

type Run = { code: number | null; out: string; calls: string[] };

/** A sandbox: a bin/ of logging stand-ins, and a place for a fake repo. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "dev-rigs-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  for (const tool of ["docker", "git", "ss", "curl", "sudo"]) {
    const p = join(bin, tool);
    writeFileSync(p, `#!/bin/sh\necho "${tool} $*" >> "${log}"\nexit 0\n`);
    chmodSync(p, 0o755);
  }
  return { dir, bin, log };
}

function run(
  sb: ReturnType<typeof sandbox>,
  script: string,
  args: string[] = [],
  env: Record<string, string> = {},
  cwd?: string,
): Run {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "KINBOARD_RIG") base[k] = v;
  const r = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    cwd: cwd ?? sb.dir,
    env: { ...base, PATH: `${sb.bin}:/usr/bin:/bin`, RIG_DATA: join(sb.dir, "rig-data"), ...env },
    timeout: 20_000,
  });
  const calls = readFileSync(sb.log, "utf8").split("\n").filter(Boolean);
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), calls };
}

/** A fake checkout: scripts/rigs/ copied in, and webapp/docker/.env as given. */
function fakeCheckout(sb: ReturnType<typeof sandbox>, env: string | null) {
  const root = join(sb.dir, "repo");
  mkdirSync(join(root, "scripts/rigs"), { recursive: true });
  mkdirSync(join(root, "webapp/docker"), { recursive: true });
  for (const f of readdirSync(RIGS)) copyFileSync(join(RIGS, f), join(root, "scripts/rigs", f));
  if (env !== null) writeFileSync(join(root, "webapp/docker/.env"), env);
  return root;
}

function expectNotAnUpdater(out: string) {
  expect(out).toContain("is a developer test, not an updater");
  expect(out).toContain("It does not update your Kinboard.");
  expect(out).toContain(UPDATE_CMD);
  expect(out).toContain(WIKI);
}

test("the rigs are where rigs.yml expects them, and none is left next to start.sh", () => {
  expect(RIG_SCRIPTS).toEqual([
    "test-backup-restore.sh",
    "test-fresh-install.sh",
    "test-integration-api.sh",
    "test-upgrade.sh",
  ]);
  const docker = readdirSync(join(REPO, "webapp/docker"));
  // Only the stub keeps a test-* name in webapp/docker.
  expect(docker.filter((f) => /^test-.*\.sh$/.test(f))).toEqual(["test-upgrade.sh"]);
  expect(readFileSync(STUB, "utf8")).not.toMatch(/docker (compose|run|build|exec|pull)|\. "\$|source /);
});

test("the stub at the old path refuses, exits non-zero and runs nothing", () => {
  const sb = sandbox();
  try {
    for (const env of [{}, { KINBOARD_RIG: "1" }]) {
      const r = run(sb, STUB, ["--rollback", "--i-am-testing"], env, join(REPO, "webapp/docker"));
      expect(r.code).toBe(2);
      expectNotAnUpdater(r.out);
      expect(r.out).toContain("scripts/rigs/test-upgrade.sh");
      expect(r.calls).toEqual([]);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
});

for (const rig of RIG_SCRIPTS) {
  test(`${rig} refuses without the developer flag and runs nothing`, () => {
    const sb = sandbox();
    try {
      // An installed copy's .env next to it: the refusal must come first.
      const root = fakeCheckout(sb, "PROJECT_NAME=kinboard\nDATA_DIR=/srv/kinboard\n");
      for (const env of [{}, { KINBOARD_RIG: "0" }, { KINBOARD_RIG: "yes" }]) {
        const r = run(sb, join(root, "scripts/rigs", rig), ["--rollback"], env);
        expect(r.code, r.out).toBe(2);
        expectNotAnUpdater(r.out);
        expect(r.out).toContain(`${rig} is a developer test`);
        expect(r.calls).toEqual([]);
      }
      expect(readFileSync(join(root, "webapp/docker/.env"), "utf8")).toBe(
        "PROJECT_NAME=kinboard\nDATA_DIR=/srv/kinboard\n",
      );
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test(`${rig}, run on purpose, still will not rewrite an installed copy's .env`, () => {
    const sb = sandbox();
    try {
      const env = 'PROJECT_NAME="kinboard"\nDATA_DIR=/srv/kinboard\nCOMPOSE_FILES="-f docker-compose.yml -f docker-compose.traefik.yml"\n';
      const root = fakeCheckout(sb, env);
      for (const how of [{ args: ["--i-am-testing"], env: {} }, { args: [], env: { KINBOARD_RIG: "1" } }]) {
        const r = run(sb, join(root, "scripts/rigs", rig), how.args, how.env);
        expect(r.code, r.out).toBe(1);
        expect(r.out).toContain("belongs to an install (PROJECT_NAME=kinboard)");
        expect(r.out).not.toContain("not an updater");
        // Nothing was started or torn down: the teardown trap is not armed yet.
        expect(r.calls.filter((c) => c.startsWith("docker"))).toEqual([]);
        expect(r.out).not.toContain("leftover");
        expect(readFileSync(join(root, "webapp/docker/.env"), "utf8")).toBe(env);
      }
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });
}

test("--i-am-testing is taken out of the arguments the rig parses", () => {
  const sb = sandbox();
  try {
    const root = fakeCheckout(sb, "PROJECT_NAME=kinboard\n");
    const r = run(sb, join(root, "scripts/rigs/test-upgrade.sh"), ["--i-am-testing", "--rollback", "1.16.0"]);
    expect(r.out).toContain("Kinboard rollback test");
    expect(r.out).toContain("->  1.16.0");
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
});

test("the stub and the rigs give the same update command and link", () => {
  const intent = readFileSync(join(RIGS, "rig-intent.sh"), "utf8");
  const stub = readFileSync(STUB, "utf8");
  for (const s of [intent, stub]) {
    expect(s).toContain(UPDATE_CMD);
    expect(s).toContain(WIKI);
  }
  expect(stub).toMatch(/TODO\(1\.\d+\): remove this stub/);
});

test("rigs.yml passes the flag and calls every rig at its new path", () => {
  const yml = readFileSync(RIGS_YML, "utf8");
  const run = yml.slice(yml.indexOf("- name: Run ${{ matrix.rig }}"), yml.indexOf("- name: Stack logs on failure"));
  expect(run).toMatch(/^\s+KINBOARD_RIG: "1"$/m);
  expect(run).not.toMatch(/working-directory:/);
  for (const rig of RIG_SCRIPTS) expect(run).toContain(`scripts/rigs/${rig}`);
  expect(run).toContain("scripts/rigs/test-upgrade.sh --rollback");
  expect(yml).not.toMatch(/\.\/test-[\w-]+\.sh/);
});

test.describe("start.sh refuses an .env a rig rewrote", () => {
  function startIn(projectName: string, env: Record<string, string> = {}) {
    const sb = sandbox();
    try {
      const docker = join(sb.dir, "webapp/docker");
      mkdirSync(docker, { recursive: true });
      copyFileSync(START, join(docker, "start.sh"));
      writeFileSync(join(docker, ".env"), `PROJECT_NAME=${projectName}\nDATA_DIR=/x\n`);
      return run(sb, join(docker, "start.sh"), ["status"], env, docker);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  }

  for (const p of ["kbupg", "kbinstall", "kbbak"]) {
    test(`PROJECT_NAME=${p}`, () => {
      const r = startIn(p);
      expect(r.code).toBe(1);
      expect(r.out).toContain("was rewritten by one of Kinboard's developer tests");
      expect(r.out).toContain(`docker compose -p ${p} down -v --remove-orphans`);
      expect(r.calls.filter((c) => c.startsWith("docker"))).toEqual([]);
    });
  }

  test("a rig's own start.sh call (KINBOARD_RIG=1) and a normal install go through", () => {
    for (const [p, env] of [["kbupg", { KINBOARD_RIG: "1" }], ["kinboard", {}], ["kbfresh", {}]] as const) {
      const r = startIn(p, env);
      expect(r.out).not.toContain("developer tests");
      expect(r.calls.some((c) => c.startsWith("docker ")), r.out).toBe(true);
    }
  });
});

test.describe("a rig tears down on any exit once its stack exists", () => {
  // Sources the shared machinery the way a rig does, with a teardown that
  // only records it ran, then ends the way a failed or interrupted run does.
  function rig(end: string, keep = "0") {
    const sb = sandbox();
    try {
      const script = join(sb.dir, "rig.sh");
      writeFileSync(
        script,
        [
          "set -euo pipefail",
          "RIG_PROJECT=kbupg RIG_DATA=/tmp/rig-x RIG_WEBAPP_PORT=3021",
          `RIG_TEARDOWN=fake_teardown RIG_KEEP=${keep}`,
          `. "${join(RIGS, "test-rig-common.sh")}"`,
          'fake_teardown() { echo "TORN-DOWN"; }',
          "rig_at_exit 'echo EXTRA-CLEANUP'",
          "rig_arm_teardown",
          end,
          "echo NOT-REACHED",
        ].join("\n"),
      );
      return run(sb, script);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  }
  const hint = "docker compose -p kbupg down -v --remove-orphans";

  test("a failing command (set -e)", () => {
    const r = rig("false");
    expect(r.code).toBe(1);
    expect(r.out).toContain("EXTRA-CLEANUP");
    expect(r.out).toContain("TORN-DOWN");
    expect(r.out).toContain(hint);
    expect(r.out).not.toContain("NOT-REACHED");
  });

  test("an interrupt (Ctrl-C) and a kill (TERM)", () => {
    for (const [sig, code] of [["INT", 130], ["TERM", 143]] as const) {
      const r = rig(`kill -${sig} $$; sleep 1`);
      expect(r.code, r.out).toBe(code);
      expect(r.out).toContain("TORN-DOWN");
      expect(r.out).toContain(hint);
    }
  });

  test("KEEP_UP leaves the stack up but still says how to remove it", () => {
    const r = rig("exit 0", "1");
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("TORN-DOWN");
    expect(r.out).toContain(hint);
  });

  test("not armed before the stack exists", () => {
    const common = readFileSync(join(RIGS, "test-rig-common.sh"), "utf8");
    // Armed from rig_prepare_env only — after the .env and port checks.
    expect(common.match(/^\s*rig_arm_teardown$/gm)).toHaveLength(1);
    const prep = common.slice(common.indexOf("rig_prepare_env() {"));
    expect(prep.indexOf("rig_arm_teardown")).toBeGreaterThan(prep.indexOf("belongs to an install"));
    expect(existsSync(join(RIGS, "rig-intent.sh"))).toBe(true);
  });
});
