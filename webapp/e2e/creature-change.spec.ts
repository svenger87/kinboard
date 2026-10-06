import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { IntlMessageFormat } from "intl-messageformat";
import { NextIntlClientProvider } from "next-intl";
import { SpeciesPicker, SPECIES_IDS } from "../src/components/pocket-money/species-picker";
import { readLook, validateLook } from "../src/lib/pocket-money/creatures";
import avatarCatalog from "../src/plugins/pocket-money/catalog/avatars.json";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";
import { establishSession, postJoin } from "./session";
import { psql, psqlRow, sqlText } from "./helpers/assistant-connect";

/**
 * A parent changes a child's creature: Settings -> Creatures & rewards (Pocket
 * money until RFC-017) -> the child's card -> Change. The species is a
 * parent's choice, so it takes the settings PIN, on the server as well as in
 * the browser; the stage (money or points, best_tier), the style and the look
 * stay exactly as they were. The child's own page has no such switch
 * (RFC-016 §4.1).
 */

const SRC = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const ROUTE = "app/api/creatures/[personId]/route.ts";
const RULES = "lib/creatures/rules.ts";
const SETTINGS = "app/settings/creatures/page.tsx";
const KID_PAGE = "app/pocket-money/page.tsx";

const LOCALES = { en, de, fr } as const;
type Messages = typeof en;
const pmSettings = (m: Messages) => m.settings.pocketMoney as Record<string, string>;

// ── the route ────────────────────────────────────────────────────────────

test("the species is behind the PIN, and only the catalog's species are taken", () => {
  const rules = read(RULES);
  const parental = /PARENTAL_FIELDS = \[([^\]]*)\]/.exec(rules)?.[1] ?? "";
  expect(parental).toContain(`"species"`);
  expect(read(ROUTE)).toMatch(/if \(parsed\.parental\) \{\s*const locked = await requireSettingsUnlock/);
  // The allow-list is the catalog itself, so the new creatures are in it.
  expect(rules).toMatch(/new Set\(avatarCatalog\.species\.map/);
  for (const id of ["rex", "trike", "stego", "princess", "prince", "unicorn", "fox", "penguin", "bunny", "axolotl", "owl", "robot"]) {
    expect(avatarCatalog.species.map((s) => s.id), id).toContain(id);
  }
});

test("changing the species writes the species and nothing else", () => {
  // The block that takes species must not touch the stage, the style or the
  // look: progress and looks are kept by not writing them at all.
  const rules = read(RULES);
  const block = rules.slice(rules.indexOf("input.species !== undefined"), rules.indexOf("input.grows_with !== undefined"));
  expect(block).toContain("patch.species = input.species");
  expect(block).not.toMatch(/patch\.(best_tier|last_seen_tier|style|look)\b/);
});

test("a body that is not JSON, or not an object, is a 400 checked after the session", () => {
  const patch = read(ROUTE);
  const session = patch.indexOf("requireSession(request)");
  const parse = patch.indexOf("await request.json()");
  expect(session).toBeGreaterThan(-1);
  expect(parse).toBeGreaterThan(session);
  expect(patch.slice(parse - 40, parse)).toContain("try {");
  expect(read(RULES)).toMatch(/body === null \|\| Array\.isArray\(body\)[\s\S]{0,120}body must be an object/);
});

// ── the look across species ─────────────────────────────────────────────

test("a princess's skin, hair and hairstyle stay valid on a T-Rex, so switching back restores them", () => {
  // validateLook does not know the species: a person-only key on a creature
  // is stored and simply not drawn. If it refused them, a parent switching a
  // princess to a T-Rex and back would lose the child's choices.
  const look = { name: "Funkel", body: "#FF8FC0", belly: "#FFF1A8", skin: "#D9A27A", hair: "#C97C3C", hairstyle: "ponytail", pattern: "hearts", eyes: "sparkly", acc: "bow" };
  const r = validateLook(look);
  expect(r.ok).toBe(true);
  expect(r.ok && r.look).toEqual(look);
  expect(readLook(look)).toEqual(look);
});

// ── the settings control ────────────────────────────────────────────────

test("Settings -> Creatures & rewards has Change per child, saving only the species", () => {
  const source = read(SETTINGS);
  expect(source).toContain(`data-testid="change-creature"`);
  expect(source).toContain("<ChangeCreatureSheet");
  // Only the species goes to the server: nothing that would reset the stage,
  // the style or the look.
  expect(source).toMatch(/onSave=\{\(species\) => change\(\{ species \}\)\}/);
  // A lapsed unlock says so.
  expect(source).toMatch(/code === "pin_required"\) return t\("errorPinRequired"\)/);
  expect(read("components/pocket-money/change-creature-sheet.tsx")).toContain("<SpeciesPicker");
  // Pocket money keeps the euros only (RFC-017).
  const pm = read("app/settings/pocket-money/page.tsx");
  expect(pm).not.toContain("ChangeCreatureSheet");
  expect(pm).not.toContain("SpeciesPicker");
  expect(pm).toContain(`href="/settings/creatures"`);
});

