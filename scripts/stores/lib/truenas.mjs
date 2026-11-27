/**
 * TrueNAS apps catalog (24.10 and later): ix-dev/community/<app>/ with
 * app.yaml, item.yaml, ix_values.yaml, questions.yaml, README.md,
 * templates/docker-compose.yaml (Jinja2 over TrueNAS's Python library) and
 * templates/test_values/basic-values.yaml (truenas/apps CONTRIBUTIONS.md and
 * .github/scripts/; RFC-024 §5.2).
 *
 * The database is a plain container on the stock database image, not the library's
 * tpl.deps.postgres(…): that helper only takes stock postgres images, which
 * can't load safeupdate (RFC-024 §4.2.1, §5.2, §11.11).
 *
 * TrueNAS drops every Linux capability by default. The containers that start
 * as root to hand their folders over and drop to their own user (the
 * database, the app's entrypoint) get back exactly the five that takes,
 * which is TrueNAS's own usual set for such images.
 *
 * Fields TrueNAS's generate_metadata.py writes (capabilities,
 * run_as_context, maintainers, sources, item.yaml) are written here the way
 * it writes them, and scripts/stores/validate-upstream.sh runs that tool to
 * prove they match.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dumpYaml, links, pinnedImages, splitRef } from "./common.mjs";
import { serviceModel, unescapeDollar } from "./model.mjs";

/** TrueNAS's pinned tooling: scripts/stores/upstream.json. */
export function upstreamPins(root) {
  return JSON.parse(readFileSync(join(root, "scripts", "stores", "upstream.json"), "utf8"));
}

const ROOT_CAPS = ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"];
/** What each kind of service needs back, by the image's own start. */
const CAPS = {
  // The init step writes and chowns the secrets; the entrypoint hands the
  // uploads folder to PUID/PGID and drops to it.
  app: ROOT_CAPS,
  // The official entrypoint chowns its data folder and drops to postgres.
  postgres: ROOT_CAPS,
};

// generate_metadata.py's texts, for the fields it writes.
const CAPABILITY_DESCRIPTIONS = {
  CHOWN: "able to change file ownership arbitrarily",
  DAC_OVERRIDE: "able to bypass file permission checks",
  FOWNER: "able to bypass permission checks for file operations",
  SETGID: "able to change group ID of processes",
  SETUID: "able to change user ID of processes",
};
const TRUENAS_MAINTAINERS = [{ email: "dev@truenas.com", name: "truenas", url: "https://www.truenas.com/" }];
const HOST_NAMES = { 0: "root", 568: "apps", 1000: null };
const normalize = (s) => s.toLowerCase().replace(/[_\- ]/g, "");
const serviceTitle = (service, appTitle) =>
  normalize(service) === normalize(appTitle)
    ? appTitle
    : service.replace(/[-_]/g, " ").replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/** A JSON literal is a valid Jinja literal for the strings and lists used here. */
const lit = (v) => JSON.stringify(v);
const jinjaName = (service) => `c_${service.replace(/[^A-Za-z0-9]/g, "_")}`;
const seconds = (v) => Number(String(v).replace(/s$/, ""));

