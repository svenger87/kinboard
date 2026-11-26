import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import {
  COMPOSE_REVISIONS,
  LATEST_COMPOSE_REVISION,
  REQUIRED_COMPOSE_REVISION,
  composeRevisionStatus,
  parseComposeRevision,
  type ComposeRevision,
} from "../src/lib/compose-revision";

/** Imported dynamically: Playwright's require hook mangles a statically imported .mjs (see secrets-store.spec.ts). */
interface ReleaseModule {
  releaseCompose(text: string, o: { tag: string; image: string; repo?: string }): { text: string; channel: string; revision: number };
}
const releaseModule: Promise<ReleaseModule> = import("../../scripts/release-compose.mjs");

/**
 * The one-file compose.yml at the repository root (RFC-023 §4.6), the file
 * every new install will run:
 *
 *   - it pastes into the Compose UIs of §4.6 (OMV, Portainer, Unraid's
 *     Compose Manager, Dockge, CasaOS) and starts with no .env and no repo;
 *   - it is wired the way the RFC says (secrets store, one-shots, conditions);
 *   - its image names come from docker.yml, and its shared services match the
 *     legacy file's (§10: two files to keep in step);
 *   - KINBOARD_COMPOSE_REVISION and the Settings notice;
 *   - the release asset made from it.
 *
 * Each lint is also run against a broken copy, which must fail it.
 */

