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
 * The pushed result is checked too, by docker/check-image-metadata.sh in the
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
    expect(code.filter((l) => /\/kinboard\b(?![./])/.test(l) && !/^\s*(UPDATER_)?IMAGE_NAME:/.test(l))).toEqual([]);
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
    const script = read("webapp/docker/check-image-metadata.sh");
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
    expect(entrypoint).toContain('chown -R "$RUN_AS" "$FILES_DIR"');
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
  const script = join(WEBAPP, "docker", "check-image-metadata.sh");
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
