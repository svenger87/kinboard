import { test, expect, request as pwRequest, type APIRequestContext, type APIResponse, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { dbContainer } from "./whole-database";
import { postJoin } from "./session";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";

/**
 * Pocket money reaches every screen as it changes, on a running server, the
 * real database and the real realtime service.
 *
 * What happened on 2026-10-08: an assistant booked a €2.23 withdrawal, a
 * parent allowed it on the wall display with the PIN, the database had it
 * right (2623 → 2400 cents) — and the parent's phone showed the old balance
 * until it happened to refetch. None of the pocket_money_* tables was in the
 * supabase_realtime publication, and nothing subscribed to them.
 *
 * Here: a phone on the pocket-money page and a wall display on another page,
 * both joined to one family. An assistant asks for the same withdrawal, the
 * wall allows it with the PIN, and the phone must show the new balance within
 * seconds, without reloading. Also: the publication itself, that publishing
 * granted the browser roles nothing, and that a family's socket gets its own
 * rows and never another family's (realtime applies the tables' row-level
 * security as the subscriber).
 *
 * After the migration on a stack whose realtime was already running, restart
 * realtime first (`docker restart kinboard-realtime`, or the realtime container of
 * whatever compose project runs the stack): it reads
 * the publication when it starts.
 *
 * In two families of its own, `claude-pmrt` and `claude-pmrt-other`, created
 * here and removed afterwards with their tokens, devices, requests and
 * ledgers. Needs a running stack: FAMILY_CODE says there is one; the socket
 * test also needs SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (e2e.yml
 * exports both).
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const ID = (n: string) => `c1a0de00-0041-4000-8000-00000000${n}`;
const FAMILY = ID("f001");
const OTHER_FAMILY = ID("f002");
const MIRA = ID("f0a1");
const OTHER_CHILD = ID("f0a2");
const ACCOUNT = ID("f0b1");
const OTHER_ACCOUNT = ID("f0b2");
const JOIN_CODE = "CLAUDEPMRT";
const OTHER_JOIN_CODE = "CLAUDEPMRO";
const PIN = "6392";
const START_CENTS = 2623;
const POCKET_MONEY_TABLES = [
  "pocket_money_accounts",
  "pocket_money_goals",
  "pocket_money_transactions",
  "pocket_money_withdrawal_requests",
];

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  for (const fam of [FAMILY, OTHER_FAMILY]) {
    psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
      DELETE FROM messages WHERE family_id = '${fam}';
      DELETE FROM assistant_action_requests WHERE family_id = '${fam}';
      DELETE FROM scheduled_notifications WHERE family_id = '${fam}';
      DELETE FROM integration_idempotency WHERE family_id = '${fam}';
      DELETE FROM integration_tokens WHERE family_id = '${fam}';
      DELETE FROM integration_secrets WHERE family_id = '${fam}';
      DELETE FROM pocket_money_transactions WHERE account_id IN (SELECT id FROM pocket_money_accounts WHERE family_id = '${fam}');
      DELETE FROM pocket_money_accounts WHERE family_id = '${fam}';
      DELETE FROM devices WHERE family_id = '${fam}';
      DELETE FROM creatures WHERE family_id = '${fam}';
      DELETE FROM people WHERE family_id = '${fam}';
      DELETE FROM settings WHERE family_id = '${fam}';
      DELETE FROM families WHERE id = '${fam}';`);
  }
  psql(`DELETE FROM devices WHERE hardware_id LIKE 'claude-pmrt-%'`);
}

/** An assistant's token that may ask for bookings: not trusted, so a person must allow each one. */
function token(scopes = ["pocket_money:write"], family = FAMILY): string {
  const value = `kbi_${randomBytes(32).toString("base64url")}`;
  psql(`INSERT INTO integration_tokens (family_id, name, token_hash, scopes)
    VALUES ('${family}', 'claude-pmrt assistant', '${tokenHash(value)}', ARRAY[${scopes.map((x) => `'${x}'`).join(",")}])`);
  return value;
}

const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

const balance = (account = ACCOUNT) => Number(psql(`SELECT balance_cents FROM pocket_money_accounts WHERE id = '${account}'`));

let api: APIRequestContext;

const post = (path: string, bearer: string, data: unknown): Promise<APIResponse> =>
  api.post(`/api/integration/v1${path}`, { headers: { authorization: `Bearer ${bearer}`, "idempotency-key": randomUUID() }, data });

/** A browser page joined to the family as its own device, with both cookies AuthGuard needs. */
async function screenOn(browser: Browser, name: string, path: string, joinCode = JOIN_CODE): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const hardwareId = `claude-pmrt-${name}-${Date.now()}`;
  const joined = await postJoin(page.request, { joinCode, hardwareId, deviceName: hardwareId });
  expect(joined.ok(), await joined.text()).toBe(true);
  const data = await joined.json();
  await context.addCookies([{
    name: "family-calendar-storage",
    value: encodeURIComponent(JSON.stringify({ state: { family: data.family, device: data.device }, version: 0 })),
    url: BASE,
  }]);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  return page;
}

