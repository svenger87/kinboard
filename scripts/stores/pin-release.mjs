#!/usr/bin/env node
/**
 * pin-release.mjs: points the pinned listings (TrueNAS, CasaOS, Umbrel) at a
 * release, by writing the metadata's `release:` block (RFC-024 §5.2, §5.4,
 * §7).
 *
 *   node scripts/stores/pin-release.mjs v1.18.0
 *   node scripts/stores/pin-release.mjs --sha 2e83c9f --version 1.18.0-main.2e83c9f
 *
 * A release tag pins the app image's version tag and the database image's
 * `<major>-<version>` tag (docker.yml's tag scheme); --sha pins a build of
 * main (`sha-<short>`, `<major>-sha-<short>`), for validating and rehearsing
 * before that release exists. Every image the listings run, compose.yml's
 * others included, is resolved to its multi-arch index digest with
 * `docker buildx imagetools inspect`, and must list linux/amd64 and
 * linux/arm64 (Umbrel and CasaOS require both).
 *
 * Then run build-store-listings.mjs and commit dist/. Only the `release:`
 * block at the end of the metadata file is rewritten; everything above it,
 * comments included, stays as it is.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serviceModel } from "./lib/model.mjs";
import { loadSources, REPO_ROOT } from "./lib/sources.mjs";

/** The listings that run images pinned by digest. */
export const PINNED_STORES = ["truenas", "casaos", "umbrel"];

/**
 * The tags to pin for a release tag or a build of main.
 * @param {{ tag?: string, sha?: string, version?: string, major: string }} a
 */
export function releaseTags({ tag, sha, version, major }) {
  if (tag) {
    const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
    if (!m) throw new Error(`${tag} is not a release tag (vX.Y.Z or vX.Y.Z-rc.N)`);
    return { version: version ?? m[1], app_tag: m[1], postgres_tag: `${major}-${m[1]}` };
  }
  if (!sha || !/^[0-9a-f]{7}$/.test(sha)) throw new Error("--sha takes a 7-character commit hash");
  if (!version) throw new Error("--sha needs --version (what the stores show, e.g. 1.18.0-main.<sha>)");
  return { version, app_tag: `sha-${sha}`, postgres_tag: `${major}-sha-${sha}` };
}

/** The `release:` block, as written into the metadata file. */
export function releaseBlock(r) {
  const lines = [
    "release:",
    `  version: ${r.version}`,
    `  app_tag: ${r.app_tag}`,
    `  postgres_tag: ${r.postgres_tag}`,
    "  digests:",
    ...Object.entries(r.digests).map(([ref, d]) => `    ${ref}: ${d}`),
  ];
  return `${lines.join("\n")}\n`;
}

function indexDigest(ref) {
  const raw = execFileSync("docker", ["buildx", "imagetools", "inspect", ref, "--format", "{{json .Manifest}}"], { encoding: "utf8" });
  const manifest = JSON.parse(raw);
  const platforms = new Set((manifest.manifests ?? []).map((m) => `${m.platform?.os}/${m.platform?.architecture}`));
  for (const want of ["linux/amd64", "linux/arm64"]) {
    if (!platforms.has(want)) throw new Error(`${ref} has no ${want} image (it lists ${[...platforms].join(", ") || "no index"})`);
  }
  return manifest.digest;
}

function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
  const tag = argv[0]?.startsWith("v") ? argv[0] : undefined;
  const src = loadSources(REPO_ROOT);
  const major = src.channels.postgres.stable;
  const r = releaseTags({ tag, sha: opt("--sha"), version: opt("--version"), major });
  // The other images the pinned stores run (Portainer follows channel tags).
  const others = [...new Set(PINNED_STORES.flatMap((name) => Object.values(serviceModel(src, { name, images: { app: "", postgres: "", other: (x) => x }, env: () => undefined }))
    .filter((s) => s.kind === "other")
    .map((s) => s.image)))];
  const refs = [`${src.images.app}:${r.app_tag}`, `${src.images.postgres}:${r.postgres_tag}`, ...others];
  r.digests = {};
  for (const ref of refs) {
    r.digests[ref] = indexDigest(ref);
    process.stderr.write(`pin-release: ${ref} ${r.digests[ref]}\n`);
  }
  const file = join(REPO_ROOT, src.metaFile);
  const text = readFileSync(file, "utf8");
  const at = text.search(/^release:/m);
  if (at === -1) throw new Error(`${src.metaFile} has no release: block`);
  writeFileSync(file, text.slice(0, at) + releaseBlock(r));
  process.stderr.write(`pin-release: ${src.metaFile} now pins ${r.version}; run scripts/stores/build-store-listings.mjs\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`pin-release: ${err?.message ?? err}\n`);
    process.exit(1);
  }
}
