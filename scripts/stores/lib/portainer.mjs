/**
 * Portainer app templates, format version 3 (portainer/templates, branch v3,
 * schema.json; RFC-024 §5.5).
 *
 * A type 3 template is a compose stack that Portainer fetches from a public
 * Git repository, so the stack file is generated here too (portainer/compose.yml)
 * and the templates point at it on the main branch. It is compose.yml with
 * the database on the stock database image (RFC-024 §4.5: every listing runs
 * stock PostgreSQL with safeupdate) and without the Docker-socket updater,
 * and it keeps compose.yml's variables: Portainer fills them from the
 * template's fields. Two templates: the stable channel and release
 * candidates, the same tags docker.yml publishes. Not pinned by digest: a
 * household updates with Portainer's "Pull and redeploy".
 *
 * The all-in-one image's single-container template (type 1) comes with that
 * image (RFC-024 phase 5).
 */
import { DIST } from "./sources.mjs";
import { dumpYaml, generatedNotice, links, rawUrl } from "./common.mjs";
import { variablesIn } from "./model.mjs";

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

  const stack = structuredClone(compose);
  for (const key of Object.keys(stack)) if (key.startsWith("x-")) delete stack[key];
  for (const name of Object.keys(meta.omit_services ?? {})) delete stack.services[name];
  const volumeVars = {};
  for (const [name, svc] of Object.entries(stack.services)) {
    for (const dep of Object.keys(svc.depends_on ?? {})) if (!(dep in stack.services)) delete svc.depends_on[dep];
    if (svc.image === appImage) {
      svc.image = `\${${imageVar}:-${images.app}}:\${${tagVar}:-${channels.app.stable}}`;
    } else if (name === "db") {
      svc.image = `\${${pgImageVar}:-${images.postgres}}:\${${pgTagVar}:-${channels.postgres.stable}}`;
    }
    for (const v of svc.volumes ?? []) {
      const m = new RegExp(`^\\$\\{([A-Z0-9_]+):-${meta.slug}-([a-z]+)\\}:`).exec(String(v));
      if (m) volumeVars[m[2]] = m[1];
    }
  }

  const l = links(meta);
  const env = (channel) => [
    ...Object.entries(meta.env).map(([name, v]) => ({ name, label: v.label, ...(v.default !== undefined ? { default: v.default } : {}) })),
    ...Object.entries(volumeVars).map(([vol, name]) => ({
      name,
      label: `${meta.volumes[vol].label}: an absolute host folder instead of a Docker volume (set before the first start)`,
    })),
    { name: tagVar, label: "Image tag", default: channels.app[channel], preset: true },
    { name: pgTagVar, label: "Database image tag", default: channels.postgres[channel], preset: true },
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
    ],
  };

  // Every field of a template must reach the stack, or it would do nothing.
  const varsInStack = new Set([...JSON.stringify(stack).matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]));
  for (const t of templates.templates) {
    for (const e of t.env) {
      if (!varsInStack.has(e.name)) throw new Error(`portainer: template variable ${e.name} is not read by the stack file`);
    }
  }
  return {
    [PORTAINER_STACK]: `${generatedNotice(src)}\n# The stack file of the Portainer app templates in templates.json.\n${dumpYaml(stack)}`,
    "portainer/templates.json": `${JSON.stringify(templates, null, 2)}\n`,
  };
}
