import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * RFC-024 §8 on an install that is already in use: a family that finished
 * its setup long ago, on an install with other families, never sees the
 * first-run sequence. Not from /join, not from /setup typed by hand, and the
 * install's settings answer it with nothing.
 *
 * Needs FIRST_RUN_EXISTING=1 and a running stack (the dev stack will do):
 * it adds one `claude-firstrun-existing-*` family and removes it again.
 */

test.skip(process.env.FIRST_RUN_EXISTING !== "1", "needs FIRST_RUN_EXISTING=1: a running stack with families of its own");

const STAMP = Date.now().toString(36).toUpperCase().slice(-6).padStart(6, "X");
const CODE = `C${STAMP}`.slice(0, 6);
const NAME = `claude-firstrun-existing-${STAMP}`;

function psql(sql: string): string {
  return execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim();
}

test.beforeAll(() => {
  psql(`INSERT INTO families (name, join_code, setup_completed) VALUES ('${NAME}', '${CODE}', true)`);
});

test.afterAll(() => {
  // Retried: another session's DDL on a shared dev database can deadlock a delete.
  for (let attempt = 1; ; attempt++) {
    try {
      cleanup();
      return;
    } catch (err) {
      if (attempt >= 5) throw err;
    }
  }
});

function cleanup() {
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM devices WHERE family_id IN (SELECT id FROM families WHERE name = '${NAME}') OR hardware_id LIKE 'claude-firstrun-existing-%';
    DELETE FROM families WHERE name = '${NAME}';`);
}

test("an existing family never sees the first-run sequence", async ({ page, browserName }) => {
  test.setTimeout(300_000);
  const others = Number(psql(`SELECT count(*) FROM families WHERE name <> '${NAME}'`));
  expect(others, "an install already in use").toBeGreaterThan(0);

  await establishSession(page, CODE, `claude-firstrun-existing-${browserName}`);
  // The app replaces its own URL ~2 s after a load; WebKit's late one would
  // interrupt the next goto (#378).
  await page.waitForTimeout(3000);
  // The guard may move the page on by itself while the goto is in flight;
  // that is the behaviour under test, not a failure.
  await page.goto("/join", { waitUntil: "domcontentloaded" }).catch((err: Error) => {
    if (!/interrupted by another navigation/.test(err.message)) throw err;
  });
  await page.waitForURL((u) => !u.pathname.startsWith("/join"), { timeout: 120_000 });
  expect(new URL(page.url()).pathname).not.toMatch(/^\/setup/);

  const view = await page.evaluate(async () => (await fetch("/api/setup/instance")).json());
  expect(view, "not the operator of an install with other families").toEqual({ operator: false });

  await page.goto("/setup/install", { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => !u.pathname.match(/^\/setup\/?(install)?$/), { timeout: 120_000 });
  expect(new URL(page.url()).pathname).not.toMatch(/^\/setup\/(install|push)$/);
  await expect(page.getByTestId("wizard-progress")).toContainText(/of 7$/, { timeout: 60_000 });
});
