import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";
import {
  REWARD_DECIDED, REWARD_INBOX_URL, REWARD_PREFERENCE_COLUMN, REWARD_REQUESTED, audienceFor, batchKey, filterAudience,
  liveRewardNotifier, rewardDecidedRow, rewardPushPayload, rewardRequestedRow, type DeviceOwnerRow,
} from "../src/lib/notifications/rewards";
import { clockTime, eligibleFromRead, eligibleSubscriptions, getPreferenceColumn, inQuietHours } from "../src/lib/notifications/delivery";
import type { RedemptionRow } from "../src/lib/pocket-money/rewards";

/**
 * Reward pushes (RFC-017): a request reaches the parents' phones, an answer
 * the child's own device, both through scheduled_notifications so each
 * device's quiet hours and its Rewards switch apply -- and none of them
 * carries anything of the creature.
 */

const FAMILY = "11111111-1111-4111-8111-111111111111";
const MIA = "eeeeeeee-eeee-4eee-8eee-000000000001";
const ENNO = "eeeeeeee-eeee-4eee-8eee-000000000002";
const MUM = "eeeeeeee-eeee-4eee-8eee-000000000003";
const T0 = new Date("2026-10-06T09:00:00.000Z");
const CREATURE_NAME = "Funkel";

const redemption = (over: Partial<RedemptionRow> = {}): RedemptionRow => ({
  id: "cccccccc-cccc-4ccc-8ccc-000000000001", family_id: FAMILY, person_id: MIA, reward_id: "r1",
  title: "An hour of Minecraft", icon: "🎮", cost_points: 50, created_at: T0.toISOString(), ...over,
});

const pushT = (messages: typeof en) => createTranslator({ locale: "en", messages, namespace: "push" }) as unknown as (k: string, v?: Record<string, string | number>) => string;

// ── what is queued ──────────────────────────────────────────────────────────

test.describe("queueing: one scheduled_notifications row per request and per decision", () => {
  test("a request: due now, for the parents, with the child's name and the reward -- and the asking device left out", () => {
    expect(rewardRequestedRow(redemption(), "Mia", "dev-kid", T0)).toEqual({
      family_id: FAMILY,
      notification_type: REWARD_REQUESTED,
      scheduled_for: T0.toISOString(),
      title: "Reward request",
      body: null,
      data: {
        redemption_id: "cccccccc-cccc-4ccc-8ccc-000000000001", person_id: MIA, child_name: "Mia",
        reward_title: "An hour of Minecraft", reward_icon: "🎮", cost_points: "50", source_device_id: "dev-kid",
      },
      related_entity_type: "point_redemption",
      related_entity_id: "cccccccc-cccc-4ccc-8ccc-000000000001",
    });
    expect(rewardRequestedRow(redemption({ icon: null }), "Mia", null, T0).data).not.toHaveProperty("source_device_id");
  });

  test("a decision: addressed to the child, approved or denied", () => {
    const row = rewardDecidedRow(redemption(), "denied", T0);
    expect(row.notification_type).toBe(REWARD_DECIDED);
    expect(row.data).toEqual({
      redemption_id: "cccccccc-cccc-4ccc-8ccc-000000000001", target_person_id: MIA, status: "denied",
      reward_title: "An hour of Minecraft", reward_icon: "🎮", cost_points: "50",
    });
  });

  function fake(people: Record<string, unknown>[] = [{ id: MIA, family_id: FAMILY, name: "Mia" }], fail?: string) {
    const inserts: { table: string; row: Record<string, unknown> }[] = [];
    const selects: { table: string; columns: string }[] = [];
    const tables: Record<string, Record<string, unknown>[]> = {
      people,
      point_redemptions: [{ ...redemption(), status: "approved" }],
    };
    const db = {
      from(table: string) {
        const filters: [string, unknown][] = [];
        const chain: any = {
          select(columns: string) { selects.push({ table, columns }); return chain; },
          eq(c: string, v: unknown) { filters.push([c, v]); return chain; },
          async maybeSingle() {
            return { data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null };
          },
          async insert(row: Record<string, unknown>) {
            if (fail === table) return { error: { message: "down" } };
            inserts.push({ table, row });
            return { error: null };
          },
        };
        return chain;
      },
    };
    return { db, inserts, selects };
  }

  test("the live notifier writes exactly those rows, reading only the child's name and the request", async () => {
    const f = fake();
    const notifier = liveRewardNotifier(f.db, () => T0);
    await notifier.requested(redemption(), "dev-kid");
    await notifier.decided(FAMILY, redemption().id, "approved");
    expect(f.inserts).toEqual([
      { table: "scheduled_notifications", row: rewardRequestedRow(redemption(), "Mia", "dev-kid", T0) },
      { table: "scheduled_notifications", row: rewardDecidedRow(redemption(), "approved", T0) },
    ]);
    expect(f.selects).toEqual([
      { table: "people", columns: "name" },
      { table: "point_redemptions", columns: "id, family_id, person_id, title, icon, cost_points" },
    ]);
  });

  test("a decision on another family's request queues nothing, and a failed insert never throws", async () => {
    const f = fake();
    await liveRewardNotifier(f.db, () => T0).decided("99999999-9999-4999-8999-999999999999", redemption().id, "approved");
    expect(f.inserts).toEqual([]);
    const broken = fake(undefined, "scheduled_notifications");
    await expect(liveRewardNotifier(broken.db, () => T0).requested(redemption(), null)).resolves.toBeUndefined();
  });
});

