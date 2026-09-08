import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";

/**
 * Reconciling rooms out of the settings blob. RFC-007 §3.
 *
 * The cases here decide whether a household's rooms survive. Each is one
 * seeded blob plus a set of catalogue rows, and the rows it must produce.
 */

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "kbfresh-db", "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

function applyMigration(): void {
  execFileSync("bash", ["-c",
    "docker exec -i kbfresh-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < webapp/docker/migration_rooms.sql"],
    { cwd: process.cwd().replace(/\/webapp$/, ""), encoding: "utf8" });
}

const families: string[] = [];
function makeFamily(): string {
  const id = psql(
    `INSERT INTO families (name, join_code) VALUES ('rooms-test', 'RM' || upper(substr(md5(random()::text), 1, 8))) RETURNING id;`,
  );
  families.push(id);
  return id;
}
test.afterAll(() => {
  for (const id of families) psql(`DELETE FROM families WHERE id = '${id}';`);
});

function seedBlob(familyId: string, blob: object): void {
  const json = JSON.stringify(blob).replace(/'/g, "''");
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${familyId}','home_assistant','${json}'::jsonb)
        ON CONFLICT (family_id, key) DO UPDATE SET value = EXCLUDED.value;`);
}

function seedDevice(familyId: string, entityId: string, room: string | null): void {
  const roomSql = room === null ? "NULL" : `'${room.replace(/'/g, "''")}'`;
  psql(`INSERT INTO catalogue_items (family_id, kind, entity_id, name, room)
        VALUES ('${familyId}','ha_entity','${entityId}','${entityId}',${roomSql});`);
}

/** room name | icon | colour | position, in order. */
function rooms(familyId: string): string[] {
  const out = psql(
    `SELECT name || '|' || COALESCE(icon,'-') || '|' || COALESCE(color,'-') || '|' || position
     FROM rooms WHERE family_id='${familyId}' ORDER BY position, name;`,
  );
  return out ? out.split("\n") : [];
}

/** entity | the NAME of the room it points at, resolved through the FK. */
function links(familyId: string): string[] {
  const out = psql(
    `SELECT c.entity_id || '|' || COALESCE(r.name,'-')
     FROM catalogue_items c LEFT JOIN rooms r ON r.id = c.room_id
     WHERE c.family_id='${familyId}' ORDER BY c.entity_id;`,
  );
  return out ? out.split("\n") : [];
}

test.describe("reconciling rooms", () => {
  test("a blob room keeps its icon, colour and order", () => {
    const id = makeFamily();
    seedBlob(id, {
      rooms_config: {
        rooms: [
          { id: "r1", name: "Flur", icon: "book", color: "#67f264", position: 0, created_at: "2026-01-01", entities: [] },
          { id: "r2", name: "Wohnzimmer", icon: "lamp", position: 1, created_at: "2026-01-01", entities: [] },
        ],
      },
    });
    applyMigration();
    expect(rooms(id)).toEqual(["Flur|book|#67f264|0", "Wohnzimmer|lamp|-|1"]);
  });

  test("a room that exists only as catalogue text becomes a room, after the blob's", () => {
    const id = makeFamily();
    seedBlob(id, {
      rooms_config: { rooms: [{ id: "r1", name: "Flur", icon: "book", position: 0, created_at: "2026-01-01", entities: [] }] },
    });
    seedDevice(id, "sensor.carport", "Carport");
    applyMigration();
    // The blob's room keeps position 0; the text-only one lands after it.
    expect(rooms(id)).toEqual(["Flur|book|-|0", "Carport|-|-|1"]);
  });

  test("the same name in both, differing in case, is one room", () => {
    const id = makeFamily();
    seedBlob(id, {
      rooms_config: { rooms: [{ id: "r1", name: "Flur", icon: "book", position: 0, created_at: "2026-01-01", entities: [] }] },
    });
    seedDevice(id, "light.a", "flur");
    seedDevice(id, "light.b", "  FLUR  ");
    applyMigration();
    expect(rooms(id)).toEqual(["Flur|book|-|0"]);
    // Both devices resolve to that one room, under the blob's spelling.
    expect(links(id)).toEqual(["light.a|Flur", "light.b|Flur"]);
  });

  test("every device's room text resolves to a room_id", () => {
    const id = makeFamily();
    seedDevice(id, "light.a", "Küche");
    seedDevice(id, "light.b", "Küche");
    seedDevice(id, "sensor.c", null);
    applyMigration();
    expect(rooms(id)).toEqual(["Küche|-|-|0"]);
    expect(links(id)).toEqual(["light.a|Küche", "light.b|Küche", "sensor.c|-"]);
  });

  test("the blob's entity lists are ignored", () => {
    // RFC-007 §3: membership already lives on the catalogue row. Reading these
    // again would re-add a device the household has since removed.
    const id = makeFamily();
    seedBlob(id, {
      rooms_config: {
        rooms: [{ id: "r1", name: "Flur", icon: "book", position: 0, created_at: "2026-01-01",
                  entities: [{ entity_id: "light.removed", display_name: "Gone", position: 0 }] }],
      },
    });
    applyMigration();
    expect(rooms(id)).toEqual(["Flur|book|-|0"]);
    // No catalogue row was invented for it.
    expect(links(id)).toEqual([]);
  });

  test("a blob room with no name is skipped, and does not take the batch down", () => {
    const poisoned = makeFamily();
    seedBlob(poisoned, {
      rooms_config: { rooms: [{ id: "r1", icon: "book", position: 0, created_at: "2026-01-01", entities: [] }] },
    });
    const clean = makeFamily();
    seedDevice(clean, "light.ok", "Bad");
    applyMigration();
    expect(rooms(poisoned)).toEqual([]);
    // The property whose absence takes the container down.
    expect(rooms(clean)).toEqual(["Bad|-|-|0"]);
    expect(links(clean)).toEqual(["light.ok|Bad"]);
  });

  test("a non-array rooms_config does not take the batch down either", () => {
    const poisoned = makeFamily();
    seedBlob(poisoned, { rooms_config: { rooms: {} } });
    const clean = makeFamily();
    seedDevice(clean, "light.ok2", "Fine");
    applyMigration();
    expect(rooms(clean)).toEqual(["Fine|-|-|0"]);
  });

  test("applying it twice changes nothing", () => {
    const id = makeFamily();
    seedBlob(id, {
      rooms_config: { rooms: [{ id: "r1", name: "Flur", icon: "book", position: 0, created_at: "2026-01-01", entities: [] }] },
    });
    seedDevice(id, "light.a", "Flur");
    applyMigration();
    const first = [rooms(id), links(id)];
    applyMigration();
    expect([rooms(id), links(id)]).toEqual(first);
  });

  test("the blob and the room text are both left exactly as they were", () => {
    const id = makeFamily();
    seedBlob(id, {
      rooms_config: { rooms: [{ id: "r1", name: "Flur", icon: "book", position: 0, created_at: "2026-01-01", entities: [] }] },
    });
    seedDevice(id, "light.a", "Flur");
    applyMigration();
    expect(psql(`SELECT value #>> '{rooms_config,rooms,0,name}' FROM settings WHERE family_id='${id}' AND key='home_assistant';`)).toBe("Flur");
    expect(psql(`SELECT room FROM catalogue_items WHERE family_id='${id}' AND entity_id='light.a';`)).toBe("Flur");
  });
});
