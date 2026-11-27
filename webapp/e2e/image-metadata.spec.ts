import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

/**
 * The professional bar on the published image (RFC-024 §6, phase 1).
 *
 * The image's labels, annotations, SBOM and provenance are made by
 * .github/workflows/docker.yml, its health check by the Dockerfile, its
 * release notes by scripts/release-notes.sh. None of it can be seen until a
 * release is pushed, which is too late to find out a line went missing: the
 * published 1.17.0 says `licenses: NOASSERTION` and has no SBOM because
 * nothing ever asked for them. These read the files that ask.
 *
 * The pushed result is checked too, by scripts/ci/check-image-metadata.sh in the
 * merge job, against the registry.
 */

const WEBAPP = join(__dirname, "..");
const REPO = join(WEBAPP, "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

type Step = { name?: string; uses?: string; id?: string; run?: string; env?: Record<string, string>; with?: Record<string, string> };
type Job = { steps: Step[]; needs?: string[]; if?: string };
type Workflow = { env: Record<string, string>; jobs: Record<string, Job> };

const workflow = yaml.load(read(".github/workflows/docker.yml")) as Workflow;
const metadata = Object.fromEntries(
  workflow.env.IMAGE_METADATA.trim()
    .split("\n")
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
/**
 * A deliberately minimal environment for the scripts run here: only what is
 * passed, so nothing from the caller's shell (a PUID, a GH token, a REPO)
 * leaks in. NODE_ENV only because the project's ProcessEnv type requires it;
 * none of the scripts reads it.
 */
const cleanEnv = (vars: Record<string, string>): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...vars });
const metaSteps = (job: string) => workflow.jobs[job].steps.filter((s) => s.uses?.startsWith("docker/metadata-action@"));

