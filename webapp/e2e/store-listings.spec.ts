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
  images: { app: string; postgres: string; updater: string };
  channels: { app: { stable: string; next: string }; postgres: { stable: string; next: string } };
}
interface SourcesModule {
  REPO_ROOT: string;
  loadSources(root?: string): Sources;
  metadataProblems(m: unknown, file?: string): string[];
  imageNamesFromWorkflow(text: string, owner: string): { app: string; postgres: string; updater: string };
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
