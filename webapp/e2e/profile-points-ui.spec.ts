import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import { establishSession } from "./session";
import { acquireWholeDatabase, dbContainer, releaseWholeDatabase } from "./whole-database";

/**
 * A child's profile on the dashboard shows the points they have collected
 * (discussion #349), and a child without any points business shows no tile.
 * Needs FAMILY_CODE and a running stack.
 */
const familyCode = process.env.FAMILY_CODE;
test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
test.describe.configure({ mode: "serial" });
const DEVICE = "profile-points-ui";
const TITLE = "Profile points check";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

let familyId = "";
let created: string[] = [];
test.beforeEach(async () => {
  await acquireWholeDatabase();
  familyId = psql(`SELECT id FROM families WHERE join_code = '${familyCode}'`);
});
test.afterEach(() => {
  try {
    for (const id of created) {
      psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
            DELETE FROM todo_point_awards WHERE todo_id = '${id}';
            DELETE FROM todo_events WHERE todo_id = '${id}'; DELETE FROM todos WHERE id = '${id}';`);
    }
    created = [];
  } finally {
    releaseWholeDatabase();
  }
});
test.afterAll(async () => {
  await acquireWholeDatabase();
  try {
    psql(`DELETE FROM devices WHERE hardware_id LIKE 'e2e-${DEVICE}%'`);
  } finally {
    releaseWholeDatabase();
  }
});

async function openProfile(page: Page, name: string): Promise<Locator> {
  const opener = page.getByRole("button", { name: new RegExp(`^${name} — `) });
  const dialog = page.getByRole("dialog");
  await expect(opener).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    if (!(await dialog.isVisible())) await opener.click({ timeout: 2_000 });
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return dialog;
}

test("a child's profile shows the points the tasks page counts", async ({ page }) => {
  const children = psql(`SELECT id || '|' || name FROM people
    WHERE family_id = '${familyId}' AND is_child AND deleted_at IS NULL ORDER BY created_at LIMIT 2`)
    .split("\n").filter(Boolean).map((row) => row.split("|"));
  expect(children.length, "the family has two children").toBe(2);
  const [[kidId, kidName], [otherId, otherName]] = children;
  const otherHasPoints = psql(`SELECT EXISTS (SELECT 1 FROM todo_point_awards WHERE person_id = '${otherId}')
    OR EXISTS (SELECT 1 FROM todos WHERE family_id = '${familyId}' AND points > 0 AND deleted_at IS NULL
      AND (person_id = '${otherId}' OR '${otherId}' = ANY(COALESCE(rotation_person_ids, '{}'))))`);
  test.skip(otherHasPoints === "t", `${otherName} already has points business`);

  // Two of the child's tasks are ticked off -- the database awards them -- and
  // a third is still open, which earns nothing yet.
  for (const points of [7, 5, 30]) {
    created.push(psql(`INSERT INTO todos (family_id, title, person_id, points)
      VALUES ('${familyId}', '${TITLE} ${points}', '${kidId}', ${points}) RETURNING id`));
  }
  psql(`UPDATE todos SET completed = true WHERE id IN ('${created[0]}', '${created[1]}')`);
  const total = psql(`SELECT COALESCE(sum(points), 0) FROM todo_point_awards WHERE person_id = '${kidId}'`);
  expect(Number(total)).toBeGreaterThanOrEqual(12);

  await establishSession(page, familyCode!, DEVICE);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const dialog = await openProfile(page, kidName);
  const tile = dialog.getByTestId("profile-points");
  await expect(tile).toBeVisible();
  await expect(tile).toContainText(total);
  await expect(tile).toContainText(/Points|Punkte/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const other = await openProfile(page, otherName);
  await expect(other.getByText(otherName).first()).toBeVisible();
  await expect(other.getByTestId("profile-points")).toHaveCount(0);
});
