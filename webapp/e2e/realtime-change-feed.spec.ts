import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { codeOnly } from "./source-helpers";

/**
 * Every table the screens follow must announce its changes.
 *
 * Live updates come from a trigger on each table that NOTIFYs the change
 * (docker/migrations/084_change_feed.sql); the webapp streams it to the
 * family's screens (src/app/api/realtime/route.ts). A table in the hook's list
 * without the trigger is not an error anywhere. The stream opens, the handler
 * is registered, and nothing ever arrives — the feature simply does not update
 * on other screens. That is how `timers` once shipped under Supabase Realtime,
 * whose publication had the same failure mode; this replaces the guard on the
 * publication with one on the trigger.
 *
 * Reads source rather than a database on purpose: it costs no stack, and what
 * is wrong in that failure mode is the migration.
 */

const ROOT = join(__dirname, "..");
const MIGRATIONS = join(ROOT, "docker", "migrations");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const sqlOf = (file: string) => codeOnly(readFileSync(join(MIGRATIONS, file), "utf8"), { sql: true });
const migrationFiles = () => readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();

function subscribedTables(): string[] {
  const src = codeOnly(read("src", "hooks", "use-realtime.ts"));
  const block = /const ALL_TABLES: TableName\[\] = \[([\s\S]*?)\]/.exec(src);
  if (!block) throw new Error("could not find ALL_TABLES in use-realtime.ts");
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** The file that creates the trigger, and the tables it puts it on. */
function changeFeed(): { file: string; tables: Set<string>; sql: string } {
  const files = migrationFiles().filter((f) => /CREATE\s+TRIGGER\s+kinboard_change_feed\b/i.test(sqlOf(f)));
  expect(files, "exactly one migration creates the kinboard_change_feed trigger").toHaveLength(1);
  const sql = sqlOf(files[0]);
  // The table list of the loop that creates the trigger.
  const loop = /FOREACH\s+t\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]\s*LOOP[\s\S]*?kinboard_change_feed/i.exec(sql);
  if (!loop) throw new Error(`could not find the trigger's table list in ${files[0]}`);
  return { file: files[0], tables: new Set([...loop[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])), sql };
}

test("every table the screens follow has the change-feed trigger", () => {
  const subscribed = subscribedTables();
  // Guard the guard: a regex that stopped matching would make this vacuous.
  expect(subscribed.length).toBeGreaterThan(10);
  const { tables } = changeFeed();
  expect(tables.size).toBeGreaterThan(10);
  expect(subscribed.filter((t) => !tables.has(t))).toEqual([]);
});

/**
 * What the pocket-money and rewards screens show is written by the server
 * only (#361), often for another screen: an assistant's booking a parent
 * allowed on the wall, a reward decided on the kitchen display, the
 * allowance run. Named here, so that dropping a table from both ALL_TABLES and
 * the migration — which the test above would let through — is caught too.
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

test("pocket money and rewards are followed and announced", () => {
  const subscribed = new Set(subscribedTables());
  const { tables } = changeFeed();
  expect(SERVER_WRITTEN_FAMILY_MONEY.filter((t) => !subscribed.has(t))).toEqual([]);
  expect(SERVER_WRITTEN_FAMILY_MONEY.filter((t) => !tables.has(t))).toEqual([]);
});

test("the trigger migration sorts after every file that creates a followed table", () => {
  // The loop skips a table that does not exist yet (to_regclass), so on a
  // fresh database a table created by a later file would get no trigger, and
  // nothing would say so.
  const { file } = changeFeed();
  const late: string[] = [];
  let creators = 0;
  for (const table of subscribedTables()) {
    const create = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\b`, "i");
    for (const f of migrationFiles()) {
      if (f === file || !create.test(sqlOf(f))) continue;
      creators++;
      if (f > file) late.push(`${f} creates ${table}`);
    }
  }
  // Guard the guard: the tables are created somewhere.
  expect(creators).toBeGreaterThan(10);
  expect(late).toEqual([]);
});

test("the payload keeps what the handlers read from a change, and nothing wider", () => {
  const { sql } = changeFeed();
  const keepFor = (table: string) => {
    const m = new RegExp(`TG_TABLE_NAME\\s*=\\s*'${table}'\\s+THEN\\s+keep\\s*:=\\s*keep\\s*\\|\\|\\s*ARRAY\\[([\\s\\S]*?)\\]`, "i").exec(sql);
    expect(m, `a keep list for ${table}`).not.toBeNull();
    return new Set([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  };

  // todos: every field of TickRow and the TurnFields it extends — the
  // creature reaction compares the new row with the cached one.
  const fields = (src: string, name: string) => {
    const body = new RegExp(`export interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(codeOnly(src));
    expect(body, `interface ${name}`).not.toBeNull();
    return [...body![1].matchAll(/^\s*([a-z_]+)\??:/gm)].map((m) => m[1]);
  };
  const tick = [
    ...fields(read("src", "lib", "pocket-money", "creature-reactions.ts"), "TickRow"),
    ...fields(read("src", "lib", "todo-turns.ts"), "TurnFields"),
  ].filter((f) => f !== "id");
  expect(tick.length).toBeGreaterThan(10);
  const todos = keepFor("todos");
  expect(tick.filter((f) => !todos.has(f))).toEqual([]);

  expect([...keepFor("settings")]).toEqual(["key"]);
  expect([...keepFor("birthday_gift_ideas")]).toEqual(["birthday_id"]);
  expect([...keepFor("assistant_action_requests")]).toEqual(["status"]);

  // Nothing else is ever widened, and the row itself is never sent whole.
  expect(sql.match(/keep\s*:=\s*keep\s*\|\|/gi)).toHaveLength(4);
  expect(sql).toMatch(/keep\s+text\[\]\s*:=\s*ARRAY\['id'\]/i);
  expect(sql).not.toMatch(/'new',\s*new_row\b/i);
  expect(sql).not.toMatch(/'old',\s*old_row\b/i);
  // Under Postgres's 8000-byte NOTIFY limit, with a fallback when not.
  expect(sql).toMatch(/octet_length\(body\)\s*>\s*7000/i);
});

test("the stream is the session's family's, and the hook reads it", () => {
  const route = codeOnly(read("src", "app", "api", "realtime", "route.ts"));
  expect(route).toMatch(/requireSession\(request\)/);
  expect(route).toMatch(/subscribe\(familyId,/);
  expect(route).toMatch(/const \{ familyId \} = auth\.session/);
  // Never a family from the request.
  expect(route).not.toMatch(/searchParams|family_id/);
  expect(route).toMatch(/"text\/event-stream/);
  expect(route).toMatch(/"Cache-Control": "no-cache, no-transform"/);
  expect(route).toMatch(/"X-Accel-Buffering": "no"/);

  const hook = codeOnly(read("src", "hooks", "use-realtime.ts"));
  expect(hook).toMatch(/new EventSource\("\/api\/realtime"\)/);
  expect(hook).not.toMatch(/postgres_changes|\.channel\(/);
  // The realtime-only token option is gone from the browser client.
  expect(codeOnly(read("src", "lib", "supabase", "client.ts"))).not.toMatch(/accessToken:/);
});
