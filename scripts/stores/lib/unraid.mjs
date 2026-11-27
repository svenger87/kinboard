/**
 * The Unraid Community Applications template for the all-in-one image
 * (RFC-024 §5.1, §11.9, phase 5), in CA's documented format:
 *
 *   - https://ca.unraid.net/submit/help (repository layout, policies),
 *   - https://ca.unraid.net/submit/help/xml-field-reference (the tags),
 *   - unraid/unraid-community-apps-starter: templates/example-app.xml (a
 *     `<Container version="2">` with `Config` entries carrying Name, Target,
 *     Default, Mode, Description, Type, Display, Required and Mask) and
 *     ca_profile.xml (a `<CommunityApplications>` with a non-empty `<Profile>`).
 *
 * Written to dist/unraid/ as the whole content of the separate template
 * repository the RFC decides on (aio.unraid.repository in the metadata):
 * ca_profile.xml at its root, the template under templates/, and a README.
 * Nothing pushes there; the maintainer copies the folder (dist/README.md).
 *
 * The image is docker.yml's AIO_IMAGE_NAME on its stable channel tag when
 * AIO_IMAGE_TAGS publishes one, otherwise on `next` with `<Beta>true</Beta>`;
 * once both exist, `next` is offered as a second tag through `<Branch>`
 * (RFC-024 §4.7's channel table). Unpinned: Unraid's "update ready" compares
 * the tag's registry digest with the local image.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { links, rawUrl } from "./common.mjs";

export const UNRAID_DIR = "unraid";

/** XML text and attribute escaping (the five predefined entities). */
export const xmlEscape = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const el = (name, value) => `  <${name}>${xmlEscape(value)}</${name}>`;
const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${xmlEscape(v)}"`).join(" ");

/** The CHANGELOG.md section of a version, without its heading; null when there is none. */
export function changelogSection(text, version) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## ["));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return body || null;
}

/** The variables the all-in-one template offers: the metadata's, minus what it excludes, plus its own. */
export function aioEnv(meta) {
  const out = {};
  for (const [name, v] of Object.entries(meta.env)) {
    if ((meta.aio.env_exclude ?? []).includes(name)) continue;
    out[name] = { ...v };
  }
  // aio.env adds variables, and overrides the label or default of one the image reads differently.
  for (const [name, v] of Object.entries(meta.aio.env ?? {})) out[name] = { ...(out[name] ?? {}), ...v };
  return out;
}

/** The template's repository and its URLs. */
export function unraidRepo(meta) {
  const repo = meta.aio.unraid.repository;
  const file = `templates/${meta.slug}.xml`;
  return { repo, file, templateUrl: `https://raw.githubusercontent.com/${repo}/main/${file}`, web: `https://github.com/${repo}` };
}

