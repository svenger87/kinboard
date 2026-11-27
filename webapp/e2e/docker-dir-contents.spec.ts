import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * webapp/docker is the folder every git install lives in: `cd webapp/docker &&
 * ./start.sh up` is how Kinboard is started and updated. Discussion #539
 * showed what a self-hoster sees there with `ls`: next to start.sh, a pile of
 * developer and CI files (test rigs, CI checks, a dev overlay), one of which,
 * test-upgrade.sh, he ran to update and got a throwaway copy of Kinboard
 * instead. The rigs went to scripts/rigs/ (#545, #551); the CI checks went to
 * scripts/ci/, the dev overlay to scripts/dev/, the build's sw.js stamp to
 * webapp/scripts/. What only the published images are built from (the
 * Dockerfile, the entrypoint and the scripts it COPYs, aio/, postgres/) went
 * to webapp/image/ (#539 follow-up); the Diun and Watchtower examples went.
 *
 * This keeps it that way: the folder holds exactly the files below, each with
 * the reason an install needs it. A new file here is red until it is either
 * moved out or added with its reason. The second half checks the other
 * direction: everything an install runs, mounts or builds from is still here,
 * and every image build, here or in webapp/image, finds its files.
 */

const REPO = resolve(__dirname, "../..");
const DOCKER = join(REPO, "webapp/docker");

/** Top-level entries of webapp/docker (directories with a trailing /), and why an install needs each. */
const ALLOWED: Record<string, string> = {
  ".env.example": "the template setup.sh copies to .env",
  "start.sh": "how a git install starts and updates",
  "migrate.sh": "`./start.sh migrate`, and COPYed into the image as its migration runner",
  "migrations/": "the schema, applied by the image and migrate.sh",
  "init.sql": "the base schema, mounted into db, and COPYed into the image",
  "go2rtc.yaml": "mounted into go2rtc",
  "kong.yml":
    "unused since 1.15, but every pre-1.15 install's copy holds its keys (setup.sh wrote them in; skip-worktree on some): " +
    "git refuses a pull that deletes it, which would stop the self-update for good",
  "diun/": "Diun's config and the webhook's hooks, mounted by docker-compose.diun.yml",
  "docker-compose.yml": "the stack",
  "docker-compose.image.yml":
    "named in the COMPOSE_FILES of older installs (prod's among them); Compose aborts on a -f file that is missing",
  "docker-compose.traefik.yml": "overlay named in COMPOSE_FILES",
  "docker-compose.build.yml": "overlay named in COMPOSE_FILES (build from source; builds ../image/Dockerfile)",
  "docker-compose.diun.yml": "overlay named in COMPOSE_FILES (auto-update); used as it is, there is no example to copy",
  "docker-compose.webhook-build.yml":
    "overlay named in COMPOSE_FILES after the Diun overlay, to build the webhook here instead of pulling kinboard-webhook",
  "docker-compose.override.yml.example": "the copy the wiki tells you to make (docker-compose.override.yml is gitignored)",
  "docker-compose.demo.yml.example":
    "the public demo's overlay; the demo host's copy mounts ./ofelia.demo.ini and ./seed-demo.sql from this folder",
  "ofelia.demo.ini": "mounted by the demo host's overlay (./ofelia.demo.ini): moving it leaves Docker an empty directory to mount",
  "seed-demo.sql": "`./start.sh seed-demo`, and mounted by the demo host's overlay (./seed-demo.sql)",
  "Dockerfile.webhook":
    "published as kinboard-webhook and kinboard-updater by docker.yml (context webapp/docker); built on the household's " +
    "machine only by docker-compose.webhook-build.yml, and by an older install's own copy of the Diun overlay",
  "kinboard-self-update.sh": "run by the webhook from this checkout",
  "kinboard-updater.sh": "COPYed by Dockerfile.webhook as the kinboard-updater command (build context webapp/docker)",
  "kinboard-entry.sh": "called by start.sh and by older self-updates after a git pull",
  "test-upgrade.sh": "a stub that tells whoever ran the old rig how to update instead; goes with the 1.18 release",
};

/**
 * webapp/image: what the published images are built from. Not an install's
 * business: a git install only builds from it through docker-compose.build.yml.
 */
const IMAGE_DIR = join(REPO, "webapp/image");

/** Tracked, and untracked-but-not-ignored, files directly under webapp/docker: what a checkout would carry. */
function entries(): string[] {
  const git = (args: string[]) =>
    execFileSync("git", ["-C", REPO, ...args, "--", "webapp/docker"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const files = [...git(["ls-files"]), ...git(["ls-files", "--others", "--exclude-standard"])];
  // Paths git lists for files deleted in the working tree but not yet committed are gone.
  const present = files.filter((f) => existsSync(join(REPO, f)));
  const top = present.map((f) => {
    const rest = f.slice("webapp/docker/".length);
    const slash = rest.indexOf("/");
    return slash === -1 ? rest : rest.slice(0, slash + 1);
  });
  return [...new Set(top)].sort();
}

test("webapp/docker holds only what an install needs", () => {
  const extra = entries().filter((e) => !(e in ALLOWED));
  expect(
    extra,
    "a file no install needs is in webapp/docker: move it to scripts/ci, scripts/dev or scripts/rigs, " +
      "or add it to ALLOWED with the reason an install needs it",
  ).toEqual([]);
});

test("everything on the list is there", () => {
  const have = new Set(entries());
  expect(Object.keys(ALLOWED).filter((e) => !have.has(e))).toEqual([]);
});

test.describe("nothing an install runs, mounts or builds from has left webapp/docker", () => {
  const read = (f: string) => readFileSync(join(DOCKER, f), "utf8");
  const code = (s: string) =>
    s
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");

  test("the compose files' bind mounts from this folder", () => {
    const missing: string[] = [];
    for (const f of readdirSync(DOCKER).filter((n) => /^docker-compose.*\.ya?ml(\.example)?$/.test(n))) {
      const src = code(read(f));
      for (const m of src.matchAll(/^\s*-\s*\.\/([^:\s]+):/gm)) if (!existsSync(join(DOCKER, m[1]))) missing.push(`${f}: ./${m[1]}`);
      for (const m of src.matchAll(/\$\{KINBOARD_PROJECT_DIR[^}]*\}\/webapp\/docker\/([^:\s"]+)/g)) {
        if (m[1].startsWith("data/")) continue; // created at runtime
        if (!existsSync(join(DOCKER, m[1]))) missing.push(`${f}: webapp/docker/${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("the Dockerfiles' sources", () => {
    const missing: string[] = [];
    const copies = (text: string) => [...code(text).matchAll(/^COPY (?!--from)(?:--\S+ )*(.+) \S+$/gm)].flatMap((m) => m[1].split(/\s+/));
    // image/Dockerfile builds from webapp/ (docker-compose.build.yml: context .., docker.yml: context webapp).
    const df = readFileSync(join(IMAGE_DIR, "Dockerfile"), "utf8");
    for (const p of copies(df)) {
      if (!/^(docker|image)\//.test(p)) continue; // package.json and the like: the app itself
      if (!existsSync(join(REPO, "webapp", p))) missing.push(`image/Dockerfile: ${p}`);
    }
    for (const m of code(df).matchAll(/\bsh ((?:docker|image|scripts)\/\S+)/g)) {
      if (!existsSync(join(REPO, "webapp", m[1]))) missing.push(`image/Dockerfile: ${m[1]}`);
    }
    // aio/ and postgres/ build from their own folder.
    for (const sub of ["aio", "postgres"]) {
      for (const p of copies(readFileSync(join(IMAGE_DIR, sub, "Dockerfile"), "utf8"))) {
        if (!existsSync(join(IMAGE_DIR, sub, p))) missing.push(`image/${sub}/Dockerfile: ${p}`);
      }
    }
    // Dockerfile.webhook builds from webapp/docker.
    for (const p of copies(read("Dockerfile.webhook"))) if (!existsSync(join(DOCKER, p))) missing.push(`Dockerfile.webhook: ${p}`);
    expect(missing).toEqual([]);
  });

  test("every build names a Dockerfile and a context that exist", () => {
    const missing: string[] = [];
    // The workflows: context and file are repository paths.
    for (const wf of ["docker.yml", "ci.yml", "rigs.yml"]) {
      const text = readFileSync(join(REPO, ".github/workflows", wf), "utf8");
      for (const m of text.matchAll(/^\s+(context|file): (webapp\/\S+)$/gm)) {
        if (!existsSync(join(REPO, m[2]))) missing.push(`${wf}: ${m[1]} ${m[2]}`);
      }
    }
    // The build-from-source overlay: context relative to webapp/docker, dockerfile relative to the context.
    // The webhook's build overlay: context from KINBOARD_PROJECT_DIR, the checkout's root.
    for (const f of ["docker-compose.build.yml", "docker-compose.webhook-build.yml"]) {
      const src = code(read(f));
      for (const b of src.matchAll(/^\s+build:\n\s+(?:#.*\n\s+)*context: (\S+)\n\s+dockerfile: (\S+)$/gm)) {
        const ctx = b[1].startsWith("${KINBOARD_PROJECT_DIR}/") ? join(REPO, b[1].slice("${KINBOARD_PROJECT_DIR}/".length)) : resolve(DOCKER, b[1]);
        if (!existsSync(ctx)) missing.push(`${f}: context ${b[1]}`);
        if (!existsSync(join(ctx, b[2]))) missing.push(`${f}: dockerfile ${b[2]}`);
      }
      if (!/^\s+build:/m.test(src)) missing.push(`${f}: no build section found`);
    }
    // The scripts that build an image: every -f <path> they name.
    for (const dir of ["scripts/ci", "scripts/rigs"]) {
      for (const f of readdirSync(join(REPO, dir)).filter((n) => n.endsWith(".sh"))) {
        const text = readFileSync(join(REPO, dir, f), "utf8");
        const vars: Record<string, string> = { REPO_ROOT: REPO };
        for (const m of text.matchAll(/^([A-Z_]+_DIR)="\$REPO_ROOT\/([^"]+)"$/gm)) vars[m[1]] = join(REPO, m[2]);
        for (const m of text.matchAll(/-f "\$(?:\{)?([A-Z_]+)\}?\/([^"]*Dockerfile[^"]*)"/g)) {
          if (!(m[1] in vars)) continue;
          if (!existsSync(join(vars[m[1]], m[2]))) missing.push(`${dir}/${f}: -f $${m[1]}/${m[2]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("the image's own files are in webapp/image, not here", () => {
    // What the image COPYs from webapp/docker is what an install also uses
    // (the migrations, their runner, init.sql); everything else it takes from image/.
    const fromDocker = [...code(readFileSync(join(IMAGE_DIR, "Dockerfile"), "utf8")).matchAll(/^COPY (?!--from)(?:--\S+ )*(.+) \S+$/gm)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter((p) => p.startsWith("docker/"));
    expect(fromDocker.sort()).toEqual(["docker/init.sql", "docker/migrate.sh", "docker/migrations/"]);
  });

  test("the files the self-update, its hook and start.sh name", () => {
    const missing: string[] = [];
    for (const f of ["kinboard-self-update.sh", "diun/hooks.yaml"]) {
      for (const m of read(f).matchAll(/webapp\/docker\/([A-Za-z0-9_.\/-]+)/g)) {
        const p = m[1].replace(/[.,)]+$/, "");
        if (p === ".env" || p.startsWith("data/")) continue;
        if (!existsSync(join(DOCKER, p))) missing.push(`${f}: webapp/docker/${p}`);
      }
    }
    // Lines that run something, not the messages it prints (those name ../setup.sh).
    const startSh = code(read("start.sh"))
      .split("\n")
      .filter((l) => !/\becho\b/.test(l))
      .join("\n");
    for (const m of startSh.matchAll(/(?:\bsh |\.\/|< )([A-Za-z0-9_-]+\.(?:sh|sql))\b/g)) {
      if (!existsSync(join(DOCKER, m[1]))) missing.push(`start.sh: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