test.beforeAll(async () => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES
      ('${FAMILY}', 'claude-pmrt', '${JOIN_CODE}', true),
      ('${OTHER_FAMILY}', 'claude-pmrt-other', '${OTHER_JOIN_CODE}', true);
    INSERT INTO settings (family_id, key, value) VALUES ('${FAMILY}', 'locale', '"en"'::jsonb), ('${OTHER_FAMILY}', 'locale', '"en"'::jsonb);
    INSERT INTO people (id, family_id, name, is_child, color) VALUES
      ('${MIRA}', '${FAMILY}', 'claude-Mira', true, '#56B6E8'),
      ('${OTHER_CHILD}', '${OTHER_FAMILY}', 'claude-Other', true, '#56E88E');
    INSERT INTO pocket_money_accounts (id, family_id, person_id, balance_cents, currency) VALUES
      ('${ACCOUNT}', '${FAMILY}', '${MIRA}', ${START_CENTS}, 'EUR'),
      ('${OTHER_ACCOUNT}', '${OTHER_FAMILY}', '${OTHER_CHILD}', 500, 'EUR');
    INSERT INTO creatures (person_id, family_id, species, style, enabled) VALUES
      ('${MIRA}', '${FAMILY}', 'dragon', 'gumdrop', true),
      ('${OTHER_CHILD}', '${OTHER_FAMILY}', 'cat', 'gumdrop', true);`);
  api = await pwRequest.newContext({ baseURL: BASE });
  // The family's PIN, set from a screen of its own.
  const setter = await pwRequest.newContext({ baseURL: BASE });
  try {
    const joined = await postJoin(setter, { joinCode: JOIN_CODE, hardwareId: "claude-pmrt-setter", deviceName: "claude-pmrt-setter" });
    expect(joined.status(), await joined.text()).toBe(200);
    expect((await setter.post("/api/pin", { data: { family_id: FAMILY, action: "set", pin: PIN } })).status()).toBe(200);
  } finally {
    await setter.dispose();
  }
});

test.afterAll(async () => {
  await api?.dispose();
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id IN ('${FAMILY}', '${OTHER_FAMILY}')`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE 'claude-pmrt-%'`)).toBe("0");
});

test("the four pocket-money tables are published, and the browser roles still only read them", () => {
  expect(psql(`SELECT string_agg(tablename, ' ' ORDER BY tablename) FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename LIKE 'pocket\\_money\\_%'`))
    .toBe(POCKET_MONEY_TABLES.join(" "));
  // Publishing is not granting: SELECT, as before, and no write.
  // has_table_privilege, not information_schema: it sees grants made by any role.
  const held = psql(`SELECT string_agg(t || ':' || r || ':' || p, ' ' ORDER BY t, r, p)
    FROM unnest(ARRAY['${POCKET_MONEY_TABLES.join("','")}']) t,
         unnest(ARRAY['anon', 'authenticated']) r,
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
    WHERE has_table_privilege(r, 'public.' || t, p)`);
  expect(held).toBe(POCKET_MONEY_TABLES.flatMap((t) => [`${t}:anon:SELECT`, `${t}:authenticated:SELECT`]).join(" "));
});

test("a family's socket receives its own pocket-money rows and never another family's", async () => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(url && anon, "SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY").toBeTruthy();

  // Each family's own short-lived token, minted the way a screen gets one.
  const familyToken = async (joinCode: string, name: string) => {
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      const joined = await postJoin(ctx, { joinCode, hardwareId: `claude-pmrt-${name}`, deviceName: `claude-pmrt-${name}` });
      expect(joined.status(), await joined.text()).toBe(200);
      return ((await (await ctx.get("/api/session/token")).json()) as { token: string }).token;
    } finally {
      await ctx.dispose();
    }
  };
  const listen = async (bearer: string) => {
    const seen: { table: string; family_id?: unknown; account_id?: unknown; id?: unknown }[] = [];
    const client: SupabaseClient = createClient(url!, anon!, { accessToken: async () => bearer });
    // Before the channel joins: otherwise the join can go out with the anon
    // key, which carries no family, and RLS would filter every row away —
    // a red here that says nothing about the publication.
    await client.realtime.setAuth(bearer);
    const channel: RealtimeChannel = client.channel(`claude-pmrt-${randomUUID()}`);
    for (const table of POCKET_MONEY_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        const row = (payload.new ?? {}) as Record<string, unknown>;
        seen.push({ table, family_id: row.family_id, account_id: row.account_id, id: row.id });
      });
    }
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(err ?? new Error(status));
      });
    });
    return { seen, close: () => client.removeAllChannels() };
  };

  const mine = await listen(await familyToken(JOIN_CODE, "socket-mine"));
  const theirs = await listen(await familyToken(OTHER_JOIN_CODE, "socket-theirs"));
  try {
    // A booking in each family, through the booking function the server uses.
    const book = (family: string, account: string, cents: number) =>
      psql(`SELECT book_pocket_money('${family}', '${account}', ${cents}, 'manual_deposit', 'claude-pmrt')`);
    // A just-subscribed channel can miss the first change while realtime sets
    // it up, so book until it arrives rather than once and hope.
    await expect.poll(() => {
      book(FAMILY, ACCOUNT, 1);
      return mine.seen.some((s) => s.table === "pocket_money_accounts" && s.id === ACCOUNT);
    }, { timeout: 30_000, intervals: [2_000] }).toBe(true);
    await expect.poll(() => {
      book(OTHER_FAMILY, OTHER_ACCOUNT, 1);
      return theirs.seen.some((s) => s.table === "pocket_money_accounts" && s.id === OTHER_ACCOUNT);
    }, { timeout: 30_000, intervals: [2_000] }).toBe(true);
    // Let anything still in flight land before judging what each one got.
    await new Promise((r) => setTimeout(r, 2_000));

    expect(mine.seen.some((s) => s.table === "pocket_money_transactions" && s.account_id === ACCOUNT)).toBe(true);
    expect(mine.seen.filter((s) => s.id === OTHER_ACCOUNT || s.account_id === OTHER_ACCOUNT || s.family_id === OTHER_FAMILY)).toEqual([]);
    expect(theirs.seen.filter((s) => s.id === ACCOUNT || s.account_id === ACCOUNT || s.family_id === FAMILY)).toEqual([]);
  } finally {
    await mine.close();
    await theirs.close();
    psql(`DELETE FROM devices WHERE hardware_id IN ('claude-pmrt-socket-mine', 'claude-pmrt-socket-theirs')`);
  }
});

test("a withdrawal allowed on the wall shows on the phone within seconds, without a reload", async ({ browser }) => {
  test.setTimeout(240_000);
  psql(`DELETE FROM pocket_money_transactions WHERE account_id = '${ACCOUNT}';
    UPDATE pocket_money_accounts SET balance_cents = ${START_CENTS} WHERE id = '${ACCOUNT}';
    UPDATE assistant_action_requests SET status = 'expired' WHERE family_id = '${FAMILY}' AND status = 'pending'`);

  const phone = await screenOn(browser, "phone", "/pocket-money");
  const wall = await screenOn(browser, "wall", "/calendar");
  try {
    const shown = phone.getByText(/26[.,]23/).first();
    // A first compile of the page adds to it.
    await expect(shown).toBeVisible({ timeout: 90_000 });
    // The app replaces the URL once, about 2 s after a load (#378); WebKit
    // can take that late. Let both screens settle before anything else.
    await Promise.all([phone.waitForLoadState("load"), wall.waitForLoadState("load")]);
    await phone.waitForTimeout(2_500);
    // Survives only if the page is never reloaded.
    await phone.evaluate(() => { (window as unknown as { __claudePmrt: number }).__claudePmrt = 1; });

    // The assistant asks; nothing is booked yet.
    const assistant = token();
    const asked = await post("/pocket-money/bookings", assistant, { person_id: MIRA, amount: 2.23, type: "withdrawal", note: "claude-pmrt" });
    expect(asked.status(), await asked.text()).toBe(202);
    const requestId = (await asked.json()).request_id as string;
    expect(balance()).toBe(START_CENTS);

    // A parent allows it on the wall with the PIN.
    const card = wall.getByTestId("assistant-action-overlay").locator(`[data-assistant-action="${requestId}"]`);
    await expect(card).toBeVisible({ timeout: 90_000 });
    await card.locator(`#assistant-action-pin-${requestId}`).fill(PIN);
    const allow = [en, de, fr].map((m) => m.assistantActions.allow).join("|");
    await card.getByRole("button", { name: new RegExp(`^(${allow})$`) }).click();
    const outcome = () => `${balance()} ${psql(`SELECT concat_ws(' ', status, result::text) FROM assistant_action_requests WHERE id = '${requestId}'`)}`;
    await expect.poll(outcome, { timeout: 30_000 }).toMatch(new RegExp(`^${START_CENTS - 223} done`));
    // What the assistant hears back through get_action_status: booked, and no account data.
    const status = await (await api.get(`/api/integration/v1/actions/${requestId}`, { headers: { authorization: `Bearer ${assistant}` } })).json();
    expect(status.action).toMatchObject({ kind: "pocket_money", status: "done" });
    expect(status.action.result).toEqual({ status: 200, booked: true });

    // The phone follows on its own: no reload, no navigation, a few seconds.
    const booked = Date.now();
    await expect(phone.getByText(/24[.,]00/).first()).toBeVisible({ timeout: 8_000 });
    test.info().annotations.push({ type: "phone caught up after", description: `${Date.now() - booked} ms` });
    console.log(`[pmrt] phone caught up ${Date.now() - booked} ms after the booking was in the database`);
    await expect(phone.getByText(/26[.,]23/)).toHaveCount(0);
    expect(await phone.evaluate(() => (window as unknown as { __claudePmrt?: number }).__claudePmrt)).toBe(1);
    expect(new URL(phone.url()).pathname).toBe("/pocket-money");
  } finally {
    await phone.context().close();
    await wall.context().close();
  }
});

