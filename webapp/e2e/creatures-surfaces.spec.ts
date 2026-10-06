import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { creatureChildren, rewardsNavVisible, stageProgress } from "../src/lib/creatures/surfaces";
import { mayStartElsewhere, parseDeviceOwner, rewardsHref, startRouteFor } from "../src/lib/device-owner";
import { documentStartPath, isAppStartAtDashboard, noteRoute, resetAppStart } from "../src/lib/app-start";
import { avatarStage } from "../src/lib/pocket-money/points";
import { DEFAULT_WIDGET_ORDER, DEFAULT_WIDGET_VISIBILITY } from "../src/types/widgets";
import { canHideNavItem } from "../src/lib/nav-visibility";
import { codeOnly } from "./source-helpers";

/**
 * RFC-017 step 2, the surfaces, below the browser: the rules that decide
 * where the creatures show up -- the Rewards nav item, the children the
 * widget and the page show, how far a creature is toward its next stage --
 * and a child's own device: who it belongs to, where it opens, and that only
 * the app's start (never the Home button) sends it there. Plus the wiring the
 * rules depend on, by source scan. Pure functions, no stack.
 *
 * The browser half is creatures-surfaces-live.spec.ts; the database half
 * (the column, its grants) device-owner-db.spec.ts.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const KID = "00000000-0000-4000-8000-0000000000a1";
const SIB = "00000000-0000-4000-8000-0000000000a2";
const MUM = "00000000-0000-4000-8000-0000000000b1";

test.describe("the Rewards nav item (RFC-017 §8.1)", () => {
  test("appears once a child has a creature switched on, and not before", () => {
    expect(rewardsNavVisible([{ person_id: KID, enabled: true }])).toBe(true);
    expect(rewardsNavVisible([{ person_id: KID, enabled: false }, { person_id: SIB, enabled: true }])).toBe(true);
    // Switched off keeps the creature, and hides the page.
    expect(rewardsNavVisible([{ person_id: KID, enabled: false }])).toBe(false);
    expect(rewardsNavVisible([])).toBe(false);
    // Still loading: hidden, not flashed in and out.
    expect(rewardsNavVisible(undefined)).toBe(false);
  });

  test("is a nav item with its own rule, and hideable per device like any other", () => {
    const constants = codeOnly(read("src/lib/constants.ts"));
    expect(constants).toMatch(/\{ href: "\/rewards", icon: Gift, labelKey: "rewards" \}/);
    const hook = codeOnly(read("src/hooks/use-visible-nav-items.ts"));
    expect(hook).toContain('const REWARDS_HREF = "/rewards"');
    expect(hook).toMatch(/if \(item\.href === REWARDS_HREF\) return rewardsNavVisible\(creatures\);/);
    // The user's own hiding still applies first: the rule sits below it.
    expect(hook.indexOf("hiddenItems.includes(item.href)")).toBeLessThan(hook.indexOf("REWARDS_HREF) return"));
    // Settings -> Navigation may switch it off on any device, kiosk or not.
    expect(canHideNavItem("/rewards", false)).toBe(true);
    expect(canHideNavItem("/rewards", true)).toBe(true);
  });

  test("a reward request waits on the Rewards item's badge, a withdrawal on pocket money's", () => {
    const badges = codeOnly(read("src/hooks/use-nav-badges.ts"));
    expect(badges).toContain('badges["/rewards"] = pendingRedemptions;');
    expect(badges).toContain('badges["/pocket-money"] = pendingWithdrawals;');
  });
});

test.describe("which children the widget and the page show", () => {
  const people = [
    { id: MUM, is_child: false, name: "Mum" },
    { id: SIB, is_child: true, name: "Ben" },
    { id: KID, is_child: true, name: "Mia" },
  ];
  test("children with a creature switched on, in the family's order", () => {
    const creatures = [
      { person_id: KID, enabled: true },
      { person_id: SIB, enabled: true },
    ];
    expect(creatureChildren(people, creatures).map((c) => c.person.name)).toEqual(["Ben", "Mia"]);
  });
  test("leaves out a creature switched off, a grown-up's row, and a child no longer in the list", () => {
    const creatures = [
      { person_id: KID, enabled: false },
      { person_id: MUM, enabled: true },
      { person_id: "00000000-0000-4000-8000-0000000000ff", enabled: true },
      { person_id: SIB, enabled: true },
    ];
    expect(creatureChildren(people, creatures).map((c) => c.person.name)).toEqual(["Ben"]);
    expect(creatureChildren(undefined, creatures)).toEqual([]);
    expect(creatureChildren(people, undefined)).toEqual([]);
  });
});

test.describe("progress to the next stage", () => {
  test("from this stage's threshold to the next, in points", () => {
    const egg = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 0, storedBestTier: 1 });
    expect(stageProgress(egg, 0)).toBe(0);
    const half = Math.floor(egg.next!.at / 2);
    expect(stageProgress(egg, half)).toBe(Math.floor((half * 100) / egg.next!.at));
    const two = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: egg.next!.at, storedBestTier: 1 });
    expect(two.tier).toBe(2);
    expect(stageProgress(two, egg.next!.at)).toBe(0);
  });
  test("in money, a stage held up by best_tier reads 0, and the top reads 100", () => {
    const money = avatarStage({ mode: "money", balanceCents: 0, earnedPoints: 0, storedBestTier: 1 });
    expect(stageProgress(money, 0)).toBe(0);
    const top = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 1_000_000, storedBestTier: 8 });
    expect(top.next).toBeNull();
    expect(stageProgress(top, 1_000_000)).toBe(100);
    const held = avatarStage({ mode: "points", balanceCents: 0, earnedPoints: 0, storedBestTier: 5 });
    expect(stageProgress(held, 0)).toBe(0);
  });
});

test.describe("a child's own device (RFC-017 §8.2)", () => {
  const on = [{ person_id: KID, enabled: true }];
  test("opens on the Rewards page of the child it belongs to, when the child has a creature", () => {
    expect(startRouteFor({ is_kiosk: false, person_id: KID }, on)).toBe(`/rewards?child=${KID}`);
    expect(rewardsHref(KID)).toBe(`/rewards?child=${KID}`);
  });
  test("a kiosk ignores it: the family's screen opens on the dashboard", () => {
    expect(startRouteFor({ is_kiosk: true, person_id: KID }, on)).toBeNull();
    expect(mayStartElsewhere({ is_kiosk: true, person_id: KID })).toBe(false);
  });
  test("nobody's device, a child without a creature, one switched off, or not loaded yet: the dashboard", () => {
    expect(startRouteFor({ is_kiosk: false, person_id: null }, on)).toBeNull();
    expect(startRouteFor({ is_kiosk: false, person_id: SIB }, on)).toBeNull();
    expect(startRouteFor({ is_kiosk: false, person_id: KID }, [{ person_id: KID, enabled: false }])).toBeNull();
    expect(startRouteFor({ is_kiosk: false, person_id: KID }, undefined)).toBeNull();
    expect(startRouteFor(null, on)).toBeNull();
  });
  test("only a device that belongs to someone holds the dashboard's first paint", () => {
    expect(mayStartElsewhere({ is_kiosk: false, person_id: KID })).toBe(true);
    expect(mayStartElsewhere({ is_kiosk: false, person_id: null })).toBe(false);
    expect(mayStartElsewhere(null)).toBe(false);
  });

  test("Belongs to takes a person's id or null, and nothing else", () => {
    expect(parseDeviceOwner({ person_id: KID.toUpperCase() })).toEqual({ ok: true, personId: KID });
    expect(parseDeviceOwner({ person_id: null })).toEqual({ ok: true, personId: null });
    const refused = (body: unknown) => {
      const r = parseDeviceOwner(body);
      return r.ok ? null : r.error;
    };
    expect(refused({})).toBe("person_id required");
    expect(refused({ person_id: "mia" })).toContain("person's id or null");
    expect(refused({ person_id: 7 })).toContain("person's id or null");
    expect(refused({ person_id: KID, is_kiosk: true })).toBe("unknown field: is_kiosk");
    expect(refused(null)).toBe("body must be an object");
    expect(refused([KID])).toBe("body must be an object");
  });
});

test.describe("the app's start, not the Home button", () => {
  const g = globalThis as unknown as { window?: unknown; performance: Performance };
  let realGetEntries: Performance["getEntriesByType"];
  test.beforeEach(() => {
    realGetEntries = g.performance.getEntriesByType.bind(g.performance);
    resetAppStart();
  });
  test.afterEach(() => {
    delete g.window;
    g.performance.getEntriesByType = realGetEntries;
    resetAppStart();
  });
  const openedOn = (path: string) => {
    g.window = { location: { href: `http://kinboard.local${path}` } };
    g.performance.getEntriesByType = ((type: string) =>
      type === "navigation" ? [{ name: `http://kinboard.local${path}` }] : []) as never;
  };

  test("opened on the dashboard: it is the start until the first route change", () => {
    openedOn("/");
    expect(documentStartPath()).toBe("/");
    noteRoute("/");
    expect(isAppStartAtDashboard()).toBe(true);
    // The redirect itself, or any tap elsewhere, ends the start...
    noteRoute("/rewards");
    expect(isAppStartAtDashboard()).toBe(false);
    // ...for good: Home is the dashboard from then on.
    noteRoute("/");
    expect(isAppStartAtDashboard()).toBe(false);
  });
  test("opened anywhere else: Home later is never the start", () => {
    openedOn("/todos");
    expect(isAppStartAtDashboard()).toBe(false);
    noteRoute("/");
    expect(isAppStartAtDashboard()).toBe(false);
  });
  test("the document's own entry decides, not the address now", () => {
    openedOn("/todos");
    (g.window as { location: { href: string } }).location.href = "http://kinboard.local/";
    expect(isAppStartAtDashboard()).toBe(false);
  });
  test("outside a browser there is no start", () => {
    delete g.window;
    expect(documentStartPath()).toBeNull();
    expect(isAppStartAtDashboard()).toBe(false);
  });

  test("the dashboard asks before it paints, and the shell reports every route", () => {
    const page = codeOnly(read("src/app/page.tsx"));
    expect(page).toContain("const start = useStartRedirect();");
    expect(page).toMatch(/if \(start === "wait"\) \{\s*return/);
    const shell = codeOnly(read("src/components/shell-chrome.tsx"));
    expect(shell).toMatch(/useEffect\(\(\) => \{\s*noteRoute\(pathname\);\s*\}, \[pathname\]\);/);
    // Before the shell's early return, or a route without the nav would not count.
    expect(shell.indexOf("noteRoute(pathname)")).toBeLessThan(shell.indexOf("if (isNoNavPath(pathname))"));
    const hook = codeOnly(read("src/hooks/use-device-owner.ts"));
    expect(hook).toContain("useSyncExternalStore(noSubscribe, isAppStartAtDashboard, serverStart)");
    expect(hook).toContain("router.replace(target)");
  });
});

test.describe("Belongs to is a parent's setting", () => {
  test("PATCH /api/devices/[id] checks the session and the settings PIN, and writes only person_id", () => {
    const src = codeOnly(read("src/app/api/devices/[id]/route.ts"));
    expect(src).toContain("requireSession(request)");
    expect(src).toContain("requireSettingsUnlock(auth.session)");
    expect(src).toContain('.update({ person_id: parsed.personId })');
    // Both the device and the person are the session's family's.
    expect(src).toMatch(/\.from\("devices"\)[\s\S]*\.eq\("family_id", familyId\)/);
    expect(src).toMatch(/\.from\("people"\)[\s\S]*\.eq\("family_id", familyId\)[\s\S]*\.is\("deleted_at", null\)/);
  });

  test("every mutating route under api/devices checks the PIN", () => {
    const dir = join(ROOT, "src/app/api/devices");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (e === "route.ts") files.push(f);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/export async function (POST|PATCH|PUT|DELETE)/.test(src)) continue;
      expect(src, f).toContain("requireSettingsUnlock");
    }
  });

  test("the browser never writes person_id itself: the settings page goes through the route", () => {
    const hooks = codeOnly(read("src/hooks/use-device-owner.ts"));
    expect(hooks).toContain("fetch(`/api/devices/${id}`");
    // Every direct write to devices the browser makes, and the settings page's calls.
    const queries = codeOnly(read("src/hooks/use-supabase-queries.ts"));
    const writes = queries.match(/\.from\("devices"\)[\s\S]*?;/g) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const w of writes) expect(w).not.toContain("person_id");
    const page = codeOnly(read("src/app/settings/devices/page.tsx"));
    expect(page).not.toMatch(/updateDevice\.mutateAsync\(\{[^}]*person_id/);
    expect(page).toContain("setOwner.mutateAsync({ id, personId })");
  });

  test("the migration adds the column idempotently, clears it with the person, and keeps the browser off it", () => {
    const sql = read("docker/migration_zzzzzzzzz_device_owner.sql");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES public\.people\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE ON TABLE public\.devices FROM anon, authenticated;/);
    expect(sql).not.toMatch(/'GRANT\s/i);
    expect(sql).not.toMatch(/GRANT[^;]*person_id[^;]*TO anon/);
    // Revoke, then grant: a table-level revoke takes the column grants with it.
    const grant = sql.indexOf("GRANT\n    INSERT");
    expect(grant).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(sql.indexOf("REVOKE INSERT, UPDATE ON TABLE"));
    // Sorts after every other migration, so nothing grants it back afterwards.
    const all = readdirSync(join(ROOT, "docker")).filter((f) => /^migration.*\.sql$/.test(f)).sort();
    expect(all[all.length - 1]).toBe("migration_zzzzzzzzz_device_owner.sql");
  });
});

test.describe("the Creatures widget", () => {
  test("is a widget of its own, off until a family switches it on", () => {
    expect(DEFAULT_WIDGET_VISIBILITY.creatures).toBe(false);
    expect(DEFAULT_WIDGET_ORDER).toContain("creatures");
    expect(DEFAULT_WIDGET_ORDER.indexOf("creatures")).toBe(DEFAULT_WIDGET_ORDER.indexOf("pocketMoney") + 1);
    const settings = codeOnly(read("src/app/settings/widgets/page.tsx"));
    expect(settings).toMatch(/\{ key: "creatures", labelKey: "creaturesLabel", descriptionKey: "creaturesDescription"/);
    const dashboard = codeOnly(read("src/app/page.tsx"));
    expect(dashboard).toContain("creatures: <CreaturesWidget />");
  });

  test("stays still on the wall: every creature it draws is static outside a reaction", () => {
    const widget = codeOnly(read("src/components/widgets/creatures-widget.tsx"));
    const drawn = widget.match(/<ReactingCreature[\s\S]*?\/>/g) ?? [];
    expect(drawn.length).toBe(1);
    expect(drawn[0]).toContain("animated={false}");
    expect(drawn[0]).toContain("compactStageUp");
    expect(drawn[0]).toContain("mood={mood}");
    expect(widget).toContain("href={rewardsHref(person.id)}");
  });

  test("so do the tasks page's creatures; the Rewards page's own is large and tappable", () => {
    const todos = codeOnly(read("src/app/todos/page.tsx"));
    const chip = todos.match(/<ReactingCreature[\s\S]*?\/>/g) ?? [];
    expect(chip.length).toBe(1);
    expect(chip[0]).toContain("animated={false}");
    const rewards = codeOnly(read("src/app/rewards/page.tsx"));
    expect(rewards).toMatch(/<ReactingCreature[\s\S]*?size=\{220\}[\s\S]*?tappable/);
  });
});

test.describe("the Rewards page", () => {
  test("needs no pocket-money account and no plugin", () => {
    const page = codeOnly(read("src/app/rewards/page.tsx"));
    expect(page).not.toMatch(/useIsPluginEnabled|accounts\.length === 0/);
    expect(page).toContain("<RewardsPanel");
    // The shop of step 3 has its place marked, under the rewards.
    expect(read("src/app/rewards/page.tsx")).toMatch(/RFC-017 step 3: the shop goes here/);
  });
  test("the profile's way to the rewards goes to it", () => {
    const profile = codeOnly(read("src/components/widgets/family-members.tsx"));
    expect(profile).toContain("rewardsHref: rewardsHref(selectedPerson.id)");
    expect(profile).not.toContain("/pocket-money?child=");
  });
});

test.describe("translations", () => {
  const msgs = ["en", "de", "fr"].map((l) => JSON.parse(read(`messages/${l}.json`)) as Record<string, any>);
  const keys = (o: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]);
  test("every new string in all three languages", () => {
    for (const ns of ["creaturesWidget", "rewardsPage"]) {
      const [en, de, fr] = msgs.map((m) => keys(m[ns] ?? {}).sort());
      expect(en.length, ns).toBeGreaterThan(3);
      expect(de, ns).toEqual(en);
      expect(fr, ns).toEqual(en);
    }
    expect(msgs.map((m) => m.nav.rewards)).toEqual(["Rewards", "Belohnungen", "Récompenses"]);
    expect(msgs.map((m) => m.creaturesWidget.title)).toEqual(["Creatures", "Kreaturen", "Créatures"]);
    for (const k of ["belongsToLabel", "belongsToAria", "belongsToNobody", "belongsToHint", "belongsToKioskNote", "belongsToFailed"]) {
      for (const m of msgs) expect(m.settings.devices[k], k).toBeTruthy();
    }
    for (const k of ["creaturesLabel", "creaturesDescription", "creaturesPreview1", "creaturesPreview2"]) {
      for (const m of msgs) expect(m.settings.widgets[k], k).toBeTruthy();
    }
  });
});
