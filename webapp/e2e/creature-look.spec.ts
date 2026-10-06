import { test, expect } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CreatureAvatar } from "../src/components/pocket-money/creature-avatar";
import {
  ACCESSORIES,
  COLOR_NAMES,
  DRAWN_SPECIES_IDS,
  DRAWN_STYLES,
  EYE_SHAPES,
  HAIRSTYLES,
  LOOK_KEYS,
  LOOK_SWATCHES,
  NAME_MAX,
  PATTERNS,
  NAME_RAW_MAX,
  clampName,
  cleanName,
  graphemes,
  readLook,
  restorableLook,
  resolveStyle,
  speciesArt,
  startOverLook,
  surpriseLook,
  validateLook,
  type CreatureLook,
} from "../src/lib/pocket-money/creatures";
import type { AvatarTier } from "../src/lib/pocket-money/types";
import { LISTS } from "../src/lib/integration-lists";
import { RESTORE_TYPES } from "../src/lib/integration-recycle-bin";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";

/**
 * A child's own look (RFC-016 §4): what the server accepts
 * (lib/pocket-money/creatures/look.ts, used by the account PATCH), what a
 * restore keeps, how every choice is drawn, and that the look -- the name
 * above all -- stays on the family's own screens.
 */

const ok = (input: unknown) => {
  const r = validateLook(input);
  expect(r.ok, JSON.stringify(input)).toBe(true);
  return (r as { ok: true; look: CreatureLook }).look;
};
const refused = (input: unknown) => {
  const r = validateLook(input);
  expect(r.ok, JSON.stringify(input)).toBe(false);
  return (r as { ok: false; error: string }).error;
};

