import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A mutex for the specs whose unit of work is the entire database.
 *
 * `catalogue-migration.spec.ts` and `rooms-migration.spec.ts` both apply a
 * real migration file, and a migration file is written to migrate every
 * household on the install in one statement. That is the point of them — a
 * per-family re-implementation would prove nothing about the SQL the
 * entrypoint actually runs — but it means each spec writes to the other's
 * fixtures and reads a database the other is halfway through changing. Both
 * were written as if the family they just made were the only thing in there.
 *
 * Run together (two workers, or the two Playwright projects, or CI's desktop
 * line once both files are on it) that produced a different failure on every
 * run, which is why it read as flakiness rather than as a race:
 *
 *   - `rooms-migration › the blob's entity lists are ignored` asserts that no
 *     catalogue row was invented for an entity named only in the settings
 *     blob. `migration_catalogue_items.sql`, running in the other worker over
 *     every family including this one, invents exactly that row — and is
 *     right to. Expected `[]`, received `["light.removed|-"]`.
 *
 *   - Either spec's `applyMigration()` died outright with
 *     `insert or update on table "rooms" violates foreign key constraint
 *     "rooms_family_id_fkey" — Key (family_id)=(…) is not present in table
 *     "families"`: the other file's `afterAll` had deleted its throwaway
 *     families between the migration's `SELECT` over `settings` and the FK
 *     check on its `INSERT`. Whichever test happened to be running took the
 *     exception, so the name in the report was unrelated to the cause.
 *
 * Neither is fixable inside one file, and no per-file Playwright setting
 * helps: `mode: "serial"` orders tests within a file, and files are handed to
 * different workers by design. So the invariant is stated where it actually
 * lives — while one of these specs is between seeding and asserting, it owns
 * the database — and enforced across processes with the one primitive that is
 * atomic on every filesystem, `mkdir`.
 *
 * Hold it around the whole test, not just the migration: the window that
 * matters starts at the first seeded row, because a foreign migration landing
 * between the seed and the migration is exactly the `light.removed` case.
 */

const LOCK_DIR = join(tmpdir(), "kinboard-e2e-whole-database.lock");
const POLL_MS = 25;

/**
 * How long a held lock may be before it is treated as wreckage.
 *
 * These sections take well under two seconds each. A worker killed mid-test
 * (Ctrl-C, the OOM killer, a crashed browser) would otherwise leave the
 * directory behind and block every future run on this machine for ever, with
 * no error message that says so. Two minutes is far longer than any honest
 * holder and far shorter than "somebody has to go and delete a temp dir".
 */
const STALE_MS = 120_000;

let held = false;

export async function acquireWholeDatabase(): Promise<void> {
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      held = true;
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    try {
      if (Date.now() - statSync(LOCK_DIR).mtimeMs > STALE_MS) {
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
    } catch {
      // It was released while we were looking at it. Retry immediately.
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export function releaseWholeDatabase(): void {
  if (!held) return;
  held = false;
  rmSync(LOCK_DIR, { recursive: true, force: true });
}
