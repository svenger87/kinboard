import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A git install follows main: the self-update runs `git pull --ff-only origin
 * main`, and the docs say `git pull`. But it runs the STABLE images
 * (KINBOARD_TAG defaults to `latest`). So main's compose files have to work
 * with what the current stable release published.
 *
 * #582 broke that: docker-compose.diun.yml started pulling
 * ghcr.io/svenger87/kinboard-webhook:latest, which only the next stable
 * release publishes, with no build to fall back on. Every git install that
 * pulled main lost its webhook and Diun (#539: "manifest unknown").
 *
 * The guard resolves the image of every service in the git-install compose
 * files (docker-compose.yml and its overlays), with the default .env, and
 * requires each of our own images to be published by the latest stable tag's
 * docker.yml, or buildable, or covered by start.sh's webhook fallback (a
 * sha- build of main that docker.yml published). Third-party images are not
 * ours to publish and are left alone. compose.yml, the one-file install, is
 * not one of these files: it needs 1.18 images by design (kinboard-init) and
 * says so when it runs an older one.
 *
 * Then the fallback itself: start.sh's prepare_webhook against a stub docker.
 */

const WEBAPP = join(__dirname, "..");
const REPO = join(WEBAPP, "..");
const DOCKER = join(WEBAPP, "docker");
const OURS = "ghcr.io/svenger87/";

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** The newest vX.Y.Z tag. CI's Specs job checks out with full history and tags for this. */
function stableTag(): string {
  const tags = git("tag", "-l", "v*")
    .split("\n")
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .sort((a, b) => {
      const pa = a.slice(1).split(".").map(Number);
      const pb = b.slice(1).split(".").map(Number);
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
    });
  if (!tags.length) throw new Error("no vX.Y.Z tag in this checkout: fetch tags (CI: fetch-depth: 0)");
  return tags[tags.length - 1];
}

/** The images a docker.yml publishes (its *_IMAGE_NAME env), as ghcr.io/<owner>/<name>. */
function publishedBy(dockerYml: string): Set<string> {
  const names = [...dockerYml.matchAll(/^\s+[A-Z_]*IMAGE_NAME:\s*\$\{\{\s*github\.repository_owner\s*\}\}\/([a-z0-9-]+)\s*$/gm)].map(
    (m) => `${OURS}${m[1]}`,
  );
  return new Set(names);
}

/** Every service's image and whether it can be built, as Compose resolves them with the default .env. */
function resolve(files: string[], extraEnv: Record<string, string> = {}): Record<string, { image: string; buildable: boolean }> {
  const json = execFileSync(
    "docker",
    ["compose", "--env-file", ".env.example", ...files.flatMap((f) => ["-f", f]), "config", "--format", "json"],
    // A clean environment: a KINBOARD_TAG in the shell must not stand in for the default.
    // KINBOARD_PROJECT_DIR is what setup.sh writes into .env.
    {
      cwd: DOCKER,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", KINBOARD_PROJECT_DIR: "/opt/kinboard", NODE_ENV: process.env.NODE_ENV, ...extraEnv } as NodeJS.ProcessEnv,
    },
  );
  const services = JSON.parse(json).services as Record<string, { image?: string; build?: unknown }>;
  return Object.fromEntries(Object.entries(services).map(([svc, s]) => [svc, { image: s.image ?? "", buildable: s.build !== undefined }]));
}

/** start.sh's webhook fallback: the published repository and the pinned sha- build, as the script sets them. */
function startShFallback(startSh: string): { repo?: string; pinned?: string } {
  const repo = /^WEBHOOK_PUBLISHED=(\S+)$/m.exec(startSh)?.[1];
  const pinnedRaw = /^WEBHOOK_PINNED_REF="?\$WEBHOOK_PUBLISHED:(sha-[0-9a-f]{7,})"?$/m.exec(startSh)?.[1];
  return { repo, pinned: repo && pinnedRaw ? `${repo}:${pinnedRaw}` : undefined };
}

/**
 * The problems with these compose files against what `stable` publishes;
 * empty when a git install on main runs.
 */