test.describe("validation: every key, only from its set", () => {
  test("the empty look is the creature's own", () => {
    expect(ok({})).toEqual({});
  });

  test("every colour in each set is accepted, and stored upper-case", () => {
    for (const hex of LOOK_SWATCHES.body) expect(ok({ body: hex.toLowerCase() })).toEqual({ body: hex });
    for (const hex of [...LOOK_SWATCHES.belly, ...LOOK_SWATCHES.trim]) expect(ok({ belly: hex })).toEqual({ belly: hex });
    for (const hex of LOOK_SWATCHES.accent) expect(ok({ accent: hex })).toEqual({ accent: hex });
    for (const hex of LOOK_SWATCHES.hair) expect(ok({ hair: hex })).toEqual({ hair: hex });
    for (const hex of LOOK_SWATCHES.skin) expect(ok({ skin: hex })).toEqual({ skin: hex });
  });

  test("a colour from another key's set, or none of them, is refused", () => {
    refused({ body: "#123456" });
    refused({ body: "#FFFFFF" }); // a tummy colour, not a body colour
    refused({ belly: "#6FCF97" });
    refused({ accent: "#2B1D14" }); // a hair colour
    refused({ hair: "#56B6E8" }); // an accent
    refused({ skin: "#FFFFFF" });
    refused({ skin: "#6FCF97" });
    refused({ body: "red" });
    refused({ body: "url(#x)" });
    refused({ body: "#6FCF97; fill: red" });
  });

  test("pattern, eyes, accessory and hairstyle take only their lists", () => {
    for (const v of PATTERNS) expect(ok({ pattern: v })).toEqual({ pattern: v });
    for (const v of EYE_SHAPES) expect(ok({ eyes: v })).toEqual({ eyes: v });
    for (const v of ACCESSORIES) expect(ok({ acc: v })).toEqual({ acc: v });
    for (const v of HAIRSTYLES) expect(ok({ hairstyle: v })).toEqual({ hairstyle: v });
    refused({ pattern: "zigzag" });
    refused({ eyes: "laser" });
    refused({ acc: "crown" });
    refused({ hairstyle: "mohawk" });
    refused({ pattern: "Spots" });
  });

  test("the name: trimmed, controls and bidi overrides removed, at most 16 characters", () => {
    expect(ok({ name: "  Funkel  " })).toEqual({ name: "Funkel" });
    expect(ok({ name: "Fun\nkel\t\u0000" })).toEqual({ name: "Fun kel" });
    expect(ok({ name: "a‮b​c" })).toEqual({ name: "abc" });
    expect(ok({ name: "x".repeat(40) }).name).toBe("x".repeat(NAME_MAX));
    expect(Array.from(ok({ name: "🐉".repeat(20) }).name!)).toHaveLength(NAME_MAX);
    expect(ok({ name: "   " })).toEqual({});
    expect(ok({ name: "\u0007" })).toEqual({});
    expect(cleanName("Mo  the   dragon")).toBe("Mo the dragon");
    expect(ok({ name: "<b>Rex</b>" })).toEqual({ name: "<b>Rex</b>" }); // text, rendered as text
  });

  test("a raw name over 256 UTF-16 units is refused before any cleaning", () => {
    expect(refused({ name: "x".repeat(NAME_RAW_MAX + 1) })).toBe("avatar_look.name is too long");
    // even when it would clean down to nothing, or to a short name
    refused({ name: " ".repeat(NAME_RAW_MAX + 1) });
    refused({ name: "Rex" + "\u200B".repeat(NAME_RAW_MAX) });
    expect(ok({ name: "x".repeat(NAME_RAW_MAX) }).name).toBe("x".repeat(NAME_MAX));
  });

  test("the name counts what a person sees: emoji with a skin tone, a selector, a flag or a family are one each", () => {
    const thumbs = "👍🏽", heart = "❤️", flag = "🇩🇪", family = "👨‍👩‍👧‍👦";
    for (const g of [thumbs, heart, flag, family]) {
      expect(graphemes(g), g).toHaveLength(1);
      const name = ok({ name: g.repeat(20) }).name!;
      expect(graphemes(name), g).toHaveLength(NAME_MAX);
      expect(name, g).toBe(g.repeat(NAME_MAX)); // never cut in half
    }
    expect(ok({ name: `Mo ${family}` }).name).toBe(`Mo ${family}`);
  });

  test("the name keeps the joiners writing needs, and drops only bidi controls, ZWSP and the BOM", () => {
    // ZWJ holds the family together; ZWNJ is part of Persian spelling.
    expect(ok({ name: "👨‍👩‍👧" }).name).toBe("👨\u200D👩\u200D👧");
    expect(ok({ name: "می\u200Cخواهم" }).name).toBe("می\u200Cخواهم");
    for (const c of ["\u202A", "\u202B", "\u202C", "\u202D", "\u202E", "\u2066", "\u2067", "\u2068", "\u2069", "\u200B", "\uFEFF"]) {
      expect(ok({ name: `Re${c}x` }).name, c.codePointAt(0)!.toString(16)).toBe("Rex");
    }
  });

  test("a name of only white space and invisible fillers is no name", () => {
    for (const filler of ["\u3164", "\u2800", "\u115F", "\u1160", "\uFFA0", "\u3164 \u2800", " \u200D ", "\u200B\u3164"]) {
      expect(ok({ name: filler }), JSON.stringify(filler)).toEqual({});
    }
    // a filler next to a real character is that character's business
    expect(ok({ name: "A\u3164" }).name).toBe("A\u3164");
  });

  test("the editor's name field counts like the server: graphemes, no maxLength", () => {
    const family = "👨‍👩‍👧‍👦";
    expect(clampName(family.repeat(20))).toBe(family.repeat(NAME_MAX));
    expect(clampName("Mo the ")).toBe("Mo the "); // a trailing space can still be typed
    for (const raw of ["x".repeat(40), "👍🏽".repeat(30), `${family} ${family}`]) {
      expect(cleanName(clampName(raw)), raw).toBe(cleanName(raw));
    }
    const editor = readFileSync(join(process.cwd(), "src/components/pocket-money/creature-look-editor.tsx"), "utf8");
    const input = editor.slice(editor.indexOf('data-testid="look-name"') - 700, editor.indexOf('data-testid="look-name"'));
    expect(input).toContain("clampName(e.target.value)");
    expect(input).not.toMatch(/maxLength=/);
  });

  test("a focused swatch looks different from the selected one", () => {
    const editor = readFileSync(join(process.cwd(), "src/components/pocket-money/creature-look-editor.tsx"), "utf8");
    const swatch = editor.slice(editor.indexOf("data-color={hex}"), editor.indexOf("style={{ background: hex }}"));
    // selected: a solid ring in the accent colour; focus: a dashed outline in the text colour
    expect(swatch).toContain('pressed ? "ring-[3px] ring-primary"');
    expect(swatch).toContain("focus-visible:outline-dashed");
    expect(swatch).toContain("focus-visible:outline-foreground");
    expect(swatch).not.toMatch(/focus-visible:ring-primary/);
  });

  test("unknown keys are refused, not dropped", () => {
    expect(refused({ body: "#6FCF97", colour: "#6FCF97" })).toContain("unknown avatar_look key: colour");
    refused({ palette: { body: "#6FCF97" } });
    refused({ __proto__: { x: 1 }, polluted: true });
    refused({ constructor: "x" });
  });

  test("not an object, or a value that is not a string, is refused", () => {
    for (const bad of [null, "x", 3, true, [], ["#6FCF97"]]) refused(bad);
    refused({ body: null });
    refused({ body: 0x6fcf97 });
    refused({ name: 5 });
    refused({ pattern: ["spots"] });
  });

  test("the keys are exactly the editor's, and the shop's four slots (RFC-017 §5)", () => {
    expect([...LOOK_KEYS].sort()).toEqual(["acc", "accent", "background", "belly", "body", "eyes", "face", "hair", "hairstyle", "head", "name", "neck", "pattern", "skin"]);
  });
});