test("the child's own page has no species switch", () => {
  const source = read(KID_PAGE);
  expect(source).not.toMatch(/avatar_species\s*:|change:\s*\{[^}]*\bspecies\b/);
  expect(source).not.toContain("SpeciesPicker");
  expect(source).not.toContain("ChangeCreatureSheet");
});

test("the picker shows every creature in the child's style and colours, the current one marked", () => {
  const look = { body: "#56B6E8", name: "Funkel" };
  const intlProps: Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> = { locale: "en", messages: en, timeZone: "UTC" };
  const html = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      // Checked without children, which come as the third argument.
      intlProps as ComponentProps<typeof NextIntlClientProvider>,
      createElement(SpeciesPicker, { picked: "rex", onPick: () => {}, avatarStyle: "sticker", look, current: "dragon" }),
    ),
  );
  for (const id of SPECIES_IDS) expect(html, id).toContain(`data-species="${id}"`);
  expect(SPECIES_IDS.length).toBe(avatarCatalog.species.length);
  // The current creature carries "Now", once.
  expect(html.match(/>Now</g)?.length).toBe(1);
  const dragonCard = html.slice(html.indexOf('data-species="dragon"'), html.indexOf('data-species="cat"'));
  expect(dragonCard).toContain(">Now<");
  // The picked one is pressed, and its stages are named below.
  expect(html).toMatch(/aria-pressed="true" data-species="rex"|data-species="rex"[^>]*aria-pressed="true"/);
  expect(html).toContain("T-Rex evolution stages");
  // Drawn in the child's colours: their body colour is in the drawings.
  expect(html.toUpperCase()).toContain("#56B6E8");
});

// ── the copy ────────────────────────────────────────────────────────────

test("the hint no longer calls the creature a one-time choice, in any language", () => {
  for (const [loc, m] of Object.entries(LOCALES)) {
    const hint = pmSettings(m as Messages).speciesPickerHint;
    expect(hint, loc).not.toMatch(/one-time|einmalig|choix unique/i);
  }
});

test("the confirmation reads naturally for every creature, in every language", () => {
  const confirm = (loc: keyof typeof LOCALES, who: string, species: string) => {
    const m = LOCALES[loc] as Messages;
    const label = (m.pocketMoney.species as Record<string, { label: string }>)[species].label;
    return String(new IntlMessageFormat(pmSettings(m).changeCreatureConfirm, loc).format({ who, species, label }));
  };
  expect(confirm("en", "Funkel", "rex")).toBe("Funkel becomes a T-Rex. Stage and look stay.");
  expect(confirm("en", "Funkel", "owl")).toBe("Funkel becomes an Owl. Stage and look stay.");
  expect(confirm("de", "Funkel", "rex")).toBe("Funkel wird zum T-Rex. Stufe und Aussehen bleiben.");
  expect(confirm("de", "Funkel", "bunny")).toBe("Funkel wird zum Hasen. Stufe und Aussehen bleiben.");
  expect(confirm("fr", "Funkel", "unicorn")).toBe("Funkel se transforme en licorne. Le stade et l'apparence restent.");
  // Every species has its own German and French form, not the fallback.
  for (const s of SPECIES_IDS) {
    expect(confirm("de", "X", s), s).not.toContain("zu:");
    expect(confirm("fr", "X", s), s).toMatch(/^X se transforme en \S/);
  }
});

// ── live: the route, and the screen ─────────────────────────────────────

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const P = "claude-creature-change-";
const LOOK = { name: "Funkel", body: "#FF8FC0", belly: "#FFF1A8", skin: "#D9A27A", hair: "#C97C3C", hairstyle: "ponytail", pattern: "hearts", eyes: "sparkly", acc: "bow" };

