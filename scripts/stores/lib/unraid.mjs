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
import { DOCKER_SOCKET } from "./model.mjs";

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
  const updaterFile = `templates/${meta.slug}-updater.xml`;
  return {
    repo, file, templateUrl: `https://raw.githubusercontent.com/${repo}/main/${file}`, web: `https://github.com/${repo}`,
    updaterFile, updaterTemplateUrl: `https://raw.githubusercontent.com/${repo}/main/${updaterFile}`,
  };
}

/**
 * compose.yml's updater service, as the Unraid template needs it: its
 * container name, its entrypoint, the variables it sets to fixed values, and
 * the folder it keeps its state in (the mount that is not the socket).
 * @param {any} compose
 */
export function composeUpdater(compose) {
  const svc = compose?.services?.updater;
  if (!svc) throw new Error("compose.yml has no updater service");
  const entrypoint = [].concat(svc.entrypoint ?? [])[0];
  const env = Object.entries(svc.environment ?? {}).filter(([, v]) => !String(v).includes("${"));
  const state = (svc.volumes ?? []).map(String).find((v) => !v.includes(DOCKER_SOCKET))?.split(":").pop();
  if (!svc.container_name || !entrypoint || !state) throw new Error("compose.yml's updater lacks a container_name, an entrypoint or a state volume");
  return { name: String(svc.container_name), entrypoint: String(entrypoint), env, state };
}

/**
 * The second template: the updater beside the all-in-one container
 * (RFC-024 §4.7's Unraid row), on the same channel tag. The one container on
 * the server that gets the Docker socket; the all-in-one template never does
 * (lib/checks.mjs holds both). It names the container it updates (the first
 * template's Name, which Unraid makes the container's name), keeps its
 * journal in a folder of its own, and runs compose.yml's updater entrypoint
 * instead of the image's own (the git install's webhook).
 */
export function unraidUpdater(src, tag) {
  const { meta, images } = src;
  const l = links(meta);
  const { updaterTemplateUrl } = unraidRepo(meta);
  const up = meta.aio.unraid.updater;
  const c = composeUpdater(src.compose);
  const overview = [
    `Automatic updates for ${meta.name}'s all-in-one container (the ${meta.name} template), the way the compose file's updater does them. Two minutes after it starts, and then every 30 minutes, it asks the registry whether the tag ${meta.name} runs has a newer image. When it has, it takes ${meta.name}'s own checked database dump (into the data folder's backups), replaces the container with one that has exactly the same settings and only the new image, waits for it to come up healthy and pass a check of its database, and otherwise puts the previous container back and skips that release. A version tag (1.18.0) never moves. ${meta.name}'s Settings shows what it did.`,
    `It needs the Docker socket to pull and replace containers, and whoever holds that controls the server: this is the only container that gets it. It opens no port. It only ever replaces the one container named under "${meta.name} container" (${up.container_env}), and only while that runs the all-in-one image.`,
    `Leave ${meta.name} out of the Auto Update Applications plugin while this runs: that plugin takes no backup and does not go back when an update fails. To pause, set ${up.switch_env} to off.`,
  ].join("\n\n");
  const config = [
    { Name: "Docker socket", Target: DOCKER_SOCKET, Default: DOCKER_SOCKET, Mode: "rw", Description: `Docker's socket, to pull images and replace the ${meta.name} container. Only this container gets it.`, Type: "Path", Display: "always", Required: "true", Mask: "false" },
    { Name: "Updater folder", Target: c.state, Default: `/mnt/user/appdata/${c.name}`, Mode: "rw", Description: "The updater's log and its record of an update in progress, so that one cut short (a reboot mid-update) is put back.", Type: "Path", Display: "always", Required: "true", Mask: "false" },
    { Name: `${meta.name} container`, Target: up.container_env, Default: meta.name, Description: `The name of the ${meta.name} container this updater looks after (the Name in its template).`, Type: "Variable", Display: "always", Required: "true", Mask: "false" },
    { Name: "Automatic updates", Target: up.switch_env, Default: "on", Description: "on, or off to pause them (read when the container starts).", Type: "Variable", Display: "advanced", Required: "false", Mask: "false" },
    { Name: "Time zone", Target: "TZ", Default: meta.env?.TZ?.default ?? "Europe/Berlin", Description: "Time zone", Type: "Variable", Display: "advanced", Required: "false", Mask: "false" },
    ...c.env.map(([k, v]) => ({ Name: k, Target: k, Default: String(v), Description: "Set as compose.yml's updater sets it.", Type: "Variable", Display: "advanced-hide", Required: "true", Mask: "false" })),
  ];
  return [
    '<?xml version="1.0"?>',
    `<!-- Generated from ${src.metaFile}, compose.yml and docker.yml by scripts/stores/build-store-listings.mjs. Do not edit by hand. -->`,
    '<Container version="2">',
    el("Name", c.name),
    el("Repository", `${images.updater}:${tag}`),
    el("Registry", `https://github.com/${meta.repository}/pkgs/container/${images.updater.split("/").pop()}`),
    el("Network", "bridge"),
    el("Shell", "sh"),
    el("Privileged", "false"),
    el("Support", l.support),
    el("Project", l.website),
    el("Overview", overview),
    el("Category", up.category),
    el("TemplateURL", updaterTemplateUrl),
    el("Icon", rawUrl(meta, meta.icon.png)),
    el("ExtraParams", `--entrypoint=${c.entrypoint}`),
    el("Requires", `The ${meta.name} template (the all-in-one container) on this server.`),
    el("ExtraSearchTerms", `${meta.slug} update updater`),
    el("License", meta.license),
    ...(src.channels.aio.stable ? [] : [el("Beta", "true")]),
    ...config.map((x) => `  <Config ${attrs(x)}>${xmlEscape(x.Default)}</Config>`),
    "</Container>",
    "",
  ].join("\n");
}

