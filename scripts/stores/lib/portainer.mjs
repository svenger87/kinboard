/**
 * Portainer app templates, format version 3 (portainer/templates, branch v3,
 * schema.json; RFC-024 §5.5).
 *
 * A type 3 template is a compose stack that Portainer fetches from a public
 * Git repository, so the stack file is generated here too (portainer/compose.yml)
 * and the templates point at it on the main branch. It is compose.yml with
 * the database on the stock database image (RFC-024 §4.5: every listing runs
 * stock PostgreSQL with safeupdate), and it keeps compose.yml's variables:
 * Portainer fills them from the template's fields. Two templates: the stable
 * channel and release candidates, the same tags docker.yml publishes. Not
 * pinned by digest: a household updates with Portainer's "Pull and redeploy",
 * or turns on automatic updates.
 *
 * Unlike the other stores' listings, this one keeps the Docker-socket updater
 * (RFC-024 §4.7: Portainer has no update path of its own with a backup and a
 * rollback). It keeps compose.yml's profile too, so the updater, and with it
 * the socket, starts only when the template's switch sets COMPOSE_PROFILES
 * to the profile (the metadata's `opt_in`). Portainer keeps a template's file
 * in its own volume, out of the updater's reach, so the updater works in
 * container mode (RFC-023 §4.11.3).
 *
 * Plus a type 1 (single container) template for the all-in-one image
 * (RFC-024 §5.5, phase 5), on its stable channel tag once docker.yml
 * publishes one, on `next` until then.
 */
import { DIST } from "./sources.mjs";
import { dumpYaml, generatedNotice, links, rawUrl } from "./common.mjs";
import { variablesIn } from "./model.mjs";
import { aioEnv } from "./unraid.mjs";

export const PORTAINER_STACK = "portainer/compose.yml";