test.describe("live: changing a child's creature", () => {
  test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE and a running stack");
  test.describe.configure({ mode: "serial" });
  // The PWA service worker answers fetches before page.route sees them.
  test.use({ serviceWorkers: "block" });

  let api: APIRequestContext;
  let famId = "";
  let code = "";
  let childId = "";
  let accountId = "";

  const purge = () => {
    if (!famId) return;
    psql(`DELETE FROM pocket_money_transactions WHERE account_id IN (SELECT id FROM pocket_money_accounts WHERE family_id = ${sqlText(famId)})`);
    psql(`DELETE FROM pocket_money_accounts WHERE family_id = ${sqlText(famId)}`);
    psql(`DELETE FROM creatures WHERE family_id = ${sqlText(famId)}`);
    for (let i = 0; i < 2; i++) psql(`DELETE FROM people WHERE family_id = ${sqlText(famId)}`);
    psql(`DELETE FROM integration_secrets WHERE family_id = ${sqlText(famId)}`);
    psql(`DELETE FROM devices WHERE family_id = ${sqlText(famId)}`);
    psql(`DELETE FROM families WHERE id = ${sqlText(famId)}`);
  };
  /** Everything a species change must leave alone, as one string. */
  const kept = () =>
    psql(`SELECT concat_ws('|', a.balance_cents, a.lifetime_saved_cents, c.best_tier, c.last_seen_tier, c.grows_with, c.style, c.look::text)
          FROM pocket_money_accounts a JOIN creatures c ON c.person_id = a.person_id WHERE a.id = '${accountId}'`);
  const species = () => psql(`SELECT species FROM creatures WHERE person_id = '${childId}'`);
  const lock = () => psql(`UPDATE device_sessions SET settings_unlocked_until = NULL WHERE family_id = '${famId}'`);

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    for (const id of psql(`SELECT string_agg(id::text, ',') FROM families WHERE name LIKE '${P}%'`).split(",").filter(Boolean)) {
      famId = id;
      purge();
    }
    code = `CC${randomBytes(4).toString("hex").toUpperCase()}`;
    famId = psqlRow(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${P}family', '${code}', true) RETURNING id`);
    childId = psqlRow(`INSERT INTO people (family_id, name, is_child) VALUES ('${famId}', 'Mia', true) RETURNING id`);
    // A child well along: stage 6 reached, the money spent back down since,
    // in the Sticker style, a princess with her own look.
    accountId = psqlRow(`INSERT INTO pocket_money_accounts
      (family_id, person_id, currency, balance_cents, lifetime_saved_cents, best_tier, last_seen_tier, avatar_species, avatar_style, avatar_look)
      VALUES ('${famId}', '${childId}', 'EUR', 700, 30000, 6, 6, 'princess', 'sticker', ${sqlText(JSON.stringify(LOOK))}::jsonb) RETURNING id`);
    // Her creature, as the RFC-017 migration derives it from that account.
    psql(`SELECT public.creatures_from_accounts('${famId}')`);

    api = await pwRequest.newContext({ baseURL: BASE });
    const join = await postJoin(api, { joinCode: code, hardwareId: `${P}api`, deviceName: `${P}api` });
    expect(join.ok(), await join.text()).toBe(true);
    const setPin = await api.post("/api/pin", { data: { family_id: famId, action: "set", pin: "4711" } });
    expect(setPin.ok(), await setPin.text()).toBe(true);
  });

  test.afterAll(async () => {
    purge();
    psql(`DELETE FROM devices WHERE hardware_id LIKE '${P}%' OR hardware_id LIKE 'e2e-${P}%'`);
    await api?.dispose();
    expect(psql(`SELECT count(*) FROM families WHERE name LIKE '${P}%'`)).toBe("0");
    expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE '%${P}%'`)).toBe("0");
  });

  test("without the PIN a species change is 403 pin_required and writes nothing", async () => {
    lock();
    const before = kept();
    const res = await api.patch(`/api/creatures/${childId}`, { data: { species: "rex" } });
    expect(res.status(), await res.text()).toBe(403);
    expect((await res.json()).error).toBe("pin_required");
    expect(species()).toBe("princess");
    expect(kept()).toBe(before);
  });

  test("a body that is not JSON, or JSON null, is 400 rather than 500", async () => {
    for (const raw of ["{", "null", "[]", "42", ""]) {
      const res = await api.patch(`/api/creatures/${childId}`, {
        headers: { "content-type": "application/json" },
        data: raw,
      });
      expect(res.status(), `${JSON.stringify(raw)}: ${await res.text()}`).toBe(400);
    }
    // and without a session it is still the session's 401 first
    const anon = await pwRequest.newContext({ baseURL: BASE });
    const res = await anon.patch(`/api/creatures/${childId}`, { headers: { "content-type": "application/json" }, data: "{" });
    expect(res.status()).toBe(401);
    await anon.dispose();
  });

  test("with the PIN, an unknown species is 400", async () => {
    const verify = await api.post("/api/pin", { data: { family_id: famId, action: "verify", pin: "4711" } });
    expect((await verify.json()).valid).toBe(true);
    const res = await api.patch(`/api/creatures/${childId}`, { data: { species: "griffin" } });
    expect(res.status(), await res.text()).toBe(400);
    expect(species()).toBe("princess");
  });

  test("with the PIN, the princess becomes a T-Rex: stage, style and look untouched", async () => {
    const before = kept();
    expect(before).toContain("|6|6|money|sticker|");
    const res = await api.patch(`/api/creatures/${childId}`, { data: { species: "rex" } });
    expect(res.status(), await res.text()).toBe(200);
    expect(species()).toBe("rex");
    expect(kept()).toBe(before);
    // and back: her skin, hair and hairstyle were kept all along
    const back = await api.patch(`/api/creatures/${childId}`, { data: { species: "princess" } });
    expect(back.status(), await back.text()).toBe(200);
    expect(JSON.parse(psql(`SELECT look::text FROM creatures WHERE person_id = '${childId}'`))).toEqual(LOOK);
    expect(kept()).toBe(before);
  });

  test("on the screen: Change creature, a confirmation, and only the species changes", async ({ page }) => {
    test.setTimeout(180_000);
    // No PIN for this part: the settings page opens without one, so the
    // test is about the control, not the PIN pad (the server gate is above).
    const removed = await api.post("/api/pin", { data: { family_id: famId, action: "remove" } });
    expect(removed.ok(), await removed.text()).toBe(true);
    psql(`UPDATE creatures SET species = 'princess' WHERE person_id = '${childId}'`);
    const before = kept();

    await establishSession(page, code, `${P}ui`);
    await page.goto("/settings/creatures", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId(`creature-card-${childId}`);
    await expect(card.getByTestId("creature-current")).toHaveText("Princess", { timeout: 60_000 });
    await card.getByTestId("change-creature").click();
    const sheet = page.getByTestId("change-creature-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("change-creature-save")).toBeDisabled();
    await sheet.locator('button[data-species="rex"]').click();
    await expect(sheet.getByTestId("change-creature-confirm")).toHaveText("Funkel becomes a T-Rex. Stage and look stay.");
    // Set CREATURE_SHOTS=<file.png> to keep a picture of the sheet.
    if (process.env.CREATURE_SHOTS) await page.screenshot({ path: process.env.CREATURE_SHOTS });
    await sheet.getByTestId("change-creature-save").click();
    await expect(sheet).toBeHidden();
    await expect(card.getByTestId("creature-current")).toHaveText("T-Rex");
    expect(species()).toBe("rex");
    expect(kept()).toBe(before);
  });

  test("on the screen: a lapsed unlock says so and keeps the sheet open", async ({ page }) => {
    test.setTimeout(120_000);
    let hits = 0;
    await page.context().route("**/api/creatures/*", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      hits++;
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "pin_required" }) });
    });
    await establishSession(page, code, `${P}ui`);
    await page.goto("/settings/creatures", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId(`creature-card-${childId}`);
    await expect(card.getByTestId("creature-current")).toHaveText("T-Rex", { timeout: 60_000 });
    await card.getByTestId("change-creature").click();
    const sheet = page.getByTestId("change-creature-sheet");
    await sheet.locator('button[data-species="owl"]').click();
    await sheet.getByTestId("change-creature-save").click();
    await expect(page.getByText(en.settings.creatures.errorPinRequired)).toBeVisible();
    await expect(sheet).toBeVisible();
    expect(hits).toBeGreaterThan(0);
    expect(species()).toBe("rex");
  });

  test("the child's own page offers no species switch", async ({ page }) => {
    test.setTimeout(120_000);
    await establishSession(page, code, `${P}ui`);
    await page.goto(`/pocket-money?child=${childId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("change-look")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("change-creature")).toHaveCount(0);
    await expect(page.getByTestId("species-picker")).toHaveCount(0);
  });
});
