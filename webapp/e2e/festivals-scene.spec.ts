import { expect, test } from "@playwright/test";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { runInNewContext } from "vm";
import { FESTIVAL_INIT_SCRIPT, FESTIVAL_STORAGE_KEY } from "../src/lib/festival-settings";
import { PASS_MS } from "../src/components/festival-visitors";
import { codeOnly } from "./source-helpers";

/**
 * How RFC-020's festivals join the weather effects in one scene (§5), and
 * that the weather effects are untouched by it when no festival is on.
 * Source guards and the init script, no stack; festivals-ui.spec.ts drives
 * the real page.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const scene = () => codeOnly(read("src/components/weather-effects.tsx"));

test("the weather's own drawing is exactly the code it was before the festivals joined", () => {
  // weatherLayer() is the old EffectsCanvas effect with its clock moved out
  // to the scene: the same particles, sprites, lightning and heat, line for
  // line (diffed against 6bb59951 when it was split). The hash makes any
  // change to it a deliberate one: update it with the change, not instead of
  // looking at it.
  const source = read("src/components/weather-effects.tsx");
  const body = source.slice(source.indexOf("function weatherLayer("), source.indexOf("  return {\n    resize,"));
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  expect(lines.length).toBe(253);
  expect(createHash("sha256").update(lines.join("\n")).digest("hex")).toBe("b54bfbc6d990df17989b672725788bc98df131fa07f2a1a2b442faa17a4fc63e");
});

test("one scene: the weather's clock, frame cap and pause drive the visitor too", () => {
  const code = scene();
  // One requestAnimationFrame loop, capped at 30 fps, drawing the weather and then the visitor.
  expect(code.match(/window\.requestAnimationFrame\(tick\)/g)?.length).toBe(2);
  expect(code.match(/if \(t - last < FRAME_MS\) return;/g)?.length).toBe(1);
  expect(code).toMatch(/weather\?\.draw\(t, dt\);\s*drawVisitor\(t, dt\);/);
  // With no weather showing, the loop runs only for a pass, and nothing at all while hidden.
  expect(code).toContain("if (!weather && !pass) stop();");
  expect(code).toContain("if (!frame && !document.hidden && (weather || pass)) frame = window.requestAnimationFrame(tick);");
  expect(code).toContain("const onVisibility = () => (document.hidden ? stop() : start());");
  // One wind: the visitor gets the weather's gust.
  expect(code).toContain("const wind = gust * (0.8 + 0.2 * Math.sin(t / 2300));");
  // The visitor's canvas has pixels only during a pass, and clears only what it drew over.
  expect(code).toContain("front.width = 0;");
  expect(code).toContain("if (dirty) fctx.clearRect(dirty.x - 2, dirty.y - 2, dirty.w + 4, dirty.h + 4);");
  // Bitmaps in idle time, not on the frame the festival starts.
  expect(code).toContain("window.requestIdleCallback(() => void prepare(), { timeout: 2_000 })");
});

test("with no festival on, nothing of it is there: no canvas, no timer, no button", () => {
  const code = scene();
  // Home: the weather alone returns exactly what it did; the visitor is only ever added.
  expect(code).toContain("const visitor = forced ? null : (festival?.kit.visitor ?? null);");
  expect(code).toContain("if (effects.length === 0 && visitor) return <FestivalVisitor />;");
  expect(code).toContain('if (effects.length === 0 || motion === "off") return null;');
  expect(code).toContain("{flying && <VisitorTap ref={tapRef} placement=\"home\" />}");
  // The scene: the visitor's canvas, its passes and its tap only with a visitor.
  expect(code).toContain("const flies = Boolean(visitor && front && fctx);");
  expect(code).toContain("if (flies) passTimer = window.setTimeout(beginPass, preview ? 600 : FIRST_PASS_MS);");
  expect(code).toMatch(/\{visitor && \(\s*<canvas\s*ref=\{frontRef\}/);
  // The weather's canvas is the one it always was.
  expect(code).toMatch(/\{effects\.length > 0 && \(\s*<canvas\s*ref=\{ref\}\s*data-testid="weather-effects-motion"\s*className="pointer-events-none fixed inset-0 z-\[5\] h-full w-full"/);
});

test("the Animations switch, exactly as §4 says", () => {
  const code = scene();
  // On: everything. Reduced: no visitor (dressing and outfits stay). Off: the colour wash only.
  expect(code).toContain('const flying = motion === "full" ? visitor : null;');
  expect(code).toContain('if (!visitor || motion !== "full") return null;');
  const css = read("src/app/globals.css");
  const dressing = css.slice(css.indexOf("/* ── Festival dressing"));
  const rules = dressing.match(/^:root\[data-festival="[^"]+"\][^{]*\{/gm) ?? [];
  expect(rules.length).toBeGreaterThanOrEqual(6);
  for (const rule of rules) expect(rule, rule).toContain(':not([data-motion="off"])');
  // The outfit goes with Off too (the wash only); the wash stays on every setting.
  expect(codeOnly(read("src/hooks/use-festival.ts"))).toContain('const id = motion === "off" ? null : (festival?.id ?? null);');
  const wash = css.slice(css.indexOf("body::before {"), css.indexOf(".page-gradient {"));
  expect(wash).toContain("hsl(var(--festival-top, var(--month-primary)) / var(--month-wash-top))");
  expect(wash).toContain("hsl(var(--festival-bottom, var(--month-primary)) / var(--month-wash-bottom))");
  // The same strengths as the month's wash (§2.4): contrast doesn't change.
  expect(wash).toContain(":root { --month-wash-top: 0.07; --month-wash-bottom: 0.05; }");
  expect(wash).toContain(".dark { --month-wash-top: 0.14; --month-wash-bottom: 0.10; }");
  expect(wash).not.toMatch(/data-festival[^{]*\{[^}]*--month-wash/);
});

test("over the widgets, under the frost and the heat; only the visitor's own shape takes a tap, once a pass", () => {
  const code = scene();
  // Widgets are z-10; frost, heat and the storm's glow z-20 sit over everything.
  expect(code).toContain('className={`pointer-events-none ${layer} inset-0 ${placement === "home" ? "z-[15]" : ""} h-full w-full`}');
  expect(code).toContain('className={`${placement === "home" ? "fixed z-[15]" : "absolute"} left-0 top-0 cursor-pointer rounded-3xl border-0 bg-transparent p-0`}');
  // Outside the aria-hidden overlay, out of the tab order, and it never wakes the screensaver.
  expect(code).toMatch(/tabIndex=\{-1\}\s*aria-hidden="true"\s*hidden\s*data-no-wake=""/);
  // A tap: presents and stars, the creatures cheer, and the button is gone for the rest of the pass.
  expect(code).toMatch(/pass\.tap\(\);\s*if \(button\) button\.hidden = true;/);
  expect(code).toContain("if (familyId) cheerCreatures(queryClient, familyId);");
  const visitors = codeOnly(read("src/components/festival-visitors.ts"));
  expect(visitors.match(/if \(tappedAt >= 0 \|\| !target\) return;/g)?.length).toBe(2);
  expect(visitors.match(/return tappedAt >= 0 \? null : target;/g)?.length).toBe(2);
});

test("every two minutes, about ten seconds a pass, on Home and the screensaver", () => {
  const code = scene();
  expect(code).toContain("const PASS_EVERY_MS = 120_000;");
  expect(PASS_MS).toBe(10_000);
  // Home doesn't fly a second one under the screensaver.
  expect(code).toContain('if (placement === "home" && document.documentElement.hasAttribute("data-screensaver")) return;');
  // The screensaver: above the photo, below the clock and everything after it.
  const saver = codeOnly(read("src/components/screensaver.tsx"));
  const visitorAt = saver.indexOf('<FestivalVisitor placement="screensaver" />');
  expect(visitorAt).toBeGreaterThan(saver.indexOf("screensaver-photo-in"));
  expect(visitorAt).toBeLessThan(saver.indexOf("{(screensaverSettings.showNews ?? true)"));
  expect(code).toContain("const PREVIEW_EVERY_MS = 20_000;");
});

test("sprites are drawn once, at the screen's pixel ratio capped as the weather's, and let go when the festival ends", () => {
  const code = scene();
  expect(code.match(/const dpr = Math\.min\(window\.devicePixelRatio \|\| 1, 1\.5\);/g)?.length).toBe(2);
  expect(code).toContain("return prepareVisitorSprites(visitor, visitorScale(visitor, width, height), dpr)");
  const visitors = codeOnly(read("src/components/festival-visitors.ts"));
  expect(visitors).toContain("const k = scale * dpr;");
  expect(visitors).toContain("img.src = `/festivals/${name}.svg`;");
  expect(visitors).toContain('if ("close" in b) b.close();');
  expect(codeOnly(read("src/hooks/use-festival.ts"))).toContain("releaseVisitorSprites((kind) => kind === visitor);");
  // Every part the rig names is a file the browser can fetch.
  for (const part of Object.keys(JSON.parse(read("src/lib/festival-rig.json")).parts)) {
    expect(read(`public/festivals/${part}.svg`).startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""), part).toBe(true);
  }
});

test("<html data-festival> before first paint, while the festival this device last showed is still on", () => {
  // Right after the motion level's, ahead of the app; only a comment between them.
  expect(read("src/app/layout.tsx")).toMatch(
    /<script dangerouslySetInnerHTML=\{\{ __html: MOTION_INIT_SCRIPT \}\} \/>\s*\{\/\*[^*]*\*\/\}\s*<script dangerouslySetInnerHTML=\{\{ __html: FESTIVAL_INIT_SCRIPT \}\} \/>/,
  );
  const run = (stored: unknown, today: Date) => {
    const attrs: Record<string, string> = {};
    const store: Record<string, string> = stored === undefined ? {} : { [FESTIVAL_STORAGE_KEY]: JSON.stringify(stored) };
    class FixedDate extends Date {
      constructor() {
        super(today.getTime());
      }
    }
    runInNewContext(FESTIVAL_INIT_SCRIPT, {
      localStorage: { getItem: (k: string) => store[k] ?? null },
      document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
      Date: FixedDate,
      JSON,
    });
    return attrs;
  };
  const advent = { id: "christmas", stage: null, start: "2026-11-29", end: "2027-01-06" };
  expect(run(advent, new Date(2026, 11, 2, 9))).toEqual({ "data-festival": "christmas" });
  expect(run(advent, new Date(2027, 0, 6, 9))).toEqual({ "data-festival": "christmas" });
  expect(run(advent, new Date(2027, 0, 7, 9))).toEqual({});
  expect(run({ id: "st-nicholas", stage: "eve", start: "2026-12-05", end: "2026-12-06" }, new Date(2026, 11, 5, 18))).toEqual({
    "data-festival": "st-nicholas",
    "data-festival-stage": "eve",
  });
  expect(run(undefined, new Date(2026, 11, 2))).toEqual({});
  // Only an id it could have written: never markup from storage.
  expect(run({ ...advent, id: '"><script>' }, new Date(2026, 11, 2))).toEqual({});
});

test("Settings -> Design -> Festivals: the setting, the search, and every string in every language", () => {
  expect(read("src/lib/settings-keys.ts")).toContain('festivals: "festivals",');
  expect(read("src/lib/settings-search/registry.ts")).toContain(
    '{ anchor: "festivals", labelKey: "settings.theme.festivalsLabel", descriptionKey: "settings.theme.festivalsHint" },',
  );
  const page = codeOnly(read("src/app/settings/theme/page.tsx"));
  expect(page).toContain("<FestivalSettingsCard />");
  expect(page).toContain('<motion.div id="festivals" data-setting="festivals"');
  const card = codeOnly(read("src/components/settings/festival-settings.tsx"));
  expect(card).toContain("{previewing && <FestivalVisitor key={previewing} />}");
  // Re-read every minute, like the weather effects (#429).
  expect(codeOnly(read("src/hooks/use-festival.ts"))).toContain(
    "useSetting<unknown>(SETTINGS_KEYS.festivals, DEFAULT_FESTIVAL_SETTINGS, { refetchInterval: 60_000 })",
  );
  const keys = (o: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const festivalKeys = (lang: string) => {
    const m = JSON.parse(read(`messages/${lang}.json`));
    const theme = Object.fromEntries(Object.entries(m.settings.theme).filter(([k]) => k.startsWith("festival")));
    return [...keys(theme), ...keys(m.pocketMoney.lookEditor).filter((k) => k.startsWith("festive")), m.settingsSearch.keywords.theme_festivals ? "kw" : ""].sort();
  };
  const en = festivalKeys("en");
  expect(en).toEqual(expect.arrayContaining(["festivalName.christmas", "festivalName.st-martin", "festivalName.st-nicholas", "festive", "festiveHint", "kw"]));
  expect(festivalKeys("de")).toEqual(en);
  expect(festivalKeys("fr")).toEqual(en);
});

test("the Santa hat is the festival's, worn on the creatures' screens, and never in the editor or the shop", () => {
  const items = codeOnly(read("src/lib/pocket-money/creatures/items.tsx"));
  expect(items).toContain('export const FESTIVAL_ITEMS: Readonly<Record<string, ShopSlot>> = { santa_hat: "head" };');
  expect(items).toContain('case "santa_hat":');
  expect(read("src/lib/pocket-money/creatures/shop.ts")).not.toContain("santa_hat");
  for (const file of [
    "src/components/widgets/creatures-widget.tsx",
    "src/components/widgets/pocket-money-widget.tsx",
    "src/components/widgets/family-members.tsx",
    "src/app/todos/page.tsx",
    "src/app/rewards/page.tsx",
    "src/app/pocket-money/page.tsx",
  ]) {
    expect(codeOnly(read(file)), file).toMatch(/festive\((readLook|look|activeLook)/);
  }
  // The editor gets the child's own look: the hat would fail the save (validateLook).
  expect(codeOnly(read("src/app/rewards/page.tsx"))).toMatch(/<CreatureLookEditor[\s\S]*?look=\{look\}/);
  expect(codeOnly(read("src/app/pocket-money/page.tsx"))).toMatch(/<CreatureLookEditor[\s\S]*?look=\{activeLook\}/);
});
