import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { clampTier, moneyAvailable, parseCreaturePatch, pluginOn, startingStyle } from "../src/lib/creatures/rules";
import { clampStageWrites, creatureStage, effectiveGrowsWith, justifiedTiers } from "../src/lib/creatures/stage";
import { backupHasCreatures, personForOldRedemptions } from "../src/lib/creatures/backup";
import { pointTotals } from "../src/lib/pocket-money/points";
import { reactToTaskChange, resetCreatureReactions, useCreatureReactions } from "../src/stores/creature-reactions";
import { SETTINGS_ENTRIES } from "../src/lib/settings-search/registry";
import { searchSettings, toSearchable } from "../src/lib/settings-search/search";
import { codeOnly } from "./source-helpers";
import { activeCreatureOf } from "../src/hooks/use-creatures";

/** activeCreatureOf ignores a creature that is switched off. */
function activeCreatureOfEnabled(): boolean {
  const off = [{ person_id: "p", enabled: false }] as never;
  const on = [{ person_id: "p", enabled: true }] as never;
  return activeCreatureOf(off, "p") === undefined && activeCreatureOf(on, "p") !== undefined;
}

/**
 * RFC-017 step 1, below the database: what a creature write may carry and who
 * may make it, the stage read from the creature, a child's points without a
 * pocket-money account, the creature reactions, backups from before the move,
 * and where the screens read from. The database half is
 * creatures-migration.spec.ts and point-rewards-live.spec.ts; the routes'
 * PIN boundary is pocket-money-pin.spec.ts.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test.describe("a creature write", () => {
  test("a parent's fields need the PIN, the child's do not, and one parental field gates the lot", () => {
    for (const body of [{ enabled: false }, { species: "rex" }, { grows_with: "money" }, { shop_enabled: false }]) {
      const r = parseCreaturePatch(body);
      expect(r.ok && r.parental, JSON.stringify(body)).toBe(true);
    }
    for (const body of [{ style: "sticker" }, { look: { body: "#56B6E8" } }, { best_tier: 3 }, { last_seen_tier: 2 }]) {
      const r = parseCreaturePatch(body);
      expect(r.ok && !r.parental, JSON.stringify(body)).toBe(true);
    }
    const mixed = parseCreaturePatch({ look: { body: "#56B6E8" }, species: "unicorn" });
    expect(mixed.ok && mixed.parental).toBe(true);
  });

  test("refuses what it does not know, values outside the sets, and an empty write", () => {
    const refused = (body: unknown) => {
      const r = parseCreaturePatch(body);
      return r.ok ? null : r.error;
    };
    expect(refused({ avatar_style: "sticker" })).toBe("unknown field: avatar_style");
    expect(refused({ reward_mode: "points" })).toBe("unknown field: reward_mode");
    expect(refused({ species: "griffin" })).toContain("unknown species");
    expect(refused({ style: "neon" })).toContain("unknown style");
    expect(refused({ grows_with: "euros" })).toContain("grows_with");
    expect(refused({ enabled: "yes" })).toContain("enabled");
    expect(refused({ shop_enabled: 1 })).toContain("shop_enabled");
    expect(refused({ look: { wings: "#56B6E8" } })).toBe("unknown look key: wings");
    expect(refused({ look: ["x"] })).toBe("look must be an object");
    expect(refused({})).toBe("no updatable fields provided");
    expect(refused({ family_id: "x" })).toBe("no updatable fields provided");
    expect(refused(null)).toBe("body must be an object");
    expect(refused([])).toBe("body must be an object");
  });

  test("a family id sent along is accepted and dropped: the family is the session's", () => {
    const r = parseCreaturePatch({ family_id: "someone-else", best_tier: 2 });
    expect(r.ok && r.patch).toEqual({ best_tier: 2 });
  });

  test("the look is cleaned as #366 cleans it; a stage is held to 1..8", () => {
    const r = parseCreaturePatch({ look: { name: "  Funkel\n", body: "#ff8a5b" }, best_tier: 99, last_seen_tier: -3 });
    expect(r.ok && r.patch).toEqual({ look: { name: "Funkel", body: "#FF8A5B" }, best_tier: 8, last_seen_tier: 1 });
    expect([clampTier("4"), clampTier(4.9), clampTier("x"), clampTier(0)]).toEqual([4, 4, 1, 1]);
  });

  test("a new creature that exists only drawn starts in Gumdrop; the dragon on Classic", () => {
    expect(startingStyle("unicorn")).toBe("gumdrop");
    expect(startingStyle("dragon")).toBe("classic");
  });

  test("saved money is on offer only with the plugin on and an account", () => {
    expect(moneyAvailable({ pocketMoneyOn: true, hasAccount: true })).toBe(true);
    expect(moneyAvailable({ pocketMoneyOn: false, hasAccount: true })).toBe(false);
    expect(moneyAvailable({ pocketMoneyOn: true, hasAccount: false })).toBe(false);
    // The plugin is on unless the family switched it off.
    expect(pluginOn(undefined, "pocket-money")).toBe(true);
    expect(pluginOn({}, "pocket-money")).toBe(true);
    expect(pluginOn({ "pocket-money": true }, "pocket-money")).toBe(true);
    expect(pluginOn({ "pocket-money": false }, "pocket-money")).toBe(false);
    expect(pluginOn({ media: false }, "pocket-money")).toBe(true);
  });

  test("the route asks for money's availability before writing grows_with money", () => {
    const src = codeOnly(read("src/lib/creatures/server.ts"));
    const check = src.indexOf('patch.grows_with === "money" && !(await moneyAvailableFor(');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(src.indexOf(".update(patch)"));
  });
});

test.describe("the stage, read from the creature", () => {
  const account = { balance_cents: 1_000 }; // stage 5 with money
  test("points: the points earned, never below best_tier", () => {
    expect(creatureStage({ creature: { grows_with: "points", best_tier: 1 }, account, earnedPoints: 160 }).tier).toBe(3);
    expect(creatureStage({ creature: { grows_with: "points", best_tier: 6 }, account, earnedPoints: 0 }).tier).toBe(6);
  });

  test("money: the account's balance, as before", () => {
    const stage = creatureStage({ creature: { grows_with: "money", best_tier: 7 }, account, earnedPoints: 2_500 });
    expect([stage.mode, stage.tier, stage.best]).toEqual(["money", 5, 7]);
  });

  test("money without an account grows with points rather than freezing", () => {
    expect(effectiveGrowsWith({ grows_with: "money", best_tier: 1 }, null)).toBe("points");
    expect(creatureStage({ creature: { grows_with: "money", best_tier: 1 }, account: null, earnedPoints: 160 }).mode).toBe("points");
  });
});

test.describe("the stages a child's screen may record", () => {
  test("points: the lifetime points' stage bounds best_tier; the shown stage bounds last_seen_tier", () => {
    // 160 points is stage 3; a money stage 5 kept from before shows as 5.
    expect(justifiedTiers({ creature: { grows_with: "points", best_tier: 1 }, account: null, earnedPoints: 160 })).toEqual({ seen: 3, best: 3 });
    expect(justifiedTiers({ creature: { grows_with: "points", best_tier: 5 }, account: null, earnedPoints: 160 })).toEqual({ seen: 5, best: 3 });
  });

  test("money: the balance's stage bounds both", () => {
    expect(justifiedTiers({ creature: { grows_with: "money", best_tier: 7 }, account: { balance_cents: 400 }, earnedPoints: 9_999 })).toEqual({ seen: 4, best: 4 });
    // without the account, it grows with points
    expect(justifiedTiers({ creature: { grows_with: "money", best_tier: 1 }, account: null, earnedPoints: 50 })).toEqual({ seen: 2, best: 2 });
  });

  test("a write above is clamped, one below or equal is kept, and other fields pass through", () => {
    const bound = { seen: 3, best: 2 };
    expect(clampStageWrites({ best_tier: 8, last_seen_tier: 8, style: "sticker" as const }, bound)).toEqual({ best_tier: 2, last_seen_tier: 3, style: "sticker" });
    expect(clampStageWrites({ best_tier: 1, last_seen_tier: 3 }, bound)).toEqual({ best_tier: 1, last_seen_tier: 3 });
    expect(clampStageWrites({ look: {} } as { look: object; best_tier?: number }, bound)).toEqual({ look: {} });
  });

  test("the one write path applies the clamp before it writes, with the growth source the write leaves", () => {
    const src = codeOnly(read("src/lib/creatures/server.ts"));
    const clamp = src.indexOf("patch = clampStageWrites(patch, justifiedTiers(");
    expect(clamp).toBeGreaterThan(0);
    expect(clamp).toBeLessThan(src.indexOf(".update(patch)"));
    expect(src).toContain("const growsWith = patch.grows_with ?? creature.grows_with;");
    // and both routes that write a creature use it
    expect(read("src/app/api/creatures/[personId]/route.ts")).toContain("applyCreaturePatch({");
    expect(read("src/app/api/pocket-money/accounts/[id]/route.ts")).toContain("applyCreaturePatch({");
  });

  test("a child in the recycle bin is not in the family, for every creature route", () => {
    const src = codeOnly(read("src/lib/creatures/server.ts"));
    const fn = src.slice(src.indexOf("export async function personInFamily"), src.indexOf("export async function pocketMoneyOn"));
    expect(fn).toContain('.is("deleted_at", null)');
  });
});

test.describe("the profile shows a creature only when it is switched on", () => {
  test("family-members reads the creature through activeCreatureOf, for the picture and the points tile", () => {
    const src = codeOnly(read("src/components/widgets/family-members.tsx"));
    expect(src.match(/activeCreatureOf\(creatures, selectedPerson\.id\)/g)).toHaveLength(2);
    expect(activeCreatureOfEnabled()).toBe(true);
  });
});

test.describe("a child's points, per child", () => {
  test("the screens sum the child's awards and the child's requests, with no account in the sum", () => {
    expect(pointTotals(100, [{ cost_points: 30, status: "approved" }, { cost_points: 10, status: "pending" }]))
      .toMatchObject({ earned: 100, spent: 30, pending: 10, balance: 70, available: 60 });
    const hook = codeOnly(read("src/hooks/use-point-rewards.ts"));
    expect(hook).toContain("redemptionRows.filter((r) => r.person_id === personId)");
    expect(hook).not.toContain("account_id");
    expect(hook).toContain('fetch("/api/rewards/redemptions"');
  });
});

test.describe("the creature cheering a tick", () => {
  const KID = "kid";
  test.beforeEach(() => {
    // A visible screen: a hidden one plays nothing.
    (globalThis as { document?: unknown }).document = {
      visibilityState: "visible",
      documentElement: { hasAttribute: () => false },
    };
    resetCreatureReactions();
  });
  test.afterEach(() => {
    resetCreatureReactions();
    delete (globalThis as { document?: unknown }).document;
  });
  const tick = (qc: QueryClient) =>
    reactToTaskChange(qc, "fam",
      { id: "t1", person_id: KID, recurrence: "once", completed: false, points: 10 },
      { id: "t1", person_id: KID, recurrence: "once", completed: true, points: 10 });
  const client = (creatures: unknown[], accounts: unknown[] = []) => {
    const qc = new QueryClient();
    qc.setQueryData(["people", "fam"], [{ id: KID, is_child: true }]);
    qc.setQueryData(["todo-point-awards", "fam"], [{ person_id: KID, points: 45 }]);
    qc.setQueryData(["creatures", "fam"], creatures);
    qc.setQueryData(["pocket-money-accounts", "fam"], accounts);
    return qc;
  };

  test("a creature growing with points hatches on the tick that crosses 50", () => {
    expect(tick(client([{ person_id: KID, enabled: true, grows_with: "points", best_tier: 1 }]))).toBe(true);
    expect(useCreatureReactions.getState().current[KID]?.stageUp).toEqual({ from: 1, to: 2 });
  });

  test("one growing with money and an account does not; without the account it grows with points", () => {
    expect(tick(client([{ person_id: KID, enabled: true, grows_with: "money", best_tier: 1 }], [{ person_id: KID }]))).toBe(true);
    expect(useCreatureReactions.getState().current[KID]?.stageUp).toBeNull();
    resetCreatureReactions();
    expect(tick(client([{ person_id: KID, enabled: true, grows_with: "money", best_tier: 1 }]))).toBe(true);
    expect(useCreatureReactions.getState().current[KID]?.stageUp).toEqual({ from: 1, to: 2 });
  });

  test("a creature switched off has no stage to reach", () => {
    expect(tick(client([{ person_id: KID, enabled: false, grows_with: "points", best_tier: 1 }]))).toBe(true);
    expect(useCreatureReactions.getState().current[KID]?.stage).toBeNull();
  });
});

test.describe("backups across the move", () => {
  test("an old backup's requests get their child from the backup's own accounts", () => {
    const data: Record<string, unknown[]> = {
      pocket_money_accounts: [{ id: "a1", person_id: "p1" }, { id: "a2", person_id: "p2" }],
      point_redemptions: [{ id: "r1", account_id: "a1" }, { id: "r2", account_id: "a2", person_id: "p9" }, { id: "r3", account_id: "gone" }],
    };
    personForOldRedemptions(data);
    expect(data.point_redemptions).toEqual([
      { id: "r1", account_id: "a1", person_id: "p1" },
      // one that already names its child is left alone
      { id: "r2", account_id: "a2", person_id: "p9" },
      // and one whose account is not in the backup is skipped by the import, as before
      { id: "r3", account_id: "gone" },
    ]);
  });

  test("a backup without creatures is older than the move; with the key, even empty, it is the family's choice", () => {
    expect(backupHasCreatures({})).toBe(false);
    expect(backupHasCreatures({ creatures: [] })).toBe(true);
  });

  test("the export carries creatures, and the import remaps them by person and derives them for an old backup", () => {
    const exp = codeOnly(read("src/app/api/export/route.ts"));
    expect(exp).toMatch(/from\("creatures"\)\.select\("\*"\)\.eq\("family_id", familyId\)/);
    expect(exp).toMatch(/point_redemptions,\s*point_purchases,\s*creatures,\s*settings,/);
    const imp = codeOnly(read("src/app/api/import/route.ts"));
    const creatures = imp.slice(imp.indexOf('spec("creatures"'), imp.indexOf('spec("settings"'));
    expect(creatures).toContain("hasOwnId: false");
    expect(creatures).toContain('requiredFks: ["person_id"]');
    const redemptions = imp.slice(imp.indexOf('spec("point_redemptions"'), imp.indexOf('spec("creatures"'));
    expect(redemptions).toContain('requiredFks: ["person_id"]');
    expect(redemptions).toContain('nullableFks: ["account_id", "reward_id"]');
    expect(imp).toContain("personForOldRedemptions(payload.data);");
    expect(imp).toMatch(/if \(!backupHasCreatures\(payload\.data\)\) \{\s*const \{ error \} = await db\.rpc\("creatures_from_accounts", \{ p_family_id: newFamilyId \}\)/);
  });
});

test.describe("where the screens read the creature from", () => {
  test("every screen that draws a creature reads `creatures`, not the account's columns", () => {
    for (const file of [
      "src/app/pocket-money/page.tsx",
      "src/components/widgets/pocket-money-widget.tsx",
      "src/components/widgets/family-members.tsx",
      "src/app/settings/creatures/page.tsx",
    ]) {
      const src = codeOnly(read(file));
      expect(src, file).not.toMatch(/\.(avatar_species|avatar_style|avatar_look|reward_mode)\b/);
      expect(src, file).not.toMatch(/(account|acct|active)\??\.(best_tier|last_seen_tier)\b/);
      expect(src, file).toMatch(/useCreatures\(\)/);
    }
    const store = codeOnly(read("src/stores/creature-reactions.ts"));
    expect(store).toContain('["creatures", familyId]');
    expect(store).not.toContain("reward_mode");
  });

  test("the child's page writes the stage and the look to the creature route", () => {
    const page = codeOnly(read("src/app/pocket-money/page.tsx"));
    expect(page).toContain("updateCreature.mutateAsync({ personId: creature.person_id, change: update })");
    expect(page).toContain("change: { style, look }");
    const hook = codeOnly(read("src/hooks/use-creatures.ts"));
    expect(hook).toContain("fetch(`/api/creatures/${personId}`");
    expect(hook).not.toMatch(/\.from\("creatures"\)[^;]*\.(insert|update|upsert|delete)\(/);
  });
});

test.describe("Settings -> Creatures & rewards", () => {
  const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
  test("is found by its words in every language", () => {
    for (const [locale, query] of [["en", "creature"], ["de", "drache"], ["de", "belohnung"], ["de", "kreatur"], ["fr", "créature"], ["fr", "récompenses"]] as const) {
      const m = messages(locale);
      const t = (key: string) => key.split(".").reduce((o: any, k) => o?.[k], m) as string;
      const found = searchSettings(toSearchable(SETTINGS_ENTRIES, t), query).map((e) => e.href);
      expect(found[0], `${locale} ${query}`).toBe("/settings/creatures");
    }
  });

  test("is named in all three languages", () => {
    expect(messages("en").settings.itemCreaturesLabel).toBe("Creatures & rewards");
    expect(messages("de").settings.itemCreaturesLabel).toBe("Kreaturen & Belohnungen");
    expect(messages("fr").settings.itemCreaturesLabel).toBe("Créatures et récompenses");
  });

  test("holds the catalogue and the inbox; pocket money keeps the euros and links here", () => {
    const page = read("src/app/settings/creatures/page.tsx");
    expect(page).toContain("<RewardCatalogue />");
    expect(page).toContain("<RedemptionInbox");
    const pm = read("src/app/settings/pocket-money/page.tsx");
    for (const gone of ["RewardCatalogue", "RedemptionInbox", "RewardModeSelect", "AvatarStylePicker", "CreatureAvatar", "SpeciesPicker"]) {
      expect(pm, gone).not.toContain(gone);
    }
    expect(pm).toContain('href="/settings/creatures"');
  });
});
