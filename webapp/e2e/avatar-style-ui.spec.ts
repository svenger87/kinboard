import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { establishSession } from "./session";
import { acquireWholeDatabase, dbContainer, releaseWholeDatabase } from "./whole-database";

/**
 * The drawn avatars on the screens: a child changes their own avatar's look
 * from their page with no PIN, taps it and it hops, a parent sees and changes
 * the same choice under Settings behind the PIN, the profile shows it, a stage
 * gained plays the hatching scene, a species without drawings offers only
 * Classic, the workshop's creatures are drawn on the child's page, and the
 * species picker offers all of them. Needs FAMILY_CODE and a running stack.
 *
 * Set AVATAR_SHOTS=<dir> to keep screenshots of each screen.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
test.describe.configure({ mode: "serial" });
const DEVICE = "claude-avatar-style";
const TAG = "claude-avatar";
const PIN = "5381";
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
let childName = "";
let accountId = "";
let createdAccount = false;
let original = "";
let hadPin = false;

test.beforeAll(async () => {
  await acquireWholeDatabase();
  try {
    familyId = psql(`SELECT id FROM families WHERE join_code = '${familyCode}'`);
    [childId, childName] = psql(`SELECT id || '|' || name FROM people
      WHERE family_id = '${familyId}' AND is_child AND deleted_at IS NULL ORDER BY created_at LIMIT 1`).split("|");
    expect(childId, "the family has a child").toMatch(/^[0-9a-f-]{36}$/);
    accountId = psql(`SELECT id FROM pocket_money_accounts WHERE person_id = '${childId}'`);
    if (!accountId) {
      accountId = psql(`INSERT INTO pocket_money_accounts (family_id, person_id) VALUES ('${familyId}', '${childId}') RETURNING id`);
      createdAccount = true;
    }
    original = psql(`SELECT avatar_species || '|' || avatar_style || '|' || reward_mode || '|' || last_seen_tier
      FROM pocket_money_accounts WHERE id = '${accountId}'`);
    // Points mode, so the visits below never raise best_tier (money mode
    // writes it, and it only climbs): 650 points is stage 5, the Drake, the
    // first with wings.
    psql(`UPDATE pocket_money_accounts SET avatar_species = 'dragon', avatar_style = 'classic', reward_mode = 'points', last_seen_tier = 5
      WHERE id = '${accountId}'`);
    psql(`INSERT INTO todo_point_awards (family_id, person_id, todo_id, completion_key, points)
      VALUES ('${familyId}', '${childId}', NULL, '${TAG}', 650)`);
    hadPin = psql(`SELECT count(*) FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'settings_pin'`) !== "0";
    test.skip(hadPin, "the family already has a settings PIN this spec does not know");
    psql(`INSERT INTO integration_secrets (family_id, key, value) VALUES ('${familyId}', 'settings_pin', '{"pin":"${PIN}"}')`);
  } finally {
    releaseWholeDatabase();
  }
});

test.afterAll(async () => {
  await acquireWholeDatabase();
  try {
    if (!familyId) return;
    psql(`DELETE FROM todo_point_awards WHERE family_id = '${familyId}' AND completion_key = '${TAG}'`);
    if (createdAccount) psql(`DELETE FROM pocket_money_accounts WHERE id = '${accountId}'`);
    else if (original) {
      const [species, style, mode, seen] = original.split("|");
      psql(`UPDATE pocket_money_accounts SET avatar_species = '${species}', avatar_style = '${style}', reward_mode = '${mode}', last_seen_tier = ${seen}
        WHERE id = '${accountId}'`);
    }
    if (!hadPin) psql(`DELETE FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'settings_pin'`);
    psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE}%' OR hardware_id LIKE '${DEVICE}%'`);
  } finally {
    releaseWholeDatabase();
  }
});

async function openUntil(opener: Locator, target: Locator): Promise<void> {
  await expect(opener).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    if (!(await target.isVisible())) await opener.click({ timeout: 2_000 });
    await expect(target).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

async function goto(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

async function shot(target: Page | Locator, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const style = () => psql(`SELECT avatar_style FROM pocket_money_accounts WHERE id = '${accountId}'`);

test("a child changes their own look with no PIN, a parent sees it behind the PIN, and the profile shows it", async ({ page }) => {
  test.setTimeout(240_000);
  await establishSession(page, familyCode!, DEVICE);

  // The child's page: the classic picture until a look is chosen.
  await goto(page, `/pocket-money?child=${childId}`);
  const avatar = page.getByRole("button", { name: /^(Tap|.* antippen|Toucher) / });
  await expect(avatar).toBeVisible({ timeout: 30_000 });
  await expect(avatar.locator('[data-avatar-style="classic"]')).toBeVisible();

  // "Change look": four pictures of their own dragon, at its own stage.
  const picker = page.getByTestId("avatar-style-picker");
  await openUntil(page.getByTestId("change-look"), picker);
  await expect(picker.getByRole("radio")).toHaveCount(4);
  await expect(picker.getByRole("radio", { checked: true })).toHaveAttribute("data-style", "classic");
  for (const s of ["gumdrop", "sticker", "storybook"]) {
    await expect(picker.locator(`[data-style="${s}"] svg[data-tier="5"]`)).toBeVisible();
    await expect(picker.locator(`[data-style="${s}"]`)).toBeEnabled();
  }
  await shot(page.getByRole("dialog"), "kid-change-look-sheet");

  // No settings unlock on this device, and none is needed for the look.
  await picker.locator('[data-style="sticker"]').click();
  await expect.poll(style, { timeout: 15_000 }).toBe("sticker");
  await expect(picker.getByRole("radio", { checked: true })).toHaveAttribute("data-style", "sticker", { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(avatar.locator('svg[data-avatar-style="sticker"][data-tier="5"]')).toBeVisible({ timeout: 15_000 });
  // The big avatar breathes; the drawing has the Drake's wings.
  await expect(avatar.locator("svg.creature-animated")).toHaveCount(1);
  await expect(avatar.locator('[data-part="wings"]')).toHaveCount(1);

  // Tapping it: a hop and hearts.
  await avatar.click();
  await expect(avatar.locator(".creature-body.creature-hop")).toHaveCount(1);
  await expect(avatar.locator(".creature-particle").first()).toBeAttached();
  await shot(page, "kid-page-sticker");

  // The stages sheet: eight stages in the child's look, none of them moving.
  await openUntil(page.getByRole("button", { name: /evolution stages|Entwicklungsstufen|stades d'évolution/i }), page.getByRole("dialog"));
  const sheet = page.getByRole("dialog");
  await expect(sheet.locator('svg[data-avatar-style="sticker"]')).toHaveCount(8);
  await expect(sheet.locator("svg.creature-animated")).toHaveCount(0);
  await shot(sheet, "stages-sheet-sticker");
  await page.keyboard.press("Escape");

  // A parent: Settings asks for the PIN, and shows the same choice.
  await goto(page, "/settings/pocket-money");
  const digits = page.locator('input[inputmode="numeric"]');
  await expect(digits.first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < PIN.length; i++) await digits.nth(i).fill(PIN[i]);
  const card = page.getByTestId(`avatar-style-${accountId}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByRole("radio", { checked: true })).toHaveAttribute("data-style", "sticker");
  await card.scrollIntoViewIfNeeded();
  await shot(card, "settings-picker-sticker");
  await card.locator('[data-style="storybook"]').click();
  await expect.poll(style, { timeout: 15_000 }).toBe("storybook");

  // The child's profile shows the avatar, small, in the child's look.
  await goto(page, "/");
  const dialog = page.getByRole("dialog");
  await openUntil(page.getByRole("button", { name: new RegExp(`^${childName} — `) }), dialog);
  const pet = dialog.getByTestId("profile-pet-avatar");
  await expect(pet.locator('svg[data-avatar-style="storybook"][data-tier="5"]')).toBeVisible();
  await expect(pet.locator("svg.creature-animated")).toHaveCount(0);
  await shot(dialog, "profile-storybook");
});

test("a stage gained in a drawn look plays the hatching scene; from the egg, the egg cracks first", async ({ page }) => {
  test.setTimeout(120_000);
  await establishSession(page, familyCode!, DEVICE);
  psql(`UPDATE pocket_money_accounts SET avatar_style = 'gumdrop', last_seen_tier = 1 WHERE id = '${accountId}'`);

  await goto(page, `/pocket-money?child=${childId}`);
  const scene = page.getByTestId("hatching-scene");
  await expect(scene).toBeVisible({ timeout: 30_000 });
  await expect(scene.locator('[data-phase="egg"], [data-phase="cracked"]')).toBeVisible();
  await expect(scene.locator('[data-phase="cracked"] [data-part="crack"]')).toBeVisible({ timeout: 5_000 });
  await shot(page, "hatching-cracked");
  await expect(scene.locator('[data-phase="new"] svg[data-tier="5"]')).toBeVisible({ timeout: 5_000 });
  await expect(scene.locator(".creature-particle").first()).toBeAttached();
  await shot(page, "hatching-new-stage");
  await expect(scene).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => psql(`SELECT last_seen_tier FROM pocket_money_accounts WHERE id = '${accountId}'`)).toBe("5");

  // From a hatched stage: the flash, then the new one.
  psql(`UPDATE pocket_money_accounts SET last_seen_tier = 4 WHERE id = '${accountId}'`);
  await goto(page, `/pocket-money?child=${childId}`);
  await expect(scene).toBeVisible({ timeout: 30_000 });
  await expect(scene.locator('[data-phase="new"] svg[data-tier="5"]')).toBeVisible({ timeout: 5_000 });
});

test("a species without drawings offers only Classic, and the child's page offers no look to change", async ({ page }) => {
  test.setTimeout(120_000);
  await establishSession(page, familyCode!, DEVICE);
  psql(`UPDATE pocket_money_accounts SET avatar_species = 'wizard', avatar_style = 'sticker' WHERE id = '${accountId}'`);

  await goto(page, `/pocket-money?child=${childId}`);
  const avatar = page.getByRole("button", { name: /^(Tap|.* antippen|Toucher) / });
  // A stored drawn look on an undrawn species is the classic picture.
  await expect(avatar.locator('img[data-avatar-style="classic"]')).toHaveAttribute("src", "/pocket-money/avatars/wizard-5.svg", { timeout: 30_000 });
  await expect(page.getByTestId("change-look")).toHaveCount(0);

  await goto(page, "/settings/pocket-money");
  const digits = page.locator('input[inputmode="numeric"]');
  await expect(digits.first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < PIN.length; i++) await digits.nth(i).fill(PIN[i]);
  const card = page.getByTestId(`avatar-style-${accountId}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator('[data-style="classic"]')).toBeEnabled();
  for (const s of ["gumdrop", "sticker", "storybook"]) await expect(card.locator(`[data-style="${s}"]`)).toBeDisabled();
  await expect(card).toContainText(/Coming for this species|Kommt bald|Bientôt/);
  // Shown as what it looks like, Classic -- not as the stored choice it cannot show.
  await expect(card.getByRole("radio", { checked: true })).toHaveAttribute("data-style", "classic");
  await card.scrollIntoViewIfNeeded();
  await shot(card, "settings-picker-wizard");
});

test("the new creatures: drawn and moving on the child's page; a drawn-only one stands still in Classic", async ({ page }) => {
  test.setTimeout(120_000);
  await establishSession(page, familyCode!, DEVICE);
  const avatar = page.getByRole("button", { name: /^(Tap|.* antippen|Toucher) / });
  for (const species of ["rex", "unicorn", "princess", "prince", "cat", "fox", "robot", "stego"]) {
    psql(`UPDATE pocket_money_accounts SET avatar_species = '${species}', avatar_style = 'sticker' WHERE id = '${accountId}'`);
    await goto(page, `/pocket-money?child=${childId}`);
    const svg = avatar.locator(`svg[data-species="${species}"][data-avatar-style="sticker"][data-tier="5"]`);
    await expect(svg).toBeVisible({ timeout: 30_000 });
    await expect(avatar.locator("svg.creature-animated")).toHaveCount(1);
    await expect(page.getByTestId("change-look")).toBeVisible();
    await shot(avatar, `child-${species}-sticker`);
  }
  psql(`UPDATE pocket_money_accounts SET avatar_species = 'princess', avatar_style = 'classic' WHERE id = '${accountId}'`);
  await goto(page, `/pocket-money?child=${childId}`);
  await expect(avatar.locator('svg[data-species="princess"][data-avatar-style="classic"]')).toBeVisible({ timeout: 30_000 });
  await expect(avatar.locator("img")).toHaveCount(0);
  await expect(avatar.locator("svg.creature-animated")).toHaveCount(0);
  await shot(avatar, "child-princess-classic");
});

test("the species picker offers all fourteen drawn and the classic three, and a new creature starts in Gumdrop", async ({ page }) => {
  test.setTimeout(120_000);
  const kidName = `${TAG}-kid2`;
  let kidId = "";
  await acquireWholeDatabase();
  try {
    kidId = psql(`INSERT INTO people (family_id, name, is_child) VALUES ('${familyId}', '${kidName}', true) RETURNING id`);
  } finally {
    releaseWholeDatabase();
  }
  try {
    await establishSession(page, familyCode!, DEVICE);
    await goto(page, "/settings/pocket-money");
    const digits = page.locator('input[inputmode="numeric"]');
    await expect(digits.first()).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < PIN.length; i++) await digits.nth(i).fill(PIN[i]);
    const card = page.locator("div").filter({ has: page.getByText(kidName, { exact: false }) }).filter({ has: page.locator("button[data-species]") }).last();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const drawn = ["dragon", "cat", "axolotl", "owl", "robot", "unicorn", "fox", "penguin", "bunny", "rex", "trike", "stego", "princess", "prince"];
    for (const species of drawn) {
      const option = card.locator(`button[data-species="${species}"]`);
      await expect(option).toBeVisible();
      await expect(option.locator('svg[data-avatar-style="gumdrop"]')).toHaveCount(8);
    }
    for (const species of ["astronaut", "plant", "wizard"]) await expect(card.locator(`button[data-species="${species}"] img`)).toHaveCount(8);
    await card.locator('button[data-species="unicorn"]').click();
    await expect(card.getByText(/Star Egg|Sternenei|Œuf étoilé/)).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await shot(card, "settings-species-picker");
    await card.getByRole("button", { name: /^(Create as|Als|Créer).*(Unicorn|Einhorn|Licorne)/ }).click();
    await expect.poll(() => psql(`SELECT avatar_species || '|' || avatar_style FROM pocket_money_accounts WHERE person_id = '${kidId}'`), { timeout: 15_000 }).toBe("unicorn|gumdrop");
  } finally {
    await acquireWholeDatabase();
    try {
      psql(`DELETE FROM pocket_money_accounts WHERE person_id = '${kidId}'`);
      // Twice: the first delete only moves a person to the recycle bin.
      for (let i = 0; i < 2; i++) psql(`DELETE FROM people WHERE id = '${kidId}'`);
    } finally {
      releaseWholeDatabase();
    }
  }
});
