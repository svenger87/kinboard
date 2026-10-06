import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { establishSession, postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";

/**
 * RFC-017 step 1 against a running stack: a backup carries the creatures and
 * the per-child requests, an older backup has its creatures derived the way
 * the migration derives them, and Settings -> Creatures & rewards renders and
 * switches a creature on.
 *
 * Works in families of its own (`claude-creatures-live-*`), deleted again,
 * including what an interrupted run left behind.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-creatures-live-";

function purgeFamily(id: string) {
  psql(`SELECT public.delete_family(${sqlText(id)})`);
}
function purgeAll() {
  for (const id of psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`).split(",").filter(Boolean)) purgeFamily(id);
  psql(`DELETE FROM devices WHERE hardware_id LIKE '%${P}%'`);
}

test.describe("live: creatures in a backup", () => {
  test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
  test.describe.configure({ mode: "serial" });

  let api: APIRequestContext;
  let famId = "";
  let kid = "";
  let backup: { data: Record<string, Array<Record<string, unknown>>> } & Record<string, unknown>;

  test.beforeAll(async () => {
    purgeAll();
    const code = `CL${randomBytes(4).toString("hex").toUpperCase()}`;
    famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
    kid = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', '${P}kid', true) RETURNING id`);
    // A creature switched off, restyled and named; a request with no account.
    psql(`INSERT INTO creatures (person_id, family_id, species, style, look, best_tier, last_seen_tier, grows_with, shop_enabled, enabled)
      VALUES ('${kid}', '${famId}', 'fox', 'storybook', '{"name":"Fuchsi"}', 3, 3, 'points', false, false)`);
    psql(`INSERT INTO point_redemptions (family_id, person_id, title, cost_points, status) VALUES ('${famId}', '${kid}', '${P}film', 5, 'approved')`);
    api = await pwRequest.newContext({ baseURL: BASE });
    const join = await postJoin(api, { joinCode: code, hardwareId: `${P}api`, deviceName: `${P}api` });
    expect(join.ok(), await join.text()).toBe(true);
  });

  test.afterAll(async () => {
    purgeAll();
    await api?.dispose();
    expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  });

  test("the export carries the creature and the child's request", async () => {
    const res = await api.get(`/api/export?family_id=${famId}`);
    expect(res.status(), await res.text()).toBe(200);
    backup = await res.json();
    expect(backup.data.creatures).toHaveLength(1);
    expect(backup.data.creatures[0]).toMatchObject({ person_id: kid, species: "fox", enabled: false, shop_enabled: false });
    expect(backup.data.point_redemptions[0]).toMatchObject({ person_id: kid, account_id: null });
  });

  test("an import brings the creature back as it was, on the restored child", async () => {
    const res = await api.post("/api/import", { data: { ...backup, family: { id: famId, name: `${P}restored` } } });
    expect(res.status(), await res.text()).toBe(200);
    const restored = (await res.json()).family_id as string;
    const child = psql(`SELECT id FROM people WHERE family_id = '${restored}'`);
    expect(child).not.toBe(kid);
    expect(psql(`SELECT concat_ws('|', species, style, look->>'name', best_tier, grows_with, shop_enabled::text, enabled::text)
      FROM creatures WHERE person_id = '${child}' AND family_id = '${restored}'`)).toBe("fox|storybook|Fuchsi|3|points|false|false");
    expect(psql(`SELECT person_id FROM point_redemptions WHERE family_id = '${restored}'`)).toBe(child);
  });

  test("a backup from before the move: creatures derived from its accounts, requests moved to the child", async () => {
    const accountId = "c1a0de00-0017-4000-8000-0000000000a1";
    const old = JSON.parse(JSON.stringify(backup));
    delete old.data.creatures;
    old.data.pocket_money_accounts = [{
      id: accountId, family_id: famId, person_id: kid, currency: "EUR", balance_cents: 0,
      avatar_species: "unicorn", avatar_style: "sticker", avatar_look: { name: "Funkel" },
      best_tier: 4, last_seen_tier: 4, reward_mode: "points",
    }];
    old.data.point_redemptions = old.data.point_redemptions.map((r: Record<string, unknown>) => {
      const { person_id: _drop, ...rest } = r;
      void _drop;
      return { ...rest, account_id: accountId };
    });
    old.family = { id: famId, name: `${P}old` };
    const res = await api.post("/api/import", { data: old });
    expect(res.status(), await res.text()).toBe(200);
    const restored = (await res.json()).family_id as string;
    const child = psql(`SELECT id FROM people WHERE family_id = '${restored}'`);
    expect(psql(`SELECT concat_ws('|', species, style, look->>'name', best_tier, grows_with, shop_enabled::text, enabled::text)
      FROM creatures WHERE person_id = '${child}'`)).toBe("unicorn|sticker|Funkel|4|points|true|true");
    expect(psql(`SELECT person_id || '|' || (account_id IS NOT NULL)::text FROM point_redemptions WHERE family_id = '${restored}'`))
      .toBe(`${child}|true`);
  });
});

test.describe("live: Settings -> Creatures & rewards", () => {
  test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
  test.describe.configure({ mode: "serial" });
  // The PWA service worker answers fetches before page.route sees them.
  test.use({ serviceWorkers: "block" });

  let famId = "";
  let code = "";
  let withAccount = "";
  let withoutAccount = "";

  test.beforeAll(() => {
    purgeAll();
    code = `CS${randomBytes(4).toString("hex").toUpperCase()}`;
    famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}settings', '${code}', true) RETURNING id`);
    withAccount = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', 'Mia', true) RETURNING id`);
    withoutAccount = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', 'Ben', true) RETURNING id`);
    psql(`INSERT INTO pocket_money_accounts (family_id, person_id) VALUES ('${famId}', '${withAccount}')`);
  });

  test.afterAll(() => {
    purgeAll();
    expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
  });

  test("renders a card per child, switches a creature on, and offers money only where it can work", async ({ page }) => {
    test.setTimeout(180_000);
    await establishSession(page, code, `${P}ui`);
    await page.goto("/settings/creatures", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /^(Creatures & rewards|Kreaturen & Belohnungen|Créatures et récompenses)$/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("reward-catalogue")).toBeVisible();

    for (const [personId, name] of [[withAccount, "Mia"], [withoutAccount, "Ben"]] as const) {
      const card = page.getByTestId(`creature-card-${personId}`);
      await expect(card).toContainText(name);
      await expect(card.getByTestId("creature-switch")).toHaveAttribute("aria-checked", "false");
      await card.getByTestId("creature-switch").click();
      await card.locator('button[data-species="owl"]').click();
      await card.getByTestId("creature-create").click();
      await expect(card.getByTestId("grows-with")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => psql(`SELECT species || '|' || grows_with || '|' || enabled::text FROM creatures WHERE person_id = '${personId}'`))
        .toBe("owl|points|true");
    }

    // Mia has an account and the plugin is on: saved money is a choice.
    const mia = page.getByTestId(`creature-card-${withAccount}`);
    await mia.getByTestId("grows-with").click();
    await page.getByRole("option", { name: /Saved money|gespartem Geld|L'argent économisé/ }).click();
    await expect.poll(() => psql(`SELECT grows_with FROM creatures WHERE person_id = '${withAccount}'`)).toBe("money");

    // Ben has none: points only, and the hint says why.
    const ben = page.getByTestId(`creature-card-${withoutAccount}`);
    await expect(ben).toContainText(/once pocket money is on and this child has an account|sobald Taschengeld|dès que l'argent de poche|quand l'argent de poche/);
    await ben.getByTestId("grows-with").click();
    await expect(page.getByRole("option", { name: /Saved money|gespartem Geld|L'argent économisé/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Off keeps it.
    await ben.getByTestId("creature-switch").click();
    await expect.poll(() => psql(`SELECT species || '|' || enabled::text FROM creatures WHERE person_id = '${withoutAccount}'`)).toBe("owl|false");
    await expect(ben.getByTestId("grows-with")).toHaveCount(0);

    // Pocket money points here.
    await page.goto("/settings/pocket-money", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("creatures-link")).toHaveAttribute("href", "/settings/creatures", { timeout: 60_000 });
    await expect(page.getByTestId("reward-catalogue")).toHaveCount(0);
  });
});