test.describe("export and import", () => {
  test("a restore keeps a valid look and turns anything else into {}", () => {
    const look = { name: "Funkel", body: "#FF8A5B", pattern: "hearts", acc: "bow" };
    expect(restorableLook(look)).toEqual(look);
    for (const bad of [null, undefined, "x", [], { body: "#000000" }, { wings: "#56B6E8" }, { name: 3 }]) expect(restorableLook(bad)).toEqual({});
  });

  test("one bad key drops only itself: the name and colours survive a rollback or a newer backup", () => {
    // as a newer version might have stored it: a new key, a new accessory, a
    // colour from a later palette
    const stored = { name: "Funkel", body: "#FF8A5B", belly: "#DDF7E8", acc: "crown", wings: "#56B6E8", pattern: "hearts", eyes: 7, hair: "#C97C3C", skin: "#123456" };
    const kept = { name: "Funkel", body: "#FF8A5B", belly: "#DDF7E8", pattern: "hearts", hair: "#C97C3C" };
    expect(readLook(stored)).toEqual(kept);
    expect(restorableLook(stored)).toEqual(kept);
    expect(readLook({ name: "x".repeat(NAME_RAW_MAX + 1), body: "#FF8A5B" })).toEqual({ body: "#FF8A5B" });
    // while the PATCH stays strict about the very same look
    expect(validateLook(stored).ok).toBe(false);
  });

  test("the import normalises it on every account and creature row, and the export takes the whole rows", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const imp = read("src/app/api/import/route.ts");
    const spec = imp.slice(imp.indexOf('spec("pocket_money_accounts"'), imp.indexOf('spec("pocket_money_goals"'));
    expect(spec).toContain("row.avatar_look = restorableLook(row.avatar_look)");
    const creatures = imp.slice(imp.indexOf('spec("creatures"'), imp.indexOf('spec("settings"'));
    expect(creatures).toContain("row.look = restorableLook(row.look)");
    const exp = read("src/app/api/export/route.ts");
    expect(exp).toMatch(/from\("pocket_money_accounts"\)\.select\("\*"\)/);
    expect(exp).toMatch(/from\("creatures"\)\.select\("\*"\)/);
  });
});

test.describe("the creature PATCH (RFC-017; the account PATCH until then)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/creatures/rules.ts"), "utf8");

  test("validates the look with validateLook and 400s on a refusal, with no PIN of its own", () => {
    const block = src.slice(src.indexOf("input.look !== undefined"), src.indexOf("input.best_tier !== undefined"));
    expect(block).toContain("validateLook(input.look)");
    expect(block).toMatch(/ok: false, error/);
    const parental = /PARENTAL_FIELDS = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
    expect(parental).not.toContain("look");
    const route = readFileSync(join(process.cwd(), "src/app/api/creatures/[personId]/route.ts"), "utf8");
    expect(route).toMatch(/if \(!parsed\.ok\) return NextResponse\.json\(\{ error: parsed\.error \}, \{ status: 400 \}\)/);
    // The account PATCH only forwards it, for one release, through the same rules.
    const account = readFileSync(join(process.cwd(), "src/app/api/pocket-money/accounts/[id]/route.ts"), "utf8");
    expect(account.slice(account.indexOf("MOVED_TO_CREATURES: Record"))).toContain('avatar_look: "look"');
    expect(account).toContain("parseCreaturePatch(creatureBody)");
  });
});