test.describe("OCI labels and annotations, from one place", () => {
  test("the metadata block names title, url, documentation and vendor", () => {
    for (const key of ["title", "url", "documentation", "vendor"]) {
      expect(metadata[`org.opencontainers.image.${key}`], key).toBeTruthy();
    }
  });

  test("the licence is not written into the workflow, it is read from package.json", () => {
    expect(metadata["org.opencontainers.image.licenses"]).toBeUndefined();
    const code = read(".github/workflows/docker.yml").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(code).not.toContain("PolyForm");
    expect(code).not.toContain("NOASSERTION");
    // package.json states LICENSE's SPDX id (e2e/licence-files.spec.ts pins it too).
    expect(JSON.parse(read("webapp/package.json")).license).toBe("PolyForm-Noncommercial-1.0.0");
    expect(read("LICENSE")).toContain("# PolyForm Noncommercial License 1.0.0");
  });

  test("each job's metadata step emits IMAGE_METADATA plus package.json's licence", () => {
    for (const job of ["build", "merge"]) {
      const steps = workflow.jobs[job].steps;
      const oci = steps.find((s) => s.id === "oci");
      expect(oci?.run, job).toContain("webapp/package.json");
      expect(steps.indexOf(oci!), job).toBeLessThan(steps.indexOf(metaSteps(job)[0]));
      // Run the step's own script, as the runner would, and read its output.
      const dir = mkdtempSync(join(tmpdir(), "oci-"));
      try {
        const out = join(dir, "out");
        writeFileSync(out, "");
        execFileSync("bash", ["-eo", "pipefail", "-c", oci!.run!], {
          cwd: REPO,
          env: cleanEnv({ PATH: process.env.PATH ?? "", GITHUB_OUTPUT: out, IMAGE_METADATA: "a=1\nb=2\n" }),
        });
        expect(readFileSync(out, "utf8"), job).toBe(
          "metadata<<OCI_METADATA_EOF\na=1\nb=2\norg.opencontainers.image.licenses=PolyForm-Noncommercial-1.0.0\nOCI_METADATA_EOF\n",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("both jobs read tags from env and labels and annotations from that step", () => {
    for (const job of ["build", "merge"]) {
      const steps = metaSteps(job);
      expect(steps, job).toHaveLength(1);
      expect(steps[0].with?.images, job).toBe("${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}");
      expect(steps[0].with?.tags, job).toBe("${{ env.IMAGE_TAGS }}");
      expect(steps[0].with?.labels, job).toBe("${{ steps.oci.outputs.metadata }}");
      expect(steps[0].with?.annotations, job).toBe("${{ steps.oci.outputs.metadata }}");
    }
    expect(metaSteps("build")[0].env?.DOCKER_METADATA_ANNOTATIONS_LEVELS).toBe("manifest");
    expect(metaSteps("merge")[0].env?.DOCKER_METADATA_ANNOTATIONS_LEVELS).toBe("index");
  });

  test("the image name is set once, and the updater's", () => {
    const text = read(".github/workflows/docker.yml");
    expect(workflow.env.IMAGE_NAME).toBe("${{ github.repository_owner }}/kinboard");
    expect(workflow.env.UPDATER_IMAGE_NAME).toBe("${{ github.repository_owner }}/kinboard-updater");
    expect(text.match(/^\s*IMAGE_NAME:/gm)).toHaveLength(1);
    expect(text.match(/^\s*UPDATER_IMAGE_NAME:/gm)).toHaveLength(1);
    // Every other mention goes through the variable: no step spells it out.
    const code = text.split("\n").filter((l) => !l.trim().startsWith("#"));
    // (UPDATER_, POSTGRES_ and AIO_IMAGE_NAME are the other images' one places, beside it.)
    expect(code.filter((l) => /\/kinboard\b(?![./])/.test(l) && !/^\s*(UPDATER_|POSTGRES_|AIO_)?IMAGE_NAME:/.test(l))).toEqual([]);
  });

  test("the platform images get labels and annotations, the list gets annotations", () => {
    const build = workflow.jobs.build.steps.find((s) => s.uses?.startsWith("docker/build-push-action@"));
    expect(build?.with?.labels).toBe("${{ steps.meta.outputs.labels }}");
    expect(build?.with?.annotations).toBe("${{ steps.meta.outputs.annotations }}");
    const create = workflow.jobs.merge.steps.find((s) => s.run?.includes("imagetools create"));
    expect(create?.run).toContain("--annotation");
    expect(create?.run).toContain(".annotations[]");
  });
});

test.describe("kinboard-updater, published beside the webapp (RFC-023 §4.11.3)", () => {
  const job = workflow.jobs.updater;
  const step = (uses: string) => job.steps.find((s) => s.uses?.startsWith(uses));

  test("its own job, gated like the webapp's build", () => {
    expect(job, "an updater job").toBeTruthy();
    expect(job.needs).toEqual(workflow.jobs.build.needs);
    expect(job.if).toBe(workflow.jobs.build.if);
    expect(workflow.jobs.release.needs, "the release's compose.yml names its image").toContain("updater");
  });

  test("multi-arch from Dockerfile.webhook, with the webapp's tags, provenance and SBOM", () => {
    const build = step("docker/build-push-action@");
    expect(build?.with?.file).toBe("webapp/docker/Dockerfile.webhook");
    expect(build?.with?.context).toBe("webapp/docker");
    expect(build?.with?.platforms).toBe("linux/amd64,linux/arm64");
    expect(String(build?.with?.push)).toBe("true");
    expect(build?.with?.provenance).toBe("mode=max");
    expect(String(build?.with?.sbom)).toBe("true");
    const meta = step("docker/metadata-action@");
    expect(meta?.with?.images).toBe("${{ env.REGISTRY }}/${{ env.UPDATER_IMAGE_NAME }}");
    expect(meta?.with?.tags, "the same tags as the webapp").toBe("${{ env.IMAGE_TAGS }}");
    expect(meta?.with?.labels).toBe("${{ steps.oci.outputs.metadata }}");
    expect(meta?.env?.DOCKER_METADATA_ANNOTATIONS_LEVELS).toBe("manifest,index");
    expect(build?.with?.labels).toBe("${{ steps.meta.outputs.labels }}");
    expect(build?.with?.annotations).toBe("${{ steps.meta.outputs.annotations }}");
  });

  test("its metadata: its own title and description, the licence from package.json, checked after the push", () => {
    const um = Object.fromEntries(
      workflow.env.UPDATER_METADATA.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
    expect(um["org.opencontainers.image.title"]).toBe("Kinboard updater");
    expect(um["org.opencontainers.image.description"]).toBeTruthy();
    expect(um["org.opencontainers.image.licenses"]).toBeUndefined();
    const oci = job.steps.find((s) => s.id === "oci");
    expect(oci?.run).toContain("webapp/package.json");
    expect(oci?.run).toContain("$UPDATER_METADATA");
    const check = job.steps.find((s) => s.run?.includes("check-image-metadata.sh"));
    expect(check?.run).toContain("${{ env.UPDATER_IMAGE_NAME }}");
    expect(check?.run).toContain('<<< "$UPDATER_METADATA"');
  });

  test("the image has the health check the metadata check asks for, and runs the script it carries", () => {
    const df = read("webapp/docker/Dockerfile.webhook");
    expect(df).toMatch(/^HEALTHCHECK /m);
    expect(df).toContain("COPY kinboard-self-update.sh /usr/local/bin/kinboard-self-update.sh");
    expect(df).toContain("'export KINBOARD_UPDATER=1'");
    // Git installs keep the webhook as the entrypoint (docker-compose.diun.yml builds this file).
    expect(df).toMatch(/^ENTRYPOINT \["\/usr\/local\/bin\/webhook"\]$/m);
    const diun = read("webapp/docker/docker-compose.diun.yml");
    expect(diun).toContain("dockerfile: Dockerfile.webhook");
    expect(diun).toContain("image: kinboard-webhook:local");
  });
});

test.describe("SBOM and provenance", () => {
  test("each platform build attests an SBOM and max-mode provenance, stated explicitly", () => {
    const build = workflow.jobs.build.steps.find((s) => s.uses?.startsWith("docker/build-push-action@"));
    expect(String(build?.with?.sbom)).toBe("true");
    expect(build?.with?.provenance).toBe("mode=max");
  });

  test("the merge job checks the pushed list for all of it", () => {
    const check = workflow.jobs.merge.steps.find((s) => s.run?.includes("check-image-metadata.sh"));
    expect(check?.run).toContain('<<< "$IMAGE_METADATA"');
    const script = read("scripts/ci/check-image-metadata.sh");
    for (const needle of ["{{json .SBOM}}", "{{json .Provenance}}", "buildConfig", "Healthcheck", "package.json", ".license"]) {
      expect(script, needle).toContain(needle);
    }
  });
});

test.describe("HEALTHCHECK", () => {
  const dockerfile = read("webapp/docker/Dockerfile");
  const runner = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));

  test("the final stage probes /api/health, with Pi-sized timings", () => {
    expect(runner.startsWith("\nFROM node:22-alpine AS runner")).toBe(true);
    const line = runner.match(/^HEALTHCHECK(?:[^\n]*\\\n)*[^\n]*/m)?.[0] ?? "";
    expect(line, "a HEALTHCHECK in the runner stage").not.toBe("");
    expect(line).toMatch(/--interval=30s/);
    expect(line).toMatch(/--timeout=10s/);
    expect(line).toMatch(/--start-period=120s/);
    expect(line).toMatch(/--retries=3/);
    expect(line).toMatch(/CMD curl -sf [^\n]*http:\/\/127\.0\.0\.1:\$\{PORT:-3000\}\/api\/health/);
  });

  test("curl, which it runs, is installed in that stage", () => {
    expect(runner).toMatch(/apk add --no-cache[^\n]*\bcurl\b/);
  });

  test("the compose file's own healthcheck stays, and wins", () => {
    const compose = yaml.load(read("webapp/docker/docker-compose.yml")) as {
      services: Record<string, { healthcheck?: { test: string[] } }>;
    };
    expect(compose.services.webapp.healthcheck?.test.join(" ")).toContain("/api/health");
  });
});

test.describe("PUID/PGID in the compose image (§6.3)", () => {
  const entrypoint = read("webapp/docker/webapp-entrypoint.sh");

  test("unset keeps nextjs:nodejs; the server and the files follow RUN_AS", () => {
    expect(entrypoint).toContain('RUN_AS="nextjs:nodejs"');
    expect(entrypoint).toContain('exec su-exec "$RUN_AS" node server.js');
    // -h: a link the server's user planted is changed itself, never what it points at (RFC-024 review).
    expect(entrypoint).toContain('chown -R -h "$RUN_AS" "$FILES_DIR"');
    expect(entrypoint).not.toMatch(/chown (-R )?nextjs:nodejs/);
    expect(entrypoint).not.toMatch(/su-exec nextjs/);
  });

  test("compose passes them through, empty by default", () => {
    const compose = read("webapp/docker/docker-compose.yml");
    expect(compose).toContain("PUID: ${PUID:-}");
    expect(compose).toContain("PGID: ${PGID:-}");
  });

  test("the id handling: unset, both, one, and a non-number refused", () => {
    // The block that works out RUN_AS, run on its own with a fake `id`.
    const block = entrypoint.slice(entrypoint.indexOf('RUN_AS="nextjs:nodejs"'), entrypoint.indexOf("start_server() {"));
    const dir = mkdtempSync(join(tmpdir(), "puid-"));
    try {
      writeFileSync(join(dir, "group"), "root:x:0:\nnodejs:x:1001:\n");
      const script = [
        `id() { case "$*" in "-u nextjs") echo 1001 ;; "-u") echo 0 ;; *) echo 0 ;; esac; }`,
        `awk() { command awk "$1" "$2" "${dir}/group"; }`,
        block,
        'echo "RUN_AS=$RUN_AS RUN_IDS=$RUN_IDS"',
      ].join("\n");
      const run = (env: Record<string, string>) => {
        try {
          return execFileSync("sh", ["-c", script], { env: cleanEnv({ PATH: process.env.PATH ?? "", ...env }), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
            .trim().split("\n").pop();
        } catch (e) {
          return `exit ${(e as { status: number }).status}`;
        }
      };
      expect(run({})).toBe("RUN_AS=nextjs:nodejs RUN_IDS=1001:1001");
      expect(run({ PUID: "", PGID: "" })).toBe("RUN_AS=nextjs:nodejs RUN_IDS=1001:1001");
      expect(run({ PUID: "99", PGID: "100" })).toBe("RUN_AS=99:100 RUN_IDS=99:100");
      expect(run({ PUID: "1000" })).toBe("RUN_AS=1000:1001 RUN_IDS=1000:1001");
      expect(run({ PGID: "100" })).toBe("RUN_AS=1001:100 RUN_IDS=1001:100");
      expect(run({ PUID: "nobody" })).toBe("exit 1");
      expect(run({ PUID: "99", PGID: "-1" })).toBe("exit 1");
      // "000" passes a digits-only test, and su-exec reads it as root.
      expect(run({ PUID: "000" })).toBe("exit 1");
      expect(run({ PUID: "99", PGID: "0100" })).toBe("exit 1");
      expect(run({ PUID: "0", PGID: "0" })).toBe("RUN_AS=0:0 RUN_IDS=0:0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe("release notes from the changelog", () => {
  const script = join(REPO, "scripts", "release-notes.sh");
  const changelog = `# Changelog

## [Unreleased]

### Fixed

- **Unreleased fix.** For the next candidates.

## [1.18.0-rc.2] - 2026-12-01

### Added

- **Own section for rc.2.**

## [1.17.0] - 2026-11-25

### Added

- **Stable entry.** In 1.17.0.

## [1x17x0] - 2026-11-24

- not a version a dot may match
`;
  const notes = (tag: string, text = changelog) => {
    const dir = mkdtempSync(join(tmpdir(), "notes-"));
    try {
      writeFileSync(join(dir, "CHANGELOG.md"), text);
      return execFileSync("bash", [script, tag, join(dir, "CHANGELOG.md")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return `exit ${(e as { status: number }).status}`;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("a stable tag gets its own section, without heading or surrounding blank lines", () => {
    expect(notes("v1.17.0")).toBe("### Added\n\n- **Stable entry.** In 1.17.0.\n");
  });

  test("a release candidate gets its own section when it has one", () => {
    expect(notes("v1.18.0-rc.2")).toBe("### Added\n\n- **Own section for rc.2.**\n");
  });

  test("otherwise [Unreleased], where candidates collect their entries", () => {
    expect(notes("v1.18.0-rc.3")).toBe("### Fixed\n\n- **Unreleased fix.** For the next candidates.\n");
  });

  test("a stable tag never falls back to [Unreleased]", () => {
    expect(notes("v1.18.0")).toBe("exit 1");
  });

  test("an empty section is no notes", () => {
    expect(notes("v1.18.0-rc.3", changelog.replace(/## \[Unreleased\][\s\S]*?(?=## \[1\.18)/, "## [Unreleased]\n\n"))).toBe("exit 1");
  });

  test("the workflow's release job runs publish-release.sh for every tag", () => {
    const job = workflow.jobs.release;
    expect(job, "a release job").toBeTruthy();
    expect(job.if).toContain("github.ref_type == 'tag'");
    expect(job.if).not.toContain("contains(github.ref_name, '-')");
    const run = job.steps.map((s) => s.run ?? "").join("\n");
    expect(run).toContain('scripts/publish-release.sh "${{ github.ref_name }}"');
    expect(run).not.toContain("gh release create");
  });

  test("it reads the real changelog: 1.17.0's notes are its section", () => {
    const out = execFileSync("bash", [script, "v1.17.0"], { encoding: "utf8" });
    expect(out.startsWith("### Added\n")).toBe(true);
    expect(out).not.toContain("## [");
  });
});

test.describe("publishing the release", () => {
  const script = join(REPO, "scripts", "publish-release.sh");
  const changelog = "# Changelog\n\n## [Unreleased]\n\n- **Next.**\n\n## [1.18.0] - 2026-12-01\n\n- **Stable entry.**\n";

  /** Runs publish-release.sh with a fake `gh`; returns what it asked gh to create. */
  const publish = (tag: string, opts: { handwritten?: string; existing?: "draft" | "published"; compose?: string } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "publish-"));
    try {
      const bin = join(dir, "bin");
      const root = join(dir, "root");
      execFileSync("mkdir", ["-p", bin, join(root, "docs", "release-notes")]);
      writeFileSync(join(root, "CHANGELOG.md"), changelog);
      if (opts.handwritten) writeFileSync(join(root, "docs", "release-notes", `${tag}.md`), opts.handwritten);
      if (opts.compose !== undefined) writeFileSync(join(root, "compose.yml"), opts.compose);
      // `gh release list` applies the script's own --jq to a fixture list
      // (the real gh does the same); `gh release create` logs its arguments
      // and its notes' text.
      writeFileSync(
        join(bin, "gh"),
        `#!/usr/bin/env bash
if [ "$1 $2" = "release list" ]; then
  prev=""; for a in "$@"; do [ "$prev" = "--jq" ] && q="$a"; prev="$a"; done
  printf '%s' "\${FAKE_RELEASES:-[]}" | jq -r "$q"; exit 0
fi
if [ "$1 $2" = "release create" ]; then
  echo "ARGS $*" >> "${dir}/log"
  prev=""; for a in "$@"; do [ "$prev" = "--notes-file" ] && { echo "NOTES"; cat "$a"; } >> "${dir}/log"; prev="$a"; done
  for a in "$@"; do case "$a" in */compose.yml) { echo "ASSET $(basename "$a")"; cat "$a"; } >> "${dir}/log" ;; esac; done
  exit 0
fi
echo "unexpected gh $*" >&2; exit 9
`,
        { mode: 0o755 },
      );
      execFileSync("bash", [script, tag], {
        env: cleanEnv({ PATH: `${bin}:${process.env.PATH}`, REPO: "owner/repo", RELEASE_ROOT: root,
          REGISTRY: "ghcr.io", IMAGE_NAME: "owner/kinboard", UPDATER_IMAGE_NAME: "owner/kinboard-updater",
          FAKE_RELEASES: JSON.stringify([
            { tagName: "v1.17.0", isDraft: false },
            ...(opts.existing ? [{ tagName: tag, isDraft: opts.existing === "draft" }] : []),
          ]) }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        return readFileSync(join(dir, "log"), "utf8");
      } catch {
        return "";
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("stable with docs/release-notes/vX.Y.Z.md: published with that file, not a draft", () => {
    const log = publish("v1.18.0", { handwritten: "## Upgrading\n\nRun it.\n" });
    expect(log).toContain("ARGS release create v1.18.0 --repo owner/repo --verify-tag --title Kinboard v1.18.0 --notes-file ");
    expect(log).not.toContain("--draft");
    expect(log).not.toContain("--prerelease");
    expect(log).toContain("NOTES\n## Upgrading\n\nRun it.\n");
  });

  test("stable without it: a draft with the changelog section, to be edited by hand", () => {
    const log = publish("v1.18.0");
    expect(log).toMatch(/^ARGS release create v1\.18\.0 .*--draft --notes-file /m);
    expect(log).not.toContain("--prerelease");
    expect(log).toContain("NOTES\n- **Stable entry.**\n");
  });

  test("a pre-release: published at once, marked pre-release, with the changelog", () => {
    const log = publish("v1.18.1-rc.1");
    expect(log).toMatch(/^ARGS release create v1\.18\.1-rc\.1 .*--title v1\.18\.1-rc\.1 --prerelease --notes-file /m);
    expect(log).not.toContain("--draft");
    expect(log).toContain("NOTES\n- **Next.**\n");
  });

  test("compose.yml goes with every new release, made from the tagged file (RFC-023 §4.6)", () => {
    const compose = readFileSync(join(REPO, "compose.yml"), "utf8");
    const stable = publish("v1.18.0", { handwritten: "x", compose });
    expect(stable).toMatch(/^ARGS release create v1\.18\.0 .* \S*\/compose\.yml$/m);
    expect(stable).toContain("ASSET compose.yml\n# compose.yml from Kinboard v1.18.0, revision ");
    expect(stable, "the updater's name from docker.yml").toContain("${KINBOARD_UPDATER_IMAGE:-ghcr.io/owner/kinboard-updater}:${KINBOARD_TAG:-latest}");
    expect(stable).toContain("x-kinboard-image: &kinboard-image ${KINBOARD_IMAGE:-ghcr.io/owner/kinboard}:${KINBOARD_TAG:-latest}");
    const rc = publish("v1.18.1-rc.1", { compose });
    expect(rc).toContain("${KINBOARD_IMAGE:-ghcr.io/owner/kinboard}:${KINBOARD_TAG:-next}");
    expect(rc).toContain("https://github.com/owner/repo/releases/latest/download/compose.yml");
  });

  test("a compose.yml it can't make stops the release before anything is created", () => {
    let err: (Error & { stderr?: string }) | null = null;
    try {
      publish("v1.18.0", { handwritten: "x", compose: "# no image line\nservices: {}\n" });
    } catch (e) {
      err = e as Error & { stderr?: string };
    }
    expect(err, "the script failed").not.toBeNull();
    expect(String(err?.stderr), "for the asset, not something else").toContain("release-compose: compose.yml must name the Kinboard image");
    expect(String(err?.stderr)).not.toContain("unexpected gh");
  });

  test("a tree without compose.yml (an older tag) gets its release, without the asset", () => {
    const log = publish("v1.18.0", { handwritten: "x" });
    expect(log).toContain("ARGS release create v1.18.0 ");
    expect(log).not.toContain("ASSET");
  });

  test("an existing release, draft or published, is never touched", () => {
    expect(publish("v1.18.0", { existing: "draft" })).toBe("");
    expect(publish("v1.18.0", { existing: "published", handwritten: "x" })).toBe("");
    expect(publish("v1.18.1-rc.1", { existing: "published" })).toBe("");
  });
});

test.describe("check-image-metadata.sh against a registry stand-in", () => {
  const script = join(WEBAPP, "..", "scripts", "ci", "check-image-metadata.sh");
  const want: Record<string, string> = {
    "org.opencontainers.image.title": "Kinboard",
    "org.opencontainers.image.url": "https://kinboard.app",
    "org.opencontainers.image.documentation": "https://github.com/o/r/wiki",
    "org.opencontainers.image.vendor": "o",
  };
  const auto = {
    "org.opencontainers.image.version": "1.18.0",
    "org.opencontainers.image.revision": "abc",
    "org.opencontainers.image.created": "2026-11-26T00:00:00Z",
    "org.opencontainers.image.source": "https://github.com/o/r",
    "org.opencontainers.image.description": "A family dashboard",
  };

  /** Runs the check with a fake `docker` serving one pushed amd64 image. */
  const check = (licence: string, opts: { sbom?: boolean; healthcheck?: boolean; packageLicence?: string; stdinLicence?: string } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "imgcheck-"));
    try {
      const labels = { ...want, ...auto, "org.opencontainers.image.licenses": licence };
      const fx = {
        raw: { annotations: labels, manifests: [{ digest: "sha256:aa", platform: { os: "linux", architecture: "amd64" } }] },
        image: { config: { Labels: labels } },
        sbom: opts.sbom === false ? {} : { SPDX: { packages: [{ name: "a" }, { name: "b" }] } },
        prov: { SLSA: { invocation: { parameters: {} }, metadata: { "https://mobyproject.org/buildkit@v1#metadata": { buildConfig: {} } } } },
        hc: opts.healthcheck === false ? "" : '{"Test":["CMD-SHELL","curl"]}',
      };
      for (const [k, v] of Object.entries(fx)) writeFileSync(join(dir, k), typeof v === "string" ? v : JSON.stringify(v));
      writeFileSync(join(dir, "package.json"), JSON.stringify({ license: opts.packageLicence ?? "PolyForm-Noncommercial-1.0.0" }));
      execFileSync("mkdir", [join(dir, "bin")]);
      writeFileSync(
        join(dir, "bin", "docker"),
        `#!/usr/bin/env bash
case "$*" in
  *"--raw"*) cat "${dir}/raw" ;;
  *"json .Image"*) cat "${dir}/image" ;;
  *"json .SBOM"*) cat "${dir}/sbom" ;;
  *"json .Provenance"*) cat "${dir}/prov" ;;
  "pull "*|"image rm "*) ;;
  "image inspect "*) cat "${dir}/hc" ;;
  *) echo "unexpected docker $*" >&2; exit 9 ;;
esac
`,
        { mode: 0o755 },
      );
      const lines = Object.entries(want).map(([k, v]) => `${k}=${v}`);
      if (opts.stdinLicence) lines.push(`org.opencontainers.image.licenses=${opts.stdinLicence}`);
      const stdin = lines.join("\n") + "\n";
      try {
        return execFileSync("bash", [script, "reg.example/o/kinboard:1.18.0"], {
          input: stdin,
          env: cleanEnv({ PATH: `${join(dir, "bin")}:${process.env.PATH}`, PACKAGE_JSON: join(dir, "package.json") }),
          encoding: "utf8",
        });
      } catch (e) {
        return `exit ${(e as { status: number }).status}\n${(e as { stdout: string }).stdout}`;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("an image with everything passes", () => {
    expect(check("PolyForm-Noncommercial-1.0.0")).toContain("all checks passed");
  });

  test("a licence other than package.json's fails, on the list and on the image", () => {
    const out = check("NOASSERTION");
    expect(out).toMatch(/^exit 1/);
    expect(out).toContain("FAIL  org.opencontainers.image.licenses: want 'PolyForm-Noncommercial-1.0.0', got 'NOASSERTION'");
    expect(out).toContain("FAIL  label org.opencontainers.image.licenses");
  });

  test("the expected licence follows package.json, not the workflow", () => {
    const out = check("PolyForm-Noncommercial-1.0.0", { packageLicence: "MIT" });
    expect(out).toMatch(/^exit 1/);
    expect(out).toContain("want 'MIT', got 'PolyForm-Noncommercial-1.0.0'");
  });

  test("a licence line on stdin does not overrule package.json", () => {
    expect(check("PolyForm-Noncommercial-1.0.0", { stdinLicence: "MIT" })).toContain("all checks passed");
  });

  test("a missing SBOM or HEALTHCHECK fails", () => {
    expect(check("PolyForm-Noncommercial-1.0.0", { sbom: false })).toContain("FAIL  no SBOM");
    expect(check("PolyForm-Noncommercial-1.0.0", { healthcheck: false })).toContain("FAIL  no HEALTHCHECK");
  });
});

test.describe("kinboard-aio, the all-in-one image (RFC-024 §4.5, phase 5)", () => {
  const text = read(".github/workflows/docker.yml");
  const build = workflow.jobs["aio-build"];
  const merge = workflow.jobs["aio-merge"];
  const step = (job: Job, uses: string) => job.steps.find((s) => s.uses?.startsWith(uses));

  test("its name is set once, beside the others", () => {
    expect(workflow.env.AIO_IMAGE_NAME).toBe("${{ github.repository_owner }}/kinboard-aio");
    expect(text.match(/^\s*AIO_IMAGE_NAME:/gm)).toHaveLength(1);
    const code = text.split("\n").filter((l) => !/^\s*#/.test(l) && !/^\s*name:/.test(l)).join("\n");
    expect(code.match(/kinboard-aio/g)).toHaveLength(1);
  });

  test("built per platform FROM that platform's webapp image by digest, after the webapp's build", () => {
    expect(build.needs).toEqual(["changes", "build"]);
    expect(build.if).toBe(workflow.jobs.build.if);
    const b = step(build, "docker/build-push-action@");
    expect(b?.with?.file).toBe("webapp/docker/aio/Dockerfile");
    expect(b?.with?.["build-args"]).toContain("APP_IMAGE=${{ steps.app.outputs.image }}");
    const app = build.steps.find((s) => s.id === "app");
    expect(app?.run).toContain('$REGISTRY/$IMAGE_NAME@sha256:');
    expect(b?.with?.provenance).toBe("mode=max");
    expect(b?.with?.sbom).toBe(true);
    expect(b?.with?.labels).toBe("${{ steps.meta.outputs.labels }}");
    expect(step(build, "docker/metadata-action@")?.with?.images).toBe("${{ env.REGISTRY }}/${{ env.AIO_IMAGE_NAME }}");
  });

  test("merged, annotated and checked like the others", () => {
    expect(merge.needs).toEqual(["changes", "aio-build"]);
    const create = merge.steps.find((s) => s.run?.includes("imagetools create"));
    expect(create?.run).toContain("$REGISTRY/$AIO_IMAGE_NAME@sha256:$digest");
    expect(create?.run).toContain(".annotations[]");
    const check = merge.steps.find((s) => s.run?.includes("check-image-metadata.sh"));
    expect(check?.run).toContain("${{ env.AIO_IMAGE_NAME }}");
    expect(check?.env?.EXPECTED_LICENSE).toBe("${{ steps.oci.outputs.license }}");
  });

  test("`next`, `main`, sha and version tags, but no `latest`, `X` or `X.Y` until phase 5's gates are met", () => {
    const tags = workflow.env.AIO_IMAGE_TAGS;
    expect(tags).toContain("type=raw,value=next,");
    expect(tags).toContain("type=ref,event=branch");
    expect(tags).toContain("type=semver,pattern={{version}}");
    expect(tags).not.toContain("latest");
    expect(tags).not.toContain("{{major}}");
    for (const job of [build, merge]) {
      const meta = step(job, "docker/metadata-action@");
      expect(meta?.with?.tags).toBe("${{ env.AIO_IMAGE_TAGS }}");
      // metadata-action adds `latest` to a stable semver tag by itself (latest=auto) unless told not to.
      expect(meta?.with?.flavor, "flavor: latest=false").toBe("latest=false");
    }
  });
});

/**
 * Every image's tags, worked out as docker/metadata-action@v5 does for the
 * types our lists use (ref/branch, semver with pattern and prefix, sha with
 * prefix, raw with enable=, and the `latest` flavor, whose default `auto`
 * adds `latest` to any stable semver tag), for a stable release tag, a
 * release candidate and a push to main. An unintended `latest`, or an
 * intended tag gone, fails here before it reaches a registry.
 */
type Ref = { ref: string; refName: string; sha: string };
const REFS: Record<string, Ref> = {
  stable: { ref: "refs/tags/v1.18.0", refName: "v1.18.0", sha: "abcdef1234567" },
  rc: { ref: "refs/tags/v1.18.0-rc.1", refName: "v1.18.0-rc.1", sha: "abcdef1234567" },
  main: { ref: "refs/heads/main", refName: "main", sha: "abcdef1234567" },
};

function evalEnable(expr: string, r: Ref): boolean {
  // Only the expression forms docker.yml uses; anything else throws, so a new form is noticed.
  const js = expr
    .replace(/startsWith\(github\.ref, '([^']*)'\)/g, (_m, p) => JSON.stringify(r.ref.startsWith(p)))
    .replace(/contains\(github\.ref_name, '([^']*)'\)/g, (_m, p) => JSON.stringify(r.refName.includes(p)))
    .replace(/contains\(github\.ref, '([^']*)'\)/g, (_m, p) => JSON.stringify(r.ref.includes(p)))
    .replace(/github\.ref == '([^']*)'/g, (_m, p) => JSON.stringify(r.ref === p))
    .trim();
  if (!/^[!()&|\s\w]*$/.test(js.replace(/true|false/g, ""))) throw new Error(`unsupported enable expression: ${expr}`);
  return Function(`return (${js});`)() as boolean;
}

function metadataTags(list: string, flavor: string | undefined, r: Ref): string[] {
  const tags = new Set<string>();
  const semver = /^refs\/tags\/v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(r.ref);
  let hasSemverType = false;
  for (const raw of list.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const enableAt = raw.indexOf(",enable=${{");
    const enable = enableAt === -1 ? true : evalEnable(raw.slice(enableAt + ",enable=${{".length).replace(/\}\}\s*$/, ""), r);
    const attrs = Object.fromEntries((enableAt === -1 ? raw : raw.slice(0, enableAt)).split(",").map((kv) => kv.split(/=(.*)/).slice(0, 2)));
    if (!enable) continue;
    const prefix = attrs.prefix ?? "";
    switch (attrs.type) {
      case "ref":
        if (attrs.event === "branch" && r.ref.startsWith("refs/heads/")) tags.add(prefix + r.refName);
        break;
      case "sha":
        tags.add(prefix + r.sha.slice(0, 7));
        break;
      case "raw":
        tags.add(prefix + attrs.value);
        break;
      case "semver": {
        hasSemverType = true;
        if (!semver) break;
        const [, maj, min, pat, pre] = semver;
        // metadata-action leaves {{major}} and {{major}}.{{minor}} out for a prerelease.
        if (attrs.pattern === "{{version}}") tags.add(`${prefix}${maj}.${min}.${pat}${pre ?? ""}`);
        else if (!pre && attrs.pattern === "{{major}}.{{minor}}") tags.add(`${prefix}${maj}.${min}`);
        else if (!pre && attrs.pattern === "{{major}}") tags.add(`${prefix}${maj}`);
        break;
      }
      default:
        throw new Error(`unsupported tag type in ${raw}`);
    }
  }
  const latest = /latest=(true|false|auto)/.exec(flavor ?? "")?.[1] ?? "auto";
  if (latest === "true" || (latest === "auto" && hasSemverType && semver && !semver[4])) tags.add("latest");
  return [...tags].sort();
}

/** What each image must publish, per ref (RFC-024 §4.5, §6, §9; #560 for the database image). */
const WANT: Record<string, Record<string, string[]>> = {
  kinboard: {
    stable: ["1", "1.18", "1.18.0", "latest", "sha-abcdef1"],
    rc: ["1.18.0-rc.1", "next", "sha-abcdef1"],
    main: ["main", "sha-abcdef1"],
  },
  "kinboard-updater": {
    stable: ["1", "1.18", "1.18.0", "latest", "sha-abcdef1"],
    rc: ["1.18.0-rc.1", "next", "sha-abcdef1"],
    main: ["main", "sha-abcdef1"],
  },
  // The PostgreSQL major first: the bare `17` is the stable channel, never `latest`.
  "kinboard-postgres": {
    stable: ["17", "17-1.18.0", "17-sha-abcdef1"],
    rc: ["17-1.18.0-rc.1", "17-next", "17-sha-abcdef1"],
    main: ["17-main", "17-sha-abcdef1"],
  },
  // No stable channel until phase 5's gates are met: no `latest`, no `1`, no `1.18`.
  "kinboard-aio": {
    stable: ["1.18.0", "sha-abcdef1"],
    rc: ["1.18.0-rc.1", "next", "sha-abcdef1"],
    main: ["main", "sha-abcdef1"],
  },
};
const IMAGE_OF: Record<string, string> = {
  IMAGE_NAME: "kinboard", UPDATER_IMAGE_NAME: "kinboard-updater", POSTGRES_IMAGE_NAME: "kinboard-postgres", AIO_IMAGE_NAME: "kinboard-aio",
};

/** Every problem with the tags docker.yml's metadata steps publish, as sentences. */
function tagProblems(wf: Workflow): string[] {
  const p: string[] = [];
  const seen = new Set<string>();
  for (const [jobName, job] of Object.entries(wf.jobs)) {
    for (const step of job.steps.filter((s) => s.uses?.startsWith("docker/metadata-action@"))) {
      const nameVar = /\$\{\{ env\.([A-Z_]+) \}\}$/.exec(step.with?.images ?? "")?.[1] ?? "";
      const image = IMAGE_OF[nameVar];
      if (!image) { p.push(`${jobName}: metadata step for an unknown image ${step.with?.images}`); continue; }
      seen.add(image);
      const listVar = /^\$\{\{ env\.([A-Z_]+) \}\}$/.exec(step.with?.tags ?? "")?.[1] ?? "";
      const list = wf.env[listVar];
      if (!list) { p.push(`${jobName}: ${image}'s tags are not one of docker.yml's lists`); continue; }
      if (step.with?.flavor !== "latest=false") p.push(`${jobName}: ${image}'s metadata step does not set flavor: latest=false`);
      for (const [refKind, r] of Object.entries(REFS)) {
        const got = metadataTags(list, step.with?.flavor, r);
        const want = WANT[image][refKind];
        for (const t of got) if (!want.includes(t)) p.push(`${jobName}: ${image} would publish the unintended tag ${t} on ${r.refName}`);
        for (const t of want) if (!got.includes(t)) p.push(`${jobName}: ${image} would not publish ${t} on ${r.refName}`);
      }
    }
  }
  for (const image of Object.keys(WANT)) if (!seen.has(image)) p.push(`no metadata step publishes ${image}`);
  return p;
}

test.describe("every image's tags, per channel (RFC-024 §4.5, §9)", () => {
  test("each image publishes exactly its channel's tags: latest only for kinboard and kinboard-updater", () => {
    expect(tagProblems(workflow)).toEqual([]);
  });

  test("the evaluator reproduces metadata-action's own default: without the flavor, a stable tag adds latest", () => {
    expect(metadataTags("type=semver,pattern={{version}},prefix=17-", undefined, REFS.stable)).toEqual(["17-1.18.0", "latest"]);
    expect(metadataTags("type=semver,pattern={{version}},prefix=17-", undefined, REFS.rc)).toEqual(["17-1.18.0-rc.1"]);
    expect(metadataTags("type=semver,pattern={{version}},prefix=17-", "latest=false", REFS.stable)).toEqual(["17-1.18.0"]);
  });

  test("red: the flavor taken off kinboard-postgres's or kinboard-aio's steps publishes latest, and fails", () => {
    for (const [jobs, image] of [[["postgres-build", "postgres-merge"], "kinboard-postgres"], [["aio-build", "aio-merge"], "kinboard-aio"]] as const) {
      const wf = structuredClone(workflow);
      for (const j of jobs) for (const s of wf.jobs[j].steps) if (s.uses?.startsWith("docker/metadata-action@") && s.with) delete s.with.flavor;
      const problems = tagProblems(wf);
      for (const j of jobs) {
        expect(problems, image).toContain(`${j}: ${image} would publish the unintended tag latest on v1.18.0`);
        expect(problems, image).toContain(`${j}: ${image}'s metadata step does not set flavor: latest=false`);
      }
    }
  });

  test("red: an intended tag gone (the database's stable 17, the webapp's latest) fails", () => {
    const wf = structuredClone(workflow);
    wf.env.POSTGRES_IMAGE_TAGS = wf.env.POSTGRES_IMAGE_TAGS.split("\n").filter((l) => !l.includes("value=17,")).join("\n");
    wf.env.IMAGE_TAGS = wf.env.IMAGE_TAGS.split("\n").filter((l) => !l.includes("value=latest")).join("\n");
    const problems = tagProblems(wf);
    expect(problems).toContain("postgres-merge: kinboard-postgres would not publish 17 on v1.18.0");
    expect(problems).toContain("merge: kinboard would not publish latest on v1.18.0");
    // and the updater, which shares the webapp's list
    expect(problems).toContain("updater: kinboard-updater would not publish latest on v1.18.0");
  });

  test("red: a stable alias added to kinboard-aio before its gates fails", () => {
    const wf = structuredClone(workflow);
    wf.env.AIO_IMAGE_TAGS += "type=semver,pattern={{major}}\n";
    expect(tagProblems(wf)).toContain("aio-merge: kinboard-aio would publish the unintended tag 1 on v1.18.0");
  });
});
