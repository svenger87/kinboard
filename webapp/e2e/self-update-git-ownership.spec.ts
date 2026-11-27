import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { Rig, type Service } from "./helpers/self-update-stub";
import { parsePullFailure, pullFixCommand } from "../src/lib/update-status";

/**
 * The self-update runs as root inside the webhook container, and a git install
 * is usually cloned by a normal user. Git refuses a repository someone else
 * owns ("detected dubious ownership"), so on such an install `git fetch`
 * failed at every run: v1.17.0's script stopped there without a word, later
 * ones logged it and exited, and Settings showed nothing. Where root's git did
 * run, every file it wrote became root's, and the household could no longer
 * edit or `git pull` its own checkout.
 *
 * Now every git call names the checkout as safe on its own command line, what
 * root's git wrote goes back to the checkout's owner (exactly that, nothing
 * recursive), a .env an earlier update gave to root is given back, and a git
 * step that fails is recorded for Settings (update_pull).
 *
 * The first half runs as the test's user with a stub `git` that refuses
 * unless the call names the checkout, as git refuses root. The second half
 * runs the script as root through `sudo -n` (passwordless on the CI runner)
 * on a checkout the test's user owns, with the real git.
 */

const STACK: Record<string, Service> = {
  db: { ref: "supabase/postgres:15.14.1.159" },
  rest: { ref: "postgrest/postgrest:v14.16" },
};
const IMAGES: Record<string, string> = {
  "supabase/postgres:15.14.1.159": "sha256:db",
  "postgrest/postgrest:v14.16": "sha256:rest",
};
const RUNNING = {
  db: { ref: "supabase/postgres:15.14.1.159", id: "sha256:db" },
  rest: { ref: "postgrest/postgrest:v14.16", id: "sha256:rest" },
};

const ME = userInfo();
const SUDO = ME.uid !== 0 && spawnSync("sudo", ["-n", "true"]).status === 0;
const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

/**
 * git as root sees it: it refuses unless the call carries
 * `-c safe.directory=<the checkout>`, and logs every call. With
 * $STUB/refuse-always it refuses even then (a checkout git still will not
 * read, whatever the reason).
 */
const STUB_GIT = String.raw`#!/bin/sh
printf '%s\n' "$*" >> "$STUB/git-calls"
ok=""; prev=""
for a in "$@"; do
  if [ "$prev" = -c ]; then
    case "$a" in "safe.directory=$PROJECT_DIR" | "safe.directory=$(cd "$PROJECT_DIR" && pwd -P)") ok=1 ;; esac
  fi
  prev="$a"
done
if [ -f "$STUB/fetch-error" ] && [ -n "$ok" ]; then
  case "$*" in *" fetch "*) cat "$STUB/fetch-error" >&2; exit 128 ;; esac
fi
if [ -z "$ok" ] || [ -f "$STUB/refuse-always" ]; then
  echo "fatal: detected dubious ownership in repository at '$PROJECT_DIR'" >&2
  echo "To add an exception for this directory, call:" >&2
  exit 128
fi
exec "$REAL_GIT" "$@"
`;

/** chown as it is, with every call logged; a recursive one fails the run loudly. */
const STUB_CHOWN = String.raw`#!/bin/sh
printf '%s\n' "$*" >> "$STUB/chown-calls"
for a in "$@"; do case "$a" in -R | --recursive | -*R*) echo "recursive chown: $*" >> "$STUB/chown-recursive"; exit 1 ;; esac; done
exec /bin/chown "$@"
`;

/**
 * A rig with a release on origin that changes one file and adds one in a new
 * folder. `base`: more files in the checkout's commit, by path.
 */
function rigWithRelease(base: Record<string, string> = {}) {
  const r = new Rig({ stack: STACK, containers: RUNNING, images: IMAGES });
  writeFileSync(join(r.proj, "webapp", "docker", "init.sql"), "-- 1\n");
  for (const [path, content] of Object.entries(base)) writeFileSync(join(r.proj, path), content);
  git(r.proj, "add", "-A");
  git(r.proj, "commit", "-qm", "init.sql");
  git(r.proj, "push", "-q", "origin", "main");
  git(r.dir, "clone", "-q", join(r.dir, "origin.git"), "pusher2");
  const pusher = join(r.dir, "pusher2");
  writeFileSync(join(pusher, "webapp", "docker", "init.sql"), "-- 2\n");
  mkdirSync(join(pusher, "webapp", "docker", "migrations", "new"), { recursive: true });
  writeFileSync(join(pusher, "webapp", "docker", "migrations", "new", "095_x.sql"), "select 1;\n");
  git(pusher, "add", "-A");
  git(pusher, "commit", "-qm", "release");
  git(pusher, "push", "-q", "origin", "main");
  return r;
}

