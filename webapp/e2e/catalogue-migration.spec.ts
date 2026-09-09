import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * The blob-to-table migration, against the real database.
 *
 * These cases decide whether somebody's house survives the upgrade. Each is
 * one seeded `settings.home_assistant` blob and the rows it must produce.
 *
 * Not a pure function test: the migration is SQL applied by the container
 * entrypoint (RFC-006 §3.1), and testing a re-implementation of it in
 * TypeScript would prove something no installation ever runs.
 */

function psql(sql: string): string {
  return execFileSync(
    "docker",
    // -q: this psql (15.14) prints the "INSERT 0 1" / "DELETE 3" command tag
    // on stdout after any RETURNING statement even with -tA, corrupting
    // makeFamily()'s single-line UUID. -q silences psql's own status
    // messages; it does not touch the SQL under test.
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

function applyMigration(): void {
  // -v ON_ERROR_STOP=1: without it, psql rolls a failed statement back and
  // still exits 0, so "clean no-op" and "loud rollback that wrote nothing"
  // are indistinguishable to a test that only reads rows back afterwards.
  // With it, a duplicate-key error becomes a non-zero exit, which
  // execFileSync throws on — the way a real second migration pass failing
  // would actually surface.
  execFileSync("bash", ["-c",
    `docker exec -i ${dbContainer()} psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q < webapp/docker/migration_catalogue_items.sql`],
    { cwd: process.cwd().replace(/\/webapp$/, ""), encoding: "utf8" });
}

/** A throwaway family, so seeding a blob cannot disturb the real one. */
function makeFamily(): string {
  return psql(
    // 8 random characters, not 3: join_code is unique, and a flaky test that
    // fails on a collision once a fortnight is worse than a longer string.
    `INSERT INTO families (name, join_code) VALUES ('catalogue-test', 'CAT' || upper(substr(md5(random()::text), 1, 8))) RETURNING id;`,
  );
}

function seedBlob(familyId: string, blob: object): void {
  const json = JSON.stringify(blob).replace(/'/g, "''");
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${familyId}', 'home_assistant', '${json}'::jsonb)
        ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value;`);
}

function rows(familyId: string): string[] {
  const out = psql(
    `SELECT entity_id || '|' || name || '|' || COALESCE(room,'-') || '|' || position
     FROM catalogue_items WHERE family_id = '${familyId}' ORDER BY position, entity_id;`,
  );
  return out ? out.split("\n") : [];
}

/*
  Same reason as rooms-migration.spec.ts: this file's `applyMigration()` walks
  every family in the database, including the throwaway families that spec is
  in the middle of seeding. See ./whole-database.ts.
*/
test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable, and no FAMILY_CODE promising a stack");

test.beforeEach(acquireWholeDatabase);
test.afterEach(releaseWholeDatabase);

const families: string[] = [];
test.afterAll(async () => {
  await acquireWholeDatabase();
  try {
    for (const id of families) psql(`DELETE FROM families WHERE id = '${id}';`);
  } finally {
    releaseWholeDatabase();
  }
});

function freshFamily(blob: object): string {
  const id = makeFamily();
  families.push(id);
  seedBlob(id, blob);
  applyMigration();
  return id;
}

test.describe("the blob migration", () => {
  test("a room entity keeps its name, or gets one from the entity id", () => {
    const id = freshFamily({
      rooms_config: {
        rooms: [
          {
            id: "room_1", name: "Kitchen", icon: "utensils", position: 0, created_at: "2026-01-01",
            entities: [
              { entity_id: "light.ceiling", display_name: "Ceiling", position: 0 },
              { entity_id: "light.under_cupboard", position: 1 },
            ],
          },
        ],
        show_unassigned: true,
      },
    });
    expect(rows(id)).toEqual([
      "light.ceiling|Ceiling|Kitchen|0",
      // No display_name: the entity id's own suffix, made readable.
      "light.under_cupboard|Under cupboard|Kitchen|1",
    ]);
  });

  test("an entity on a dashboard AND in a room is one row, and the room's name wins", () => {
    const id = freshFamily({
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Hall", icon: "home", position: 0, created_at: "2026-01-01",
          entities: [{ entity_id: "lock.front", display_name: "Front door", position: 0 }],
        }],
        show_unassigned: true,
      },
      dashboards: [{
        id: "d1", name: "Main", type: "custom", position: 0, created_at: "2026-01-01",
        cards: [{ id: "c1", entity_id: "lock.front", display_name: "FRONT DOOR LOCK", card_type: "lock", position: 0, size: "small" }],
      }],
    });
    expect(rows(id)).toEqual(["lock.front|Front door|Hall|0"]);
  });

  test("a dashboard-only entity lands after the room entries, not interleaved", () => {
    const id = freshFamily({
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Kitchen", icon: "utensils", position: 0, created_at: "2026-01-01",
          entities: [
            { entity_id: "light.a", display_name: "A", position: 0 },
            { entity_id: "light.b", display_name: "B", position: 1 },
          ],
        }],
        show_unassigned: true,
      },
      dashboards: [{
        id: "d1", name: "Main", type: "custom", position: 0, created_at: "2026-01-01",
        cards: [{ id: "c1", entity_id: "sensor.power", display_name: "Power", card_type: "sensor", position: 0, size: "small" }],
      }],
    });
    // Both card and room positions start at 0; appending rather than
    // interleaving is what stops them scrambling each other.
    expect(rows(id)).toEqual([
      "light.a|A|Kitchen|0",
      "light.b|B|Kitchen|1",
      "sensor.power|Power|-|2",
    ]);
  });

  test("a blob with no rooms_config, and one with no dashboards", () => {
    const noRooms = freshFamily({
      dashboards: [{
        id: "d1", name: "Main", type: "custom", position: 0, created_at: "2026-01-01",
        cards: [{ id: "c1", entity_id: "switch.kettle", display_name: "Kettle", card_type: "switch", position: 0, size: "small" }],
      }],
    });
    expect(rows(noRooms)).toEqual(["switch.kettle|Kettle|-|0"]);

    const noDashboards = freshFamily({
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Bath", icon: "bath", position: 0, created_at: "2026-01-01",
          entities: [{ entity_id: "light.mirror", display_name: "Mirror", position: 0 }],
        }],
        show_unassigned: true,
      },
    });
    expect(rows(noDashboards)).toEqual(["light.mirror|Mirror|Bath|0"]);
  });

  test("an empty blob, and a family with no settings row at all, produce nothing", () => {
    const empty = freshFamily({});
    expect(rows(empty)).toEqual([]);

    const none = makeFamily();
    families.push(none);
    applyMigration();
    expect(rows(none)).toEqual([]);
  });

  test("applying it twice changes nothing", () => {
    const id = freshFamily({
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Kitchen", icon: "utensils", position: 0, created_at: "2026-01-01",
          entities: [{ entity_id: "light.ceiling", display_name: "Ceiling", position: 0 }],
        }],
        show_unassigned: true,
      },
    });
    const first = rows(id);
    applyMigration();
    expect(rows(id)).toEqual(first);
  });

  test("the blob it read is left exactly as it was", () => {
    // RFC-006 §3.2: deleting a household's configuration in the same change
    // that migrates it leaves no way back when the migration is wrong.
    const id = freshFamily({
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Kitchen", icon: "utensils", position: 0, created_at: "2026-01-01",
          entities: [{ entity_id: "light.ceiling", display_name: "Ceiling", position: 0 }],
        }],
        show_unassigned: true,
      },
    });
    const stillThere = psql(
      `SELECT value #>> '{rooms_config,rooms,0,entities,0,entity_id}' FROM settings WHERE family_id='${id}' AND key='home_assistant';`,
    );
    expect(stillThere).toBe("light.ceiling");
  });

  test("a display_name over 120 characters is clamped to fit the column, not rejected", () => {
    // The old blob never enforced a length on display_name. Without the
    // clamp this violates catalogue_items' CHECK (char_length(name) BETWEEN
    // 1 AND 120) and aborts the whole INSERT ... SELECT.
    const id = freshFamily({
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Attic", icon: "home", position: 0, created_at: "2026-01-01",
          entities: [{ entity_id: "light.long_name", display_name: "L".repeat(200), position: 0 }],
        }],
        show_unassigned: true,
      },
    });
    const length = psql(
      `SELECT char_length(name) FROM catalogue_items WHERE family_id = '${id}' AND entity_id = 'light.long_name';`,
    );
    // The length, not just that a row exists: a silent truncation to the
    // wrong length would pass a mere "a row exists" check.
    expect(length).toBe("120");
  });

  test("an entity_id with no dot still gets a non-empty name", () => {
    // split_part(entity_id, '.', 2) on an id with no dot returns '' — with no
    // fallback past that, the derived name is empty, which also violates the
    // NOT NULL / length-1 CHECK and aborts the insert.
    const id = freshFamily({
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Garage", icon: "home", position: 0, created_at: "2026-01-01",
          entities: [{ entity_id: "nodothere", position: 0 }],
        }],
        show_unassigned: true,
      },
    });
    // No display_name and no dot to derive a suffix from: falls all the way
    // through to the raw entity_id, which the WHERE clause guarantees is
    // non-empty.
    expect(rows(id)).toEqual(["nodothere|nodothere|Garage|0"]);
  });

  test("a poisoned blob in one family does not stop a clean family's rows from being written", () => {
    // The property that matters: a single INSERT ... SELECT scans every
    // family's settings row in one statement, so one household's bad data
    // used to write zero rows for every other household migrated in the
    // same pass — and the container refuses to start until it's hand-fixed.
    // Both blobs are seeded before the one applyMigration() call below, so
    // they are genuinely processed together, not migrated one after another.
    const poisoned = makeFamily();
    families.push(poisoned);
    const clean = makeFamily();
    families.push(clean);

    seedBlob(poisoned, {
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Poisoned", icon: "home", position: 0, created_at: "2026-01-01",
          entities: [
            { entity_id: "light.also_long", display_name: "X".repeat(200), position: 0 },
            { entity_id: "nodothere", position: 1 },
          ],
        }],
        show_unassigned: true,
      },
    });
    seedBlob(clean, {
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Clean", icon: "home", position: 0, created_at: "2026-01-01",
          entities: [{ entity_id: "light.ceiling", display_name: "Ceiling", position: 0 }],
        }],
        show_unassigned: true,
      },
    });

    applyMigration();

    expect(rows(clean)).toEqual(["light.ceiling|Ceiling|Clean|0"]);
  });

  test("a null dashboards and a non-array rooms do not stop a clean family's rows from being written", () => {
    // "dashboards": null is valid JSON but not SQL NULL, so
    // COALESCE(x, '[]'::jsonb) does not catch it — jsonb_array_elements
    // receives a scalar and raises "cannot extract elements from a scalar".
    // Same failure shape for rooms_config.rooms holding an object instead of
    // an array. Either one aborts the whole INSERT ... SELECT, which scans
    // every family in one statement — so a single household on this shape
    // used to take the migration, and therefore the webapp container, down
    // for everyone on the install.
    const nullDashboards = makeFamily();
    families.push(nullDashboards);
    const nonArrayRooms = makeFamily();
    families.push(nonArrayRooms);
    const clean = makeFamily();
    families.push(clean);

    seedBlob(nullDashboards, {
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Poisoned", icon: "home", position: 0, created_at: "2026-01-01",
          entities: [{ entity_id: "light.also_poisoned", display_name: "Also poisoned", position: 0 }],
        }],
        show_unassigned: true,
      },
      dashboards: null,
    });
    seedBlob(nonArrayRooms, {
      rooms_config: { rooms: { not: "an array" }, show_unassigned: true },
    });
    seedBlob(clean, {
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Clean", icon: "home", position: 0, created_at: "2026-01-01",
          entities: [{ entity_id: "light.ceiling2", display_name: "Ceiling", position: 0 }],
        }],
        show_unassigned: true,
      },
    });

    applyMigration();

    // The poisoned families' own rooms rows still land — the guard turns the
    // bad value into an empty array for the *cards*/*dashboards* step, it
    // doesn't drop the family's other, valid data.
    expect(rows(nullDashboards)).toEqual(["light.also_poisoned|Also poisoned|Poisoned|0"]);
    expect(rows(nonArrayRooms)).toEqual([]);
    expect(rows(clean)).toEqual(["light.ceiling2|Ceiling|Clean|0"]);
  });

  test("a non-integer position does not stop a clean family's rows from being written", () => {
    // (e.value ->> 'position')::int raises on a float ("1.5") or a
    // non-numeric string ("first") — a cast error, but the same
    // whole-statement, every-family blast radius as the array-shape bugs
    // above, because it happens inside the same INSERT ... SELECT.
    const poisoned = makeFamily();
    families.push(poisoned);
    const clean = makeFamily();
    families.push(clean);

    seedBlob(poisoned, {
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Poisoned", icon: "home", position: 0, created_at: "2026-01-01",
          entities: [
            { entity_id: "light.float_pos", display_name: "Float position", position: 1.5 },
            { entity_id: "light.string_pos", display_name: "String position", position: "first" },
          ],
        }],
        show_unassigned: true,
      },
    });
    seedBlob(clean, {
      rooms_config: {
        rooms: [{
          id: "room_1", name: "Clean", icon: "home", position: 0, created_at: "2026-01-01",
          entities: [{ entity_id: "light.ceiling3", display_name: "Ceiling", position: 0 }],
        }],
        show_unassigned: true,
      },
    });

    applyMigration();

    // Both poisoned rows still land, falling back to position 0 rather than
    // being dropped or aborting the statement.
    expect(rows(poisoned)).toEqual([
      "light.float_pos|Float position|Poisoned|0",
      "light.string_pos|String position|Poisoned|0",
    ]);
    expect(rows(clean)).toEqual(["light.ceiling3|Ceiling|Clean|0"]);
  });
});
