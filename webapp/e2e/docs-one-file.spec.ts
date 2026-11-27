import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The docs of the one-file install (RFC-023 §4.10, PR 7) against what exists:
 *
 *   - the "from 1.18" notes stand exactly as long as compose.yml carries its
 *     PRE-RELEASE line, and RELEASE.md's 1.18 checklist says to remove them;
 *   - every variable compose.yml reads is in the Compose UIs page's table (or
 *     its sentence about the secrets of a moved install), and nothing else;
 *   - the secret files Self-hosting lists are the ones the init step writes;
 *   - the messages the docs quote are the ones the code prints;
 *   - every wiki link from the pages this touches, and from README and
 *     UPGRADING, names a page that exists and a heading on it.
 *
 * Each check is also run against a broken copy, which must fail it.
 */

const REPO = join(__dirname, "..", "..");
const WIKI = join(REPO, "docs", "wiki");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const wiki = (name: string) => readFileSync(join(WIKI, `${name}.md`), "utf8");

const COMPOSE = read("compose.yml");
const RELEASE = read("RELEASE.md");
const UI_PAGE = wiki("Compose-UIs");
const QUICK = wiki("Quick-start");
const SELF = wiki("Self-hosting");
/** A page with its line breaks as spaces, for quotes the text wraps. */
const flat = (md: string) => md.replace(/\s*\n\s*(?:>\s*)?/g, " ");

const PRE_RELEASE = /^# PRE-RELEASE:/m;

/* ------------------------------------------------------------- the notes */

/** The pre-1.18 notes, and what their absence or presence must match. Empty: in step. */
function preReleaseProblems(o: { compose: string; release: string; uiPage: string; quick: string }): string[] {
  const out: string[] = [];
  const pre = PRE_RELEASE.test(o.compose);
  const uiBox = /^> \*\*From Kinboard 1\.18\.\*\*/m.test(o.uiPage);
  const quickBox = /^> \*\*Needs Kinboard 1\.18 or newer\.\*\*/m.test(o.quick);
  const item = /^- \[ \] \*\*1\.18\.0 only:\*\* remove the "from 1\.18" notes in the docs/m.test(o.release);
  if (pre && !uiBox) out.push("compose.yml is pre-release, but Compose-UIs.md has no 'From Kinboard 1.18' box");
  if (pre && !quickBox) out.push("compose.yml is pre-release, but Quick-start.md has no 'Needs Kinboard 1.18 or newer' box");
  if (pre && !item) out.push("compose.yml is pre-release, but RELEASE.md has no item to remove the docs' notes");
  if (!pre && uiBox) out.push("compose.yml is released, but Compose-UIs.md still says 'From Kinboard 1.18'");
  if (!pre && quickBox) out.push("compose.yml is released, but Quick-start.md still says 'Needs Kinboard 1.18 or newer'");
  return out;
}

test.describe("the 'from 1.18' notes", () => {
  const current = { compose: COMPOSE, release: RELEASE, uiPage: UI_PAGE, quick: QUICK };

  test("stand while compose.yml is pre-release, with a RELEASE.md item to remove them", () => {
    expect(preReleaseProblems(current)).toEqual([]);
  });

  test("a missing box, a missing item, or a box left after the release is caught", () => {
    expect(preReleaseProblems({ ...current, uiPage: UI_PAGE.replace("> **From Kinboard 1.18.**", "> **Soon.**") })).toHaveLength(1);
    expect(preReleaseProblems({ ...current, quick: QUICK.replace("> **Needs Kinboard 1.18 or newer.**", "> **Soon.**") })).toHaveLength(1);
    expect(preReleaseProblems({ ...current, release: RELEASE.replace('remove the "from 1.18" notes', "tidy the docs") })).toHaveLength(1);
    // The release drops the compose line and forgets the docs.
    expect(preReleaseProblems({ ...current, compose: COMPOSE.replace(PRE_RELEASE, "# Released:") })).toHaveLength(2);
  });

  test("the box quotes what an older image really says", () => {
    const quoted = "This Kinboard image is older than 1.18 and can't run the one-file setup";
    expect(COMPOSE).toContain(quoted);
    expect(flat(UI_PAGE)).toContain(quoted);
    expect(flat(QUICK)).toContain(quoted);
  });
});

/* ------------------------------------------------------------- variables */

/** Variables a compose file interpolates, `${NAME` and `${NAME:-…}`; `$${…}` is go2rtc's, not compose's. */
function composeVariables(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/(?<!\$)\$\{([A-Z_][A-Z0-9_]*)/g)) names.add(m[1]);
  return names;
}

/** The names in the Compose UIs page's variables table, plus the KINBOARD_ secrets it lists in the file's header. */
function documentedVariables(md: string): Set<string> {
  const section = md.split(/^## Variables$/m)[1]?.split(/^## /m)[0] ?? "";
  const names = new Set<string>();
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const first = line.split("|")[1];
    for (const m of first.matchAll(/`([A-Z_][A-Z0-9_]*)`/g)) names.add(m[1]);
  }
  return names;
}

