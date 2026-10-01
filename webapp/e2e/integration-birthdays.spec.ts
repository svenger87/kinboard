import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createBirthday,
  deleteBirthday,
  describeBirthday,
  listBirthdays,
  parseBirthdayDate,
  parseBirthdayFields,
  updateBirthday,
  type BirthdayDb,
} from "../src/lib/integration-birthdays";
import { hasBirthYear, parseBirthdayDate as appParse, getDaysUntilBirthday } from "../src/lib/birthday";
import { codeOnly } from "./source-helpers";

/**
 * RFC-012 task 7: GET/POST /birthdays and PATCH/DELETE /birthdays/{id}.
 *
 * The fake client applies the `.eq`/`.is` filters it is given and models the
 * soft-delete trigger (a DELETE of a live row stamps deleted_at and returns
 * nothing; a DELETE of a binned row purges it), so a query that forgets
 * `family_id` or `deleted_at` really does reach the foreign or binned row.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const MIA = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const BINNED_PERSON = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002";
const OTHER_CHILD = "bbbbbbbb-bbbb-bbbb-bbbb-000000000001";
const B_OMA = "cccccccc-cccc-cccc-cccc-000000000001";
const B_MIA = "cccccccc-cccc-cccc-cccc-000000000002";
const B_BINNED = "cccccccc-cccc-cccc-cccc-000000000003";
const B_FOREIGN = "cccccccc-cccc-cccc-cccc-000000000004";
const B_NOYEAR = "cccccccc-cccc-cccc-cccc-000000000005";
const NOWHERE = "dddddddd-dddd-dddd-dddd-000000000001";

const TODAY = "2026-10-01";

type Row = Record<string, unknown>;
type Filter = [column: string, value: unknown];

function fakeDb(opts: { beforeDelete?: (tables: Record<string, Row[]>) => void } = {}) {
  const tables: Record<string, Row[]> = {
    people: [
      { id: MIA, family_id: OURS, deleted_at: null },
      { id: BINNED_PERSON, family_id: OURS, deleted_at: "2026-09-30T10:00:00Z" },
      { id: OTHER_CHILD, family_id: THEIRS, deleted_at: null },
    ],
    birthdays: [
      { id: B_OMA, family_id: OURS, name: "Oma", date: "1950-12-24", person_id: null, notify_days_before: 14, deleted_at: null },
      { id: B_MIA, family_id: OURS, name: "Mia", date: "2018-10-03", person_id: MIA, notify_days_before: 7, deleted_at: null },
      { id: B_BINNED, family_id: OURS, name: "Binned", date: "1990-10-02", person_id: null, notify_days_before: 7, deleted_at: "2026-09-30T10:00:00Z" },
      { id: B_FOREIGN, family_id: THEIRS, name: "Foreign", date: "1980-10-01", person_id: null, notify_days_before: 7, deleted_at: null },
      { id: B_NOYEAR, family_id: OURS, name: "Nils", date: "2026-11-05", person_id: null, notify_days_before: null, deleted_at: null },
    ],
  };
  const deletes: { filters: Filter[] }[] = [];
  const matches = (filters: Filter[]) => (row: Row) => filters.every(([c, v]) => (row[c] ?? null) === v);
  const pick = (row: Row) => {
    const { family_id: _f, deleted_at: _d, ...rest } = row;
    return rest;
  };

  const db = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: Filter[] = [];
      let mode: "select" | "update" | "delete" = "select";
      let patch: Row = {};
      const run = () => {
        const hit = rows.filter(matches(filters));
        if (mode === "update") {
          for (const r of hit) Object.assign(r, patch);
          return hit.map(pick);
        }
        if (mode === "delete") {
          deletes.push({ filters: [...filters] });
          opts.beforeDelete?.(tables);
          for (const r of rows.filter(matches(filters))) {
            if (r.deleted_at === null) r.deleted_at = "2026-10-01T12:00:00Z"; // the trigger: bin, return NULL
            else rows.splice(rows.indexOf(r), 1); // already binned: a real purge
          }
          return [];
        }
        return hit.map(pick);
      };
      const chain = {
        select() { return chain; },
        limit() { return chain; },
        eq(column: string, value: unknown) { filters.push([column, value]); return chain; },
        is(column: string, value: unknown) { filters.push([column, value]); return chain; },
        update(p: Row) { mode = "update"; patch = p; return chain; },
        delete() { mode = "delete"; return chain; },
        async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
        then(resolve: (v: unknown) => void) { resolve({ data: run(), error: null }); },
        insert(row: Row) {
          const stored = { id: `bday-${rows.length + 1}`, deleted_at: null, ...row };
          rows.push(stored);
          return { select: () => ({ single: async () => ({ data: pick(stored), error: null }) }) };
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as BirthdayDb, tables, deletes };
}

const row = (date: string, extra: Row = {}) =>
  ({ id: B_OMA, name: "X", date, person_id: null, notify_days_before: 7, ...extra }) as Parameters<typeof describeBirthday>[0];

test.describe("next occurrence and age", () => {
  test("today counts, and tomorrow is one day away", () => {
    expect(describeBirthday(row("1985-10-01"), TODAY)).toMatchObject({ next_date: "2026-10-01", days_until: 0, age: 41, turns: 41 });
    expect(describeBirthday(row("1985-10-02"), TODAY)).toMatchObject({ next_date: "2026-10-02", days_until: 1, age: 40, turns: 41 });
    expect(describeBirthday(row("1985-09-30"), TODAY)).toMatchObject({ next_date: "2027-09-30", days_until: 364, age: 41, turns: 42 });
  });

  test("29 February falls on 1 March in a year without one, and the age turns that day", () => {
    expect(describeBirthday(row("2000-02-29"), "2026-02-28")).toMatchObject({ next_date: "2026-03-01", days_until: 1, age: 25, turns: 26 });
    expect(describeBirthday(row("2000-02-29"), "2026-03-01")).toMatchObject({ next_date: "2026-03-01", days_until: 0, age: 26, turns: 26 });
    expect(describeBirthday(row("2000-02-29"), "2027-12-01")).toMatchObject({ next_date: "2028-02-29", age: 27, turns: 28 });
  });

  test("days_until agrees with the birthdays page's own arithmetic", () => {
    for (const date of ["1985-10-01", "1985-12-24", "2000-02-29", "1990-01-01", "1970-09-30"]) {
      for (const today of ["2026-10-01", "2026-02-28", "2027-03-01", "2028-02-28", "2026-12-31"]) {
        const now = new Date(`${today}T09:00:00`);
        expect(describeBirthday(row(date), today).days_until, `${date} @ ${today}`).toBe(getDaysUntilBirthday(appParse(date), now));
      }
    }
  });

  test("a stored year that is not before this one means no year, as hasBirthYear says", () => {
    const b = describeBirthday(row("2026-11-05"), TODAY);
    expect(b).toMatchObject({ date: "--11-05", year_known: false, age: null, turns: null, next_date: "2026-11-05", days_until: 35 });
    expect(hasBirthYear(appParse("2026-11-05"), new Date("2026-10-01T12:00:00"))).toBe(false);
    expect(describeBirthday(row("2025-11-05"), TODAY)).toMatchObject({ date: "2025-11-05", year_known: true, age: 0, turns: 1 });
  });

  test("a null notify_days_before reads as the column's default, 7", () => {
    expect(describeBirthday(row("1985-10-01", { notify_days_before: null }), TODAY).notify_days_before).toBe(7);
  });
});

test.describe("the date a caller sends", () => {
  test("YYYY-MM-DD is stored as is; --MM-DD with the family's current year, as the form stores a blank year", () => {
    expect(parseBirthdayDate("1985-03-07", TODAY)).toEqual({ ok: true, value: "1985-03-07" });
    expect(parseBirthdayDate("--03-07", TODAY)).toEqual({ ok: true, value: "2026-03-07" });
    expect(parseBirthdayDate("--03-07", "2027-01-01")).toEqual({ ok: true, value: "2027-03-07" });
  });

  test("29 February needs a real leap year, or a leap current year when there is no year", () => {
    expect(parseBirthdayDate("2000-02-29", TODAY).ok).toBe(true);
    expect(parseBirthdayDate("1900-02-29", TODAY).ok).toBe(false);
    expect(parseBirthdayDate("2001-02-29", TODAY).ok).toBe(false);
    const yearless = parseBirthdayDate("--02-29", TODAY);
    expect(yearless.ok).toBe(false);
    if (!yearless.ok) expect(yearless.error).toContain("29 February needs a birth year");
    expect(parseBirthdayDate("--02-29", "2028-05-01")).toEqual({ ok: true, value: "2028-02-29" });
  });

  test("the year is from 1900 to this year; the date must exist; anything else is refused", () => {
    expect(parseBirthdayDate("1900-01-01", TODAY).ok).toBe(true);
    expect(parseBirthdayDate("2025-12-31", TODAY).ok).toBe(true);
    for (const bad of ["1899-12-31", "2027-01-01", "1985-13-01", "1985-00-10", "1985-04-31", "1985-04-00", "--13-01", "--04-31",
      "1985-4-7", "85-04-07", "1985-04-07T00:00:00Z", "-04-07", "", null, 19850407, undefined]) {
      expect(parseBirthdayDate(bad, TODAY).ok, String(bad)).toBe(false);
    }
  });

  test("a birth year of this year is refused, pointing at --MM-DD; a later one is in the future", () => {
    const thisYear = parseBirthdayDate("2026-03-14", TODAY);
    expect(thisYear.ok).toBe(false);
    if (!thisYear.ok) expect(thisYear.error).toContain("--03-14");
    expect(parseBirthdayDate("2026-12-25", TODAY).ok).toBe(false);
    const future = parseBirthdayDate("2027-01-01", TODAY);
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toContain("future");
    expect(parseBirthdayDate("--03-14", TODAY)).toEqual({ ok: true, value: "2026-03-14" });
  });

  test("name is trimmed and 1..100 characters; notify_days_before a whole number 0..60", () => {
    expect(parseBirthdayFields({ name: "  Oma  " }, TODAY)).toEqual({ ok: true, value: { name: "Oma" } });
    expect(parseBirthdayFields({ name: "x".repeat(100) }, TODAY).ok).toBe(true);
    for (const name of ["", "   ", "x".repeat(101), null, 5]) expect(parseBirthdayFields({ name }, TODAY).ok, String(name)).toBe(false);
    for (const n of [0, 1, 60]) expect(parseBirthdayFields({ notify_days_before: n }, TODAY)).toEqual({ ok: true, value: { notify_days_before: n } });
    for (const n of [-1, 61, 2.5, "7", null]) expect(parseBirthdayFields({ notify_days_before: n }, TODAY).ok, String(n)).toBe(false);
  });
});

test.describe("GET /birthdays", () => {
  test("only this family's, never the binned one, next first", async () => {
    const { db } = fakeDb();
    const list = await listBirthdays(OURS, TODAY, db);
    expect(list.map((b) => b.name)).toEqual(["Mia", "Nils", "Oma"]);
    expect(list[0]).toMatchObject({ id: B_MIA, date: "2018-10-03", days_until: 2, age: 7, turns: 8, person_id: MIA });
    expect(list[1]).toMatchObject({ date: "--11-05", year_known: false, age: null, notify_days_before: 7 });
  });
});

test.describe("POST /birthdays", () => {
  test("stores what the form stores and answers with the birthday", async () => {
    const { db, tables } = fakeDb();
    const result = await createBirthday(OURS, { name: " Opa ", date: "--06-15", person_id: MIA, notify_days_before: 3 }, TODAY, db);
    expect(result.status).toBe(201);
    expect(result.response.birthday).toMatchObject({ name: "Opa", date: "--06-15", year_known: false, person_id: MIA, notify_days_before: 3 });
    expect(tables.birthdays.at(-1)).toMatchObject({ family_id: OURS, name: "Opa", date: "2026-06-15", person_id: MIA, notify_days_before: 3 });
  });

  test("notify_days_before defaults to 7 and person_id to nobody", async () => {
    const { db, tables } = fakeDb();
    await createBirthday(OURS, { name: "Opa", date: "1950-06-15" }, TODAY, db);
    expect(tables.birthdays.at(-1)).toMatchObject({ notify_days_before: 7, person_id: null });
  });

  test("a person of another family, a binned one or a made-up one is refused, and nothing is written", async () => {
    for (const person_id of [OTHER_CHILD, BINNED_PERSON, NOWHERE, "not-a-uuid", 5]) {
      const { db, tables } = fakeDb();
      const before = tables.birthdays.length;
      const result = await createBirthday(OURS, { name: "Opa", date: "1950-06-15", person_id }, TODAY, db);
      expect(result.status, String(person_id)).toBe(400);
      expect(tables.birthdays.length).toBe(before);
    }
  });

  test("name and date are required; a bad field writes nothing", async () => {
    for (const body of [{ date: "1950-06-15" }, { name: "Opa" }, { name: "Opa", date: "--02-29" }, { name: "Opa", date: "1950-06-15", notify_days_before: 90 }]) {
      const { db, tables } = fakeDb();
      const before = tables.birthdays.length;
      expect((await createBirthday(OURS, body, TODAY, db)).status, JSON.stringify(body)).toBe(400);
      expect(tables.birthdays.length).toBe(before);
    }
  });
});

test.describe("PATCH /birthdays/{id}", () => {
  test("changes only the fields sent", async () => {
    const { db, tables } = fakeDb();
    const result = await updateBirthday(OURS, B_OMA, { notify_days_before: 0, person_id: MIA }, TODAY, db);
    expect(result.status).toBe(200);
    expect(tables.birthdays.find((b) => b.id === B_OMA)).toMatchObject({ name: "Oma", date: "1950-12-24", notify_days_before: 0, person_id: MIA });
    await updateBirthday(OURS, B_OMA, { person_id: null, date: "--12-25" }, TODAY, db);
    expect(tables.birthdays.find((b) => b.id === B_OMA)).toMatchObject({ date: "2026-12-25", person_id: null });
  });

  test("another family's, a binned or a missing birthday is 404 and unchanged", async () => {
    const { db, tables } = fakeDb();
    for (const id of [B_FOREIGN, B_BINNED, NOWHERE, "nope"]) {
      expect((await updateBirthday(OURS, id, { name: "Hacked" }, TODAY, db)).status, id).toBe(404);
    }
    expect(tables.birthdays.filter((b) => b.name === "Hacked")).toEqual([]);
  });

  test("a person of another family is refused", async () => {
    const { db, tables } = fakeDb();
    expect((await updateBirthday(OURS, B_OMA, { person_id: OTHER_CHILD }, TODAY, db)).status).toBe(400);
    expect(tables.birthdays.find((b) => b.id === B_OMA)?.person_id).toBeNull();
  });

  test("an empty patch is 400", async () => {
    const { db } = fakeDb();
    expect((await updateBirthday(OURS, B_OMA, {}, TODAY, db)).status).toBe(400);
  });
});

test.describe("DELETE /birthdays/{id}", () => {
  test("moves it to the recycle bin rather than erasing it", async () => {
    const { db, tables } = fakeDb();
    expect(await deleteBirthday(OURS, B_OMA, db)).toBe(true);
    expect(tables.birthdays.find((b) => b.id === B_OMA)?.deleted_at).not.toBeNull();
  });

  test("a second delete is 404, not a purge", async () => {
    const { db, tables } = fakeDb();
    expect(await deleteBirthday(OURS, B_OMA, db)).toBe(true);
    expect(await deleteBirthday(OURS, B_OMA, db)).toBe(false);
    expect(tables.birthdays.some((b) => b.id === B_OMA)).toBe(true);
  });

  test("another family's or a binned birthday is 404 and untouched", async () => {
    const { db, tables, deletes } = fakeDb();
    expect(await deleteBirthday(OURS, B_FOREIGN, db)).toBe(false);
    expect(await deleteBirthday(OURS, B_BINNED, db)).toBe(false);
    expect(await deleteBirthday(OURS, "nope", db)).toBe(false);
    expect(deletes).toEqual([]);
    expect(tables.birthdays.find((b) => b.id === B_FOREIGN)?.deleted_at).toBeNull();
    expect(tables.birthdays.some((b) => b.id === B_BINNED)).toBe(true);
  });

  test("the DELETE itself is scoped by family and deleted_at — a row binned in between is not purged", async () => {
    const { db, tables, deletes } = fakeDb({
      beforeDelete: (t) => { t.birthdays.find((b) => b.id === B_OMA)!.deleted_at = "2026-10-01T11:59:00Z"; },
    });
    await deleteBirthday(OURS, B_OMA, db);
    expect(tables.birthdays.some((b) => b.id === B_OMA)).toBe(true);
    expect(deletes[0].filters).toEqual(expect.arrayContaining([["family_id", OURS], ["deleted_at", null]]));
  });
});

test.describe("the routes", () => {
  const read = (...p: string[]) => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", ...p), "utf8"));

  test("take the family only from the token, and the right scopes", () => {
    const list = read("birthdays", "route.ts");
    const one = read("birthdays", "[id]", "route.ts");
    expect(list).toContain('withIntegrationAuth(request, "family:read"');
    expect(list).toContain('withIntegrationAuth(request, "birthdays:write"');
    expect(one.match(/withIntegrationAuth\(request, "birthdays:write"/g)).toHaveLength(2);
    for (const src of [list, one]) {
      // The client and every family filter live in the lib, which the tests
      // above hold; a route that made its own client would escape them.
      expect(src).not.toContain("createAdminClient");
      expect(src).not.toMatch(/body\.family_id|searchParams\.get\("family/);
      expect(src).toContain("context.familyId");
    }
  });

  test("POST requires an Idempotency-Key and remembers only successes", () => {
    const list = read("birthdays", "route.ts");
    expect(list).toContain("validateIdempotencyKey");
    expect(list).toContain("result.status < 400");
  });
});