// ── who gets it ─────────────────────────────────────────────────────────────

test.describe("who gets it: the parents for a request, the child's own device for an answer", () => {
  const devices: DeviceOwnerRow[] = [
    { id: "dev-mum", person_id: MUM, is_kiosk: false },
    { id: "dev-wall", person_id: null, is_kiosk: true },
    { id: "dev-mia", person_id: MIA, is_kiosk: false },
    { id: "dev-enno", person_id: ENNO, is_kiosk: false },
    { id: "dev-mia-kiosk", person_id: MIA, is_kiosk: true },
    { id: "dev-nobody", person_id: null, is_kiosk: false },
  ];
  const subs = devices.map((d) => ({ device_id: d.id }));
  const children = new Set([MIA, ENNO]);
  const ids = (s: { device_id: string }[]) => s.map((x) => x.device_id);

  test("a request goes to every device but the children's own and the kiosks", () => {
    expect(ids(filterAudience(subs, audienceFor(REWARD_REQUESTED, {}), devices, children)))
      .toEqual(["dev-mum", "dev-nobody"]);
    // A kiosk that belongs to a grown-up is still the family's wall screen.
    const grownUpsKiosk: DeviceOwnerRow[] = [{ id: "k", person_id: MUM, is_kiosk: true }];
    expect(filterAudience([{ device_id: "k" }], { kind: "parents" }, grownUpsKiosk, children)).toEqual([]);
  });

  test("an answer goes only to the child's own non-kiosk device -- and to nobody without one", () => {
    expect(ids(filterAudience(subs, audienceFor(REWARD_DECIDED, { target_person_id: MIA }), devices, children))).toEqual(["dev-mia"]);
    expect(ids(filterAudience(subs, audienceFor(REWARD_DECIDED, { target_person_id: "nobody" }), devices, children))).toEqual([]);
    expect(ids(filterAudience(subs, audienceFor(REWARD_DECIDED, {}), devices, children))).toEqual([]);
  });

  test("every other push still goes to everyone", () => {
    for (const type of ["shopping_collaborative", "todo_assigned", "calendar_reminder", "camera_live", "timer"]) {
      expect(ids(filterAudience(subs, audienceFor(type, {}), devices, children)), type).toEqual(ids(subs));
    }
  });

  test("answers for two children are two batches; requests stay one", () => {
    const n = (type: string, data: Record<string, string>) => ({ family_id: FAMILY, notification_type: type, data });
    expect(batchKey(n(REWARD_DECIDED, { target_person_id: MIA }))).not.toBe(batchKey(n(REWARD_DECIDED, { target_person_id: ENNO })));
    expect(batchKey(n(REWARD_REQUESTED, { person_id: MIA }))).toBe(batchKey(n(REWARD_REQUESTED, { person_id: ENNO })));
    expect(batchKey(n("shopping_collaborative", {}))).toBe(`${FAMILY}::shopping_collaborative`);
  });
});

// ── quiet hours and the switch ──────────────────────────────────────────────