function withStubGit(r: Rig) {
  const bin = join(r.dir, "bin");
  writeFileSync(join(bin, "git"), STUB_GIT.replace('"$REAL_GIT"', REAL_GIT));
  chmodSync(join(bin, "git"), 0o755);
}

function withStubChown(r: Rig) {
  const bin = join(r.dir, "bin");
  writeFileSync(join(bin, "chown"), STUB_CHOWN);
  chmodSync(join(bin, "chown"), 0o755);
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const writes = (r: Rig) =>
  read(join(r.stub, "writes"))
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ key: l.slice(0, l.indexOf(" ")), value: JSON.parse(l.slice(l.indexOf(" ") + 1)) as Record<string, unknown> }));

const sudo = (...args: string[]) => execFileSync("sudo", ["-n", ...args], { encoding: "utf8" }).trim();
/**
 * The run as root. The rig's origin is a folder, which root's git would refuse
 * to fetch from as well when the test's user owns it (a household's origin is
 * GitHub). So the origin is given to root; the checkout stays the test's
 * user's.
 */
const asRoot = (r: Rig) => {
  sudo("chown", "-R", "0:0", join(r.dir, "origin.git"));
  return r.run([], {}, { asRoot: true });
};

const owner = (p: string) => {
  const s = statSync(p);
  return `${s.uid}:${s.gid}`;
};
const mine = `${ME.uid}:${ME.gid}`;

test.describe("git as root sees it: a checkout another user owns", () => {
  test("every git call names the checkout as safe, so the update goes through", () => {
    const r = rigWithRelease();
    withStubGit(r);
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("=== self-update done ===");
      expect(git(r.proj, "rev-parse", "HEAD")).toBe(git(r.proj, "rev-parse", "origin/main"));
      const calls = read(join(r.stub, "git-calls")).split("\n").filter(Boolean);
      // fetch, rev-parse, pull, diff and the rest, not just the first one
      expect(calls.length).toBeGreaterThan(5);
      for (const c of ["fetch origin main", "pull --ff-only origin main", "rev-parse HEAD", "ls-files"]) {
        expect(calls.some((l) => l.includes(c)), c).toBe(true);
      }
      const missing = calls.filter((l) => !l.includes(`safe.directory=${r.proj}`));
      expect(missing, "git calls without the checkout's safe.directory").toEqual([]);
      // Only this checkout, never every repository.
      expect(calls.some((l) => l.includes("safe.directory=*"))).toBe(false);
    } finally {
      r.cleanup();
    }
  });

  test("a checkout git still refuses is reported to Settings, with the fix, and the run stops", () => {
    const r = rigWithRelease();
    withStubGit(r);
    writeFileSync(join(r.stub, "refuse-always"), "");
    try {
      const res = r.run();
      expect(res.status, res.out).toBe(1);
      expect(res.log).toContain("=== self-update skipped: git fetch failed (fatal: detected dubious ownership");
      expect(res.pulls, "nothing pulled").toBe(0);
      const rec = writes(r).find((w) => w.key === "update_pull");
      expect(rec, "an update_pull record").toBeTruthy();
      expect(rec!.value).toMatchObject({ status: "pull_failed", kind: "ownership", dir: r.proj });
      expect(String(rec!.value.detail)).toContain("dubious ownership");
      // What Settings makes of it.
      const p = parsePullFailure(JSON.stringify(rec!.value))!;
      expect(p.kind).toBe("ownership");
      expect(pullFixCommand(p)).toBe(`cd ${r.proj} && git pull --ff-only origin main && cd webapp/docker && ./start.sh up`);

      // Once git reads the checkout again, the next run clears it.
      execFileSync("rm", [join(r.stub, "refuse-always")]);
      const again = r.run();
      expect(again.status, again.out).toBe(0);
      expect(again.calls.some((c) => c.includes("DELETE FROM public.instance_settings WHERE key = 'update_pull'"))).toBe(true);
    } finally {
      r.cleanup();
    }
  });

  test("a remote that refuses the key is a fetch problem, not the folder's", () => {
    const r = rigWithRelease();
    withStubGit(r);
    try {
      for (const [msg, kind] of [
        ["git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.", "fetch"],
        ["error: cannot open '.git/FETCH_HEAD': Permission denied", "permission"],
        ["fatal: unable to access 'https://github.com/svenger87/kinboard.git/': Could not resolve host: github.com", "fetch"],
      ]) {
        writeFileSync(join(r.stub, "fetch-error"), `${msg}\n`);
        const res = r.run();
        expect(res.status, res.out).toBe(1);
        const rec = writes(r).find((w) => w.key === "update_pull");
        expect(rec?.value.kind, msg).toBe(kind);
      }
    } finally {
      r.cleanup();
    }
  });

  // #589: git's message went to Settings as git printed it. On an
  // authentication error that is the remote's URL, a token in it when origin
  // has one; and a .env value it quotes is a secret like any other.
  test("git's message is cleaned like a log excerpt: credentials in the URL and the .env's values taken out", () => {
    const r = rigWithRelease();
    withStubGit(r);
    r.addEnv("BRING_PASSWORD=bring-secret-value");
    try {
      writeFileSync(
        join(r.stub, "fetch-error"),
        "fatal: unable to access 'https://svenger:ghp_Tok3nValue123@github.com/svenger87/kinboard.git/' (bring-secret-value): The requested URL returned error: 403\n",
      );
      const res = r.run();
      expect(res.status, res.out).toBe(1);
      const rec = writes(r).find((w) => w.key === "update_pull");
      expect(rec, "an update_pull record").toBeTruthy();
      const detail = String(rec!.value.detail);
      expect(detail).not.toContain("ghp_Tok3nValue123");
      expect(detail).not.toContain("svenger:");
      expect(detail).not.toContain("bring-secret-value");
      expect(detail).toBe("fatal: unable to access 'https://[redacted]@github.com/svenger87/kinboard.git/' ([redacted]): The requested URL returned error: 403");
      expect(rec!.value.kind).toBe("fetch");
    } finally {
      r.cleanup();
    }
  });

  test("a pull that local edits stop is reported too, naming the files", () => {
    const r = rigWithRelease();
    try {
      writeFileSync(join(r.proj, "webapp", "docker", "init.sql"), "-- my own edit\n");
      const res = r.run();
      expect(res.log).toContain("WARN: git still behind");
      const rec = writes(r).find((w) => w.key === "update_pull");
      expect(rec, "an update_pull record").toBeTruthy();
      expect(rec!.value).toMatchObject({ status: "pull_failed", kind: "pull", detail: "webapp/docker/init.sql", stack: "legacy" });
      expect(pullFixCommand(parsePullFailure(JSON.stringify(rec!.value))!)).toBe(
        `cd ${r.proj} && git checkout -- webapp/docker/init.sql && git pull --ff-only origin main`,
      );
    } finally {
      r.cleanup();
    }
  });
});

