#!/usr/bin/env node
/**
 * release-compose.mjs: the compose.yml attached to a release (RFC-023 §4.6).
 *
 *   node scripts/release-compose.mjs <tag> <image> [in] [out]
 *     tag    the release's tag, vX.Y.Z or vX.Y.Z-rc.N
 *     image  the Kinboard image without its tag, from docker.yml's REGISTRY
 *            and IMAGE_NAME (the one place image names come from)
 *   UPDATER_IMAGE names kinboard-updater's image the same way (docker.yml's
 *   REGISTRY and UPDATER_IMAGE_NAME); without it, the image's name with
 *   "-updater" appended, as docker.yml names it.
 *     in     the repository's compose.yml (default: ./compose.yml)
 *     out    where to write the asset (default: stdout)
 *   REPO (owner/name) names the repository in the header's link.
 *
 * The asset is the repository's file at that tag with three changes:
 *
 *   - The image's name is docker.yml's, so a release can't hand out a file
 *     that pulls an image the release didn't publish. So is the updater's
 *     (RFC-023 §4.11.3), on its own x-kinboard-updater-image line.
 *   - The default tag is the release's channel: `latest` for a stable
 *     release, `next` for a release candidate. Not the version itself:
 *     `releases/latest/download/compose.yml` is the link households paste
 *     and install.sh downloads, and a file pinned to 1.18.0 would never
 *     update with Pull and Up, which is the whole update path (§4.7). A
 *     household that wants to stay on a version sets KINBOARD_TAG.
 *   - A first line saying which release and revision it is, so a file found
 *     on a disk a year later says where it came from.
 *
 * Anything the transformation expects and doesn't find is a refusal (exit 1)
 * rather than an asset that quietly differs from what was meant.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The one line every Kinboard image reference in compose.yml goes through. */
const IMAGE_LINE = /^x-kinboard-image: &kinboard-image \$\{KINBOARD_IMAGE:-([^}]+)\}:\$\{KINBOARD_TAG:-([^}]+)\}$/m;
const UPDATER_LINE = /^x-kinboard-updater-image: &kinboard-updater-image \$\{KINBOARD_UPDATER_IMAGE:-([^}]+)\}:\$\{KINBOARD_TAG:-([^}]+)\}$/m;
const REVISION = /^\s+KINBOARD_COMPOSE_REVISION: "([1-9][0-9]*)"$/m;
const TAG = /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const IMAGE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;

/**
 * The asset's text for a tag and an image name. Throws with a reason when the
 * input is not what this expects.
 *
 * @param {string} text  the repository's compose.yml
 * @param {{ tag: string, image: string, updaterImage?: string, repo?: string }} release
 * @returns {{ text: string, channel: "latest" | "next", revision: number }}
 */
export function releaseCompose(text, { tag, image, updaterImage, repo = "svenger87/kinboard" }) {
  const t = TAG.exec(tag ?? "");
  if (!t) throw new Error(`"${tag}" is not a release tag (vX.Y.Z or vX.Y.Z-rc.N)`);
  // Docker references are lowercase; GitHub owners need not be (GHCR lowercases them too).
  image = (image ?? "").toLowerCase();
  if (!IMAGE.test(image)) throw new Error(`"${image}" is not an image name without a tag (registry/owner/name)`);
  updaterImage = (updaterImage || `${image}-updater`).toLowerCase();
  if (!IMAGE.test(updaterImage)) throw new Error(`"${updaterImage}" is not an image name without a tag (registry/owner/name)`);
  const channel = t[4] ? "next" : "latest";

  const lines = text.match(new RegExp(IMAGE_LINE.source, "gm")) ?? [];
  if (lines.length !== 1) {
    throw new Error(`compose.yml must name the Kinboard image on exactly one x-kinboard-image line; found ${lines.length}`);
  }
  const updaterLines = text.match(new RegExp(UPDATER_LINE.source, "gm")) ?? [];
  if (updaterLines.length !== 1) {
    throw new Error(`compose.yml must name the updater's image on exactly one x-kinboard-updater-image line; found ${updaterLines.length}`);
  }
  const revisions = text.match(new RegExp(REVISION.source, "gm")) ?? [];
  if (revisions.length !== 1) {
    throw new Error(`compose.yml must declare KINBOARD_COMPOSE_REVISION exactly once; found ${revisions.length}`);
  }
  const revision = Number(REVISION.exec(text)[1]);
  if (!text.startsWith("# ")) throw new Error("compose.yml must start with its comment header");

  const body = text
    .replace(IMAGE_LINE, `x-kinboard-image: &kinboard-image \${KINBOARD_IMAGE:-${image}}:\${KINBOARD_TAG:-${channel}}`)
    .replace(
      UPDATER_LINE,
      `x-kinboard-updater-image: &kinboard-updater-image \${KINBOARD_UPDATER_IMAGE:-${updaterImage}}:\${KINBOARD_TAG:-${channel}}`,
    );
  const header = `# compose.yml from Kinboard ${tag}, revision ${revision}. Current file: ` +
    `https://github.com/${repo}/releases/latest/download/compose.yml\n`;
  return { text: header + body, channel, revision };
}

function main(argv) {
  const [tag, image, input = "compose.yml", output] = argv;
  if (!tag || !image) {
    process.stderr.write("usage: release-compose.mjs <tag> <image> [in] [out]\n");
    process.exit(2);
  }
  let result;
  try {
    result = releaseCompose(readFileSync(input, "utf8"), {
      tag, image, updaterImage: process.env.UPDATER_IMAGE || undefined, repo: process.env.REPO || undefined,
    });
  } catch (err) {
    process.stderr.write(`release-compose: ${err?.message ?? err}\n`);
    process.exit(1);
  }
  if (output) {
    writeFileSync(output, result.text);
    process.stderr.write(`release-compose: ${output} for ${tag}: ${image}, default tag ${result.channel}, revision ${result.revision}\n`);
  } else {
    process.stdout.write(result.text);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
