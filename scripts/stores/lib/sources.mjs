/**
 * The three inputs every store listing is generated from (RFC-024 §7):
 *
 *   dist/<slug>.yaml (METADATA)        what the listing says: name, texts,
 *                                      icon, screenshots, links, ports, paths,
 *                                      the variables a household may set, and
 *                                      the release the listings are pinned to
 *   compose.yml                        what runs: the services, their
 *                                      commands, health checks and variables
 *   .github/workflows/docker.yml       the image names, the one place they
 *                                      are set (RFC-024 §4.5)
 *
 * Nothing here knows the product's name; it is read from the metadata.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

// js-yaml is the webapp's (a devDependency there); scripts/ has no packages of its own.
const require = createRequire(join(REPO_ROOT, "webapp", "package.json"));
/** @type {typeof import("js-yaml")} */
export const yaml = require("js-yaml");

/** Where the listings are generated to, and where the metadata file lives. */
export const DIST = "dist";

/** The metadata file: the only `*.yaml` directly in dist/. */
export function metadataPath(root = REPO_ROOT) {
  const found = readdirSync(join(root, DIST)).filter((f) => f.endsWith(".yaml"));
  if (found.length !== 1) throw new Error(`${DIST}/ must hold exactly one metadata *.yaml; found ${found.length}`);
  return join(DIST, found[0]);
}

const LOCALES = ["en", "de"];
const SLUG = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
/**
 * CasaOS's id rule (validate_compose.py): runs of [a-z0-9] joined by single
 * `.`, `_` or `-`, with at least one `.`. Their pattern nests quantifiers
 * and backtracks exponentially on input such as "0.0.0…0!"; this one has a
 * single separator class between runs, so it is linear, and the `.` is
 * checked apart.
 */
const ID_RUNS = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const isReverseDomain = (s) => typeof s === "string" && s.includes(".") && ID_RUNS.test(s);
const SPDX = /^[A-Za-z0-9.+-]+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * Every problem with the metadata, as sentences. Empty means usable.
 * @param {any} m
 * @param {string} [file]
 */
export function metadataProblems(m, file = "metadata") {
  const p = [];
  const need = (cond, msg) => { if (!cond) p.push(`${file}: ${msg}`); };
  const str = (v) => typeof v === "string" && v.trim() !== "";
  need(m && typeof m === "object", "is not a YAML mapping");
  if (!m || typeof m !== "object") return p;
  need(m.schema === 1, "schema must be 1");
  need(str(m.name), "name is required");
  need(typeof m.slug === "string" && SLUG.test(m.slug), "slug must be lowercase kebab-case");
  need(isReverseDomain(m.id), "id must be a reverse-domain id such as app.example");
  need(typeof m.repository === "string" && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(m.repository), "repository must be owner/name");
  for (const key of ["tagline", "first_run"]) {
    for (const l of LOCALES) need(str(m[key]?.[l]), `${key}.${l} is required`);
  }
  need(str(m.description?.short), "description.short is required");
  need((m.description?.short ?? "").length < 512, "description.short must be under 512 characters (GHCR's limit)");
  for (const l of LOCALES) need(str(m.description?.long?.[l]), `description.long.${l} is required`);
  need(Array.isArray(m.categories) && m.categories.length > 0, "categories must be a non-empty list");
  for (const s of ["casaos", "umbrel", "truenas", "portainer"]) need(m.store_categories?.[s] !== undefined, `store_categories.${s} is required`);
  need(str(m.icon?.png) && str(m.icon?.svg), "icon.png and icon.svg are required");
  need(Array.isArray(m.screenshots) && m.screenshots.length >= 1, "screenshots must list at least one image");
  for (const k of ["website", "docs", "support", "changelog", "security"]) need(str(m.links?.[k]), `links.${k} is required`);
  need(typeof m.license === "string" && SPDX.test(m.license), "license must be an SPDX identifier");
  need(str(m.maintainer?.name) && str(m.maintainer?.url), "maintainer.name and maintainer.url are required");
  need(!/@/.test(JSON.stringify(m.maintainer ?? {})), "maintainer must not carry an email address");
  for (const port of ["web", "webrtc"]) {
    need(Number.isInteger(m.ports?.[port]?.container) && Number.isInteger(m.ports?.[port]?.host), `ports.${port}.container and .host are required`);
  }
  need(Number.isInteger(m.ports?.web?.umbrel) && Number.isInteger(m.ports?.web?.truenas), "ports.web.umbrel and ports.web.truenas are required");
  need(m.volumes && Object.keys(m.volumes).length > 0, "volumes are required");
  for (const s of ["casaos", "umbrel"]) need(str(m.volume_paths?.[s]) && m.volume_paths[s].includes("{volume}"), `volume_paths.${s} must contain {volume}`);
  need(m.env && typeof m.env === "object", "env is required");
  for (const [name, v] of Object.entries(m.env ?? {})) {
    need(/^[A-Z][A-Z0-9_]*$/.test(name), `env ${name} is not a variable name`);
    need(str(v?.label), `env ${name} needs a label`);
    need(v?.default === undefined || typeof v.default === "string", `env ${name}: default must be a string`);
  }
  const r = m.release;
  need(r && str(r.version) && str(r.app_tag) && str(r.postgres_tag), "release.version, .app_tag and .postgres_tag are required");
  for (const [ref, d] of Object.entries(r?.digests ?? {})) need(DIGEST.test(String(d)), `release.digests: ${ref} is not a sha256 digest`);
  return p;
}