export function unraid(src) {
  const { meta, images, channels, root } = src;
  const l = links(meta);
  const u = meta.aio.unraid;
  const { templateUrl, web, file } = unraidRepo(meta);
  const stable = channels.aio.stable;
  const tag = stable ?? channels.aio.next;
  const dataPath = u.data_path.replaceAll("{slug}", meta.slug);

  const changelogPath = join(root, "CHANGELOG.md");
  const section = existsSync(changelogPath) ? changelogSection(readFileSync(changelogPath, "utf8"), meta.release.version) : null;
  const changes = section
    ? `${meta.release.version}\n\n${section.length > 3000 ? `${section.slice(0, 3000).replace(/\n[^\n]*$/, "")}\n\n…` : section}\n\nEvery release: ${l.changelog}`
    : `Release notes for every version: ${l.changelog}`;

  const overview = [meta.description.long.en, meta.aio.note.en, meta.aio.first_run.en].join("\n\n");

  const config = [];
  config.push({
    Name: "Web UI", Target: String(meta.ports.web.container), Default: String(meta.ports.web.host), Mode: "tcp",
    Description: "The port families open in a browser.", Type: "Port", Display: "always", Required: "true", Mask: "false",
  });
  config.push({
    Name: "Data", Target: meta.aio.data, Default: dataPath, Mode: "rw",
    Description: `Everything ${meta.name} keeps: ${Object.values(meta.volumes).map((v) => v.description).join("; ")}. Back it up, and keep the backups private.`,
    Type: "Path", Display: "always", Required: "true", Mask: "false",
  });
  for (const [name, v] of Object.entries(aioEnv(meta))) {
    const def = name === "PUID" ? u.puid : name === "PGID" ? u.pgid : v.default ?? "";
    config.push({
      Name: v.label, Target: name, Default: def, Description: v.label, Type: "Variable",
      Display: v.advanced || name === "PUID" || name === "PGID" ? "advanced" : "always", Required: "false", Mask: "false",
    });
  }

  const xml = [
    '<?xml version="1.0"?>',
    `<!-- Generated from ${src.metaFile}, compose.yml and docker.yml by scripts/stores/build-store-listings.mjs. Do not edit by hand. -->`,
    '<Container version="2">',
    el("Name", meta.name),
    el("Repository", `${images.aio}:${tag}`),
    el("Registry", `https://github.com/${meta.repository}/pkgs/container/${images.aio.split("/").pop()}`),
    el("Network", "bridge"),
    el("Shell", "sh"),
    el("Privileged", "false"),
    el("Support", l.support),
    el("Project", l.website),
    el("Overview", overview),
    el("Category", u.category),
    el("WebUI", `http://[IP]:[PORT:${meta.ports.web.container}]/`),
    el("TemplateURL", templateUrl),
    el("Icon", rawUrl(meta, meta.icon.png)),
    el("ExtraParams", `--stop-timeout=${meta.aio.stop_timeout}`),
    el("Requires", meta.aio.requires.en),
    el("ExtraSearchTerms", meta.keywords.join(" ")),
    el("Changes", changes),
    el("MinVer", u.min_version),
    el("License", meta.license),
    ...(stable ? [] : [el("Beta", "true")]),
    ...meta.screenshots.map((s) => el("Screenshot", rawUrl(meta, s))),
    ...(stable && channels.aio.next ? [
      el("DefaultTagDescription", "Stable releases"),
      "  <Branch>",
      `    <Tag>${xmlEscape(channels.aio.next)}</Tag>`,
      "    <TagDescription>Release candidates: the next version, before it is released</TagDescription>",
      "  </Branch>",
    ] : []),
    ...config.map((c) => `  <Config ${attrs(c)}>${xmlEscape(c.Default)}</Config>`),
    "</Container>",
    "",
  ].join("\n");

  const profile = [
    '<?xml version="1.0"?>',
    `<!-- Generated from ${src.metaFile} by scripts/stores/build-store-listings.mjs. Do not edit by hand. -->`,
    "<CommunityApplications>",
    el("Profile", `${meta.name}: ${meta.tagline.en}. ${meta.description.short} Support: ${l.support}. Source and documentation: ${l.repo}.`),
    el("Icon", rawUrl(meta, meta.icon.png)),
    el("WebPage", l.website),
    "</CommunityApplications>",
    "",
  ].join("\n");

  const readme = [
    `# ${meta.name} for Unraid`,
    "",
    `The Unraid Community Applications template for ${meta.name}'s all-in-one image, \`${images.aio}\`.`,
    "",
    `Generated from ${l.repo} (\`${src.metaFile}\`) by \`scripts/stores/build-store-listings.mjs\`. Don't edit anything here by hand:`,
    `change the metadata there, regenerate, and copy \`dist/${UNRAID_DIR}/\` here.`,
    "",
    "## Install without Community Applications",
    "",
    `Add \`${web}\` to the Docker page's template repositories, or copy \`${file}\` (from \`${templateUrl}\`)`,
    "into `/boot/config/plugins/dockerMan/templates-user/` on the flash drive; then Docker → Add Container and pick the",
    "template. (To be confirmed on a real Unraid 7 box before any submission: RFC-024 §10.)",
    "",
    `Set the container's data folder (default \`${dataPath}\`) to a folder on a disk or the cache, and PUID/PGID to the`,
    `owner of that folder (${u.puid}:${u.pgid}, Unraid's nobody:users, by default). Moving an existing ${meta.name} install here:`,
    `\`${meta.slug} export\` on the old one, \`${meta.slug} import\` on this one (the wiki's All-in-one page).`,
    "",
    `Support: ${l.support}. Documentation: ${l.docs}. Licence: ${meta.license}.`,
    "",
  ].join("\n");

  return {
    [`${UNRAID_DIR}/${file}`]: xml,
    [`${UNRAID_DIR}/ca_profile.xml`]: profile,
    [`${UNRAID_DIR}/README.md`]: readme,
  };
}