function variableProblems(compose: string, md: string): string[] {
  const used = composeVariables(compose);
  const documented = documentedVariables(md);
  const out: string[] = [];
  for (const v of used) {
    if (v.startsWith("KINBOARD_") && /^KINBOARD_(POSTGRES_PASSWORD|JWT_SECRET|CRON_SECRET|PRESENCE_SENSOR_TOKEN|VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|ANON_KEY|SERVICE_ROLE_KEY)$/.test(v)) {
      // The moved-install secrets: the page names them in its migration step.
      if (!md.includes(`${v}=`)) out.push(`${v} is read by compose.yml but missing from the migration steps`);
      continue;
    }
    if (!documented.has(v)) out.push(`${v} is read by compose.yml but not in Compose-UIs.md's variables table`);
  }
  for (const v of documented) if (!used.has(v)) out.push(`${v} is in the variables table but compose.yml doesn't read it`);
  return out;
}

test.describe("the variables the page lists", () => {
  test("are exactly the ones compose.yml reads", () => {
    expect(composeVariables(COMPOSE).size).toBeGreaterThanOrEqual(20);
    expect(variableProblems(COMPOSE, UI_PAGE)).toEqual([]);
  });

  test("a variable added to the file, or one the file dropped, is caught", () => {
    expect(variableProblems(COMPOSE.replace("TZ: ${TZ:-Europe/Berlin}", "TZ: ${TZ:-Europe/Berlin}\n      NEW_ONE: ${KINBOARD_NEW_ONE:-}"), UI_PAGE))
      .toEqual(["KINBOARD_NEW_ONE is read by compose.yml but not in Compose-UIs.md's variables table"]);
    expect(variableProblems(COMPOSE.replaceAll("${WEBRTC_LAN_IP:-}", '""'), UI_PAGE))
      .toEqual(["WEBRTC_LAN_IP is in the variables table but compose.yml doesn't read it"]);
    expect(variableProblems(COMPOSE, UI_PAGE.replace("KINBOARD_JWT_SECRET=<JWT_SECRET>", "")))
      .toEqual(["KINBOARD_JWT_SECRET is read by compose.yml but missing from the migration steps"]);
  });
});

/* --------------------------------------------------------------- secrets */