/** The Overview's sentence on HTTPS, with the wiki page that explains it. */
export const httpsNote = (meta) => `${meta.aio.https.en} ${links(meta).docs}/HTTPS`;

/**
 * Unraid's own Tailscale tags (dynamix.docker.manager: Helpers.php's xmlToVar
 * reads them, CreateDocker.php shows them under "Use Tailscale", and the
 * container hook turns them into TAILSCALE_* variables). CA's field
 * reference does not list them; Unraid 7 reads them from any template.
 * TailscaleEnabled stays false: the household switches it on. Serve's port is
 * the web port inside the container, the one the hook proxies to.
 * TailscaleWebUI is what Unraid itself writes for Serve, so the Docker page's
 * menu offers the https address once it is on.
 */
export function tailscaleFields(meta) {
  const t = meta.aio.unraid.tailscale;
  return {
    TailscaleEnabled: "false",
    TailscaleIsExitNode: "false",
    TailscaleHostname: t.hostname.replaceAll("{slug}", meta.slug),
    TailscaleExitNodeIP: "",
    TailscaleSSH: "false",
    TailscaleUserspaceNetworking: t.userspace_networking,
    TailscaleLANAccess: "false",
    TailscaleServe: t.serve,
    TailscaleWebUI: "https://[hostname][magicdns]/",
    TailscaleServePort: String(meta.ports.web.container),
    TailscaleServeTarget: t.serve_target,
    TailscaleServeLocalPath: "",
    TailscaleServeProtocol: t.serve_protocol,
    TailscaleServeProtocolPort: "",
    TailscaleServePath: "",
    TailscaleDParams: "",
    TailscaleParams: "",
    TailscaleRoutes: "",
    TailscaleAcceptRoutes: "false",
    TailscaleStateDir: t.state_dir,
  };
}

export function unraid(src) {
  const { meta, images, channels, root } = src;
  const l = links(meta);
  const u = meta.aio.unraid;
  const { templateUrl, web, file, updaterFile } = unraidRepo(meta);
  const stable = channels.aio.stable;
  const tag = stable ?? channels.aio.next;
  const dataPath = u.data_path.replaceAll("{slug}", meta.slug);

  const changelogPath = join(root, "CHANGELOG.md");
  const section = existsSync(changelogPath) ? changelogSection(readFileSync(changelogPath, "utf8"), meta.release.version) : null;
  const changes = section
    ? `${meta.release.version}\n\n${section.length > 3000 ? `${section.slice(0, 3000).replace(/\n[^\n]*$/, "")}\n\n…` : section}\n\nEvery release: ${l.changelog}`
    : `Release notes for every version: ${l.changelog}`;

  const overview = [meta.description.long.en, meta.aio.note.en, httpsNote(meta), meta.aio.first_run.en].join("\n\n");

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
    ...Object.entries(tailscaleFields(meta)).map(([tag, v]) => el(tag, v)),
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
    "## Automatic updates",
    "",
    `\`${updaterFile}\` is a second, optional container, \`${meta.slug}-updater\`, that keeps ${meta.name} up to date: it checks the`,
    `registry every 30 minutes, takes ${meta.name}'s own checked database dump, replaces the container with the same settings and`,
    "the new image, and puts the previous one back when the new one does not come up healthy. It is the only container",
    `that gets the Docker socket. Install it after ${meta.name}, leave its "${meta.name} container" at the Name you gave ${meta.name},`,
    `and leave ${meta.name} out of the Auto Update Applications plugin (no backup, no way back). Details: the wiki's All-in-one page.`,
    "",
    `HTTPS: switch on "Use Tailscale" in the container's settings (Unraid 7; Serve on port ${meta.ports.web.container} is preset, off by default),`,
    `or see ${l.docs}/HTTPS for the other ways and what each one means.`,
    "",
    `Support: ${l.support}. Documentation: ${l.docs}. Licence: ${meta.license}.`,
    "",
  ].join("\n");

  return {
    [`${UNRAID_DIR}/${file}`]: xml,
    [`${UNRAID_DIR}/${updaterFile}`]: unraidUpdater(src, tag),
    [`${UNRAID_DIR}/ca_profile.xml`]: profile,
    [`${UNRAID_DIR}/README.md`]: readme,
  };
}