test("the other scripts that run git name the checkout too, and none trusts every repository", () => {
  // Lines that run git: not comments, not text printed for a person.
  const runsGit = (file: string) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter(
        (l) =>
          !/^\s*#/.test(l) &&
          !/^\s*(echo|printf|log)\b/.test(l) &&
          // A git command, not the word in a message ("A git install and …" in a
          // multi-line warning matched the bare `git\s` before).
          /(^|[\s($`])git\s+(-[cC]\b|(fetch|pull|push|rev-parse|diff|checkout|ls-files|status|log|describe|config|show|merge|reset|stash|clean|cat-file|update-index|remote|branch|tag|symbolic-ref|for-each-ref|clone|init|add|commit)\b)/.test(
            l,
          ),
      );
  const start = runsGit("docker/start.sh");
  expect(start.length, "start.sh reads the revision with git").toBeGreaterThan(0);
  for (const l of start) expect(l, "start.sh").toContain('safe.directory="$CHECKOUT_DIR"');
  expect(runsGit("docker/kinboard-entry.sh"), "kinboard-entry.sh runs no git").toEqual([]);
  expect(runsGit("../setup.sh"), "setup.sh runs no git").toEqual([]);
  // The self-update: git only through its git() function, never around it.
  const su = readFileSync("docker/kinboard-self-update.sh", "utf8")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  expect(su.match(/command git /g)?.length, "only inside git()").toBe(2);
  expect(su).not.toMatch(/\/usr\/bin\/git|safe\.directory=?'?\*/);
  expect(su).not.toMatch(/git config --global/);
});

test.describe("as root, on a checkout the household owns", () => {
  test.skip(!SUDO, "needs root: passwordless sudo, as on the CI runner");

  test("what the pull wrote, and .git, go back to the owner; nothing else, and nothing recursive", () => {
    const r = rigWithRelease();
    withStubChown(r);
    const docker = join(r.proj, "webapp", "docker");
    try {
      // A data folder a container wrote: root's, and none of the update's business.
      mkdirSync(join(docker, "data"), { recursive: true });
      sudo("sh", "-c", `mkdir -p '${docker}/data/db' && echo x > '${docker}/data/db/PG_VERSION'`);
      const res = asRoot(r);
      expect(res.status, res.out).toBe(0);
      expect(git(r.proj, "rev-parse", "HEAD")).toBe(git(r.proj, "rev-parse", "origin/main"));

      expect(owner(join(docker, "init.sql")), "a changed file").toBe(mine);
      expect(owner(join(docker, "migrations", "new", "095_x.sql")), "a new file").toBe(mine);
      expect(owner(join(docker, "migrations", "new")), "a folder the pull made").toBe(mine);
      expect(owner(join(docker, "migrations")), "a folder the pull made").toBe(mine);
      expect(res.log).toMatch(/gave \d+ file\(s\) the pull wrote back to/);

      // .git: nothing of git's own is root's any more (this script's state files aside).
      const rootInGit = sudo("find", join(r.proj, ".git"), "-user", "0", "!", "-name", "kinboard-*")
        .split("\n")
        .filter(Boolean);
      expect(rootInGit).toEqual([]);
      // ...so the household's own git can write there: objects, refs, logs.
      git(r.proj, "commit", "-q", "--allow-empty", "-m", "the household's own");
      git(r.proj, "reset", "-q", "--hard", "HEAD~1");

      // Not handed: the container's data.
      expect(owner(join(docker, "data", "db")), "data folder untouched").toBe("0:0");
      expect(owner(join(docker, "data", "db", "PG_VERSION"))).toBe("0:0");
      expect(read(join(r.stub, "chown-recursive")), "no recursive chown").toBe("");
      const chowns = read(join(r.stub, "chown-calls")).split("\n").filter(Boolean);
      expect(chowns.length).toBeGreaterThan(0);
      expect(chowns.some((c) => c.includes("/data/"))).toBe(false);
    } finally {
      r.cleanup();
    }
  });

  test("a .env an earlier update gave to root goes back, once, at most 0640", () => {
    const r = rigWithRelease();
    const env = join(r.proj, "webapp", "docker", ".env");
    try {
      sudo("chown", "0:0", env);
      sudo("chmod", "0644", env);
      const res = asRoot(r);
      expect(res.status, res.out).toBe(0);
      expect(owner(env)).toBe(mine);
      expect(statSync(env).mode & 0o7777).toBe(0o640);
      expect(res.log).toContain("webapp/docker/.env belonged to root");
      expect(res.log).toContain("mode 644 → 640");
      const second = asRoot(r);
      expect(second.log).not.toContain("webapp/docker/.env belonged to root");
      expect(owner(env)).toBe(mine);
    } finally {
      r.cleanup();
    }
  });

  test("a .env at 0600 stays 0600", () => {
    const r = rigWithRelease();
    const env = join(r.proj, "webapp", "docker", ".env");
    try {
      sudo("chown", "0:0", env);
      sudo("chmod", "0600", env);
      const res = asRoot(r);
      expect(res.status, res.out).toBe(0);
      expect(owner(env)).toBe(mine);
      expect(statSync(env).mode & 0o7777).toBe(0o600);
    } finally {
      r.cleanup();
    }
  });

  test("a .env that is a symlink out of the checkout is not followed", () => {
    const r = rigWithRelease();
    const env = join(r.proj, "webapp", "docker", ".env");
    const outside = join(r.dir, "outside-root-file");
    try {
      sudo("sh", "-c", `echo SECRET=1 > '${outside}' && chown 0:0 '${outside}' && chmod 600 '${outside}' && rm -f '${env}' && ln -s '${outside}' '${env}'`);
      const res = asRoot(r);
      expect(res.status, res.out).toBe(0);
      expect(owner(outside), "root's chown stays inside the checkout").toBe("0:0");
      expect(res.log).not.toContain("webapp/docker/.env belonged to root");
    } finally {
      r.cleanup();
    }
  });

  test("a skip-worktree file holding keys keeps its owner", () => {
    const r = rigWithRelease({ "webapp/docker/kong.yml": "placeholder\n" });
    const kong = join(r.proj, "webapp", "docker", "kong.yml");
    try {
      git(r.proj, "update-index", "--skip-worktree", "webapp/docker/kong.yml");
      sudo("sh", "-c", `echo REAL-KEY > '${kong}' && chown 0:0 '${kong}' && chmod 600 '${kong}'`);
      const res = asRoot(r);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("pulled");
      expect(owner(kong)).toBe("0:0");
      expect(statSync(kong).mode & 0o7777).toBe(0o600);
      expect(sudo("cat", kong)).toBe("REAL-KEY");
    } finally {
      r.cleanup();
    }
  });

  test("a checkout root owns (Unraid) is unchanged: no chown at all", () => {
    const r = rigWithRelease();
    withStubChown(r);
    try {
      sudo("chown", "-R", "0:0", r.proj);
      const res = asRoot(r);
      expect(res.status, res.out).toBe(0);
      expect(res.log).toContain("pulled");
      expect(res.log).not.toContain("back to");
      expect(read(join(r.stub, "chown-calls")), "no chown").toBe("");
      expect(owner(join(r.proj, "webapp", "docker", "init.sql"))).toBe("0:0");
      expect(owner(join(r.proj, "webapp", "docker", ".env"))).toBe("0:0");
    } finally {
      sudo("chown", "-R", `${ME.uid}`, r.dir);
      r.cleanup();
    }
  });
});
