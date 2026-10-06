import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { seedCreature, type CreatureSeed } from "./helpers/creature-seed";
import { establishSession } from "./session";
import { acquireWholeDatabase, dbContainer, releaseWholeDatabase } from "./whole-database";

/**
 * The look editor on the screen (RFC-016 §4), at a phone's and a tablet's
 * width: a child opens "Change look" on their own page, with no PIN, picks
 * colours by name, a pattern, eyes, an accessory and a name; the preview
 * follows every choice; nothing is written until Save; Surprise me and Start
 * over work; the princess's editor speaks of outfit, trim, hair and skin and
 * offers hairstyles; the name shows above the creature afterwards. Needs
 * FAMILY_CODE and a running stack.
 *
 * Set AVATAR_SHOTS=<dir> to keep screenshots.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
test.describe.configure({ mode: "serial" });
const DEVICE = "claude-avatar-look";
const TAG = "claude-avatar-look";
const SHOTS = process.env.AVATAR_SHOTS;

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

let familyId = "";
let childId = "";
let accountId = "";
let createdAccount = false;
let creature: CreatureSeed | null = null;

test.beforeAll(async () => {
  await acquireWholeDatabase();
  try {
    familyId = psql(`SELECT id FROM families WHERE join_code = '${familyCode}'`);
    childId = psql(`SELECT id FROM people WHERE family_id = '${familyId}' AND is_child AND deleted_at IS NULL ORDER BY created_at LIMIT 1`);
    expect(childId, "the family has a child").toMatch(/^[0-9a-f-]{36}$/);
    accountId = psql(`SELECT id FROM pocket_money_accounts WHERE person_id = '${childId}'`);
    if (!accountId) {
      accountId = psql(`INSERT INTO pocket_money_accounts (family_id, person_id) VALUES ('${familyId}', '${childId}') RETURNING id`);
      createdAccount = true;
    }
    // The child's creature (RFC-017), growing with points at stage 6, so no
    // visit raises best_tier and no celebration plays.
    creature = seedCreature(psql, familyId, childId, { grows_with: "points", last_seen_tier: 6, look: "{}" });
    psql(`INSERT INTO todo_point_awards (family_id, person_id, todo_id, completion_key, points) VALUES ('${familyId}', '${childId}', NULL, '${TAG}', 1100)`);
  } finally {
    releaseWholeDatabase();
  }
});

test.afterAll(async () => {
  await acquireWholeDatabase();
  try {
    if (!familyId) return;
    psql(`DELETE FROM todo_point_awards WHERE family_id = '${familyId}' AND completion_key = '${TAG}'`);
    creature?.restore();
    if (createdAccount) psql(`DELETE FROM pocket_money_accounts WHERE id = '${accountId}'`);
    psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE}%' OR hardware_id LIKE '${DEVICE}%'`);
  } finally {
    releaseWholeDatabase();
  }
});

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const stored = () => JSON.parse(psql(`SELECT look::text FROM creatures WHERE person_id = '${childId}'`));

async function openEditor(page: Page) {
  await page.goto(`/pocket-money?child=${childId}`, { waitUntil: "domcontentloaded" });
  const opener = page.getByTestId("change-look");
  const editor = page.getByTestId("look-editor");
  await expect(opener).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    if (!(await editor.isVisible())) await opener.click({ timeout: 2_000 });
    await expect(editor).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return editor;
}

async function noSideways(page: Page) {
  const { doc, win, sheet } = await page.evaluate(() => {
    const s = document.querySelector('[role="dialog"]') as HTMLElement | null;
    return { doc: document.documentElement.scrollWidth, win: window.innerWidth, sheet: s ? s.scrollWidth - s.clientWidth : 0 };
  });
  expect(doc).toBeLessThanOrEqual(win);
  expect(sheet).toBeLessThanOrEqual(0);
}

for (const [label, width, height] of [["phone", 390, 844], ["tablet", 820, 1180]] as const) {
  test(`a fox's look, chosen by the child with no PIN (${label})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height });
    creature!.set(`species = 'fox', style = 'gumdrop', look = '{}'`);
    await establishSession(page, familyCode!, DEVICE);
    const editor = await openEditor(page);
    const preview = editor.locator('svg[data-species="fox"]').first();
    await expect(preview).toBeVisible();
    await expect(preview).toHaveClass(/creature-animated/);

    // the creature's words, not a person's
    await expect(editor.getByRole("heading", { name: /^(Body colour|Körperfarbe|Couleur du corps)$/ })).toBeVisible();
    await expect(editor.getByRole("heading", { name: /^(Wings, ears and fins|Flügel, Ohren und Flossen|Ailes, oreilles et nageoires)$/ })).toBeVisible();
    await expect(editor.getByRole("heading", { name: /^(Hairstyle|Frisur|Coiffure)$/ })).toHaveCount(0);

    // swatches are buttons named after their colour
    const body = editor.getByTestId("look-body");
    await expect(body.getByRole("button")).toHaveCount(10);
    const sky = body.getByRole("button", { name: /^(Sky blue|Himmelblau|Bleu ciel)$/ });
    await sky.click();
    await expect(sky).toHaveAttribute("aria-pressed", "true");
    await expect(preview.locator('[fill="#56B6E8"]').first()).toBeAttached();
    await editor.getByTestId("look-accent").getByRole("button", { name: /^(Lilac|Flieder|Lilas)$/ }).click();
    await editor.getByTestId("look-pattern").locator('[data-value="hearts"]').click();
    await editor.getByTestId("look-eyes").locator('[data-value="sparkly"]').click();
    await editor.getByTestId("look-acc").locator('[data-value="bow"]').click();
    // the preview pops on a change (unless the device asks for less motion)
    await expect(editor.locator(".creature-pop")).toHaveCount(1, { timeout: 2_000 });
    await editor.getByTestId("look-name").fill("Fuchsi");
    await expect(editor.getByTestId("look-preview-name")).toHaveText("Fuchsi");
    await expect(preview.locator('[data-acc="bow"]')).toBeAttached();
    await expect(preview.locator('[data-pattern="hearts"]')).toBeAttached();
    await noSideways(page);
    await shot(page, `editor-fox-${label}`);

    // still a draft
    expect(stored()).toEqual({});

    // Surprise me stays in the sets; Start over brings back the fox's own
    await editor.getByTestId("look-surprise").click();
    await editor.getByTestId("look-start-over").click();
    await expect(preview.locator('[fill="#FF8A3D"]').first()).toBeAttached();
    await expect(editor.getByTestId("look-name")).toHaveValue("Fuchsi");

    await sky.click();
    await editor.getByTestId("look-acc").locator('[data-value="glasses"]').click();
    await editor.getByTestId("look-save").click();
    await expect(editor).toBeHidden({ timeout: 15_000 });
    await expect.poll(stored, { timeout: 15_000 }).toEqual({ name: "Fuchsi", body: "#56B6E8", acc: "glasses" });

    // the name above the creature, and the creature in its new look
    await expect(page.getByTestId("creature-name")).toHaveText("Fuchsi");
    const avatar = page.getByRole("button", { name: /^(Tap|.* antippen|Toucher) / });
    await expect(avatar.locator('[data-acc="glasses"]')).toBeAttached();
    await noSideways(page);
    await shot(page, `child-fox-${label}`);
  });
}

test("the princess's editor: outfit, trim, hair and skin, and hairstyles (phone)", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  creature!.set(`species = 'princess', style = 'sticker', look = '{"name":"Lia"}'`);
  await establishSession(page, familyCode!, DEVICE);
  const editor = await openEditor(page);
  for (const h of [/^(Outfit colour|Kleiderfarbe|Couleur de la tenue)$/, /^(Trim colour|Besatzfarbe|Couleur des bordures)$/, /^(Hair colour|Haarfarbe|Couleur des cheveux)$/, /^(Skin tone|Hautfarbe|Couleur de peau)$/, /^(Hairstyle|Frisur|Coiffure)$/]) {
    await expect(editor.getByRole("heading", { name: h })).toBeVisible();
  }
  await expect(editor.getByRole("heading", { name: /^(Body colour|Körperfarbe)$/ })).toHaveCount(0);
  await expect(editor.getByTestId("look-skin").getByRole("button")).toHaveCount(5);
  await expect(editor.getByTestId("look-hair").getByRole("button")).toHaveCount(8);
  await expect(editor.getByTestId("look-hairstyle").locator('[data-value="long"]')).toHaveAttribute("aria-pressed", "true");
  await editor.getByTestId("look-skin").getByRole("button", { name: /^(Dark brown|Dunkelbraun|Brun foncé)$/ }).click();
  await editor.getByTestId("look-hair").getByRole("button", { name: /^(Black|Schwarz|Noir)$/ }).click();
  await editor.getByTestId("look-hairstyle").locator('[data-value="curls"]').click();
  await editor.getByTestId("look-body").getByRole("button", { name: /^(Turquoise|Türkis)$/ }).click();
  const preview = editor.locator('svg[data-species="princess"]').first();
  await expect(preview.locator('[fill="#7A4E33"]').first()).toBeAttached();
  await expect(preview.locator('[fill="#2B1D14"]').first()).toBeAttached();
  await noSideways(page);
  await shot(page, "editor-princess-phone");
  await editor.getByTestId("look-save").click();
  await expect.poll(stored, { timeout: 15_000 }).toEqual({ name: "Lia", skin: "#7A4E33", hair: "#2B1D14", hairstyle: "curls", body: "#2EC4B6" });
  await expect(page.getByTestId("creature-name")).toHaveText("Lia");
  await shot(page, "child-princess-phone");
});