const WEBAPP = join(__dirname, "..");
const REPO = join(WEBAPP, "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const COMPOSE = read("compose.yml");
const LEGACY = read("webapp/docker/docker-compose.yml");

type Service = Record<string, any>;
type ComposeFile = { services: Record<string, Service>; volumes?: Record<string, any>; networks?: Record<string, any>; [k: string]: unknown };

const load = (text: string) => yaml.load(text) as ComposeFile;

/**
 * The optional variables compose.yml may use: §4.6's table, plus the image's
 * name for a mirror, PUID/PGID for NAS folders (RFC-024 §6.3) and the
 * operator family. The secrets of an install moving to this file (§5.2) are
 * KINBOARD_-prefixed: OMV and Dockge hand every stack a shared global.env,
 * where another app's POSTGRES_PASSWORD would otherwise become Kinboard's.
 */
const SECRET_VARIABLES = [
  "POSTGRES_PASSWORD", "JWT_SECRET", "CRON_SECRET", "PRESENCE_SENSOR_TOKEN",
  "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "ANON_KEY", "SERVICE_ROLE_KEY",
];
const ALLOWED_VARIABLES = new Set([
  "WEBAPP_PORT", "TZ", "KINBOARD_TAG", "KINBOARD_IMAGE",
  "KINBOARD_DB_DIR", "KINBOARD_STORAGE_DIR", "KINBOARD_CONFIG_DIR",
  "SITE_URL", "WEBRTC_LAN_IP", "PUID", "PGID", "INSTANCE_ADMIN_FAMILY_ID",
  ...SECRET_VARIABLES.map((v) => `KINBOARD_${v}`),
]);
const DIR_VARIABLES: Record<string, string> = {
  KINBOARD_DB_DIR: "kinboard-db",
  KINBOARD_STORAGE_DIR: "kinboard-storage",
  KINBOARD_CONFIG_DIR: "kinboard-config",
};

/**
 * What every UI in §4.6 can run: the problems in a compose file, or none.
 *
 * - `${VAR:-default}` only, so nothing needs a .env: no bare `$VAR` or
 *   `${VAR}` (CasaOS and an empty Portainer form leave those empty) and no
 *   `${VAR:?}` (which refuses to start without one);
 * - no file next to it: no build, env_file, extends, include, configs or
 *   secrets from files, no relative or literal host path (Portainer CE puts
 *   `./data` inside its own volume, Unraid on the flash drive);
 * - volumes are named, with a fixed name, so a stack renamed in a UI keeps
 *   its data; a folder is one KINBOARD_*_DIR away;
 * - no Docker socket, no published database port, no fixed subnet.
 */
function pasteProblems(text: string): string[] {
  const problems: string[] = [];
  const raw = text.replace(/\$\$/g, ""); // `$$` is a literal dollar for the container
  for (const m of raw.matchAll(/\$\{([^}]*)\}/g)) {
    const v = /^([A-Z_][A-Z0-9_]*):-[^}$]*$/.exec(m[1]);
    if (!v) problems.push(`\${${m[1]}}: only \${VAR:-default} works without a .env`);
    else if (!ALLOWED_VARIABLES.has(v[1])) problems.push(`\${${v[1]}}: not one of the file's optional variables`);
  }
  for (const m of raw.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) problems.push(`$${m[1]}: a bare variable is empty without a .env`);

  let doc: ComposeFile;
  try {
    doc = load(text);
  } catch (err) {
    return [...problems, `not YAML: ${(err as Error).message}`];
  }
  for (const key of ["version", "include", "secrets", "configs", "env_file"]) {
    if (key in doc) problems.push(`top-level ${key}: not in a pasted file`);
  }
  const declared = doc.volumes ?? {};
  for (const [name, v] of Object.entries(declared)) {
    if (!v || v.name !== name) problems.push(`volume ${name}: needs name: ${name}, or a renamed stack starts empty`);
    if (v?.external) problems.push(`volume ${name}: external volumes don't exist on a new install`);
  }
  for (const [nname, n] of Object.entries(doc.networks ?? {})) {
    if (n?.ipam) problems.push(`network ${nname}: a fixed subnet collides with other projects`);
  }
  for (const [sname, svc] of Object.entries(doc.services ?? {})) {
    for (const key of ["build", "env_file", "extends", "profiles", "privileged"]) {
      if (key in svc) problems.push(`${sname}: ${key} is not for the pasted file`);
    }
    if (!/^kinboard-[a-z0-9-]+$/.test(String(svc.container_name ?? ""))) {
      problems.push(`${sname}: needs a fixed container_name kinboard-*`);
    }
    for (const vol of svc.volumes ?? []) {
      if (typeof vol !== "string") {
        problems.push(`${sname}: long-syntax volume; keep the short form the UIs show`);
        continue;
      }
      const source = vol.split(":")[0];
      const src = /^\$\{([A-Z_]+):-([^}]*)\}/.exec(vol);
      if (src) {
        if (DIR_VARIABLES[src[1]] !== src[2]) problems.push(`${sname}: ${src[1]} must default to the volume ${DIR_VARIABLES[src[1]] ?? "?"}`);
        if (!(src[2] in declared)) problems.push(`${sname}: ${src[2]} is not a declared volume`);
      } else if (!(source in declared)) {
        problems.push(`${sname}: ${vol}: a host path or an undeclared volume`);
      }
      if (vol.includes("docker.sock")) problems.push(`${sname}: the Docker socket is not in the default stack`);
    }
    if (sname === "db" && svc.ports) problems.push("db: no published port; nothing outside the stack needs it");
  }
  return problems;
}

