import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Rig, type Service } from "./helpers/self-update-stub";

/**
 * Until 1.18 the wiki, the overlay's own header and our reply in discussion
 * #539 said `cp docker-compose.diun.yml.example docker-compose.diun.yml`. Both
 * files were tracked, so that cp left a local edit in a tracked file, and git
 * refuses a fast-forward that changes such a file, even when the copy is
 * byte for byte what it would write. The self-update then logged "git still
 * behind" and stayed on the old compose files at every run after.
 *
 * 1.18 makes docker-compose.diun.yml the only file and deletes the example.
 * The self-update now puts back a tracked file whose content is exactly a
 * version this repository has shipped at that path or at that path plus
 * .example (nobody's own edit), keeps a copy in .git, and pulls. A real edit
 * is left alone, and the log names the file and the command.
 *
 * Same harness as the other self-update specs: the whole script, a real git
 * checkout, a stub docker (helpers/self-update-stub.ts).
 */

const STACK: Record<string, Service> = { rest: { ref: "postgrest/postgrest:v14.16" } };
const IMAGES: Record<string, string> = { "postgrest/postgrest:v14.16": "sha256:rest" };
const RUNNING = { rest: { ref: "postgrest/postgrest:v14.16", id: "sha256:rest" } };

const OVERLAY = "webapp/docker/docker-compose.diun.yml";
const EXAMPLE = `${OVERLAY}.example`;
const KONG = "webapp/docker/kong.yml";
const OLD_EXAMPLE = "services:\n  webhook:\n    logging:\n      driver: json-file\n";
const NEW_OVERLAY = "services:\n  webhook:\n    build:\n      context: ${KINBOARD_PROJECT_DIR}/webapp/docker\n    logging:\n      driver: json-file\n";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

/**
 * A checkout that once shipped the example beside the overlay, and an origin
 * whose next commit makes the overlay the only file (with new content) and
 * deletes the example. `local` is what the household's overlay holds.
 */
function setup(local: string, kong = false) {
  const r = new Rig({ stack: STACK, containers: RUNNING, images: IMAGES });
  writeFileSync(join(r.proj, EXAMPLE), OLD_EXAMPLE);
  if (kong) writeFileSync(join(r.proj, KONG), "placeholder\n");
  git(r.proj, "add", "-A");
  git(r.proj, "commit", "-qm", "ship the example");
  git(r.proj, "push", "-q", "origin", "main");
  git(r.dir, "clone", "-q", join(r.dir, "origin.git"), "pusher2");
  const pusher = join(r.dir, "pusher2");
  writeFileSync(join(pusher, OVERLAY), NEW_OVERLAY);
  rmSync(join(pusher, EXAMPLE));
  git(pusher, "add", "-A");
  git(pusher, "commit", "-qm", "one overlay");
  git(pusher, "push", "-q", "origin", "main");
  writeFileSync(join(r.proj, OVERLAY), local);
  if (kong) {
    git(r.proj, "update-index", "--skip-worktree", KONG);
    writeFileSync(join(r.proj, KONG), "REAL-KEY\n");
  }
  return r;
}

test("a copy of the old example over the overlay is put back, and the pull goes through", () => {
  const r = setup(OLD_EXAMPLE);
  try {
    const res = r.run();
    expect(res.status, res.out).toBe(0);
    expect(res.log).toContain(`put back ${OVERLAY}`);
    expect(res.log).toContain("after clearing collisions");
    expect(git(r.proj, "rev-parse", "HEAD")).toBe(git(r.proj, "rev-parse", "origin/main"));
    expect(readFileSync(join(r.proj, OVERLAY), "utf8")).toBe(NEW_OVERLAY);
    expect(existsSync(join(r.proj, EXAMPLE))).toBe(false);
    expect(git(r.proj, "status", "--porcelain", "--", "webapp/docker")).toBe("");
    // The copy is kept, in .git where no pull reaches it.
    const kept = readdirSync(join(r.proj, ".git", "kinboard-local-copies"));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(r.proj, ".git", "kinboard-local-copies", kept[0]), "utf8")).toBe(OLD_EXAMPLE);
  } finally {
    r.cleanup();
  }
});

test("a copy that already equals the new overlay is put back too (git refuses it all the same)", () => {
  const r = setup(NEW_OVERLAY);
  try {
    const res = r.run();
    expect(res.status, res.out).toBe(0);
    expect(git(r.proj, "rev-parse", "HEAD")).toBe(git(r.proj, "rev-parse", "origin/main"));
    expect(readFileSync(join(r.proj, OVERLAY), "utf8")).toBe(NEW_OVERLAY);
  } finally {
    r.cleanup();
  }
});

test("an edit of the household's own is left alone, and the log says what to do", () => {
  const own = OLD_EXAMPLE + "    ports:\n      - 9000:9000\n";
  const r = setup(own);
  try {
    const before = git(r.proj, "rev-parse", "HEAD");
    const res = r.run();
    expect(res.log).not.toContain("put back");
    expect(res.log).toContain("git still behind");
    expect(res.log).toContain(`these files have local edits that this release changes too: ${OVERLAY}`);
    expect(res.log).toContain(`checkout -- ${OVERLAY}`);
    expect(git(r.proj, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(r.proj, OVERLAY), "utf8")).toBe(own);
  } finally {
    r.cleanup();
  }
});

test("a skip-worktree file holding keys is left as it is", () => {
  // kong.yml and diun/diun.yml on prod: skip-worktree, with real keys.
  const r = setup(OLD_EXAMPLE, true);
  try {
    const res = r.run();
    expect(res.status, res.out).toBe(0);
    expect(git(r.proj, "rev-parse", "HEAD")).toBe(git(r.proj, "rev-parse", "origin/main"));
    expect(readFileSync(join(r.proj, KONG), "utf8")).toBe("REAL-KEY\n");
    expect(git(r.proj, "ls-files", "-v", "--", KONG)).toMatch(/^S /);
    expect(readdirSync(join(r.proj, ".git", "kinboard-local-copies"))).toHaveLength(1);
  } finally {
    r.cleanup();
  }
});
