import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { avatarStage, isGrowthPoints, readGrowthPoints, tierFromPoints } from "../src/lib/pocket-money/points";
import { TIER_THRESHOLDS_POINTS } from "../src/lib/pocket-money/types";
import { creatureStage, justifiedTiers } from "../src/lib/creatures/stage";
import { floorsToKeep, type GrowingCreature } from "../src/lib/creatures/growth";
import { stageUpFor } from "../src/lib/pocket-money/creature-reactions";
import { codeOnly } from "./source-helpers";

/**
 * The family's own growth: how the setting is read, the stage it gives, the
 * floors that keep every creature where it is when the numbers rise, and how
 * the route, the server's stage reads, every screen and the tick reaction use
 * it. growth-points-ui.spec.ts drives a stack.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const MINE = [20, 40, 80, 160, 320, 640, 1280];

test("the setting: seven whole numbers from 1, each above the last; anything else is the standard list", () => {
  expect(TIER_THRESHOLDS_POINTS).toEqual([0, 50, 150, 300, 600, 1000, 1600, 2500]);
  expect(readGrowthPoints(MINE)).toEqual([0, ...MINE]);
  for (const bad of [null, undefined, "20", [20, 40], [20, 40, 80, 160, 320, 640, 1280, 2560], [0, 40, 80, 160, 320, 640, 1280],
    [20, 20, 80, 160, 320, 640, 1280], [40, 20, 80, 160, 320, 640, 1280], [20.5, 40, 80, 160, 320, 640, 1280], ["20", 40, 80, 160, 320, 640, 1280]]) {
    expect(isGrowthPoints(bad), JSON.stringify(bad)).toBe(false);
    expect(readGrowthPoints(bad), JSON.stringify(bad)).toBe(TIER_THRESHOLDS_POINTS);
  }
});

test("the stage with the family's numbers: the tier, the next stage and the list the stages sheet draws", () => {
  const mine = readGrowthPoints(MINE);
  expect(tierFromPoints(100)).toBe(2);
  expect(tierFromPoints(100, mine)).toBe(4);
  const stage = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 100, storedBestTier: 1, pointThresholds: mine });
  expect([stage.tier, stage.next, stage.thresholds]).toEqual([4, { tier: 5, at: 160 }, mine]);
  // Left out: the standard numbers, as before.
  expect(avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 100, storedBestTier: 1 }).next).toEqual({ tier: 3, at: 150 });
  // Never below best_tier; money follows the money.
  expect(avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 0, storedBestTier: 5, pointThresholds: mine }).tier).toBe(5);
  const money = creatureStage({ creature: { grows_with: "money", best_tier: 1 }, account: { balance_cents: 0 }, earnedPoints: 5000, pointThresholds: mine });
  expect(money.mode).toBe("money");
  expect(creatureStage({ creature: { grows_with: "points", best_tier: 1 }, account: null, earnedPoints: 100, pointThresholds: mine }).tier).toBe(4);
  expect(justifiedTiers({ creature: { grows_with: "points", best_tier: 1 }, account: null, earnedPoints: 100, pointThresholds: mine })).toEqual({ seen: 4, best: 4 });
  // A tick's stage-up uses them too.
  expect(stageUpFor({ mode: "points", storedBestTier: 1, pointThresholds: mine }, 30, 15)).toEqual({ from: 2, to: 3 });
  expect(stageUpFor({ mode: "points", storedBestTier: 1 }, 30, 15)).toBeNull();
});

test("nobody shrinks: raising the numbers floors each creature growing with points at the stage it has", () => {
  const kid = (personId: string, earnedPoints: number, extra: Partial<GrowingCreature> = {}): GrowingCreature => ({
    personId, earnedPoints, creature: { grows_with: "points", best_tier: 1 }, account: null, ...extra,
  });
  const standard = TIER_THRESHOLDS_POINTS;
  const harder = readGrowthPoints([100, 300, 600, 1200, 2000, 3200, 5000]);
  const creatures = [
    kid("a", 160), // stage 3 now, stage 2 under the harder numbers
    kid("b", 20), // an egg either way
    kid("c", 2500), // stage 8 now, 6 then
    kid("d", 5000, { creature: { grows_with: "money", best_tier: 1 }, account: { balance_cents: 0 } }), // money: not ours
    kid("e", 160, { creature: { grows_with: "money", best_tier: 1 }, account: null }), // money with no account grows with points
    kid("f", 160, { creature: { grows_with: "points", best_tier: 3 } }), // already floored at 3
  ];
  expect(floorsToKeep(creatures, standard, harder)).toEqual([
    { personId: "a", tier: 3 }, { personId: "c", tier: 8 }, { personId: "e", tier: 3 },
  ]);
  // Lowering them: nobody to keep; they grow.
  expect(floorsToKeep(creatures, standard, readGrowthPoints(MINE))).toEqual([]);
});

test("the route: behind the PIN, checked, floors written before the numbers; the generic route refuses the key", () => {
  expect(codeOnly(read("src/app/api/settings/route.ts"))).toContain('[SETTINGS_KEYS.growthPoints]: "/api/creatures/growth",');
  const route = codeOnly(read("src/app/api/creatures/growth/route.ts"));
  expect(route.indexOf("requireSettingsUnlock(auth.session)")).toBeGreaterThan(0);
  expect(route.indexOf("requireSettingsUnlock(auth.session)")).toBeLessThan(route.indexOf("request.json()"));
  expect(route).toContain('if (body.points !== null && !isGrowthPoints(body.points)) return NextResponse.json({ error: "bad_points" }, { status: 400 });');
  const floors = route.indexOf('update({ best_tier: f.tier })');
  expect(floors).toBeGreaterThan(0);
  expect(floors).toBeLessThan(route.indexOf('.from("settings")'));
  expect(route).toContain("const floors = floorsToKeep(growing, before, after);");
});

test("every stage the server works out and every screen uses the family's numbers", () => {
  expect(codeOnly(read("src/lib/creatures/server.ts"))).toContain("growthPointsFor(db, familyId),");
  expect(codeOnly(read("src/lib/creatures/server.ts"))).toContain("earnedPoints: earned, pointThresholds })");
  for (const file of ["src/lib/integration-rewards.ts", "src/lib/integration-week-summary.ts"]) {
    const src = codeOnly(read(file));
    expect(src, file).toMatch(/const pointThresholds = await growthPointsFor\((db|d), familyId\);/);
    expect(src, file).toMatch(/earnedPoints: [^\n]+,\n\s+pointThresholds,/);
  }
  const screens = [
    "src/app/pocket-money/page.tsx", "src/app/settings/creatures/page.tsx", "src/app/rewards/page.tsx", "src/app/todos/page.tsx",
    "src/components/creatures-on-home.tsx", "src/components/widgets/pocket-money-widget.tsx",
    "src/components/widgets/family-members.tsx", "src/components/widgets/creatures-widget.tsx",
  ];
  for (const file of screens) {
    const src = codeOnly(read(file));
    expect(src, file).toContain("const pointThresholds = useGrowthPoints();");
    const calls = src.split("creatureStage(").slice(1);
    expect(calls.length, file).toBeGreaterThan(0);
    for (const call of calls) expect(call.slice(0, call.indexOf("})")), file).toContain("pointThresholds");
  }
  const store = codeOnly(read("src/stores/creature-reactions.ts"));
  expect(store).toContain('const GROWTH_KEY = (familyId: string) => ["settings", familyId, SETTINGS_KEYS.growthPoints];');
  expect(codeOnly(read("src/hooks/use-supabase-queries.ts"))).toMatch(/settings: \(familyId: string, key: string\) =>\s*\["settings", familyId, key\] as const/);
  expect(store).toContain("storedBestTier: creature.best_tier, pointThresholds }");
  const card = codeOnly(read("src/components/settings/growth-settings.tsx"));
  // No edit before the family's numbers are in, nor while one is saving.
  expect(card).toContain("const locked = !ready || save.isPending;");
  expect(card).toContain("disabled={locked}");
  expect(card).toContain('<Card id="growth" data-setting="growth" className="p-4 space-y-4" data-testid="growth-points">');
  expect(codeOnly(read("src/app/settings/creatures/page.tsx"))).toMatch(/<CreaturesHomeSettings \/>\s*<GrowthSettings \/>/);
  expect(read("src/lib/settings-search/registry.ts")).toContain('{ anchor: "growth", labelKey: "settings.creatures.growthLabel", descriptionKey: "settings.creatures.growthHint" },');
});

test("every string is there in every language", () => {
  for (const lang of ["en", "de", "fr"]) {
    const m = JSON.parse(read(`messages/${lang}.json`));
    const c = m.settings.creatures;
    for (const k of ["growthLabel", "growthHint", "growthHatch", "growthStage", "growthAria", "growthInvalid", "growthReset", "growthKept"]) {
      expect(c[k], `${lang} ${k}`).toBeTruthy();
    }
    expect(c.growthStage, lang).toContain("{n}");
    expect(c.growthKept, lang).toContain("{count, plural,");
    expect(m.settingsSearch.keywords.creatures_growth, lang).toBeTruthy();
  }
});