test.describe("compose.yml pastes into every Compose UI (RFC-023 §4.6)", () => {
  test("the file passes", () => {
    expect(pasteProblems(COMPOSE)).toEqual([]);
  });

  // Red: each rule against a copy broken on purpose.
  const broken: [string, (s: string) => string, RegExp][] = [
    ["a bare ${VAR}", (s) => s.replace("${TZ:-Europe/Berlin}", "${TZ}"), /\$\{TZ\}: only/],
    ["a required ${VAR:?}", (s) => s.replace("${WEBAPP_PORT:-3001}", "${WEBAPP_PORT:?set it}"), /WEBAPP_PORT:\?set it/],
    ["a bare $VAR", (s) => s.replace("TZ: ${TZ:-Europe/Berlin}", "TZ: $TZ"), /\$TZ: a bare/],
    ["an unknown variable", (s) => s.replace("${SITE_URL:-}", "${DOMAIN:-}"), /DOMAIN\}: not one/],
    ["a secret under a name another stack shares", (s) => s.replace("${KINBOARD_JWT_SECRET:-}", "${JWT_SECRET:-}"), /JWT_SECRET\}: not one/],
    ["env_file", (s) => s.replace("  webapp:\n", "  webapp:\n    env_file: .env\n"), /webapp: env_file/],
    ["build", (s) => s.replace("  webapp:\n", "  webapp:\n    build: ./webapp\n"), /webapp: build/],
    ["a relative bind mount", (s) => s.replace("${KINBOARD_STORAGE_DIR:-kinboard-storage}:/var/lib/storage", "./data/storage:/var/lib/storage"), /\.\/data\/storage.*host path/],
    ["the Docker socket", (s) => s.replace("      - ${KINBOARD_STORAGE_DIR:-kinboard-storage}:/var/lib/storage\n", "      - ${KINBOARD_STORAGE_DIR:-kinboard-storage}:/var/lib/storage\n      - /var/run/docker.sock:/var/run/docker.sock:ro\n"), /docker\.sock/],
    ["a volume without a fixed name", (s) => s.replace("    name: kinboard-storage\n", ""), /kinboard-storage: needs name/],
    ["a published database port", (s) => s.replace("    container_name: kinboard-db\n", "    container_name: kinboard-db\n    ports: [\"5432:5432\"]\n"), /db: no published port/],
    ["a fixed subnet", (s) => s.replace("  kinboard: {}", "  kinboard:\n    ipam:\n      config:\n        - subnet: 10.200.0.0/24"), /fixed subnet/],
    ["a folder variable defaulting to a path", (s) => s.replace("${KINBOARD_DB_DIR:-kinboard-db}:/var/lib", "${KINBOARD_DB_DIR:-./db}:/var/lib"), /KINBOARD_DB_DIR must default/],
    ["a profile", (s) => s.replace("  go2rtc:\n", "  go2rtc:\n    profiles: [cameras]\n"), /go2rtc: profiles/],
  ];
  for (const [what, breakIt, expected] of broken) {
    test(`red: ${what}`, () => {
      const copy = breakIt(COMPOSE);
      expect(copy, "the breakage applied").not.toBe(COMPOSE);
      expect(pasteProblems(copy).join("\n")).toMatch(expected);
    });
  }

  const docker = spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status === 0;
  test("docker compose reads it with no .env, no variables and no other file", () => {
    test.skip(!docker, "no docker compose here");
    const dir = mkdtempSync(join(tmpdir(), "compose-paste-"));
    try {
      const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME };
      // As a file in an empty folder, and as a paste on stdin (Portainer's web editor).
      writeFileSync(join(dir, "compose.yml"), COMPOSE);
      const images = execFileSync("docker", ["compose", "config", "--images"], { cwd: dir, env, encoding: "utf8" });
      expect(images.trim().split("\n").sort()).toEqual([
        "alexxit/go2rtc:1.9.14", "ghcr.io/svenger87/kinboard:latest", "ghcr.io/svenger87/kinboard:latest",
        "ghcr.io/svenger87/kinboard:latest", "postgrest/postgrest:v14.16", "supabase/postgres:15.14.1.159",
      ]);
      rmSync(join(dir, "compose.yml"));
      const json = execFileSync("docker", ["compose", "-p", "someproject", "-f", "-", "config", "--format", "json"], {
        cwd: dir, env, input: COMPOSE, encoding: "utf8",
      });
      const cfg = JSON.parse(json);
      expect(cfg.services.webapp.ports[0]).toMatchObject({ target: 3000, published: "3001" });
      expect(cfg.volumes["kinboard-db"].name, "the volume keeps its name under any project").toBe("kinboard-db");
      // An absolute folder turns a volume into a bind, and nothing else changes.
      const bound = JSON.parse(execFileSync("docker", ["compose", "-f", "-", "config", "--format", "json"], {
        cwd: dir, env: { ...env, KINBOARD_DB_DIR: "/srv/kinboard/db" }, input: COMPOSE, encoding: "utf8",
      }));
      expect(bound.services.db.volumes[0]).toMatchObject({ type: "bind", source: "/srv/kinboard/db", target: "/var/lib/postgresql/data" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe("compose.yml is wired as the RFC says", () => {
  const doc = load(COMPOSE);
  const s = doc.services;

  test("the services, and nothing that needs a socket", () => {
    expect(Object.keys(s).sort()).toEqual(["db", "db-init", "go2rtc", "init", "rest", "webapp"]);
    // The parsed file, not its comments (which say there is no ofelia).
    expect(JSON.stringify(doc)).not.toMatch(/ofelia|docker\.sock/);
  });

  test("startup order: init -> db -> db-init -> rest -> webapp", () => {
    expect(s.db.depends_on).toEqual({ init: { condition: "service_completed_successfully" } });
    expect(s["db-init"].depends_on).toEqual({ db: { condition: "service_healthy" } });
    expect(s.rest.depends_on).toEqual({
      db: { condition: "service_healthy" }, "db-init": { condition: "service_completed_successfully" },
    });
    expect(s.webapp.depends_on).toEqual({
      db: { condition: "service_healthy" }, "db-init": { condition: "service_completed_successfully" },
      rest: { condition: "service_started" },
    });
  });

  test("one-shots run once per Up; the rest stays up", () => {
    for (const name of ["init", "db-init"]) {
      expect(s[name].restart, name).toBe("no");
      expect(s[name].healthcheck, `${name}: the image's health check means nothing for a one-shot`).toEqual({ disable: true });
    }
    expect(s.init.command).toEqual(["kinboard-init"]);
    expect(s["db-init"].command).toEqual(["kinboard-db-init"]);
    for (const name of ["db", "rest", "webapp", "go2rtc"]) expect(s[name].restart, name).toBe("unless-stopped");
  });

  test("the secrets come from the store: _FILE for the database, @file for PostgREST, nothing in the webapp's environment", () => {
    expect(s.db.environment.POSTGRES_PASSWORD_FILE).toBe("/kinboard/secrets/postgres_password");
    expect(s.db.environment, "both set make the database refuse to start").not.toHaveProperty("POSTGRES_PASSWORD");
    expect(s.rest.environment.PGRST_DB_URI).toBe("@/kinboard/secrets/db_uri");
    expect(s.rest.environment.PGRST_JWT_SECRET).toBe("@/kinboard/secrets/jwt_secret");
    for (const name of ["POSTGRES_PASSWORD", "JWT_SECRET", "CRON_SECRET", "VAPID_PRIVATE_KEY", "PRESENCE_SENSOR_TOKEN"]) {
      expect(s.webapp.environment, `webapp: ${name}`).not.toHaveProperty(name);
      expect(s.init.environment[name], `init: ${name} only from an existing install, under a KINBOARD_ name`).toBe(`\${KINBOARD_${name}:-}`);
    }
  });

  test("the config volume: read-write in init only, read-only elsewhere, absent from go2rtc (§6.1)", () => {
    const mounts = (svc: Service) => (svc.volumes ?? []).filter((v: string) => v.startsWith("${KINBOARD_CONFIG_DIR"));
    expect(mounts(s.init)).toEqual(["${KINBOARD_CONFIG_DIR:-kinboard-config}:/kinboard"]);
    for (const name of ["db", "db-init", "rest", "webapp"]) {
      expect(mounts(s[name]), name).toEqual(["${KINBOARD_CONFIG_DIR:-kinboard-config}:/kinboard:ro"]);
    }
    expect(s.go2rtc.volumes).toBeUndefined();
    expect(s.init.volumes).toContain("${KINBOARD_DB_DIR:-kinboard-db}:/kinboard-db:ro");
  });

  test("the webapp schedules its own jobs and declares the file's revision", () => {
    expect(s.webapp.environment.KINBOARD_SCHEDULER).toBe("internal");
    expect(s.webapp.environment.KINBOARD_COMPOSE_REVISION).toBe(String(LATEST_COMPOSE_REVISION));
  });

  test("go2rtc runs on its inline config (§4.3)", () => {
    expect(s.go2rtc.command).toEqual(["go2rtc", "-config", "{webrtc: {candidates: ['$${WEBRTC_LAN_IP:}:8555', 'stun:8555']}}"]);
    expect(s.go2rtc.environment.WEBRTC_LAN_IP).toBe("${WEBRTC_LAN_IP:-}");
  });

  test("the network is called kinboard, as the Traefik overlay expects (§4.9)", () => {
    for (const [name, svc] of Object.entries(s)) expect(svc.networks, name).toEqual(["kinboard"]);
    const traefik = load(read("webapp/docker/docker-compose.traefik.yml"));
    expect(traefik.services.webapp.networks).toContain("kinboard");
    expect(s.webapp.container_name).toBe("kinboard-webapp");
  });
});

test.describe("image names from one place, and the legacy file in step", () => {
  const doc = load(COMPOSE);
  const legacy = load(LEGACY);
  const workflow = yaml.load(read(".github/workflows/docker.yml")) as { env: Record<string, string> };

  test("the Kinboard image is named once, as docker.yml publishes it", () => {
    const anchors = COMPOSE.match(/ghcr\.io\/[^}:\s]+/g) ?? [];
    expect(anchors, "one place in the file").toHaveLength(1);
    // The owner docker.yml takes from GitHub, as the app's own version check names the repository.
    const owner = /const REPO = "([^/"]+)\/kinboard"/.exec(read("webapp/src/app/api/version-check/route.ts"))?.[1];
    const published = `${workflow.env.REGISTRY}/${workflow.env.IMAGE_NAME.replace("${{ github.repository_owner }}", owner ?? "?")}`;
    expect(anchors[0]).toBe(published);
    for (const name of ["init", "db-init", "webapp"]) {
      expect(doc.services[name].image, name).toBe(`\${KINBOARD_IMAGE:-${published}}:\${KINBOARD_TAG:-latest}`);
    }
    expect(legacy.services.webapp.image, "the legacy file's image").toBe(`${published}:\${KINBOARD_TAG:-latest}`);
  });

  test("db, rest and go2rtc run the same images as the legacy file", () => {
    for (const name of ["db", "rest", "go2rtc"]) {
      expect(doc.services[name].image, name).toBe(legacy.services[name].image);
    }
  });

  test("the same health checks and log limits as the legacy file", () => {
    expect(doc.services.db.healthcheck).toEqual(legacy.services.db.healthcheck);
    expect(doc.services.webapp.healthcheck).toEqual(legacy.services.webapp.healthcheck);
    for (const name of Object.keys(doc.services)) expect(doc.services[name].logging, name).toEqual(legacy.services.db.logging);
  });

  test("PostgREST is configured alike, apart from where its secrets come from", () => {
    const env = (svc: Service) => {
      const e = { ...svc.environment };
      delete e.PGRST_DB_URI;
      delete e.PGRST_JWT_SECRET;
      return e;
    };
    expect(env(doc.services.rest)).toEqual(env(legacy.services.rest));
  });

  test("the legacy file stays as git installs run it: no revision, no internal scheduler, no init service", () => {
    expect(LEGACY).not.toContain("KINBOARD_COMPOSE_REVISION");
    expect(LEGACY).not.toContain("KINBOARD_SCHEDULER");
    expect(Object.keys(legacy.services)).not.toContain("init");
  });
});

test.describe("KINBOARD_COMPOSE_REVISION", () => {
  const fixture: ComposeRevision[] = [
    { revision: 1, release: "1.18.0", changes: [] },
    { revision: 2, release: "1.19.0", changes: [{ id: "postgrestPin", service: "rest", from: "image: postgrest/postgrest:v14.16", to: "image: postgrest/postgrest:v14.20" }] },
    { revision: 3, release: "1.21.0", changes: [{ id: "newVolume", service: "webapp", to: "- ${KINBOARD_CACHE_DIR:-kinboard-cache}:/cache" }] },
  ];

  test("only a whole number of 1 or more is a revision; anything else says nothing", () => {
    expect(parseComposeRevision("1")).toBe(1);
    expect(parseComposeRevision(" 12 ")).toBe(12);
    for (const v of [undefined, null, "", "0", "-1", "1.5", "x", "01", "1e3", "9999999"]) {
      expect(parseComposeRevision(v as string), String(v)).toBeNull();
    }
  });

  test("a git install (no variable) never gets the notice", () => {
    expect(composeRevisionStatus(undefined)).toBeNull();
    expect(composeRevisionStatus("")).toBeNull();
  });

  test("the file in the repository is what this image wants", () => {
    const st = composeRevisionStatus(String(LATEST_COMPOSE_REVISION))!;
    expect(st.outdated).toBe(false);
    expect(st.changes).toEqual([]);
    expect(REQUIRED_COMPOSE_REVISION).toBeLessThanOrEqual(LATEST_COMPOSE_REVISION);
  });

  test("older than required: outdated, with every line to change since, oldest first", () => {
    const st = composeRevisionStatus("1", fixture, 3)!;
    expect(st).toMatchObject({ declared: 1, required: 3, latest: 3, outdated: true });
    expect(st.changes.map((c) => [c.revision, c.release, c.id, c.from, c.to])).toEqual([
      [2, "1.19.0", "postgrestPin", "image: postgrest/postgrest:v14.16", "image: postgrest/postgrest:v14.20"],
      [3, "1.21.0", "newVolume", undefined, "- ${KINBOARD_CACHE_DIR:-kinboard-cache}:/cache"],
    ]);
    expect(composeRevisionStatus("2", fixture, 3)!.changes.map((c) => c.id)).toEqual(["newVolume"]);
  });

  test("older than the newest but not than required: no notice, the changes still listed", () => {
    const st = composeRevisionStatus("2", fixture, 2)!;
    expect(st.outdated).toBe(false);
    expect(st.changes).toHaveLength(1);
  });

  test("a file newer than this image (an older image on a newer file): no notice", () => {
    expect(composeRevisionStatus("5", fixture, 3)!.outdated).toBe(false);
  });

  test("revisions count up by one, and each change names a service in the file", () => {
    COMPOSE_REVISIONS.forEach((r, i) => expect(r.revision, `entry ${i}`).toBe(i + 1));
    expect(COMPOSE_REVISIONS[0].changes, "the first file changes nothing").toEqual([]);
    const services = Object.keys(load(COMPOSE).services);
    for (const r of COMPOSE_REVISIONS) {
      for (const c of r.changes) {
        expect(services, `${r.revision}/${c.id}`).toContain(c.service);
        expect(c.from !== undefined || c.to !== undefined, `${r.revision}/${c.id}: a line to change`).toBe(true);
      }
    }
  });

  test("the notice and every change's line are in en, de, fr and zh", () => {
    const KEYS = ["title", "body", "revisions", "linesIntro", "inService", "whatChanged", "currentFile"];
    for (const locale of ["en", "de", "fr", "zh"]) {
      const m = JSON.parse(readFileSync(join(WEBAPP, "messages", `${locale}.json`), "utf8")).settings.composeRevision;
      for (const k of KEYS) expect(typeof m?.[k], `${locale}: ${k}`).toBe("string");
      expect(m.revisions, locale).toContain("{declared}");
      expect(m.revisions, locale).toContain("{required}");
      for (const r of COMPOSE_REVISIONS) for (const c of r.changes) expect(typeof m.changes?.[c.id], `${locale}: changes.${c.id}`).toBe("string");
    }
  });

  test("the route gives the answer to the install's operator only, by #547's gate", () => {
    const route = readFileSync(join(WEBAPP, "src/app/api/compose-revision/route.ts"), "utf8");
    expect(route).toContain("requireSession(request)");
    expect(route).toContain('import { isInstallOperator } from "@/lib/install-operator"');
    const gate = route.indexOf("if (!(await isInstallOperator(auth.session.familyId))) return NextResponse.json({ revision: null })");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(route.indexOf("return NextResponse.json({ revision: status })"));
    const updateStatus = readFileSync(join(WEBAPP, "src/app/api/update-status/route.ts"), "utf8");
    expect(updateStatus, "the same gate as the updater's status").toContain('import { isInstallOperator as operator } from "@/lib/install-operator"');
  });

  test("the notice shows only when outdated, under the version in Settings", () => {
    const notice = readFileSync(join(WEBAPP, "src/components/settings/compose-revision-notice.tsx"), "utf8");
    expect(notice).toContain("if (!status || !status.outdated) return null;");
    const page = readFileSync(join(WEBAPP, "src/app/settings/page.tsx"), "utf8");
    // Right after the version line, where "update available" is (§4.11.3).
    const version = page.indexOf('t("appVersionDynamic"');
    const at = page.indexOf("<ComposeRevisionNotice status={composeRevision} />");
    expect(at).toBeGreaterThan(version);
    expect(at).toBeLessThan(page.indexOf('data-testid="settings-updated-line"'));
  });
});

test.describe("the release asset (scripts/release-compose.mjs)", () => {
  let releaseCompose: ReleaseModule["releaseCompose"];
  test.beforeAll(async () => {
    ({ releaseCompose } = await releaseModule);
  });
  const make = (tag: string, text = COMPOSE, image = "ghcr.io/owner/kinboard") =>
    releaseCompose(text, { tag, image, repo: "owner/kinboard" });

  test("a stable release: the channel `latest`, docker.yml's image, a header naming the release", () => {
    const out = make("v1.18.0");
    expect(out.channel).toBe("latest");
    expect(out.revision).toBe(LATEST_COMPOSE_REVISION);
    expect(out.text.split("\n")[0]).toBe(
      `# compose.yml from Kinboard v1.18.0, revision ${LATEST_COMPOSE_REVISION}. Current file: https://github.com/owner/kinboard/releases/latest/download/compose.yml`,
    );
    expect(out.text).toContain("x-kinboard-image: &kinboard-image ${KINBOARD_IMAGE:-ghcr.io/owner/kinboard}:${KINBOARD_TAG:-latest}");
    expect(out.text).not.toContain("ghcr.io/svenger87/kinboard");
  });

  test("a release candidate: the channel `next`", () => {
    const out = make("v1.18.0-rc.2");
    expect(out.channel).toBe("next");
    expect(out.text).toContain("${KINBOARD_TAG:-next}");
  });

  test("everything else is the repository's file, byte for byte, and still pastes", () => {
    const out = make("v1.18.0");
    const body = out.text.slice(out.text.indexOf("\n") + 1);
    const restore = body.replace("ghcr.io/owner/kinboard", "ghcr.io/svenger87/kinboard");
    expect(restore).toBe(COMPOSE);
    expect(pasteProblems(out.text)).toEqual([]);
    expect(pasteProblems(make("v1.18.0-rc.1").text)).toEqual([]);
  });

  test("red: what it can't make is refused, not guessed", () => {
    expect(() => make("1.18.0")).toThrow(/not a release tag/);
    expect(() => make("v1.18")).toThrow(/not a release tag/);
    expect(() => make("v1.18.0", COMPOSE, "ghcr.io/owner/kinboard:latest")).toThrow(/without a tag/);
    expect(make("v1.18.0", COMPOSE, "ghcr.io/Owner/kinboard").text, "an owner with capitals").toContain("${KINBOARD_IMAGE:-ghcr.io/owner/kinboard}");
    expect(() => make("v1.18.0", COMPOSE.replace(/^x-kinboard-image:.*$/m, ""))).toThrow(/found 0/);
    expect(() => make("v1.18.0", COMPOSE.replace(/^(x-kinboard-image:.*)$/m, "$1\n$1"))).toThrow(/found 2/);
    expect(() => make("v1.18.0", COMPOSE.replace(/^\s+KINBOARD_COMPOSE_REVISION:.*\n/m, ""))).toThrow(/REVISION exactly once; found 0/);
  });

  test("the CLI writes the asset and says what it made", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-compose-"));
    try {
      const out = join(dir, "compose.yml");
      const log = spawnSync("node", [join(REPO, "scripts/release-compose.mjs"), "v1.18.0", "ghcr.io/o/kinboard", join(REPO, "compose.yml"), out], {
        encoding: "utf8", env: { ...process.env, REPO: "o/kinboard" },
      });
      expect(log.status, log.stderr).toBe(0);
      expect(log.stderr).toContain("default tag latest");
      expect(readFileSync(out, "utf8")).toContain("${KINBOARD_IMAGE:-ghcr.io/o/kinboard}:${KINBOARD_TAG:-latest}");
      const bad = spawnSync("node", [join(REPO, "scripts/release-compose.mjs"), "nope", "ghcr.io/o/kinboard", join(REPO, "compose.yml"), out], { encoding: "utf8" });
      expect(bad.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