function problems(
  resolved: Record<string, { image: string; buildable: boolean }>,
  stablePublishes: Set<string>,
  fallback: { repo?: string; pinned?: string },
  mainPublishes: Set<string>,
  commitExists: (sha: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const [svc, { image, buildable }] of Object.entries(resolved)) {
    if (buildable || !image.startsWith(OURS)) continue;
    const repo = image.replace(/[:@].*$/, "");
    if (stablePublishes.has(repo)) continue;
    // Not published by the stable release: only the webhook has a way around that.
    if (svc === "webhook" && fallback.repo === repo && fallback.pinned) {
      const sha = fallback.pinned.split(":sha-")[1];
      if (mainPublishes.has(repo) && commitExists(sha)) continue;
      out.push(`${svc}: start.sh's fallback ${fallback.pinned} names no build of main that published ${repo}`);
      continue;
    }
    out.push(`${svc}: ${image} is neither published by the stable release nor buildable, and start.sh has no fallback for it`);
  }
  return out;
}

const FILE_SETS = [
  ["docker-compose.yml"],
  ["docker-compose.yml", "docker-compose.image.yml"],
  ["docker-compose.yml", "docker-compose.image.yml", "docker-compose.diun.yml"],
  ["docker-compose.yml", "docker-compose.image.yml", "docker-compose.traefik.yml", "docker-compose.diun.yml"],
  ["docker-compose.yml", "docker-compose.diun.yml", "docker-compose.webhook-build.yml"],
];

/** Whether the commit's docker.yml published the webhook (so its main build pushed kinboard-webhook:sha-<it>). */
function commitPublishes(repo: string) {
  return (sha: string) => {
    try {
      return publishedBy(git("show", `${sha}:.github/workflows/docker.yml`)).has(repo);
    } catch {
      return false;
    }
  };
}

test.describe("main's git-install compose files run on the stable release's images", () => {
  const stable = stableTag();
  const stablePublishes = publishedBy(git("show", `${stable}:.github/workflows/docker.yml`));
  const mainPublishes = publishedBy(readFileSync(join(REPO, ".github/workflows/docker.yml"), "utf8"));
  const startSh = readFileSync(join(DOCKER, "start.sh"), "utf8");
  const fallback = startShFallback(startSh);

  test(`the stable release (${stable}) publishes the webapp`, () => {
    // A sanity check on the parsing: an empty set would make every check below vacuous.
    expect([...stablePublishes]).toContain(`${OURS}kinboard`);
  });

  for (const files of FILE_SETS) {
    test(files.join(" + "), () => {
      const resolved = resolve(files);
      expect(problems(resolved, stablePublishes, fallback, mainPublishes, commitPublishes(`${OURS}kinboard-webhook`))).toEqual([]);
    });
  }

  test("the pinned fallback is a sha- build of main that published kinboard-webhook", () => {
    expect(fallback.repo).toBe(`${OURS}kinboard-webhook`);
    expect(fallback.pinned).toMatch(/:sha-[0-9a-f]{7}$/);
    expect(commitPublishes(`${OURS}kinboard-webhook`)(fallback.pinned!.split(":sha-")[1])).toBe(true);
  });

  test("red: #582's state (the published webhook, no fallback in start.sh) fails", () => {
    const resolved = resolve(["docker-compose.yml", "docker-compose.image.yml", "docker-compose.diun.yml"]);
    // 1.17.0's docker.yml published only the webapp.
    const v117 = publishedBy(git("show", "v1.17.0:.github/workflows/docker.yml"));
    const found = problems(resolved, v117, {}, mainPublishes, commitPublishes(`${OURS}kinboard-webhook`));
    expect(found).toEqual([
      "webhook: ghcr.io/svenger87/kinboard-webhook:latest is neither published by the stable release nor buildable, and start.sh has no fallback for it",
    ]);
    // A pin to a commit that never published the webhook is no way out either.
    const bad = problems(resolved, v117, { repo: `${OURS}kinboard-webhook`, pinned: `${OURS}kinboard-webhook:sha-0000000` }, mainPublishes, commitPublishes(`${OURS}kinboard-webhook`));
    expect(bad).toHaveLength(1);
  });

  test("once a stable release publishes kinboard-webhook, no fallback is needed", () => {
    const resolved = resolve(["docker-compose.yml", "docker-compose.image.yml", "docker-compose.diun.yml"]);
    expect(problems(resolved, mainPublishes, {}, mainPublishes, () => false)).toEqual([]);
  });
});

/**
 * prepare_webhook, run on its own against a stub `docker`. The stub knows
 * which images are on the machine ($LOCAL) and which a registry has
 * ($REGISTRY); `compose pull webhook` succeeds only for a ref in $REGISTRY.
 */