/**
 * The image names from docker.yml's top-level `env`, with the repository's
 * owner filled in, lowercased as registries require.
 * @param {string} text  docker.yml
 * @param {string} owner the repository's owner
 */
export function imageNamesFromWorkflow(text, owner) {
  const wf = yaml.load(text);
  const env = wf?.env ?? {};
  const fill = (v) => String(v).replace(/\$\{\{\s*github\.repository_owner\s*\}\}/g, owner).toLowerCase();
  for (const k of ["REGISTRY", "IMAGE_NAME", "POSTGRES_IMAGE_NAME", "UPDATER_IMAGE_NAME"]) {
    if (typeof env[k] !== "string" || !env[k]) throw new Error(`docker.yml: env.${k} is missing`);
  }
  const registry = fill(env.REGISTRY);
  return {
    app: `${registry}/${fill(env.IMAGE_NAME)}`,
    postgres: `${registry}/${fill(env.POSTGRES_IMAGE_NAME)}`,
    updater: `${registry}/${fill(env.UPDATER_IMAGE_NAME)}`,
  };
}

/**
 * The channel tags docker.yml publishes: the stable one (only from a release
 * tag without a prerelease part) and the release-candidate one, for the app's
 * image (IMAGE_TAGS) and the database's (POSTGRES_IMAGE_TAGS).
 * @param {string} text docker.yml
 */
export function channelsFromWorkflow(text) {
  const env = yaml.load(text)?.env ?? {};
  const read = (key) => {
    const raws = [...String(env[key] ?? "").matchAll(/type=raw,value=([^,\s]+),enable=\$\{\{([^}]*)\}\}/g)];
    const stable = raws.find(([, , cond]) => /!contains\(/.test(cond))?.[1];
    const next = raws.find(([, , cond]) => /&&\s*contains\(/.test(cond))?.[1];
    if (!stable || !next) throw new Error(`docker.yml: ${key} has no stable and release-candidate channel tags`);
    return { stable, next };
  };
  return { app: read("IMAGE_TAGS"), postgres: read("POSTGRES_IMAGE_TAGS") };
}

/**
 * Loads and checks every input. Throws with every problem at once.
 * @param {string} [root]
 */
export function loadSources(root = REPO_ROOT) {
  const metaFile = metadataPath(root);
  const meta = yaml.load(readFileSync(join(root, metaFile), "utf8"));
  const problems = metadataProblems(meta, metaFile);
  const pkg = JSON.parse(readFileSync(join(root, "webapp", "package.json"), "utf8"));
  if (meta?.license && pkg.license !== meta.license) {
    problems.push(`${metaFile}: license ${meta.license} differs from webapp/package.json's ${pkg.license}`);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  const composeText = readFileSync(join(root, "compose.yml"), "utf8");
  const compose = yaml.load(composeText);
  const owner = meta.repository.split("/")[0];
  const workflow = readFileSync(join(root, ".github", "workflows", "docker.yml"), "utf8");
  const images = imageNamesFromWorkflow(workflow, owner);
  const channels = channelsFromWorkflow(workflow);
  return { root, metaFile, meta, compose, composeText, images, channels };
}
