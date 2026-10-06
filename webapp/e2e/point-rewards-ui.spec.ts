import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { seedCreature, type CreatureSeed } from "./helpers/creature-seed";
import { establishSession } from "./session";
import { acquireWholeDatabase, dbContainer, releaseWholeDatabase } from "./whole-database";

/**
 * Points instead of euros, end to end on the screens (discussion #349): a
 * child in points mode sees their points and the rewards, asks for one, the
 * decision is refused without the settings PIN, a parent approves it behind
 * the PIN, and the points left show on the page and on the child's profile.
 * Needs FAMILY_CODE and a running stack.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
test.describe.configure({ mode: "serial" });
const DEVICE = "point-rewards-ui";
const TAG = "claude-ui";
const PIN = "4826";

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
let hadPin = false;
let creature: CreatureSeed | null = null;

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
    // A creature growing with points (RFC-017; reward_mode on the account until then).
    creature = seedCreature(psql, familyId, childId, { grows_with: "points" });
    psql(`INSERT INTO todo_point_awards (family_id, person_id, todo_id, completion_key, points)
      VALUES ('${familyId}', '${childId}', NULL, '${TAG}', 120)`);
    psql(`INSERT INTO point_rewards (family_id, title, cost_points, icon) VALUES
      ('${familyId}', '${TAG} movie night', 100, '🎬'), ('${familyId}', '${TAG} zoo', 500, NULL)`);
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
    psql(`DELETE FROM point_redemptions WHERE family_id = '${familyId}' AND title LIKE '${TAG}%'`);
    psql(`DELETE FROM point_rewards WHERE family_id = '${familyId}' AND title LIKE '${TAG}%'`);
    psql(`DELETE FROM todo_point_awards WHERE family_id = '${familyId}' AND completion_key = '${TAG}'`);
    if (createdAccount) psql(`DELETE FROM pocket_money_accounts WHERE id = '${accountId}'`);
    creature?.restore();
    if (!hadPin) psql(`DELETE FROM integration_secrets WHERE family_id = '${familyId}' AND key = 'settings_pin'`);
    psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE}%'`);
  } finally {
    releaseWholeDatabase();
  }
});

/** Clicks `opener` until `target` shows: under `next dev` a first click can land on a page about to remount. */
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

const REDEEM = /^(Redeem|Einlösen|Échanger)$/;
const APPROVE = /^(Approve|Genehmigen|Approuver)$/;

test("a child redeems with points, the decision needs the PIN, and what is left shows everywhere", async ({ page }) => {
  // Five screens in one story; each first visit compiles under `next dev`.
  test.setTimeout(180_000);
  await establishSession(page, familyCode!, DEVICE);

  // The child's page: 120 points, a reward they can afford and one they can't.
  await goto(page, `/pocket-money?child=${childId}`);
  const panel = page.getByTestId("rewards-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("points-balance")).toContainText("120");
  const movie = panel.getByTestId("reward-card").filter({ hasText: `${TAG} movie night` });
  const zoo = panel.getByTestId("reward-card").filter({ hasText: `${TAG} zoo` });
  await expect(zoo.getByRole("button", { name: REDEEM })).toBeDisabled();
  await expect(movie.getByRole("button", { name: REDEEM })).toBeEnabled();

  // Asking: a confirmation, then a pending request and nothing spent.
  const confirm = page.getByRole("alertdialog");
  await openUntil(movie.getByRole("button", { name: REDEEM }), confirm);
  await confirm.getByRole("button", { name: REDEEM }).click();
  // The first request compiles the route under `next dev`: allow for it.
  await expect(page.getByTestId("redemptions-pending")).toContainText(`${TAG} movie night`, { timeout: 30_000 });
  const redemption = psql(`SELECT id || '|' || status || '|' || cost_points FROM point_redemptions
    WHERE person_id = '${childId}' AND title LIKE '${TAG}%'`);
  const [redemptionId, status, cost] = redemption.split("|");
  expect([status, cost]).toEqual(["pending", "100"]);
  await expect(page.getByTestId("points-balance")).toContainText("120");
  // The movie night is now held back: 20 available, so it can't be asked twice.
  await expect(movie.getByRole("button", { name: REDEEM })).toBeDisabled();

  // The child's own screen cannot approve it: no settings unlock, no decision.
  const refused = await page.request.patch(`/api/rewards/redemptions/${redemptionId}`, { data: { status: "approved" } });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: "pin_required" });
  expect(psql(`SELECT status FROM point_redemptions WHERE id = '${redemptionId}'`)).toBe("pending");

  // A parent: Settings asks for the PIN, then the request waits in the inbox.
  // Settings -> Creatures & rewards since RFC-017.
  await goto(page, "/settings/creatures");
  const digits = page.locator('input[inputmode="numeric"]');
  await expect(digits.first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < PIN.length; i++) await digits.nth(i).fill(PIN[i]);
  const inbox = page.getByTestId("redemption-inbox");
  await expect(inbox).toContainText(`${TAG} movie night`, { timeout: 30_000 });
  await expect(inbox).toContainText(childName);
  await expect(page.getByTestId(`creature-card-${childId}`).getByTestId("creature-points-summary")).toBeVisible();
  await inbox.getByRole("button", { name: APPROVE }).first().click();
  await expect(inbox).toBeHidden({ timeout: 15_000 });
  expect(psql(`SELECT status || '|' || (decided_by_device_id IS NOT NULL) FROM point_redemptions WHERE id = '${redemptionId}'`))
    .toBe("approved|true");

  // Back on the child's page: 20 left.
  await goto(page, `/pocket-money?child=${childId}`);
  await expect(page.getByTestId("points-balance")).toContainText("20", { timeout: 30_000 });
  await expect(page.getByTestId("points-balance")).not.toContainText("120");

  // The child's profile: the points to spend and the way to the rewards.
  await goto(page, "/");
  const dialog = page.getByRole("dialog");
  await openUntil(page.getByRole("button", { name: new RegExp(`^${childName} — `) }), dialog);
  const tile = dialog.getByTestId("profile-points");
  await expect(tile).toContainText("20");
  await expect(tile).toContainText(/Points to spend|Punkte zum Einlösen/);
  await expect(dialog.getByTestId("profile-rewards-link")).toHaveAttribute("href", `/pocket-money?child=${childId}`);
});
