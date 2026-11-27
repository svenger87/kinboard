/** What every store renderer shares: links, pinned image references, YAML out. */
import { yaml } from "./sources.mjs";

/** The links of the metadata, absolute. */
export function links(meta) {
  const repo = `https://github.com/${meta.repository}`;
  const gh = (p) => (/^https?:\/\//.test(p) ? p : `${repo}/${p}`);
  return {
    website: meta.links.website,
    repo,
    docs: gh(meta.links.docs),
    support: gh(meta.links.support),
    changelog: gh(meta.links.changelog),
    security: gh(meta.links.security),
  };
}

/** A file of the repository, as a URL a store can fetch (main branch). */
export function rawUrl(meta, path) {
  return `https://raw.githubusercontent.com/${meta.repository}/main/${path}`;
}

/**
 * The image references a pinned listing uses: `repo:tag@sha256:…`, the
 * multi-arch index digest from the metadata's release block. A missing digest
 * is an error: a pinned listing never ships a moving reference.
 * @param {any} meta
 * @param {{ app: string, postgres: string }} names  docker.yml's image names
 */
export function pinnedImages(meta, names) {
  const r = meta.release;
  const pin = (ref) => {
    const digest = r.digests?.[ref];
    if (!digest) throw new Error(`release.digests has no digest for ${ref}; run scripts/stores/pin-release.mjs`);
    return `${ref}@${digest}`;
  };
  return {
    app: pin(`${names.app}:${r.app_tag}`),
    postgres: pin(`${names.postgres}:${r.postgres_tag}`),
    other: (ref) => pin(ref),
    /** Every reference that needs a digest, for pin-release. */
    refs: (otherRefs) => [`${names.app}:${r.app_tag}`, `${names.postgres}:${r.postgres_tag}`, ...otherRefs],
  };
}

/** `repo:tag@digest` → { repository, tag: "tag@digest" } (TrueNAS's split). */
export function splitRef(ref) {
  const at = ref.indexOf("@");
  const base = at === -1 ? ref : ref.slice(0, at);
  const colon = base.lastIndexOf(":");
  if (colon === -1 || base.slice(colon).includes("/")) throw new Error(`${ref} has no tag`);
  return { repository: base.slice(0, colon), tag: ref.slice(colon + 1) };
}

/** The first line of every generated text file. */
export function generatedNotice(src, comment = "#") {
  return `${comment} Generated from ${src.metaFile} and compose.yml by scripts/stores/build-store-listings.mjs. Do not edit by hand.`;
}

/** YAML the way the listings are written: no folding, no anchors, double quotes. */
export function dumpYaml(value) {
  return yaml.dump(value, { lineWidth: -1, noRefs: true, quotingType: '"', sortKeys: false });
}

/** Locale keys the way CasaOS writes them. */
export const CASA_LOCALE = { en: "en_US", de: "de_DE" };

/** A store path for a logical volume: {slug} and {volume} filled in. */
export function volumePath(meta, store, volume) {
  return meta.volume_paths[store].replaceAll("{slug}", meta.slug).replaceAll("{volume}", volume);
}
