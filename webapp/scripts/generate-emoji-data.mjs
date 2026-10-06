#!/usr/bin/env node
// Generates the emoji picker's data from the pinned emojibase-data package
// (Unicode CLDR annotations, MIT):
//
//   webapp/src/lib/emoji/data/{en,de,fr}.json   what the picker shows and searches,
//                                               one file per screen language,
//                                               loaded lazily when it opens
//   webapp/src/lib/emoji/emoji-set.json         every emoji an icon may be, fully
//                                               qualified, for the server's validation
//   webapp/src/lib/emoji/data/LICENSE           emojibase's licence
//
//   node scripts/generate-emoji-data.mjs           write the files
//   node scripts/generate-emoji-data.mjs --check   exit 1 if they are stale
//
// What is left out, and why:
//   - the flags group: Windows draws no flag emoji, only two letters (#338)
//   - the components group (bare skin tones, hair) and the regional
//     indicators, which are parts of emoji rather than emoji
//   - anything newer than Emoji MAX_VERSION: what the fonts on the screens a
//     family runs (a Raspberry Pi's Noto Color Emoji, an older tablet) draw
//     as an empty box would be a broken icon on the wall
//
// Per entry: the emoji, its group, its name in the file's language, and one
// search string -- the name and keywords in that language and in English,
// lower case and without accents -- so "Eis", "ice" and "glace" all find the
// ice cream in the German file, and "glace" or "ice" in the French one.
// Emoji with skin tones carry their five single-tone variants; mixed tones
// (two people, two tones) are not offered.

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "src", "lib", "emoji");
const LOCALES = ["en", "de", "fr"];
export const MAX_VERSION = 15.0;
const LEFT_OUT_GROUPS = new Set(["component", "flags"]);

const pkgDir = dirname(require.resolve("emojibase-data/package.json"));
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const data = (l) => JSON.parse(readFileSync(join(pkgDir, l, "data.json"), "utf8"));
const messages = (l) => JSON.parse(readFileSync(join(pkgDir, l, "messages.json"), "utf8"));

/** Lower case, accents off, one space between words. */
const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
/** The emoji without its variation selectors, as the server compares them. */
const bare = (s) => s.replace(/[︎️]/g, "");

/**
 * The emoji as Unicode's fully qualified form writes it. emojibase's `emoji`
 * field adds a variation selector to some that are emoji by default ("📚" +
 * U+FE0F); its hexcode does not, and keeps the ones a sequence needs. An emoji
 * that is text by default ("🗑") keeps the selector from `emoji`, which is
 * what makes it draw in colour.
 */
const qualified = (e) =>
  e.type === 1 ? String.fromCodePoint(...e.hexcode.split("-").map((h) => parseInt(h, 16))) : e.emoji;

const en = data("en");
const enByHex = new Map(en.map((e) => [e.hexcode, e]));
const groupKeys = messages("en").groups.sort((a, b) => a.order - b.order);
const keptGroups = groupKeys.filter((g) => !LEFT_OUT_GROUPS.has(g.key));
const groupIndex = new Map(keptGroups.map((g, i) => [g.order, i]));

const offered = (e) => e.group !== undefined && groupIndex.has(e.group) && e.version <= MAX_VERSION;

function build(locale) {
  const rows = data(locale);
  const groupNames = new Map(messages(locale).groups.map((g) => [g.key, g.message]));
  const emoji = [];
  for (const e of rows.slice().sort((a, b) => a.order - b.order)) {
    if (!offered(e)) continue;
    const english = enByHex.get(e.hexcode);
    const words = [e.label, ...(e.tags ?? [])];
    if (locale !== "en" && english) words.push(english.label, ...(english.tags ?? []));
    const search = [...new Set(words.filter(Boolean).map(fold))].join("|");
    const tones = (e.skins ?? []).filter((s) => typeof s.tone === "number" && s.version <= MAX_VERSION).sort((a, b) => a.tone - b.tone);
    const row = [qualified(e), groupIndex.get(e.group), e.label, search];
    if (tones.length === 5) row.push(tones.map(qualified));
    emoji.push(row);
  }
  return {
    source: `emojibase-data ${pkg.version} (Unicode CLDR), Emoji <= ${MAX_VERSION}, no flags`,
    groups: keptGroups.map((g) => ({ key: g.key, label: groupNames.get(g.key) ?? g.message })),
    emoji,
  };
}

function emojiSet() {
  const set = new Set();
  for (const e of en) {
    if (!offered(e)) continue;
    set.add(qualified(e));
    // Every skin-tone variant an emoji has, mixed tones too: a valid emoji is
    // valid whether or not the picker offers that tone.
    for (const s of e.skins ?? []) if (s.version <= MAX_VERSION) set.add(qualified(s));
  }
  return [...set].sort();
}

const files = new Map();
for (const l of LOCALES) files.set(join(OUT, "data", `${l}.json`), JSON.stringify(build(l)) + "\n");
files.set(join(OUT, "emoji-set.json"), JSON.stringify(emojiSet()) + "\n");
files.set(join(OUT, "data", "LICENSE"), readFileSync(join(pkgDir, "LICENSE"), "utf8"));

if (process.argv.includes("--check")) {
  const stale = [...files].filter(([path, body]) => {
    try {
      return readFileSync(path, "utf8") !== body;
    } catch {
      return true;
    }
  });
  if (stale.length) {
    console.error(`stale: ${stale.map(([p]) => p).join(", ")} -- run node scripts/generate-emoji-data.mjs`);
    process.exit(1);
  }
  console.log("emoji data up to date");
} else {
  mkdirSync(join(OUT, "data"), { recursive: true });
  for (const [path, body] of files) writeFileSync(path, body);
  for (const [path, body] of files) console.log(`${path}  ${Buffer.byteLength(body)} bytes`);
}
