// CHANGELOG section lint.
//
// Every PR appends its entry to CHANGELOG.md, and the natural way to do that
// is to add the `###` heading you need at the point you are inserting. Do that
// a few dozen times and `[Unreleased]` grows eleven headings — Fixed five
// times, Added three, Security twice — which is what #214 had to clean up. The
// duplication is invisible in a diff (each PR's own change looks correct) and
// only shows up if you read the whole section, so nothing caught it for months.
//
// This catches it on the next PR instead.
//
// Four rules, three of them enforced on every section:
//
//   1. no `###` heading twice in the same release section
//   2. headings come from the Keep a Changelog set
//   3. no byte-identical entry twice in the same section
//   4. headings in Keep a Changelog order — [Unreleased] ONLY
//
// Rule 4 is deliberately not applied to released sections: six of them
// ([1.6.10], [1.6.9], [1.6.7], [1.6.0], [1.5.0], [1.0.2]) put Security before
// Fixed, and that is published history. Rewriting it would change nothing for
// a reader and would make this check a reason to edit shipped releases.
// [Unreleased] is the only section anyone still edits, so it is the only one
// where order is worth enforcing.
//
// Run: node scripts/check-changelog-sections.mjs   (from repo root)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Keep a Changelog 1.1.0, in the order it specifies. The file's own preamble
// commits to this spec, so the set is not a house invention.
const ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(repoRoot, "CHANGELOG.md");
const lines = readFileSync(path, "utf8").split("\n");

// Split into `## …` sections, remembering line numbers so failures point at
// somewhere you can actually go and look.
const sections = [];
let current = null;
lines.forEach((line, i) => {
  const heading = line.match(/^## (.+)$/);
  if (heading) {
    current = { title: heading[1].trim(), line: i + 1, headings: [], entries: [] };
    sections.push(current);
    return;
  }
  if (!current) return; // preamble above the first section

  const sub = line.match(/^### (.+)$/);
  if (sub) {
    current.headings.push({ text: sub[1].trim(), line: i + 1 });
    return;
  }
  if (/^- /.test(line)) current.entries.push({ text: line, line: i + 1 });
});

const problems = [];
const isUnreleased = (s) => /^\[Unreleased\]/i.test(s.title);

for (const section of sections) {
  const where = `${section.title} (line ${section.line})`;

  // 1. A heading twice in one section.
  const seenHeading = new Map();
  for (const h of section.headings) {
    const first = seenHeading.get(h.text);
    if (first !== undefined) {
      problems.push(
        `${where}: "### ${h.text}" appears twice — line ${first} and line ${h.line}. ` +
          `Move the entries under the existing heading instead of adding a second one.`,
      );
    } else {
      seenHeading.set(h.text, h.line);
    }
  }

  // 2. A heading outside the Keep a Changelog set.
  for (const h of section.headings) {
    if (!ORDER.includes(h.text)) {
      problems.push(
        `${where}: "### ${h.text}" (line ${h.line}) is not a Keep a Changelog section. ` +
          `Use one of: ${ORDER.join(", ")}.`,
      );
    }
  }

  // 3. The same entry twice — two PRs adding identical text under their own headings.
  const seenEntry = new Map();
  for (const e of section.entries) {
    const first = seenEntry.get(e.text);
    if (first !== undefined) {
      problems.push(
        `${where}: identical entry on line ${first} and line ${e.line} — ` +
          `${e.text.slice(0, 72)}…`,
      );
    } else {
      seenEntry.set(e.text, e.line);
    }
  }

  // 4. Order, [Unreleased] only — see the note at the top.
  if (isUnreleased(section)) {
    const known = section.headings.filter((h) => ORDER.includes(h.text));
    for (let i = 1; i < known.length; i++) {
      if (ORDER.indexOf(known[i].text) < ORDER.indexOf(known[i - 1].text)) {
        problems.push(
          `${where}: "### ${known[i].text}" (line ${known[i].line}) comes after ` +
            `"### ${known[i - 1].text}" but Keep a Changelog orders them ` +
            `${ORDER.join(" → ")}.`,
        );
      }
    }
  }
}

if (problems.length) {
  console.error(`CHANGELOG.md: ${problems.length} problem(s).\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("");
  process.exit(1);
}

const total = sections.reduce((n, s) => n + s.entries.length, 0);
console.log(`CHANGELOG.md OK — ${sections.length} sections, ${total} entries.`);