export function portainer(src) {
  const { meta, compose, images, channels } = src;
  const appImage = compose[`x-${meta.slug}-image`];
  // compose.yml's own names for the image and tag variables: <P>IMAGE, <P>TAG.
  const [imageVar, tagVar] = variablesIn(appImage);
  if (!imageVar?.endsWith("_IMAGE") || !tagVar?.endsWith("_TAG")) {
    throw new Error(`compose.yml's x-${meta.slug}-image must read an …_IMAGE and a …_TAG variable`);
  }
  const prefix = imageVar.slice(0, -"IMAGE".length);
  const pgImageVar = `${prefix}POSTGRES_IMAGE`;
  const pgTagVar = `${prefix}POSTGRES_TAG`;

  // The updater's image, as compose.yml names it: <P>UPDATER_IMAGE and the app's tag.
  const updaterImage = compose[`x-${meta.slug}-updater-image`];
  const [updaterImageVar, updaterTagVar] = updaterImage ? variablesIn(updaterImage) : [];
  if (updaterImage && (!updaterImageVar?.endsWith("_IMAGE") || updaterTagVar !== tagVar)) {
    throw new Error(`compose.yml's x-${meta.slug}-updater-image must read an …_IMAGE variable and ${tagVar}`);
  }

  const stack = structuredClone(compose);
  for (const key of Object.keys(stack)) if (key.startsWith("x-")) delete stack[key];
  for (const [name, why] of Object.entries(meta.omit_services ?? {})) if (why?.portainer !== undefined) delete stack.services[name];
  // The profiles the stack keeps, each with its switch (opt_in), checked by
  // profileProblems in sources.mjs: no other profile reaches here.
  const offered = [...new Set(Object.values(stack.services).flatMap((svc) => svc.profiles ?? []))];
  for (const pr of offered) if (!meta.opt_in?.[pr]?.stores?.includes("portainer")) throw new Error(`portainer: profile ${pr} has no switch (opt_in)`);
  const volumeVars = {};
  for (const [name, svc] of Object.entries(stack.services)) {
    for (const dep of Object.keys(svc.depends_on ?? {})) if (!(dep in stack.services)) delete svc.depends_on[dep];
    if (svc.image === appImage) {
      svc.image = `\${${imageVar}:-${images.app}}:\${${tagVar}:-${channels.app.stable}}`;
    } else if (name === "db") {
      svc.image = `\${${pgImageVar}:-${images.postgres}}:\${${pgTagVar}:-${channels.postgres.stable}}`;
    } else if (updaterImage && svc.image === updaterImage) {
      svc.image = `\${${updaterImageVar}:-${images.updater}}:\${${tagVar}:-${channels.app.stable}}`;
    }
    for (const v of svc.volumes ?? []) {
      const m = new RegExp(`^\\$\\{([A-Z0-9_]+):-${meta.slug}-([a-z]+)\\}:`).exec(String(v));
      if (m) volumeVars[m[2]] = m[1];
    }
  }

  const l = links(meta);
  // One switch for the opt-in profiles: COMPOSE_PROFILES, which Compose
  // reads from the stack's variables. Off (empty) unless chosen.
  const profileField = offered.length === 0 ? [] : [{
    name: "COMPOSE_PROFILES",
    label: meta.opt_in[offered[0]].label,
    description: meta.opt_in[offered[0]].description,
    select: [
      { text: meta.opt_in[offered[0]].off, value: "", default: true },
      { text: meta.opt_in[offered[0]].on, value: offered[0] },
    ],
  }];
  if (offered.length > 1) throw new Error("portainer: one switch takes one profile; more than one opt-in profile needs its own field design");
  const env = (channel) => [
    ...Object.entries(meta.env).map(([name, v]) => ({ name, label: v.label, ...(v.default !== undefined ? { default: v.default } : {}) })),
    ...Object.entries(volumeVars).map(([vol, name]) => ({
      name,
      label: `${meta.volumes[vol].label}: an absolute host folder instead of a Docker volume (set before the first start)`,
    })),
    { name: tagVar, label: "Image tag", default: channels.app[channel], preset: true },
    { name: pgTagVar, label: "Database image tag", default: channels.postgres[channel], preset: true },
    ...profileField,
  ];
  // The web port's variable, read from the stack's own port line.
  const webPortVar = Object.values(stack.services)
    .flatMap((s) => s.ports ?? [])
    .map((p) => new RegExp(`^\\$\\{([A-Z0-9_]+):-\\d+\\}:${meta.ports.web.container}$`).exec(String(p))?.[1])
    .find(Boolean);
  if (!webPortVar) throw new Error("portainer: compose.yml publishes no web port through a variable");
  const withPort = (list) => [{ name: webPortVar, label: "Web port", default: String(meta.ports.web.host) }, ...list];

  const base = {
    type: 3,
    categories: meta.store_categories.portainer,
    platform: "linux",
    logo: rawUrl(meta, meta.icon.png),
    repository: { url: l.repo, stackfile: `${DIST}/${PORTAINER_STACK}` },
  };
  const templates = {
    version: "3",
    templates: [
      {
        id: 1,
        title: meta.name,
        description: meta.description.short,
        note: `${meta.first_run.en} Open it at port ${meta.ports.web.host} of this machine. Documentation: ${l.docs}`,
        ...base,
        env: withPort(env("stable")),
      },
      {
        id: 2,
        title: `${meta.name} (release candidates)`,
        description: `${meta.description.short} Release candidates, for trying the next version before it is released.`,
        note: `${meta.first_run.en} Release candidates change often; for a household's everyday screen, use the stable template.`,
        ...base,
        env: withPort(env("next")),
      },
      aioTemplate(src),
    ],
  };

  // Every field of a template must reach the stack, or it would do nothing.
  const varsInStack = new Set([...JSON.stringify(stack).matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]));
  for (const t of templates.templates.filter((x) => x.type === 3)) {
    for (const e of t.env) {
      // COMPOSE_PROFILES is read by Compose itself, and does something only
      // when the stack has a service under that profile.
      const read = e.name === "COMPOSE_PROFILES" ? e.select?.every((o) => o.value === "" || offered.includes(o.value)) && offered.length > 0 : varsInStack.has(e.name);
      if (!read) throw new Error(`portainer: template variable ${e.name} is not read by the stack file`);
    }
  }
  return {
    [PORTAINER_STACK]: `${generatedNotice(src)}\n# The stack file of the Portainer app templates in templates.json.\n${offered.map((pr) => `# ${Object.keys(stack.services).filter((n) => stack.services[n].profiles?.includes(pr)).join(", ")} starts only with COMPOSE_PROFILES=${pr} (the template's "${meta.opt_in[pr].label}"); only then does any container get the Docker socket.\n`).join("")}${dumpYaml(stack)}`,
    "portainer/templates.json": `${JSON.stringify(templates, null, 2)}\n`,
  };
}

/** The all-in-one image as one container (type 1). */
function aioTemplate(src) {
  const { meta, images, channels } = src;
  const stable = channels.aio.stable;
  const tag = stable ?? channels.aio.next;
  const l = links(meta);
  return {
    id: 3,
    type: 1,
    title: stable ? `${meta.name} (all-in-one)` : `${meta.name} (all-in-one, release candidates)`,
    description: `${meta.description.short} One container with its database inside.`,
    note: `${meta.aio.note.en} ${meta.aio.first_run.en} Under Advanced, set the stop timeout to ${meta.aio.stop_timeout} seconds if your Portainer offers it, so the database always shuts down cleanly. Documentation: ${l.docs}`,
    categories: meta.store_categories.portainer,
    platform: "linux",
    logo: rawUrl(meta, meta.icon.png),
    image: `${images.aio}:${tag}`,
    restart_policy: "unless-stopped",
    ports: [`${meta.ports.web.host}:${meta.ports.web.container}/tcp`],
    volumes: [{ container: meta.aio.data }],
    env: Object.entries(aioEnv(meta)).map(([name, v]) => ({ name, label: v.label, ...(v.default !== undefined ? { default: v.default } : {}) })),
  };
}
