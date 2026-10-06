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

  test("the keys are exactly the editor's", () => {
    expect([...LOOK_KEYS].sort()).toEqual(["acc", "accent", "belly", "body", "eyes", "hair", "hairstyle", "name", "pattern", "skin"]);
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
   * Every way a file could carry the look out: naming it, a whole account
   * row from a query on pocket_money_accounts (select("*"), a select string
   * with a *, or .select() with no columns, which returns the whole row after
   * an insert or update), or the accounts embedded whole in another query
   * (pocket_money_accounts(*), with or without a !hint).
   */
  const violations = (source: string): string[] => {
    const found: string[] = [];
    if (source.includes("avatar_look")) found.push("names avatar_look");
    // The look lives on the creature since RFC-017, and on the account until
    // a later release drops the column: a whole row of either carries it.
    for (const table of ["pocket_money_accounts", "creatures"]) {
      for (const m of source.matchAll(new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`, "g"))) {
        const rest = source.slice(m.index! + m[0].length);
        const chain = rest.slice(0, rest.search(/;|\n\s*\n/) === -1 ? rest.length : rest.search(/;|\n\s*\n/));
        if (/\.select\(\s*\)/.test(chain)) found.push(`${table} .select() with no columns`);
        for (const sel of chain.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
          if (sel[2].includes("*") || /\blook\b/.test(sel[2])) found.push(`${table} .select("${sel[2]}")`);
        }
      }
      if (new RegExp(`\\b${table}\\s*(?:![\\w]+\\s*)?\\(\\s*\\*`).test(source)) found.push(`${table}(*) embedded`);
    }
    return found;
  };

  test("no outward code -- Integration API, MCP, Home Assistant, push, notifications, cron -- reads avatar_look or a whole account row", () => {
    expect(outward.length).toBeGreaterThan(30);
    expect(outward.some((f) => f.endsWith("push-sender.ts"))).toBe(true);
    expect(outward.some((f) => f.includes("/api/cron/process-allowance/"))).toBe(true);
    expect(outward.some((f) => f.includes("/lib/notifications/"))).toBe(true);
    for (const f of outward) expect(violations(readFileSync(f, "utf8")), f).toEqual([]);
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
    ];
    for (const [what, source] of crafted) expect(violations(source).length, what).toBeGreaterThan(0);
    // and stays green on what the outward code does do
    for (const ok of [
      `await db.from("pocket_money_accounts").select("id, person_id, balance_cents, currency");`,
      `await db.from("calendar_events").insert(rows).select();`,
      `await db.from("people").select("id, pocket_money_accounts(id, balance_cents)");`,
      `await db.from("creatures").select("person_id, species, grows_with");`,
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