test.describe("the look stays on the family's own screens", () => {
  const files = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|tsx)$/.test(f)) out.push(f);
      }
    };
    walk(join(process.cwd(), dir));
    return out;
  };
  const outward = [
    ...files("src/app/api/integration"),
    ...files("src/lib/mcp"),
    ...files("src/app/api/mcp"),
    ...files("src/app/api/homeassistant"),
    // What leaves the house as a push or a notification, and the jobs that send it.
    ...files("src/lib/notifications"),
    ...files("src/app/api/cron"),
    join(process.cwd(), "src/lib/push-sender.ts"),
    ...readdirSync(join(process.cwd(), "src/lib"))
      .filter((f) => /^integration-.*\.ts$/.test(f))
      .map((f) => join(process.cwd(), "src/lib", f)),
  ];

  /**
   * Every way a file could carry the look out, read with a small scanner
   * rather than line regexes (a blank line, a `;` inside a string or a cast
   * once let a query through):
   *
   *   - naming avatar_look at all;
   *   - a query on a guarded table whose select is `*`, names a forbidden
   *     column (the look, a jsonb path into it, a shop item that says what
   *     the creature wears), is empty (the whole row back after a write), or
   *     is not a plain string the guard can read;
   *   - a guarded table reached any other way: `.from()` with a variable or a
   *     cast, the table's name in a string outside `.from("...")`;
   *   - a guarded table embedded in any select string -- `creatures(*)`,
   *     `c:creatures(look)`, `...creatures(look->>name)`, with or without a
   *     `!hint` -- with a forbidden column in its list;
   *   - an RPC that is about creatures, looks or purchases, or whose name is
   *     not a plain string.
   *
   * point_purchases is guarded with the creature: an item bought in the shop
   * is worn, so its item_id tells what the creature looks like.
   */
  const GUARDED: Record<string, RegExp> = {
    pocket_money_accounts: /\*|\bavatar_look\b|\blook\b/,
    creatures: /\*|\blook\b/,
    point_purchases: /\*|\bitem_id\b|\blook\b/,
  };

  /** The index just past the string literal that opens at `i`. */
  const skipString = (src: string, i: number): number => {
    const q = src[i];
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === "\\") { j += 2; continue; }
      if (q === "`" && src[j] === "$" && src[j + 1] === "{") {
        let depth = 1;
        j += 2;
        while (j < src.length && depth > 0) {
          if (src[j] === "'" || src[j] === '"' || src[j] === "`") { j = skipString(src, j); continue; }
          if (src[j] === "{") depth++;
          else if (src[j] === "}") depth--;
          j++;
        }
        continue;
      }
      if (src[j] === q) return j + 1;
      j++;
    }
    return j;
  };

  /** The index of the bracket closing the one at `open`, strings skipped. */
  const closing = (src: string, open: number): number => {
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const stack = [pairs[src[open]]];
    let j = open + 1;
    while (j < src.length && stack.length) {
      const c = src[j];
      if (c === "'" || c === '"' || c === "`") { j = skipString(src, j); continue; }
      if (pairs[c]) stack.push(pairs[c]);
      else if (c === stack[stack.length - 1]) stack.pop();
      j++;
    }
    return j - 1;
  };

  /** The text of `arg` when it is exactly one plain string literal, else null. */
  const plainString = (arg: string): string | null => {
    const a = arg.trim();
    if (!/^["'`]/.test(a) || skipString(a, 0) !== a.length) return null;
    const body = a.slice(1, -1);
    return a[0] === "`" && body.includes("${") ? null : body;
  };

  /** Every string literal in `src`, as its text. */
  const literals = (src: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
      if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; if (i <= 0) break; continue; }
      if (c === "'" || c === '"' || c === "`") {
        const end = skipString(src, i);
        out.push(src.slice(i + 1, end - 1));
        i = end - 1;
      }
    }
    return out;
  };

  /**
   * The `.from()` calls with a variable that the outward code has, by file:
   * the Integration API's lists (LISTS) and the recycle bin (RESTORE_TYPES).
   * Allowed only in that file, under that exact expression, and only while
   * none of the tables it can hold is guarded (checked below). Any other
   * variable is a violation.
   */
  const LIST_TABLES = Object.values(LISTS).map((d) => d.table);
  const VARIABLE_TABLES: Record<string, Record<string, readonly string[]>> = {
    "src/app/api/integration/v1/lists/[list]/route.ts": { "def.table": LIST_TABLES },
    "src/app/api/integration/v1/lists/[list]/[item]/route.ts": { "def.table": LIST_TABLES },
    "src/lib/integration-recycle-bin.ts": { table: Object.values(RESTORE_TYPES).map((r) => r.table) },
  };

  const violations = (source: string, file = ""): string[] => {
    const found: string[] = [];
    if (source.includes("avatar_look")) found.push("names avatar_look");
    const tables = Object.keys(GUARDED);

    // .from(...): a plain string, and on a guarded table every select checked.
    for (const m of source.matchAll(/\.from\s*\(/g)) {
      // Array.from(...) and its kind are not queries.
      if (/\b(?:Array|Buffer|Uint8Array|Iterator)\s*$/.test(source.slice(Math.max(0, m.index! - 20), m.index!))) continue;
      const open = m.index! + m[0].length - 1;
      const close = closing(source, open);
      const table = plainString(source.slice(open + 1, close));
      const allowed = Object.entries(VARIABLE_TABLES).find(([f]) => file.endsWith(f))?.[1] ?? {};
      const variable = allowed[source.slice(open + 1, close).trim()];
      if (table === null && variable && !variable.some((t) => t in GUARDED)) continue;
      if (table === null) {
        found.push(`.from(${source.slice(open + 1, close).trim()}): not a plain string`);
        continue;
      }
      if (!tables.includes(table)) continue;
      let pos = close + 1;
      for (;;) {
        const step = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*\(/.exec(source.slice(pos));
        if (!step) break;
        const callOpen = pos + step[0].length - 1;
        const callClose = closing(source, callOpen);
        if (step[1] === "select") {
          const arg = source.slice(callOpen + 1, callClose);
          const columns = plainString(arg);
          if (arg.trim() === "") found.push(`${table} .select() with no columns`);
          else if (columns === null) found.push(`${table} .select(<not a plain string>)`);
          else if (GUARDED[table].test(columns)) found.push(`${table} .select("${columns}")`);
        }
        pos = callClose + 1;
      }
    }

    for (const text of literals(source)) {
      // The table's name as a whole string, other than in .from("..."): a
      // variable, a map, a cast -- a way round the check above.
      if (tables.includes(text.trim())) {
        const quoted = new RegExp(`\\.from\\s*\\(\\s*["'\`]${text.trim()}["'\`]\\s*\\)`, "g");
        const all = source.match(new RegExp(`["'\`]${text.trim()}["'\`]`, "g"))?.length ?? 0;
        const inFrom = source.match(quoted)?.length ?? 0;
        if (all > inFrom) found.push(`"${text.trim()}" outside .from("...")`);
      }
      // Embedded in a select: creatures(...), c:creatures(...), ...creatures(...), creatures!hint(...).
      for (const table of tables) {
        for (const e of text.matchAll(new RegExp(`\\b${table}\\s*(?:!\\s*[\\w]+\\s*)?\\(`, "g"))) {
          const open = e.index! + e[0].length - 1;
          const inner = text.slice(open + 1, closing(text, open));
          if (GUARDED[table].test(inner)) found.push(`${table}(${inner.trim()}) embedded`);
        }
      }
    }

    for (const m of source.matchAll(/\.rpc\s*\(/g)) {
      const open = m.index! + m[0].length - 1;
      const args = source.slice(open + 1, closing(source, open));
      const first = args.slice(0, /^\s*["'`]/.test(args) ? skipString(args, args.search(/["'`]/)) : args.length);
      const name = plainString(first);
      if (name === null) found.push(".rpc(<not a plain string>)");
      else if (/creature|look|purchase/i.test(name)) found.push(`.rpc("${name}")`);
    }
    return [...new Set(found)];
  };

  test("no outward code -- Integration API, MCP, Home Assistant, push, notifications, cron -- reads avatar_look, a look or a whole row", () => {
    expect(outward.length).toBeGreaterThan(30);
    expect(outward.some((f) => f.endsWith("push-sender.ts"))).toBe(true);
    expect(outward.some((f) => f.includes("/api/cron/process-allowance/"))).toBe(true);
    expect(outward.some((f) => f.includes("/lib/notifications/"))).toBe(true);
    // Points, creatures and rewards for Home Assistant and assistants, and the
    // reward pushes (RFC-017 follow-up): each is on the list by name, so a
    // move out of these folders cannot take it off quietly.
    for (const file of [
      "src/lib/integration-rewards.ts",
      "src/app/api/integration/v1/rewards/route.ts",
      "src/app/api/integration/v1/rewards/requests/route.ts",
      "src/lib/notifications/rewards.ts",
      "src/lib/notifications/delivery.ts",
      "src/app/api/cron/process-notifications/route.ts",
    ]) expect(outward, file).toContain(join(process.cwd(), file));
    for (const f of outward) expect(violations(readFileSync(f, "utf8"), f), f).toEqual([]);
    // The variable tables allowed above hold no guarded table.
    for (const byExpr of Object.values(VARIABLE_TABLES)) {
      for (const list of Object.values(byExpr)) {
        expect(list.length).toBeGreaterThan(0);
        for (const t of list) expect(Object.keys(GUARDED)).not.toContain(t);
      }
    }
  });

  test("the guard goes red on each way of leaking the look", () => {
    const crafted: Array<[string, string]> = [
      ["named", `const x = row.avatar_look;`],
      ["star", `await db.from("pocket_money_accounts").select("*").eq("id", id);`],
      ["star among columns", `await db.from('pocket_money_accounts').select('id, *').eq("id", id);`],
      ["bare select after update", `await db.from("pocket_money_accounts")\n  .update({ x: 1 })\n  .eq("id", id)\n  .select()\n  .single();`],
      ["embedded", `await db.from("people").select("id, name, pocket_money_accounts(*)");`],
      ["embedded with hint", `await db.from("people").select("id, pocket_money_accounts!person_id ( * )");`],
      ["creature star", `await db.from("creatures").select("*").eq("person_id", id);`],
      ["creature look column", `await db.from("creatures").select("species, look").eq("person_id", id);`],
      ["creature bare select", `await db.from("creatures")\n  .update({ best_tier: 2 })\n  .select()\n  .single();`],
      ["creature embedded", `await db.from("people").select("id, creatures(*)");`],
      ["creature columns from a constant", `await db.from("creatures").select(COLUMNS).eq("family_id", id);`],
      ["creature columns from a template", "await db.from(\"creatures\").select(`person_id, ${extra}`).eq(\"family_id\", id);"],
      // From the review of #374: each of these went through the line-regex guard.
      ["cast to any", `await db.from("creatures" as any).select("*");`],
      ["table name in a variable", `const T = "creatures"; await db.from(T).select("*");`],
      ["table name in a map", `const TABLES = { c: "creatures" }; await db.from(TABLES.c).select("species");`],
      ["blank line in the chain", `await db.from("creatures")\n\n  .select("*");`],
      ["semicolon inside a string in the chain", `await db.from("creatures").eq("x", "a;b").select("*");`],
      ["embedded with an alias", `await db.from("people").select("id, c:creatures(*)");`],
      ["embedded look column", `await db.from("people").select("id, creatures(look)");`],
      ["embedded among columns", `await db.from("people").select("id, creatures(species, look)");`],
      ["embedded jsonb path", `await db.from("people").select("name, creatures(look->>name)");`],
      ["embedded spread", `await db.from("people").select("id, ...creatures(*)");`],
      ["embedded with a hint", `await db.from("people").select("id, creatures!person_id(look)");`],
      ["jsonb path on the creature", `await db.from("creatures").select("species, look->name");`],
      ["an RPC about creatures", `await db.rpc("get_creature", { p: id });`],
      ["an RPC by variable", `await db.rpc(FN, { p: id });`],
      ["optional chaining", `await db.from("creatures")?.select("look");`],
      ["purchases star", `await db.from("point_purchases").select("*").eq("person_id", id);`],
      ["purchases item", `await db.from("point_purchases").select("person_id, item_id");`],
      ["purchases embedded", `await db.from("people").select("id, point_purchases(item_id)");`],
      ["purchases bare select", `await db.from("point_purchases").insert(row).select();`],
      ["a query on a variable that only looks like Array.from", `await db.from(arr).select("*");`],
            ["the lists' variable outside the lists' files", `await db.from(def.table).select("*");`],
    ];
    for (const [what, source] of crafted) expect(violations(source).length, what).toBeGreaterThan(0);
    // and stays green on what the outward code does do
    for (const ok of [
      `await db.from("pocket_money_accounts").select("id, person_id, balance_cents, currency");`,
      `await db.from("calendar_events").insert(rows).select();`,
      `await db.from("people").select("id, pocket_money_accounts(id, balance_cents)");`,
      `await db.from("creatures").select("person_id, species, grows_with");`,
      `await db.from("creatures").select("person_id, species, grows_with, best_tier").eq("family_id", familyId).eq("enabled", true);`,
      `await db.from("people").select("id, creatures(species, best_tier)");`,
      `await db.from("point_purchases").select("person_id, cost_points");`,
      `await db.rpc("point_person_totals", { p_family_id: id, p_person_id: pid });`,
      `const ids = Array.from(new Set(rows.map((r) => r.id)));`,
      `// the creatures (their look) stay home\nawait db.from("people").select("id");`,
    ]) expect(violations(ok), ok).toEqual([]);
  });
});

test.describe("drawing the look", () => {
  const TIERS: AvatarTier[] = [1, 2, 3, 4, 5, 6, 7, 8];
  const render = (props: Parameters<typeof CreatureAvatar>[0]) => renderToStaticMarkup(createElement(CreatureAvatar, props));
  const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const refs = (html: string) => [...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
  const SAMPLES: CreatureLook[] = [
    {},
    { body: "#FF8A5B", belly: "#DDF7E8", accent: "#3FA877", pattern: "spots", eyes: "sparkly", acc: "bow" },
    { body: "#2EC4B6", belly: "#FFF1A8", hair: "#D9434F", skin: "#7A4E33", hairstyle: "curls", pattern: "stripes", eyes: "happy", acc: "glasses" },
    { body: "#8C7AE6", pattern: "hearts", acc: "hat", hairstyle: "ponytail", skin: "#FBE0C8" },
    { acc: "flower", hairstyle: "long", eyes: "round" },
  ];

  test("every creature × style × stage × sample look renders with its own ids", () => {
    for (const species of DRAWN_SPECIES_IDS) {
      for (const style of DRAWN_STYLES) {
        for (const look of SAMPLES) {
          for (const tier of TIERS) {
            const html = render({ species, tier, style, look });
            const where = `${species} ${style} ${tier} ${JSON.stringify(look)}`;
            expect(html, where).toContain("<svg");
            expect(html, where).not.toMatch(/NaN|undefined/);
            const own = ids(html);
            expect(new Set(own).size, where).toBe(own.length);
            for (const ref of refs(html)) expect(own, where).toContain(ref);
          }
        }
      }
    }
  });

  test("the colours: body, tummy and accent for a creature; outfit, trim, hair and skin for a person", () => {
    const fox = render({ species: "fox", tier: 6, style: "gumdrop", look: { body: "#56B6E8", belly: "#FFE6F0", accent: "#B9AEF5" } });
    for (const hex of ["#56B6E8", "#FFE6F0", "#B9AEF5"]) expect(fox).toContain(hex);
    expect(fox).not.toContain("#FF8A3D"); // the fox's own orange is gone
    const prince = render({ species: "prince", tier: 6, style: "gumdrop", look: { body: "#2EC4B6", belly: "#FFF1A8", hair: "#E8C170", skin: "#7A4E33", accent: "#E8558F" } });
    for (const hex of ["#2EC4B6", "#FFF1A8", "#E8C170", "#7A4E33"]) expect(prince).toContain(hex);
    // an accent chosen for some other creature does not colour a person's hair
    expect(prince).not.toContain("#E8558F");
    // the dragon keeps its per-style palette unless the look says otherwise
    expect(resolveStyle("sticker", { body: "#FFB054" }).pal.body).toBe("#FFB054");
    expect(resolveStyle("sticker", { body: "#FFB054" }).pal.belly).toBe(resolveStyle("sticker").pal.belly);
  });

  test("pattern, eyes, accessory and hairstyle each show", () => {
    for (const species of ["dragon", "cat", "robot", "princess", "prince"]) {
      for (const p of ["spots", "stripes", "hearts"] as const) {
        const html = render({ species, tier: 5, style: "gumdrop", look: { pattern: p } });
        if (species === "robot" && p !== "hearts") continue; // the robot is a box: hearts only, as in the workshop
        expect(html, `${species} ${p}`).toContain(`data-pattern="${p}"`);
      }
      expect(render({ species, tier: 5, style: "gumdrop" }), species).not.toContain("data-pattern");
    }
    expect(render({ species: "rex", tier: 5, style: "gumdrop", look: { eyes: "sparkly" } })).toContain('data-eyes="sparkly"');
    const happy = render({ species: "rex", tier: 5, style: "gumdrop", look: { eyes: "happy" } });
    expect(happy).toContain('data-eyes="happy"');
    expect(happy).not.toContain("creature-blink");
    // sleepy wins over any chosen eyes
    expect(render({ species: "rex", tier: 5, style: "gumdrop", mood: "sleepy", look: { eyes: "sparkly" } })).toContain('data-eyes="sleepy"');
    for (const acc of ["bow", "hat", "glasses", "flower"] as const) {
      for (const species of ["dragon", "unicorn", "princess"]) {
        expect(render({ species, tier: 5, style: "sticker", look: { acc } }), `${species} ${acc}`).toContain(`data-acc="${acc}"`);
      }
    }
    // sunglasses cover the eyes; the party hat makes way for the crown
    expect(render({ species: "cat", tier: 5, style: "gumdrop", look: { acc: "glasses" } })).not.toContain("creature-blink");
    expect(render({ species: "cat", tier: 8, style: "gumdrop", look: { acc: "hat" } })).not.toContain('data-acc="hat"');
    // the owl's own glasses and cap make way for the chosen ones
    expect(render({ species: "owl", tier: 7, style: "gumdrop", look: { acc: "glasses" } })).not.toContain('data-part="glasses"');
    expect(render({ species: "owl", tier: 7, style: "gumdrop", look: { acc: "hat" } })).not.toContain('data-part="cap"');
    // four hairstyles, four different heads
    for (const species of ["princess", "prince"]) {
      const heads = new Set(HAIRSTYLES.map((h) => render({ species, tier: 4, style: "gumdrop", look: { hairstyle: h } })));
      expect(heads.size, species).toBe(4);
    }
    // the default hairstyles: long for the princess, short for the prince
    expect(render({ species: "princess", tier: 4, style: "gumdrop" })).toBe(render({ species: "princess", tier: 4, style: "gumdrop", look: { hairstyle: "long" } }));
    expect(render({ species: "prince", tier: 4, style: "gumdrop" })).toBe(render({ species: "prince", tier: 4, style: "gumdrop", look: { hairstyle: "short" } }));
  });
});

test.describe("the editor's helpers and words", () => {
  test("Surprise me stays inside the sets, keeps the name and what does not apply", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const person = i % 2 === 0;
      const look = surpriseLook({ name: "Funkel", accent: "#56B6E8", hair: "#2B1D14" }, person, rand);
      expect(validateLook(look).ok).toBe(true);
      expect(look.name).toBe("Funkel");
      if (person) expect(look.accent).toBe("#56B6E8");
      else expect(look.hair).toBe("#2B1D14");
    }
  });

  test("Start over is the creature's own look, keeping the name", () => {
    expect(startOverLook({ name: "Funkel", body: "#FF8A5B", acc: "bow" })).toEqual({ name: "Funkel" });
    expect(startOverLook({ body: "#FF8A5B" })).toEqual({});
  });

  test("every swatch has a colour name in en, de and fr; every option a label", () => {
    const all = [...new Set(Object.values(LOOK_SWATCHES).flat().map((h) => h.toUpperCase()))];
    for (const hex of all) expect(COLOR_NAMES[hex], hex).toBeTruthy();
    for (const [lang, bundle] of [["en", en], ["de", de], ["fr", fr]] as const) {
      const pm = (bundle as unknown as { pocketMoney: { lookColors: Record<string, string>; lookEditor: Record<string, Record<string, string> | string> } }).pocketMoney;
      for (const hex of all) expect(pm.lookColors[COLOR_NAMES[hex]]?.trim(), `${lang} ${hex}`).toBeTruthy();
      const groups: Array<[string, ReadonlyArray<string>]> = [["patterns", PATTERNS], ["eyeShapes", EYE_SHAPES], ["accessories", ACCESSORIES], ["hairstyles", HAIRSTYLES]];
      for (const [group, list] of groups) for (const v of list) expect((pm.lookEditor[group] as Record<string, string>)[v]?.trim(), `${lang} ${group}.${v}`).toBeTruthy();
      for (const k of ["body", "outfit", "belly", "trim", "accent", "hair", "skin", "hairstyle", "surprise", "startOver", "save"]) expect((pm.lookEditor[k] as string)?.trim(), `${lang} ${k}`).toBeTruthy();
    }
    // the people use their own words in the editor
    expect(en.pocketMoney.lookEditor.outfit).toBe("Outfit colour");
    expect(en.pocketMoney.lookEditor.trim).toBe("Trim colour");
    expect(en.pocketMoney.lookEditor.hair).toBe("Hair colour");
  });

  test("a person is marked as one", () => {
    expect(DRAWN_SPECIES_IDS.filter((s) => speciesArt(s)?.person).sort()).toEqual(["prince", "princess"]);
  });
});
