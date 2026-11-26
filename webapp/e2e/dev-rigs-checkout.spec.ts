import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "child_process";
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
 * A rig leaves the checkout it ran in as it found it.
 *
 * Until this spec the shared rig setup deleted webapp/.env.local after
 * setup.sh whether or not setup.sh had created it, so a developer's own file
 * was gone after any rig run; and it marked webapp/docker/kong.yml and
 * diun/diun.yml skip-worktree (with the rig's secret written into diun.yml)
 * and never unmarked them.
 *
 * Each case builds a real git repository with the two tracked files, copies
 * scripts/rigs/ into it, puts a stand-in setup.sh next to it that does what
 * the real one does to these files, and drives rig_prepare_env from a script
 * that sources test-rig-common.sh the way a rig does. git is the real git;
 * docker, ss and curl are logging stand-ins.
 */

const REPO = resolve(__dirname, "../..");
const RIGS = join(REPO, "scripts/rigs");

const KONG = "keyauth_credentials:\n  - key: REPLACE_WITH_ANON_KEY\n";
const DIUN = "headers:\n  X-Diun-Token: REPLACE_WITH_DIUN_WEBHOOK_SECRET\n";
const MINE = "# a developer's own .env.local\nPOSTGREST_URL=http://localhost:3010\n";
const GUARDED = ["webapp/docker/kong.yml", "webapp/docker/diun/diun.yml"];

// What the real setup.sh does to the checkout: an .env, an .env.local only
// when there is none, and generated secrets in diun.yml (and, before 1.15,
// kong.yml). FAIL_SETUP=1 makes it fail after it has written all of that.
const SETUP = `#!/bin/sh
set -e
d="$(cd "$(dirname "$0")" && pwd)"
[ -f "$d/webapp/docker/.env" ] || printf 'PROJECT_NAME=kbupg\\nDATA_DIR=/x\\n' > "$d/webapp/docker/.env"
[ -f "$d/webapp/.env.local" ] || echo "NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000" > "$d/webapp/.env.local"
sed -i 's/REPLACE_WITH_DIUN_WEBHOOK_SECRET/rig-secret-diun/' "$d/webapp/docker/diun/diun.yml"
sed -i 's/REPLACE_WITH_ANON_KEY/rig-secret-kong/' "$d/webapp/docker/kong.yml"
[ "\${FAIL_SETUP:-0}" = "1" ] && exit 1
exit 0
`;

type Run = { code: number | null; out: string; calls: string[] };

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=rig", "-c", "user.email=rig@example.invalid", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

/** The flag letter `git ls-files -v` prints for a path: H tracked, S skip-worktree. */
function flag(root: string, path: string): string {
  return git(root, "ls-files", "-v", "--", path).slice(0, 1);
}

function checkout(opts: { envLocal?: string; skipWorktree?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dev-rigs-checkout-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  for (const tool of ["docker", "ss", "curl", "sudo"]) {
    const p = join(bin, tool);
    writeFileSync(p, `#!/bin/sh\necho "${tool} $*" >> "${log}"\nexit 0\n`);
    chmodSync(p, 0o755);
  }

  const root = join(dir, "repo");
  mkdirSync(join(root, "scripts/rigs"), { recursive: true });
  mkdirSync(join(root, "webapp/docker/diun"), { recursive: true });
  for (const f of readdirSync(RIGS)) copyFileSync(join(RIGS, f), join(root, "scripts/rigs", f));
  writeFileSync(join(root, "webapp/docker/kong.yml"), KONG);
  writeFileSync(join(root, "webapp/docker/diun/diun.yml"), DIUN);
  writeFileSync(join(root, "setup.sh"), SETUP);
  chmodSync(join(root, "setup.sh"), 0o755);
  writeFileSync(join(root, ".gitignore"), "webapp/.env.local\nwebapp/docker/.env\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "fixture");

  // The owner's checkout: both files skip-worktree, real secrets in them.
  if (opts.skipWorktree !== undefined) {
    git(root, "update-index", "--skip-worktree", "--", ...GUARDED);
    writeFileSync(join(root, "webapp/docker/kong.yml"), KONG.replace("REPLACE_WITH_ANON_KEY", opts.skipWorktree));
    writeFileSync(
      join(root, "webapp/docker/diun/diun.yml"),
      DIUN.replace("REPLACE_WITH_DIUN_WEBHOOK_SECRET", opts.skipWorktree),
    );
  }
  if (opts.envLocal !== undefined) writeFileSync(join(root, "webapp/.env.local"), opts.envLocal);
  return { dir, bin, log, root };
}

/** Run a rig's opening (rig_prepare_env), then `end`, the way a rig ends. */
function rig(c: ReturnType<typeof checkout>, end: string, env: Record<string, string> = {}): Run {
  const script = join(c.dir, "rig.sh");
  writeFileSync(
    script,
    [
      "set -euo pipefail",
      `REPO_ROOT="${c.root}" DOCKER_DIR="${c.root}/webapp/docker"`,
      `RIG_PROJECT=kbupg RIG_DATA="${c.dir}/rig-data" RIG_WEBAPP_PORT=3021 RIG_POSTGRES_PORT=5452`,
      "RIG_GO2RTC_HTTP_PORT=1984 RIG_GO2RTC_WEBRTC_PORT=8555 RIG_NETWORK_SUBNET=10.220.0.0/24",
      "RIG_TEARDOWN=fake_teardown",
      `. "${c.root}/scripts/rigs/test-rig-common.sh"`,
      'fake_teardown() { echo "TORN-DOWN"; }',
      "rig_prepare_env",
      // Mid-run state, so a case can see what the rig ran with.
      `echo "MID flags=$(git -C "${c.root}" ls-files -v -- ${GUARDED.join(" ")} | cut -c1 | tr -d '\\n')"`,
      `[ -e "${c.root}/webapp/.env.local" ] && echo "MID env.local=present" || echo "MID env.local=absent"`,
      end,
      "echo END-REACHED",
    ].join("\n"),
  );
  const childEnv: NodeJS.ProcessEnv = { ...process.env, PATH: `${c.bin}:/usr/bin:/bin`, ...env };
  delete childEnv.KINBOARD_RIG;
  const r = spawnSync("bash", [script], { encoding: "utf8", cwd: c.dir, env: childEnv, timeout: 20_000 });
  const calls = readFileSync(c.log, "utf8").split("\n").filter(Boolean);
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), calls };
}

function expectTemplatesBack(c: ReturnType<typeof checkout>, out: string) {
  for (const p of GUARDED) expect(flag(c.root, p), `${p}\n${out}`).toBe("H");
  expect(readFileSync(join(c.root, "webapp/docker/kong.yml"), "utf8")).toBe(KONG);
  expect(readFileSync(join(c.root, "webapp/docker/diun/diun.yml"), "utf8")).toBe(DIUN);
  // Nothing tracked is modified or hidden any more.
  expect(git(c.root, "status", "--porcelain", "--untracked-files=no")).toBe("");
}

const ENDINGS: { name: string; end: string; code: number }[] = [
  { name: "a normal exit", end: "exit 0", code: 0 },
  { name: "a failing command (set -e)", end: "false", code: 1 },
  { name: "an interrupt (Ctrl-C)", end: "kill -INT $$; sleep 1", code: 130 },
  { name: "a kill (TERM)", end: "kill -TERM $$; sleep 1", code: 143 },
];

test.describe("a developer's own webapp/.env.local", () => {
  for (const e of ENDINGS) {
    test(`survives a rig run that ends in ${e.name}`, () => {
      const c = checkout({ envLocal: MINE });
      try {
        // A second setup.sh call, as the upgrade rig makes mid-run, and its cleanup.
        const r = rig(c, `( cd "${c.root}" && ./setup.sh ) >/dev/null; rig_drop_own_env_local\n${e.end}`);
        expect(r.code, r.out).toBe(e.code);
        expect(r.out).toContain("MID env.local=present");
        expect(readFileSync(join(c.root, "webapp/.env.local"), "utf8")).toBe(MINE);
        expect(r.out).not.toContain("removed the webapp/.env.local");
      } finally {
        rmSync(c.dir, { recursive: true, force: true });
      }
    });
  }
});

test.describe("an .env.local the rig's setup.sh created", () => {
  for (const e of ENDINGS) {
    test(`is gone after a run that ends in ${e.name}`, () => {
      const c = checkout();
      try {
        const r = rig(c, e.end);
        expect(r.code, r.out).toBe(e.code);
        // Removed right after setup.sh, before anything could build with it.
        expect(r.out).toContain("MID env.local=absent");
        expect(existsSync(join(c.root, "webapp/.env.local"))).toBe(false);
      } finally {
        rmSync(c.dir, { recursive: true, force: true });
      }
    });
  }

  test("is gone when setup.sh itself fails after creating it", () => {
    const c = checkout();
    try {
      const r = rig(c, "exit 0", { FAIL_SETUP: "1" });
      expect(r.code, r.out).toBe(1);
      expect(r.out).not.toContain("MID ");
      expect(existsSync(join(c.root, "webapp/.env.local"))).toBe(false);
      expectTemplatesBack(c, r.out);
      // No stack was made, so none is torn down or reported as left over.
      expect(r.out).not.toContain("TORN-DOWN");
      expect(r.out).not.toContain("leftover");
    } finally {
      rmSync(c.dir, { recursive: true, force: true });
    }
  });
});

test.describe("kong.yml and diun.yml in an ordinary checkout", () => {
  for (const e of ENDINGS) {
    test(`are tracked templates again after ${e.name}`, () => {
      const c = checkout({ envLocal: MINE });
      try {
        const r = rig(c, e.end);
        expect(r.code, r.out).toBe(e.code);
        // Protected while the rig's secrets were in them…
        expect(r.out).toContain("MID flags=SS");
        if (e.code !== 0) expect(r.out).not.toContain("END-REACHED");
        // …and handed back as found.
        expectTemplatesBack(c, r.out);
        expect(r.out).toContain("TORN-DOWN");
      } finally {
        rmSync(c.dir, { recursive: true, force: true });
      }
    });
  }
});

test.describe("kong.yml and diun.yml skip-worktree with real secrets (the owner's checkout)", () => {
  for (const e of ENDINGS) {
    test(`keep their flag and their own secrets after ${e.name}`, () => {
      const c = checkout({ envLocal: MINE, skipWorktree: "owners-real-secret" });
      try {
        const r = rig(c, e.end);
        expect(r.code, r.out).toBe(e.code);
        for (const p of GUARDED) expect(flag(c.root, p), r.out).toBe("S");
        expect(readFileSync(join(c.root, "webapp/docker/kong.yml"), "utf8")).toContain("owners-real-secret");
        expect(readFileSync(join(c.root, "webapp/docker/diun/diun.yml"), "utf8")).toContain("owners-real-secret");
        expect(readFileSync(join(c.root, "webapp/docker/diun/diun.yml"), "utf8")).not.toContain("rig-secret");
      } finally {
        rmSync(c.dir, { recursive: true, force: true });
      }
    });
  }
});

test("no rig deletes webapp/.env.local of the checkout it runs in unconditionally", () => {
  // One deletion in all the rigs, and it is the guarded one.
  const rm = /rm -f "\$REPO_ROOT\/webapp\/\.env\.local"/g;
  const hits = readdirSync(RIGS).flatMap((f) =>
    [...readFileSync(join(RIGS, f), "utf8").matchAll(rm)].map(() => f),
  );
  expect(hits).toEqual(["test-rig-common.sh"]);
  const common = readFileSync(join(RIGS, "test-rig-common.sh"), "utf8");
  const drop = common.slice(common.indexOf("rig_drop_own_env_local() {"));
  expect(drop.slice(0, drop.search(rm))).toContain('[ "$RIG_ENV_LOCAL_FOUND" = "0" ]');
  // The guard is taken before setup.sh first runs.
  const prep = common.slice(common.indexOf("rig_prepare_env() {"));
  expect(prep.indexOf("rig_guard_checkout")).toBeGreaterThan(-1);
  expect(prep.indexOf("rig_guard_checkout")).toBeLessThan(prep.indexOf("./setup.sh"));
});

test("the upgrade rig builds beside an .env.local only while .dockerignore keeps it out", () => {
  const upg = readFileSync(join(RIGS, "test-upgrade.sh"), "utf8");
  // The rule the rig relies on, matched the way the rig matches it.
  const rule = /\\\.env\(\\\*\|\\\.local\)/;
  expect(upg).toMatch(rule);
  const ignore = readFileSync(join(REPO, "webapp/.dockerignore"), "utf8").split("\n");
  expect(ignore.some((l) => /^\.env(\*|\.local)$/.test(l))).toBe(true);
  expect(upg).toContain('REFUSING: webapp/.env.local exists and webapp/.dockerignore no longer excludes it.');
});