test("only the assistant that asked, holding the booking's own scope, can read a booking request", async () => {
  // A booking request holds a child's name, an amount and a note. It is the
  // asking token's own: not another assistant's in the family, not another
  // family's, and not a token that holds only home:control -- which may
  // follow its own device actions, but has no permission to read pocket money.
  const mine = token();
  const asked = await post("/pocket-money/bookings", mine, { person_id: MIRA, amount: 1.5, type: "deposit", note: "claude-pmrt access" });
  expect(asked.status(), await asked.text()).toBe(202);
  const id = (await asked.json()).request_id as string;
  const read = (bearer: string) => api.get(`/api/integration/v1/actions/${id}`, { headers: { authorization: `Bearer ${bearer}` } });

  const own = await read(mine);
  expect(own.status()).toBe(200);
  expect((await own.json()).action).toMatchObject({ kind: "pocket_money", status: "pending" });

  const nothing = await (await api.get(`/api/integration/v1/actions/${randomUUID()}`, { headers: { authorization: `Bearer ${mine}` } })).json();
  for (const [who, bearer] of [
    ["another assistant of the family", token()],
    ["another family's assistant", token(["pocket_money:write", "home:control"], OTHER_FAMILY)],
  ] as const) {
    const res = await read(bearer);
    expect(res.status(), who).toBe(404);
    expect(await res.json(), who).toEqual(nothing);
  }

  // The same token, left with home:control only: as if there were no such request.
  psql(`UPDATE integration_tokens SET scopes = ARRAY['home:control'] WHERE token_hash = '${tokenHash(mine)}'`);
  const narrowed = await read(mine);
  const body = await narrowed.text();
  expect(narrowed.status(), body).toBe(404);
  expect(body).not.toMatch(/claude-Mira|claude-pmrt access|1\.5/);
  expect(JSON.parse(body)).toEqual(nothing);
  psql(`UPDATE assistant_action_requests SET status = 'expired' WHERE id = '${id}'`);
});
