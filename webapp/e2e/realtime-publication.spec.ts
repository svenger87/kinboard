import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { codeOnly } from "./source-helpers";

/**
 * Every table the app subscribes to must be in the realtime publication.
 *
 * A subscription to a table Postgres does not publish is not an error. The
 * channel opens, the callback is registered, and nothing ever arrives — so the
 * feature simply does not update on other screens, and only on the machine
 * where somebody once ran the ALTER by hand does it look fine. That is exactly
 * how `timers` shipped: added to `ALL_TABLES` and to the handler, absent from
 * `supabase_realtime`, working locally and dead everywhere else.
 *
 * This reads source rather than a database on purpose. It costs no stack, and
 * the thing that is actually wrong in that failure mode is the migration.
 */

const DOCKER = join(__dirname, "..", "docker");

function subscribedTables(): string[] {
  const src = codeOnly(readFileSync(join(__dirname, "..", "src/hooks/use-realtime.ts"), "utf8"));
  const block = /const ALL_TABLES: TableName\[\] = \[([\s\S]*?)\]/.exec(src);
  if (!block) throw new Error("could not find ALL_TABLES in use-realtime.ts");
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

function publishedTables(): Set<string> {
  const published = new Set<string>();
  for (const file of readdirSync(DOCKER).filter((f) => f.endsWith(".sql"))) {
    const sql = codeOnly(readFileSync(join(DOCKER, file), "utf8"), { sql: true });
    for (const m of sql.matchAll(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+(?:public\.)?([a-z_]+)/gi)) {
      published.add(m[1]);
    }
  }
  return published;
}

test("every realtime subscription has a table in the publication", () => {
  const subscribed = subscribedTables();
  // Guard the guard: a regex that stopped matching would make this vacuous.
  expect(subscribed.length).toBeGreaterThan(10);

  const published = publishedTables();
  expect(published.size).toBeGreaterThan(10);

  expect(subscribed.filter((t) => !published.has(t))).toEqual([]);
});

/**
 * What the pocket-money and rewards screens show is written by the server
 * only (#361), often for another screen: an assistant's booking a parent
 * allowed on the wall, a reward decided on the kitchen display, the
 * allowance run. Without realtime on these tables a phone kept showing the
 * old balance until it happened to refetch (2026-10-08). Named here, so that
 * dropping a table from both ALL_TABLES and the migration — which the test
 * above would let through — is caught as well.
 */
const SERVER_WRITTEN_FAMILY_MONEY = [
  "pocket_money_accounts",
  "pocket_money_transactions",
  "pocket_money_goals",
  "pocket_money_withdrawal_requests",
  "point_rewards",
  "point_redemptions",
  "point_purchases",
  "creatures",
];

test("pocket money and rewards are subscribed to and published", () => {
  const subscribed = new Set(subscribedTables());
  const published = publishedTables();
  expect(SERVER_WRITTEN_FAMILY_MONEY.filter((t) => !subscribed.has(t))).toEqual([]);
  expect(SERVER_WRITTEN_FAMILY_MONEY.filter((t) => !published.has(t))).toEqual([]);
});

test("the pocket-money publication sorts after every file that creates those tables, in byte order and under en_US", () => {
  const publishing = "migration_zzzzzzz_pocket_money_realtime.sql";
  const creating = readdirSync(DOCKER)
    .filter((f) => /^migration.*\.sql$/.test(f) && f !== publishing)
    .filter((f) => /CREATE TABLE(?: IF NOT EXISTS)? (?:public\.)?pocket_money_/i.test(codeOnly(readFileSync(join(DOCKER, f), "utf8"), { sql: true })));
  // Guard the guard: the tables are created somewhere.
  expect(creating.length).toBeGreaterThan(0);
  for (const order of [undefined, new Intl.Collator("en-US").compare]) {
    const sorted = [...creating, publishing].sort(order);
    expect(sorted.at(-1)).toBe(publishing);
  }
});
