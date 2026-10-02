import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createAdminClient } from "../src/lib/supabase/server";
import { familyHolidayRegion } from "../src/lib/family-time";
import { POST as createFamily } from "../src/app/api/session/create/route";
import { POST as importBackup } from "../src/app/api/import/route";

/**
 * RFC-014 §4.2 end to end: the two routes that make a family, called in
 * process against a real database, leave the `holiday_region` row the
 * every-boot backfill must not overwrite. holiday-region.spec.ts covers the
 * same logic with fakes; this proves the rows land.
 *
 * Needs a stack: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or
 * NEXT_PUBLIC_SUPABASE_URL), e.g. Kong on :8130 here. Skipped without them,
 * unless FAMILY_CODE says a stack is there. Every family it makes is deleted
 * again (devices and settings cascade), including the device row
 * `e2e-claude-holiday-region`, and also after a failed assertion: each id is
 * noted before the status is checked, and families are swept by name too.
 */

const HAS_STACK = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
test.skip(!HAS_STACK && !process.env.FAMILY_CODE, "needs SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL for a running stack");
test.describe.configure({ mode: "serial" });

const HARDWARE_ID = "e2e-claude-holiday-region";
const made: string[] = [];
let db: any;

test.beforeAll(() => {
  db = createAdminClient();
});

// Whatever happened in the tests: by id for every family a route answered
// with, and by name for one a route made before failing (a 500 that still
// created it has no id to push).
test.afterAll(async () => {
  try {
    if (made.length) await db.from("families").delete().in("id", made);
    await db.from("families").delete().like("name", "claude-holiday-region%");
  } finally {
    await db.from("devices").delete().eq("hardware_id", HARDWARE_ID);
  }
});

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.99.${Math.floor(Math.random() * 250)}.1` },
  });
}

test("a family made by /api/session/create has no region, explicitly", async () => {
  const res = await createFamily(
    post("/api/session/create", { familyName: "claude-holiday-region-create", deviceName: "claude-holiday-region", hardwareId: HARDWARE_ID }),
  );
  const json = await res.json();
  if (json.family?.id) made.push(json.family.id);
  expect(res.status, JSON.stringify(json)).toBe(200);

  expect(await familyHolidayRegion(json.family.id, db)).toEqual({ code: null, chosen: false });
});

async function restore(settings: unknown[]): Promise<string> {
  const oldFamily = randomUUID();
  const res = await importBackup(
    post("/api/import", {
      format: "kinboard-export",
      version: 2,
      family: { id: oldFamily, name: "claude-holiday-region-import" },
      data: { settings: settings.map((row) => ({ id: randomUUID(), family_id: oldFamily, ...(row as object) })) },
    }),
  );
  const json = await res.json();
  if (json.family_id) made.push(json.family_id);
  expect(res.status, JSON.stringify(json)).toBe(200);
  return json.family_id;
}

test("a restored pre-RFC-014 backup gets the region its holiday_country meant, and keeps holiday_country", async () => {
  const family = await restore([{ key: "holiday_country", value: "uk" }]);
  expect(await familyHolidayRegion(family, db)).toEqual({ code: "GB-ENG", chosen: false });
  const { data } = await db.from("settings").select("value").eq("family_id", family).eq("key", "holiday_country").single();
  expect(data.value).toBe("uk");
});

test("a restored backup with no holiday setting at all gets Niedersachsen, as it had", async () => {
  expect(await familyHolidayRegion(await restore([]), db)).toEqual({ code: "DE-NI", chosen: false });
});

test("a restored backup that already has a region keeps it", async () => {
  const family = await restore([
    { key: "holiday_country", value: "uk" },
    { key: "holiday_region", value: { code: "AT-9", chosen: true } },
  ]);
  expect(await familyHolidayRegion(family, db)).toEqual({ code: "AT-9", chosen: true });
});