export function truenas(src) {
  const { meta, images: names, root } = src;
  const pins = upstreamPins(root).truenas;
  const app = meta.slug;
  const appKey = app.replace(/-/g, "_");
  const images = pinnedImages(meta, names);
  const l = links(meta);

  // Image keys in ix_values.yaml ("keys end in image"): the app's is `image`,
  // its database's `postgres_image`, the rest by the repository's last part.
  const imageKeys = {};
  const keyFor = (kind, ref) => {
    const key = kind === "app" ? "image" : kind === "postgres" ? "postgres_image"
      : `${splitRef(ref).repository.split("/").pop().replace(/[^a-z0-9]/g, "_")}_image`;
    imageKeys[key] = splitRef(ref);
    return key;
  };

  // Offered variables: TZ, PUID and PGID come from TrueNAS's own questions
  // (the library adds them to every container); the rest from ours.
  const AUTO = { TZ: "TZ", PUID: "run_as.user", PGID: "run_as.group" };
  const token = (name) => `\u0000${name}\u0000`;
  const model = serviceModel(src, { images, env: (name) => token(name) });
  const own = Object.keys(meta.env).filter((n) => !(n in AUTO));

  const lines = ["{% set tpl = ix_lib.base.render.Render(values) %}", ""];
  const users = {};
  const caps = {};
  for (const [name, s] of Object.entries(model)) {
    const c = jinjaName(name);
    const key = keyFor(s.kind, s.image);
    lines.push(`{# ${name} #}`);
    lines.push(`{% set ${c} = tpl.add_container(${lit(name)}, ${lit(key)}) %}`);
    if (s.entrypoint !== undefined) {
      const ep = Array.isArray(s.entrypoint) ? s.entrypoint : [s.entrypoint];
      lines.push(`{% do ${c}.set_entrypoint(${lit(ep.map(unescapeDollar))}) %}`);
    }
    if (s.command !== undefined) {
      const cmd = Array.isArray(s.command) ? s.command : String(s.command).split(" ");
      lines.push(`{% do ${c}.set_command(${lit(cmd.map(unescapeDollar))}) %}`);
    }
    if (s.oneShot) lines.push(`{% do ${c}.restart.set_policy("on-failure", 1) %}`);
    const hc = s.healthcheck;
    if (!hc || hc.disable) {
      lines.push(`{% do ${c}.healthcheck.disable() %}`);
    } else {
      lines.push(`{% do ${c}.healthcheck.set_custom_test(${lit(hc.test)}) %}`);
      if (hc.interval) lines.push(`{% do ${c}.healthcheck.set_interval(${seconds(hc.interval)}) %}`);
      if (hc.timeout) lines.push(`{% do ${c}.healthcheck.set_timeout(${seconds(hc.timeout)}) %}`);
      if (hc.retries) lines.push(`{% do ${c}.healthcheck.set_retries(${hc.retries}) %}`);
      if (hc.start_period) lines.push(`{% do ${c}.healthcheck.set_start_period(${seconds(hc.start_period)}) %}`);
    }
    if (CAPS[s.kind]) lines.push(`{% do ${c}.add_caps(${lit(CAPS[s.kind])}) %}`);
    if (s.kind === "postgres") lines.push(`{% do ${c}.set_grace_period(60) %}`);
    for (const [dep, cond] of Object.entries(s.dependsOn)) {
      lines.push(`{% do ${c}.depends.add_dependency(${lit(dep)}, ${lit(cond.condition)}) %}`);
    }
    for (const [k, v] of Object.entries(s.environment)) {
      const m = /^\u0000([A-Z0-9_]+)\u0000$/.exec(v);
      if (m && m[1] in AUTO) continue; // the library adds it
      if (m) lines.push(`{% do ${c}.environment.add_env(${lit(k)}, values.${appKey}.${m[1].toLowerCase()}) %}`);
      else if (v.includes("\u0000")) throw new Error(`truenas: ${name}.${k} mixes a setting into a longer value`);
      else lines.push(`{% do ${c}.environment.add_env(${lit(k)}, ${lit(v)}) %}`);
    }
    for (const p of s.ports) {
      const port = meta.ports[p];
      lines.push(`{% do ${c}.add_port(values.network.${p}_port, {"container_port": ${port.container}${port.protocol ? `, "protocol": ${lit(port.protocol)}` : ""}}) %}`);
    }
    for (const v of s.volumes) {
      const cfg = v.readOnly ? `dict(values.storage.${v.volume}, **{"read_only": true})` : `values.storage.${v.volume}`;
      lines.push(`{% do ${c}.add_storage(${lit(v.target)}, ${cfg}) %}`);
    }
    lines.push("");
    if (!s.oneShot) users[name] = [0, 0];
    if (!s.oneShot) for (const cap of CAPS[s.kind] ?? []) (caps[cap] ??= new Set()).add(name);
  }
  lines.push(`{% do tpl.portals.add(values.network.web_port) %}`, "", "{{ tpl.render() | tojson }}", "");

  // ---- metadata, the way generate_metadata.py writes it
  const appVersion = imageKeys.image.tag.split("@")[0];
  const capabilities = Object.entries(caps)
    .map(([cap, svcs]) => {
      const titles = [...svcs].map((s) => serviceTitle(s, meta.name)).sort();
      return { description: `${titles.join(", ")} ${titles.length === 1 ? "is" : "are"} ${CAPABILITY_DESCRIPTIONS[cap]}`, name: cap };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const runAs = Object.entries(users)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([service, [uid, gid]]) => ({
      description: `Container [${service}] runs as root user and group.`,
      gid,
      group_name: `Host group is [${HOST_NAMES[gid]}]`,
      uid,
      user_name: `Host user is [${HOST_NAMES[uid]}]`,
    }));
  const media = `https://media.sys.truenas.net/apps/${app}`;
  const appYaml = {
    annotations: { min_scale_version: pins.min_scale_version },
    app_version: appVersion,
    capabilities,
    categories: [meta.store_categories.truenas],
    changelog_url: l.changelog,
    description: meta.description.short,
    home: l.website,
    host_mounts: [],
    // TrueNAS's reviewers upload the icon and screenshots to their CDN
    // (CONTRIBUTIONS.md); these are the addresses they end up at. The source
    // images are linked from the README.
    icon: `${media}/icons/icon.png`,
    keywords: meta.keywords,
    lib_version: pins.lib_version,
    lib_version_hash: pins.lib_version_hash,
    maintainers: TRUENAS_MAINTAINERS,
    name: app,
    run_as_context: runAs,
    screenshots: meta.screenshots.map((_, i) => `${media}/screenshots/screenshot${i + 1}.png`),
    sources: [`https://apps.truenas.com/catalog/${app}_community/`, l.repo].sort(),
    title: meta.name,
    train: "community",
    version: pins.app_version,
    risks: [],
  };
  const item = {
    categories: appYaml.categories,
    icon_url: appYaml.icon,
    screenshots: appYaml.screenshots,
    tags: appYaml.keywords,
  };

  const ixValues = {
    images: Object.fromEntries(Object.entries(imageKeys).map(([k, v]) => [k, { repository: v.repository, tag: v.tag }])),
    consts: {},
  };

  // ---- questions
  const group = `${meta.name} Configuration`;
  const storageQuestion = (vol) => ({
    variable: vol,
    label: `${meta.volumes[vol].label} Storage`,
    description: `Where ${meta.name} keeps ${meta.volumes[vol].description}.`,
    schema: {
      type: "dict",
      attrs: [
        {
          variable: "type",
          label: "Type",
          description: "ixVolume: Is dataset created automatically by the system.</br>\nHost Path: Is a path that already exists on the system.\n",
          schema: {
            type: "string",
            required: true,
            default: "ix_volume",
            enum: [
              { value: "host_path", description: "Host Path (Path that already exists on the system)" },
              { value: "ix_volume", description: "ixVolume (Dataset created automatically by the system)" },
            ],
          },
        },
        {
          variable: "ix_volume_config",
          label: "ixVolume Configuration",
          description: "The configuration for the ixVolume dataset.",
          schema: {
            type: "dict",
            show_if: [["type", "=", "ix_volume"]],
            $ref: ["normalize/ix_volume"],
            attrs: [
              { variable: "acl_enable", label: "Enable ACL", description: "Enable ACL for the storage.", schema: { type: "boolean", default: false } },
              { variable: "dataset_name", label: "Dataset Name", description: "The name of the dataset to use for storage.", schema: { type: "string", required: true, hidden: true, default: vol } },
              { variable: "acl_entries", label: "ACL Configuration", schema: { type: "dict", show_if: [["acl_enable", "=", true]], attrs: [] } },
            ],
          },
        },
        {
          variable: "host_path_config",
          label: "Host Path Configuration",
          schema: {
            type: "dict",
            show_if: [["type", "=", "host_path"]],
            attrs: [
              { variable: "acl_enable", label: "Enable ACL", description: "Enable ACL for the storage.", schema: { type: "boolean", default: false } },
              { variable: "acl", label: "ACL Configuration", schema: { type: "dict", show_if: [["acl_enable", "=", true]], attrs: [], $ref: ["normalize/acl"] } },
              { variable: "path", label: "Host Path", description: "The host path to use for storage.", schema: { type: "hostpath", show_if: [["acl_enable", "=", false]], required: true } },
            ],
          },
        },
      ],
    },
  });
  const portQuestion = (p, label) => ({
    variable: `${p}_port`,
    label,
    schema: {
      type: "dict",
      attrs: [
        {
          variable: "bind_mode",
          label: "Port Bind Mode",
          description: "The port bind mode.</br>\n- Publish: The port will be published on the host for external access.</br>\n- Expose: The port will be exposed for inter-container communication.</br>\n- None: The port will not be exposed or published.\n",
          schema: {
            type: "string",
            default: "published",
            enum: [
              { value: "published", description: "Publish port on the host for external access" },
              { value: "exposed", description: "Expose port for inter-container communication" },
              { value: "", description: "None" },
            ],
          },
        },
        { variable: "port_number", label: "Port Number", schema: { type: "int", default: meta.ports[p][p === "web" ? "truenas" : "host"], min: 1, max: 65535, required: true } },
        {
          variable: "host_ips",
          label: "Host IPs",
          description: "IPs on the host to bind this port",
          schema: { type: "list", show_if: [["bind_mode", "=", "published"]], default: [], items: [{ variable: "host_ip", label: "Host IP", schema: { type: "string", required: true, $ref: ["definitions/node_bind_ip"] } }] },
        },
      ],
    },
  });
  const usedVolumes = [...new Set(Object.values(model).flatMap((s) => s.volumes.map((v) => v.volume)))];
  const usedPorts = [...new Set(Object.values(model).flatMap((s) => s.ports))];
  const questions = {
    groups: [
      { name: group, description: `Configure ${meta.name}` },
      { name: "User and Group Configuration", description: `Configure User and Group for ${meta.name}` },
      { name: "Network Configuration", description: `Configure Network for ${meta.name}` },
      { name: "Storage Configuration", description: `Configure Storage for ${meta.name}` },
      { name: "Resources Configuration", description: `Configure Resources for ${meta.name}` },
    ],
    questions: [
      { variable: "TZ", group, label: "Timezone", schema: { type: "string", default: meta.env.TZ?.default ?? "Etc/UTC", required: true, $ref: ["definitions/timezone"] } },
      {
        variable: appKey,
        label: "",
        group,
        schema: {
          type: "dict",
          attrs: own.map((n) => ({ variable: n.toLowerCase(), label: meta.env[n].label, schema: { type: "string", default: meta.env[n].default ?? "" } })),
        },
      },
      {
        variable: "run_as",
        label: "",
        group: "User and Group Configuration",
        schema: {
          type: "dict",
          attrs: [
            { variable: "user", label: "User ID", description: `The user id that ${meta.name}'s uploaded files will be owned by.`, schema: { type: "int", min: 1, default: Number(meta.env.PUID.default), required: true } },
            { variable: "group", label: "Group ID", description: `The group id that ${meta.name}'s uploaded files will be owned by.`, schema: { type: "int", min: 1, default: Number(meta.env.PGID.default), required: true } },
          ],
        },
      },
      {
        variable: "network",
        label: "",
        group: "Network Configuration",
        schema: { type: "dict", attrs: usedPorts.map((p) => portQuestion(p, p === "web" ? "WebUI Port" : `${p.toUpperCase()} Port (${meta.ports[p].protocol ?? "tcp"})`)) },
      },
      { variable: "storage", label: "", group: "Storage Configuration", schema: { type: "dict", attrs: usedVolumes.map(storageQuestion) } },
      {
        variable: "resources",
        label: "",
        group: "Resources Configuration",
        schema: {
          type: "dict",
          attrs: [
            {
              variable: "limits",
              label: "Limits",
              schema: {
                type: "dict",
                attrs: [
                  { variable: "cpus", label: "CPUs", description: `CPUs limit for ${meta.name}.`, schema: { type: "int", default: 2, required: true } },
                  { variable: "memory", label: "Memory (in MB)", description: `Memory limit for ${meta.name}.`, schema: { type: "int", default: 4096, required: true } },
                ],
              },
            },
          ],
        },
      },
    ],
  };

  // ---- the test values TrueNAS's CI renders and starts
  const testValues = {
    resources: { limits: { cpus: 2.0, memory: 4096 } },
    TZ: "Etc/UTC",
    [appKey]: Object.fromEntries(own.map((n) => [n.toLowerCase(), meta.env[n].default ?? ""])),
    network: Object.fromEntries(usedPorts.map((p) => [`${p}_port`, { bind_mode: "published", port_number: meta.ports[p][p === "web" ? "truenas" : "host"] }])),
    run_as: { user: Number(meta.env.PUID.default), group: Number(meta.env.PGID.default) },
    ix_volumes: Object.fromEntries(usedVolumes.map((v) => [v, `/opt/tests/mnt/${app}/${v}`])),
    storage: Object.fromEntries(usedVolumes.map((v) => [v, { type: "ix_volume", ix_volume_config: { dataset_name: v, create_host_path: true } }])),
  };

  // ---- README: only a title and paragraphs, links and emphasis show in TrueNAS's UI.
  const para = (s) => s.trim().split(/\n{2,}/).map((x) => x.replace(/\s*\n\s*/g, " ")).join("\n\n");
  const readme = [
    `# ${meta.name}`,
    "",
    para(meta.description.long.en),
    "",
    `<strong>First start.</strong> ${para(meta.first_run.en)}`,
    "",
    `Documentation: <a href="${l.docs}">${l.docs}</a>. Support: <a href="${l.support}">${l.support}</a>. ` +
      `Source and license (${meta.license}): <a href="${l.repo}">${l.repo}</a>.`,
    "",
  ].join("\n");

  const dir = `truenas/ix-dev/community/${app}`;
  return {
    [`${dir}/app.yaml`]: dumpYaml(appYaml),
    [`${dir}/item.yaml`]: dumpYaml(item),
    [`${dir}/ix_values.yaml`]: dumpYaml(ixValues),
    [`${dir}/questions.yaml`]: dumpYaml(questions),
    [`${dir}/README.md`]: readme,
    [`${dir}/templates/docker-compose.yaml`]: lines.join("\n"),
    [`${dir}/templates/test_values/basic-values.yaml`]: dumpYaml(testValues),
  };
}
