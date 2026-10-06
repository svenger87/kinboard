import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { foldSearch, searchEmoji, withTone, type EmojiCatalog } from "../src/lib/emoji/catalog";
import { canonicalEmoji, EMOJI_COUNT, isEmojiIcon, isOneGrapheme } from "../src/lib/emoji/validate";
import { LEGACY_TODO_ICONS } from "../src/lib/todo-icons";
import { parseReward } from "../src/lib/pocket-money/rewards";
import { REWARD_ICON_MAX } from "../src/lib/pocket-money/points";

/**
 * The emoji picker, the one icon picker for tasks and rewards: every Unicode
 * emoji but the flags, searchable in the screen's language and English, and
 * the rule the server holds icons to -- one emoji of that set, whatever its
 * length in code units. Pure data and functions, no stack; the rendered
 * picker is emoji-picker-ui.spec.ts.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const catalog = (l: "en" | "de" | "fr") => JSON.parse(read(`src/lib/emoji/data/${l}.json`)) as EmojiCatalog;
const finds = (l: "en" | "de" | "fr", query: string) => searchEmoji(catalog(l), query).map((r) => r[0]);

test.describe("search", () => {
  test("the screen's language, English as well, any case, no accents needed", () => {
    expect(finds("de", "Eis")).toContain("🍦");
    expect(finds("de", "eis")).toContain("🍦");
    expect(finds("de", "ice")).toContain("🍦");
    expect(finds("fr", "glace")).toContain("🍦");
    expect(finds("fr", "GLACE")).toContain("🍦");
    expect(finds("fr", "ice cream")).toContain("🍦");
    expect(finds("en", "ice")).toContain("🍦");
    // Käse without the umlaut or with it.
    expect(finds("de", "kase")).toContain("🧀");
    expect(finds("de", "Käse")).toContain("🧀");
    expect(foldSearch("Crème Brûlée")).toBe("creme brulee");
    // Every word must match.
    expect(finds("en", "ice cream")).toContain("🍦");
    expect(finds("en", "ice zebra")).toEqual([]);
    expect(finds("en", "   ")).toEqual([]);
  });

  test("a name that starts with the word comes before one that only contains it", () => {
    const cat = finds("en", "cat");
    expect(cat.slice(0, 3)).toContain("🐱");
    expect(cat.indexOf("🐱")).toBeLessThan(cat.indexOf("😺"));
  });

  test("the reward-ish symbols are all there, in every language", () => {
    for (const l of ["en", "de", "fr"] as const) {
      const all = new Set(catalog(l).emoji.map((r) => r[0]));
      for (const e of ["🎮", "📺", "🍦", "🍕", "🎬", "🛝", "🧸", "🎨", "⚽", "🚲", "📚", "🎁", "⭐", "🏊", "🎡"]) {
        expect(all.has(e), `${l} ${e}`).toBe(true);
      }
    }
  });
});

test.describe("what is in the set", () => {
  test("no flags, no bare components, the same emoji in every language", () => {
    for (const l of ["en", "de", "fr"] as const) {
      const c = catalog(l);
      expect(c.groups.map((g) => g.key)).not.toContain("flags");
      expect(c.groups.map((g) => g.key)).not.toContain("component");
      expect(c.groups).toHaveLength(8);
      const emoji = c.emoji.map((r) => r[0]);
      expect(emoji.length).toBeGreaterThan(1500);
      expect(emoji).toEqual(catalog("en").emoji.map((r) => r[0]));
      for (const e of emoji) {
        expect(/[\u{1F1E6}-\u{1F1FF}]/u.test(e), `${e} is a flag`).toBe(false);
        expect(/^[\u{1F3FB}-\u{1F3FF}]$/u.test(e), `${e} is a bare skin tone`).toBe(false);
      }
      // Group names in the file's language.
      expect(c.groups[3].label).toBe({ en: "food & drink", de: "Essen & Trinken", fr: "nourriture et boissons" }[l]);
    }
    for (const flag of ["🇩🇪", "🇫🇷", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "🇺🇳", "🏳️‍🌈", "🏁"]) expect(isEmojiIcon(flag), flag).toBe(false);
    for (const part of ["🏻", "🏿", "\u{1F9B0}"]) expect(isEmojiIcon(part), part).toBe(false);
  });

  test("skin tones: five single-tone variants where an emoji has them", () => {
    const thumbs = catalog("en").emoji.find((r) => r[0] === "👍")!;
    expect(thumbs[4]).toEqual(["👍🏻", "👍🏼", "👍🏽", "👍🏾", "👍🏿"]);
    expect(withTone(thumbs, 0)).toBe("👍");
    expect(withTone(thumbs, 3)).toBe("👍🏽");
    const cat = catalog("en").emoji.find((r) => r[0] === "🐱")!;
    expect(withTone(cat, 3)).toBe("🐱");
  });

  test("the data is what the pinned emojibase-data makes of it", () => {
    expect(JSON.parse(read("package.json")).devDependencies["emojibase-data"]).toBe("17.0.0");
    execFileSync("node", ["scripts/generate-emoji-data.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
    expect(read("src/lib/emoji/data/LICENSE")).toMatch(/MIT License/);
    expect(read("../NOTICE")).toMatch(/emojibase/);
  });
});

test.describe("the icon rule (server)", () => {
  test("one emoji of the set, however long: ZWJ sequences, keycaps, skin tones", () => {
    for (const e of ["🧑🏻‍❤️‍💋‍🧑🏼", "👨‍👩‍👧‍👦", "👩🏽‍🚒", "🧑‍🍳", "1️⃣", "#️⃣", "👍🏽", "❤️", "🍦"]) {
      expect(isEmojiIcon(e), e).toBe(true);
    }
    // Ten code points, fifteen UTF-16 units, one emoji.
    expect([..."🧑🏻‍❤️‍💋‍🧑🏼"].length).toBe(10);
    expect("🧑🏻‍❤️‍💋‍🧑🏼".length).toBe(15);
    expect(isOneGrapheme("🧑🏻‍❤️‍💋‍🧑🏼")).toBe(true);
  });

  test("refuses text, two emoji, an emoji with text, padding, and nothing", () => {
    // "©", "1" and "🗑" alone are the text characters, not the emoji.
    for (const bad of ["TV", "a", "🍦🍦", "🍦 ", " 🍦", "🍦x", "x🍦", "", "1", "#", "©", "\u{1F5D1}", "™️x", 7, null]) {
      expect(isEmojiIcon(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  test("a selector it does not need is dropped: stored fully qualified", () => {
    expect(canonicalEmoji("\u{1F5D1}")).toBeNull();
    expect(canonicalEmoji("🗑️")).toBe("🗑️");
    expect(canonicalEmoji("📚️")).toBe("📚");
    expect(canonicalEmoji("❤")).toBeNull();
    expect(canonicalEmoji("©️")).toBe("©️");
  });

  test("everything the picker offers passes, and fits the database's icon check", () => {
    let checked = 0;
    for (const row of catalog("en").emoji) {
      for (const e of [row[0], ...(row[4] ?? [])]) {
        expect(canonicalEmoji(e), e).toBe(e);
        // point_rewards.icon: char_length (code points) <= 16.
        expect([...e].length, e).toBeLessThanOrEqual(REWARD_ICON_MAX);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2500);
    expect(EMOJI_COUNT).toBeGreaterThanOrEqual(checked);
  });

  test("old data still passes: the task form's nine, and the icons in use", () => {
    for (const e of LEGACY_TODO_ICONS) expect(canonicalEmoji(e), e).toBe(e);
    // Icons found in the local database when this landed (todos: none; point_rewards: 🍦).
    expect(canonicalEmoji("🍦")).toBe("🍦");
  });

  test("a reward: one emoji, canonical; an old free-text icon is kept when sent back unchanged", () => {
    expect(parseReward({ icon: " 🍦 " }, true)).toEqual({ ok: true, fields: { icon: "🍦" } });
    expect(parseReward({ icon: "👨‍👩‍👧‍👦" }, true)).toEqual({ ok: true, fields: { icon: "👨‍👩‍👧‍👦" } });
    expect(parseReward({ icon: "" }, true)).toEqual({ ok: true, fields: { icon: null } });
    expect(parseReward({ icon: "TV" }, true).ok).toBe(false);
    expect(parseReward({ icon: "🍦🍦" }, true).ok).toBe(false);
    // The text field allowed this; a reward that has it can still be edited.
    expect(parseReward({ icon: "TV", title: "Fernsehen" }, true, { storedIcon: "TV" })).toEqual({ ok: true, fields: { icon: "TV", title: "Fernsehen" } });
    expect(parseReward({ icon: "PC" }, true, { storedIcon: "TV" }).ok).toBe(false);
  });
});

test.describe("the bundle", () => {
  test("the picker's data is loaded with a dynamic import, never a static one", () => {
    const loader = read("src/lib/emoji/catalog.ts");
    for (const l of ["en", "de", "fr"]) expect(loader).toContain(`import("./data/${l}.json")`);
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(name)) out.push(p);
      }
      return out;
    };
    for (const file of walk(join(ROOT, "src"))) {
      const src = readFileSync(file, "utf8");
      // No static import of a language file anywhere.
      expect(src, file).not.toMatch(/^import [^;]*emoji\/data\/(en|de|fr)\.json/m);
      expect(src, file).not.toMatch(/^import [^;]*\.\/data\/(en|de|fr)\.json/m);
      // The validation set stays on the server.
      if (/^["']use client["']/m.test(src)) {
        expect(src, file).not.toMatch(/emoji\/validate|lib\/todo-icons|pocket-money\/rewards"/);
      }
    }
    for (const file of walk(join(ROOT, "src/components")).concat(walk(join(ROOT, "src/hooks")))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/emoji\/validate|lib\/todo-icons"/);
    }
  });

  test("each language's chunk stays small", () => {
    for (const l of ["en", "de", "fr"]) {
      const gz = gzipSync(read(`src/lib/emoji/data/${l}.json`)).length;
      expect(gz, l).toBeLessThan(100_000);
    }
  });
});

test.describe("one picker", () => {
  test("the task form and the rewards catalogue both use it", () => {
    expect(read("src/components/todo-decoration-fields.tsx")).toContain("<EmojiIconField");
    expect(read("src/components/pocket-money/rewards-settings.tsx").match(/<EmojiIconField/g)?.length).toBe(2);
    expect(read("src/components/pocket-money/rewards-settings.tsx")).not.toMatch(/rewardIconLabel[\s\S]{0,80}<Input/);
  });

  test("translations in all three languages", () => {
    const [en, de, fr] = ["en", "de", "fr"].map((l) => Object.keys(JSON.parse(read(`messages/${l}.json`)).emojiPicker).sort());
    expect(en.length).toBeGreaterThan(10);
    expect(de).toEqual(en);
    expect(fr).toEqual(en);
  });
});