function prepare(opts: { want: string; local?: string[]; registry?: string[] }) {
  const dir = mkdtempSync(join(tmpdir(), "prepare-webhook-"));
  const calls = join(dir, "calls");
  writeFileSync(calls, "");
  const fn = (name: string) => `eval "$(sed -n '/^${name}() {/,/^}$/p' "$1")"`;
  try {
    const out = execFileSync(
      "bash",
      [
        "-c",
        `set -euo pipefail
         COMPOSE="docker compose"; COMPOSE_FILES="-f docker-compose.yml -f docker-compose.diun.yml"
         eval "$(grep -E '^WEBHOOK_(PUBLISHED|PINNED_REF)=' "$1")"
         has() { case " $1 " in *" $2 "*) return 0 ;; esac; return 1; }
         docker() {
           echo "docker $*" >> "$CALLS"
           case "$*" in
             *"config --services"*) printf '%s\\n' db rest webapp cron diun webhook ;;
             *"config --images webhook"*) echo "$WANT" ;;
             *"pull --ignore-buildable webhook"*) has "$REGISTRY" "$WANT" ;;
             "image inspect "*) has "$LOCAL" "$3" ;;
             "pull -q "*) has "$REGISTRY" "$3" && LOCAL="$LOCAL $3" ;;
             *) return 0 ;;
           esac
         }
         ${fn("webhook_fallback_refs")}
         ${fn("prepare_webhook")}
         prepare_webhook >/dev/null 2>&1
         echo "up_services=[$up_services] image=[\${KINBOARD_WEBHOOK_IMAGE:-}] tag=[\${KINBOARD_WEBHOOK_TAG:-}]"`,
        "_",
        join(DOCKER, "start.sh"),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, CALLS: calls, WANT: opts.want, LOCAL: (opts.local ?? []).join(" "), REGISTRY: (opts.registry ?? []).join(" ") },
      },
    );
    return { out: out.trim(), calls: readFileSync(calls, "utf8").split("\n").filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.describe("start.sh up: the webhook when its image can't be fetched", () => {
  const startSh = readFileSync(join(DOCKER, "start.sh"), "utf8");
  const { pinned } = startShFallback(startSh);
  const HOOK = `${OURS}kinboard-webhook`;

  test("published: the files' own image, nothing else", () => {
    const r = prepare({ want: `${HOOK}:latest`, registry: [`${HOOK}:latest`] });
    expect(r.out).toBe("up_services=[] image=[] tag=[]");
    expect(r.calls.filter((c) => c.startsWith("docker pull"))).toEqual([]);
  });

  test("not published, and nothing on the machine (#539): the pinned build of main, with Diun", () => {
    const r = prepare({ want: `${HOOK}:latest`, registry: [pinned!] });
    expect(r.out).toBe(`up_services=[] image=[${HOOK}] tag=[${pinned!.slice(pinned!.lastIndexOf(":") + 1)}]`);
  });

  test("not published, a 1.17 install's own kinboard-webhook:local: that one, nothing pulled", () => {
    const r = prepare({ want: `${HOOK}:latest`, local: ["kinboard-webhook:local"], registry: [pinned!] });
    expect(r.out).toBe("up_services=[] image=[kinboard-webhook] tag=[local]");
    expect(r.calls.filter((c) => c.startsWith("docker pull"))).toEqual([]);
  });

  test("a KINBOARD_TAG pinned to a version without a webhook image: the published latest first", () => {
    const r = prepare({ want: `${HOOK}:1.17.0`, local: ["kinboard-webhook:local"], registry: [`${HOOK}:latest`, pinned!] });
    expect(r.out).toBe(`up_services=[] image=[${HOOK}] tag=[latest]`);
  });

  test("the files' image already on the machine (offline): that one", () => {
    const r = prepare({ want: `${HOOK}:latest`, local: [`${HOOK}:latest`] });
    expect(r.out).toBe("up_services=[] image=[] tag=[]");
  });

  test("nothing anywhere (offline, first start): the rest starts without the webhook and Diun", () => {
    const r = prepare({ want: `${HOOK}:latest` });
    expect(r.out).toBe("up_services=[db rest webapp cron ] image=[] tag=[]");
    // kinboard-webhook:local is never looked for on a registry.
    expect(r.calls.some((c) => c === "docker pull -q kinboard-webhook:local")).toBe(false);
  });
});