test.describe("the secret files Self-hosting lists", () => {
  /** Names in Self-hosting's table of files (the rows under `| File | Holds |`). */
  function listedFiles(md: string): string[] {
    const table = md.split("| File | Holds |")[1]?.split("\n\n")[0] ?? "";
    return [...table.matchAll(/^\| `([a-z_]+)`(?:, `([a-z_]+)`)?/gm)].flatMap((m) => [m[1], m[2]].filter(Boolean)).sort();
  }

  test("are the files kinboard-init writes", async () => {
    // The webapp's store (secrets-store.mjs STORED) plus db_uri, which only the init step writes.
    const store = read("webapp/image/secrets-store.mjs");
    const stored = [...store.matchAll(/\{ env: "[A-Z_]+", file: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(stored).toHaveLength(6);
    expect(read("webapp/image/kinboard-init.mjs")).toContain('export const DB_URI_FILE = "db_uri";');
    expect(listedFiles(SELF)).toEqual([...stored, "db_uri"].sort());
    // A file dropped from the table is caught.
    expect(listedFiles(SELF.replace("| `cron_secret` |", "| (gone) |"))).not.toContain("cron_secret");
  });

  test("the modes and the log words are the init step's", () => {
    const init = read("webapp/image/kinboard-init.mjs");
    expect(init).toContain("export const DIR_MODE = 0o750;");
    expect(init).toContain("export const FILE_MODE = 0o640;");
    expect(SELF).toContain("The folder is mode `0750` and the files `0640`");
    for (const status of ["kept", "generated", "taken from .env", "replaced from .env (previous kept)"]) {
      expect(init).toContain(`"${status}"`);
      expect(SELF).toContain(`\`${status}\``);
    }
  });
});

/* -------------------------------------------------------------- messages */

test("the messages the docs quote are the ones the code prints", () => {
  const init = read("webapp/image/kinboard-init.mjs");
  expect(init).toContain("PostgreSQL can't keep its data on a FAT filesystem");
  expect(flat(UI_PAGE)).toContain("PostgreSQL can't keep its data on a FAT filesystem");
  expect(init).toContain("POSTGRES_PASSWORD in the environment (.env, or the Compose UI's variables) differs from the ");
  expect(flat(UI_PAGE)).toContain("POSTGRES_PASSWORD in the environment … differs from the stored secrets/postgres_password");
  const en = JSON.parse(read("webapp/messages/en.json"));
  expect(en.settings.composeRevision.title).toBe("Your compose file is older than this version of Kinboard expects.");
  expect(UI_PAGE).toContain(`### "${en.settings.composeRevision.title.replace(/\.$/, "")}"`);
});

/* ------------------------------------------------------------------ links */

/**
 * GitHub's heading anchor: lower case, punctuation dropped, each space a
 * hyphen. No tag stripping: GitHub slugs the heading's text, and the wiki's
 * headings carry no HTML, only code spans such as `<id>`, whose text stays
 * (the brackets go with the other punctuation).
 */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every heading anchor of a markdown page, outside code fences, with GitHub's -1, -2 for repeats. */
function anchors(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

const PAGES = new Set(readdirSync(WIKI).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")));

/** Links to wiki pages in a markdown text: `](Name#anchor)` inside the wiki, the rendered wiki's URL anywhere, and `[[Text|Name]]`. */
function wikiLinks(markdown: string, inWiki: boolean): { name: string; anchor: string | null }[] {
  const links: { name: string; anchor: string | null }[] = [];
  const add = (target: string) => {
    const [name, anchor] = target.split("#");
    links.push({ name, anchor: anchor ?? null });
  };
  for (const m of markdown.matchAll(/https:\/\/github\.com\/svenger87\/kinboard\/wiki\/([A-Za-z0-9_.-]+(?:#[^\s)"'`]+)?)/g)) add(m[1]);
  if (inWiki) {
    // Code is not a link: `[[ … ]]` in a shell snippet, say.
    const prose = markdown.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1/gm, "").replace(/`[^`\n]*`/g, "");
    for (const m of prose.matchAll(/\]\((?!https?:|mailto:|images\/|\.\.\/)([A-Za-z0-9_.-]*(?:#[^\s)]+)?)\)/g)) add(m[1]);
    for (const m of prose.matchAll(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g)) add(m[1].replace(/ /g, "-"));
  }
  return links;
}

function linkProblems(file: string, markdown: string, inWiki: boolean, ownPage?: string): string[] {
  const out: string[] = [];
  for (const { name, anchor } of wikiLinks(markdown, inWiki)) {
    const target = name === "" ? ownPage : name;
    if (!target || !PAGES.has(target)) {
      out.push(`${file}: no wiki page "${name}"`);
      continue;
    }
    if (anchor && !anchors(target === ownPage ? markdown : wiki(target)).has(anchor)) {
      out.push(`${file}: no heading "#${anchor}" on ${target}`);
    }
  }
  return out;
}

test.describe("wiki links", () => {
  const WIKI_PAGES = ["Compose-UIs", "Quick-start", "Self-hosting", "Home", "_Sidebar", "Troubleshooting", "Windows-WSL-Host", "HTTPS"];

  test("the slug is GitHub's", () => {
    expect(slug("From scratch: Traefik + Let's Encrypt")).toBe("from-scratch-traefik--lets-encrypt");
    expect(slug("Updating: Pull, then Up")).toBe("updating-pull-then-up");
    expect(slug("3. Open the app")).toBe("3-open-the-app");
    expect(slug("CasaOS (should work, not supported)")).toBe("casaos-should-work-not-supported");
    expect(slug("The config folder (installs that have one)")).toBe("the-config-folder-installs-that-have-one");
    expect(slug("Doorbell → camera")).toBe("doorbell--camera");
    expect(slug("1. The manifest — `webapp/src/plugins/<id>/index.ts`")).toBe("1-the-manifest--webappsrcpluginsidindexts");
  });

  test("from the install and operations pages resolve, page and heading", () => {
    const problems = WIKI_PAGES.flatMap((p) => linkProblems(`${p}.md`, wiki(p), true, p));
    expect(problems).toEqual([]);
    const counted = WIKI_PAGES.flatMap((p) => wikiLinks(wiki(p), true));
    expect(counted.length).toBeGreaterThan(60);
    expect(counted.filter((l) => l.name === "Compose-UIs").length).toBeGreaterThan(5);
  });

  test("from README, UPGRADING and CHANGELOG resolve", () => {
    const problems = ["README.md", "UPGRADING.md", "CHANGELOG.md"].flatMap((f) => linkProblems(f, read(f), false));
    expect(problems).toEqual([]);
    expect(wikiLinks(read("README.md"), false).some((l) => l.name === "Compose-UIs")).toBe(true);
    expect(wikiLinks(read("UPGRADING.md"), false).some((l) => l.anchor === "moving-a-git-install-to-this-file")).toBe(true);
  });

  test("the sidebar lists the Compose UIs page", () => {
    expect(wiki("_Sidebar")).toContain("[[Compose UIs|Compose-UIs]]");
  });

  test("a renamed page or heading is caught", () => {
    expect(linkProblems("x.md", "see [it](Compose-UI)", true)).toEqual(['x.md: no wiki page "Compose-UI"']);
    expect(linkProblems("x.md", "see [it](Compose-UIs#updating)", true)).toEqual(['x.md: no heading "#updating" on Compose-UIs']);
    expect(linkProblems("x.md", "[[Compose UI|Compose-UI]]", true)).toEqual(['x.md: no wiki page "Compose-UI"']);
    expect(linkProblems("x.md", "https://github.com/svenger87/kinboard/wiki/Self-hosting#still-the-old-version", false))
      .toEqual(['x.md: no heading "#still-the-old-version" on Self-hosting']);
    // A heading inside a code fence is not a heading.
    expect(anchors("```\n# expect: 301\n```\n## Real").has("expect-301")).toBe(false);
    expect(existsSync(join(WIKI, "Compose-UIs.md"))).toBe(true);
  });
});