test.describe("quiet hours and the Rewards switch apply, per device", () => {
  const subs = [{ device_id: "a" }, { device_id: "b" }, { device_id: "c" }, { device_id: "d" }];
  const prefs = [
    { device_id: "a", quiet_hours_enabled: true, quiet_hours_start: "22:00", quiet_hours_end: "07:00", reward_requests: true },
    { device_id: "b", quiet_hours_enabled: false, reward_requests: false },
    { device_id: "c", quiet_hours_enabled: false, reward_requests: true },
    // d has no row: everything, as for every other type.
  ];

  test("both reward types are switched by reward_requests", () => {
    expect(getPreferenceColumn(REWARD_REQUESTED)).toBe(REWARD_PREFERENCE_COLUMN);
    expect(getPreferenceColumn(REWARD_DECIDED)).toBe(REWARD_PREFERENCE_COLUMN);
    expect(REWARD_PREFERENCE_COLUMN).toBe("reward_requests");
  });

  test("at 23:30 the device in its quiet hours and the one switched off get nothing", () => {
    for (const type of [REWARD_REQUESTED, REWARD_DECIDED]) {
      expect(eligibleSubscriptions(subs, prefs, type, "23:30").map((s) => s.device_id), type).toEqual(["c", "d"]);
    }
  });

  test("at noon only the switch counts", () => {
    expect(eligibleSubscriptions(subs, prefs, REWARD_REQUESTED, "12:00").map((s) => s.device_id)).toEqual(["a", "c", "d"]);
  });

  test("unreadable preferences mean nobody, not everybody -- and it is logged", () => {
    const logged: unknown[] = [];
    const log = (m: string, e: unknown) => { logged.push([m, e]); };
    for (const type of [REWARD_REQUESTED, REWARD_DECIDED, "shopping_collaborative", "calendar_reminder"]) {
      expect(eligibleFromRead(subs, { data: null, error: { message: "down" } }, type, "12:00", log), type).toEqual([]);
    }
    expect(logged).toHaveLength(4);
    // Read fine: the same answer as the rule itself, quiet hours included.
    expect(eligibleFromRead(subs, { data: prefs, error: null }, REWARD_REQUESTED, "23:30", log).map((s) => s.device_id)).toEqual(["c", "d"]);
    expect(eligibleFromRead(subs, { data: null, error: null }, REWARD_REQUESTED, "23:30", log)).toEqual(subs);
    expect(logged).toHaveLength(4);
  });

  test("the rule itself, unchanged: both ends quiet, windows across midnight and within a day", () => {
    const night = { device_id: "x", quiet_hours_enabled: true, quiet_hours_start: "22:00", quiet_hours_end: "07:00" };
    for (const [time, quiet] of [["21:59", false], ["22:00", true], ["03:00", true], ["07:00", true], ["07:01", false]] as const) {
      expect(inQuietHours(night, time), time).toBe(quiet);
    }
    const lunch = { device_id: "x", quiet_hours_enabled: true, quiet_hours_start: "12:00", quiet_hours_end: "14:00" };
    expect(inQuietHours(lunch, "13:00")).toBe(true);
    expect(inQuietHours(lunch, "15:00")).toBe(false);
    expect(inQuietHours({ ...night, quiet_hours_enabled: false }, "03:00")).toBe(false);
    expect(clockTime(new Date(2026, 9, 6, 7, 5))).toBe("07:05");
  });

  test("the processor batches, addresses and filters through these, and the switch is a real column", () => {
    const route = readFileSync(join(__dirname, "..", "src", "app", "api", "cron", "process-notifications", "route.ts"), "utf8");
    expect(route).toContain("const key = batchKey(notif);");
    expect(route).toContain("audienceFor(notificationType, notifications[0].data)");
    expect(route).toMatch(/subscriptions = filterAudience\(/);
    expect(route).toMatch(/const eligible = eligibleFromRead\(subscriptions, prefsRead, notificationType,/);
    expect(route).not.toMatch(/const \{ data: prefsData \}/);
    expect(route).toContain("case REWARD_REQUESTED:");
    expect(route).toContain("case REWARD_DECIDED:");
    // Owners unreadable: nobody, never everybody.
    expect(route).toMatch(/if \(devicesError \|\| childrenError\) \{[\s\S]*?subscriptions = \[\];/);
    const migration = readFileSync(join(__dirname, "..", "docker", "migration_zzzzzzzz_reward_notifications.sql"), "utf8");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS reward_requests BOOLEAN DEFAULT true/);
    const page = readFileSync(join(__dirname, "..", "src", "app", "settings", "notifications", "page.tsx"), "utf8");
    expect(page).toContain('handlePreferenceChange("reward_requests", checked)');
  });
});

// ── what it says ────────────────────────────────────────────────────────────

test.describe("what it says, and where a tap leads", () => {
  const queued = (data: Record<string, string>, id = "q1") => ({ id, related_entity_id: `rel-${id}`, data });
  const requestData = rewardRequestedRow(redemption(), "Mia", null, T0).data;

  test("a request: \"Mia would like 🎮 An hour of Minecraft (50 ⭐)\", opening the inbox", () => {
    const p = rewardPushPayload(REWARD_REQUESTED, [queued(requestData)], pushT(en));
    expect(p).toEqual({
      title: "Mia would like 🎮 An hour of Minecraft (50 ⭐)",
      body: en.push.rewardRequestedBody,
      tag: "reward-request-rel-q1",
      url: REWARD_INBOX_URL,
    });
    expect(REWARD_INBOX_URL).toBe("/settings/creatures#inbox");
    expect(pushT(de as typeof en)("rewardRequestedTitle", { name: "Mia", reward: "🎮 Minecraft", cost: 50 })).toBe("Mia möchte 🎮 Minecraft (50 ⭐)");
    expect(pushT(fr as typeof en)("rewardRequestedTitle", { name: "Mia", reward: "🎮 Minecraft", cost: 50 })).toBe("Mia aimerait 🎮 Minecraft (50 ⭐)");
  });

  test("the inbox link lands: the anchor the settings pages scroll to is there, waiting requests or not", () => {
    const hash = REWARD_INBOX_URL.split("#")[1];
    expect(hash).toBe("inbox");
    const src = readFileSync(join(__dirname, "..", "src", "components", "pocket-money", "rewards-settings.tsx"), "utf8");
    const inbox = src.slice(src.indexOf("export function RedemptionInbox"), src.indexOf("export function", src.indexOf("export function RedemptionInbox") + 10));
    // use-settings-anchor looks for [data-setting="<hash>"]; both the empty state and the list carry it.
    expect(inbox.match(/data-setting="inbox"/g)).toHaveLength(2);
    expect(inbox).not.toMatch(/return null/);
    const hook = readFileSync(join(__dirname, "..", "src", "hooks", "use-settings-anchor.ts"), "utf8");
    expect(hook).toContain("[data-setting=");
    const registry = readFileSync(join(__dirname, "..", "src", "lib", "settings-search", "registry.ts"), "utf8");
    expect(registry).toMatch(/sectionsOf\(creatures, \[\s*\{ anchor: "inbox"/);
    for (const dict of [en, de, fr]) expect(dict.settings.pocketMoney.redemptionInboxEmpty.length).toBeGreaterThan(5);
  });

  test("several requests at once: one push that lists them", () => {
    const p = rewardPushPayload(REWARD_REQUESTED, [queued(requestData, "a"), queued({ ...requestData, child_name: "Enno", reward_icon: "" }, "b")], pushT(en));
    expect(p.title).toBe("2 reward requests are waiting");
    expect(p.body).toBe("Mia: 🎮 An hour of Minecraft, Enno: An hour of Minecraft");
    expect(p.url).toBe(REWARD_INBOX_URL);
  });

  test("an answer: yes or not this time, opening the child's Rewards page", () => {
    const yes = rewardPushPayload(REWARD_DECIDED, [queued(rewardDecidedRow(redemption(), "approved", T0).data)], pushT(en));
    expect(yes).toEqual({ title: "Yes! 🎮 An hour of Minecraft", body: en.push.rewardApprovedBody, tag: "reward-rel-q1", url: `/rewards?child=${MIA}` });
    const no = rewardPushPayload(REWARD_DECIDED, [queued(rewardDecidedRow(redemption(), "denied", T0).data)], pushT(en));
    expect(no.title).toBe("Not this time: 🎮 An hour of Minecraft");
    expect(no.body).toBe("Your 50 ⭐ are still yours.");
  });

  test("no push carries anything of the creature", () => {
    const rows = [
      rewardRequestedRow(redemption(), "Mia", "dev", T0),
      rewardDecidedRow(redemption(), "approved", T0),
    ];
    const payloads = [
      rewardPushPayload(REWARD_REQUESTED, [queued(rows[0].data)], pushT(en)),
      rewardPushPayload(REWARD_DECIDED, [queued(rows[1].data)], pushT(en)),
    ];
    for (const thing of [...rows, ...payloads]) {
      const json = JSON.stringify(thing);
      expect(json).not.toContain(CREATURE_NAME);
      // The settings page and the URL say "creatures"; no key or value of a creature row does.
      expect(json).not.toMatch(/"look"|"species"|avatar_|best_tier|"style"/);
    }
    expect(Object.keys(rows[0].data).sort()).toEqual(["child_name", "cost_points", "person_id", "redemption_id", "reward_icon", "reward_title", "source_device_id"]);
    expect(Object.keys(rows[1].data).sort()).toEqual(["cost_points", "redemption_id", "reward_icon", "reward_title", "status", "target_person_id"]);
  });

  test("every language has every reward push text", () => {
    for (const key of ["rewardRequestedTitle", "rewardRequestedBody", "rewardRequestedMany", "rewardApprovedTitle", "rewardApprovedBody", "rewardDeniedTitle", "rewardDeniedBody", "rewardDecidedMany"] as const) {
      for (const dict of [en, de, fr]) expect(dict.push[key], key).toBeTruthy();
    }
    for (const dict of [en, de, fr]) {
      expect(dict.push.rewardRequestedTitle).toContain("{name}");
      expect(dict.push.rewardRequestedTitle).toContain("{reward}");
      expect(dict.push.rewardRequestedTitle).toContain("{cost}");
      expect(dict.settings.notifications.rewardsLabel.length).toBeGreaterThan(3);
    }
  });
});
