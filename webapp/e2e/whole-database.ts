import { mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
 *
 * ---------------------------------------------------------------------------
 * Crash recovery, which the first version of this file got badly wrong.
 *
 * A bare "steal anything older than N" is not recovery. With N above the
 * Playwright test timeout (`playwright.config.ts` — 60s) the steal can never
 * fire inside a test that is waiting for it: the hook times out first, and
 * Playwright abandons a timed-out hook *without stopping the promise behind
 * it*. The old loop kept polling in the background, stole the directory after
 * the test had already been failed, set itself as the holder after `afterEach`
 * had already run, and the worker exited without releasing — re-leaking the
 * lock on every run. A hand-made lock directory, which is exactly what a
 * SIGKILL or the OOM killer leaves behind on this box, wedged the machine
 * until somebody ran `rm -rf`. Verified twice.
 *
 * So four properties, not one timeout:
 *
 *   1. Ownership, not existence. The holder writes a token (pid + a random
 *      uuid) inside the directory. Release removes the directory only while
 *      that token is still ours — never somebody else's lock.
 *   2. A heartbeat. The holder touches the directory every few seconds, so
 *      "stale" can mean 20 seconds instead of two minutes without ever
 *      stealing from a live holder. Short staleness and long legitimate holds
 *      are only in tension while nothing says "still alive".
 *   3. A steal that re-verifies. The token is read again immediately before
 *      the removal and must still be the one the staleness check saw, and the
 *      removal itself is an atomic `rename` — so two workers acting on the
 *      same stale verdict cannot both end up holding it, which is how the old
 *      unconditional `rmSync` silently restored the original flake.
 *   4. A bounded wait that throws. Giving up at 30s — comfortably inside the
 *      60s test timeout — fails the hook loudly, inside the test, naming the
 *      path. A red test a human can act on beats a hang nobody can explain.
 */

const LOCK_DIR = join(tmpdir(), "kinboard-e2e-whole-database.lock");
const OWNER_FILE = join(LOCK_DIR, "owner");

const POLL_MS = 25;

/**
 * How often the holder says it is still alive, and how old a lock may be
 * before it is wreckage.
 *
 * STALE_MS is deliberately well under the 60s Playwright test timeout: a lock
 * left by a killed worker has to be recoverable *within* the test that trips
 * over it, or every crash costs a red test on the next run. Five heartbeats
 * of headroom covers an event loop blocked by a slow `docker exec`.
 */
const HEARTBEAT_MS = 4_000;
const STALE_MS = 20_000;

/** Give up here — inside the test timeout, so the failure is the test's. */
const ACQUIRE_TIMEOUT_MS = 30_000;

export class WholeDatabaseLockTimeout extends Error {
  constructor(waitedMs: number) {
    super(
      `whole-database lock at ${LOCK_DIR} was still held after ${Math.round(waitedMs / 1000)}s. ` +
        `Another migration spec may genuinely be running; a previous run killed mid-test may also ` +
        `have left the directory behind. If nothing else is running, remove it: rm -rf ${LOCK_DIR}`,
    );
    this.name = "WholeDatabaseLockTimeout";
  }
}

/** Our token while we hold it; null when we do not. */
let ownerToken: string | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let exitHookInstalled = false;

/** The token written inside the lock, or null if it cannot be read. */
function readOwner(): string | null {
  try {
    return readFileSync(OWNER_FILE, "utf8");
  } catch {
    return null;
  }
}

/**
 * The right to remove a stale lock. Held for microseconds, by one process.
 *
 * `rename` is atomic but it is not *conditional*: it moves whatever is at the
 * path, not the thing you looked at. That is what defeated the first two
 * attempts at recovery here, and it is visible in the debug trace of eight
 * workers racing one hand-made stale lock — several print `stealing:
 * owner=null age=302s` from the same stale verdict, one of them completes the
 * whole steal-and-claim in the microseconds before the next one's `rename`
 * runs, and that `rename` then carries away a *fresh* lock:
 *
 *     [wdb A] stealing: owner=null age=302012ms
 *     [wdb B] stealing: owner=null age=302012ms
 *     [wdb A] HELD token=A readback=null          <- A's own owner file, gone
 *     [wdb B] HELD token=B readback=B
 *     w6 SHARED …                                 <- two holders
 *
 * No amount of re-checking before the `rename` closes that, because the
 * re-check and the `rename` are themselves two syscalls. So the removal is
 * made mutually exclusive instead: a second, ordinary `mkdir` lock that a
 * would-be stealer must hold for the whole verify → remove → claim sequence.
 * While it is held, nothing else can be removing the lock, so what the verify
 * saw is what the removal acts on; the lock can only stay as verified or
 * vanish under its own holder, and `rename` then fails ENOENT.
 *
 * The one residual: a process SIGKILLed *inside* those microseconds leaves the
 * steal right behind. It expires, on the same principle and much faster — and
 * two processes both acting on a >10s-old steal right is a window of
 * microseconds inside a window of ten seconds, which is as far as a
 * filesystem-only mutex can be taken without a real `flock`.
 */
const STEAL_DIR = `${LOCK_DIR}.steal`;
const STEAL_STALE_MS = 10_000;

function tryTakeStealRight(): boolean {
  try {
    mkdirSync(STEAL_DIR);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  try {
    if (Date.now() - statSync(STEAL_DIR).mtimeMs > STEAL_STALE_MS) {
      rmSync(STEAL_DIR, { recursive: true, force: true });
    }
  } catch {
    // Released while we looked at it.
  }
  return false;
}

/**
 * Take the lock away from a dead holder and claim it, or do nothing.
 *
 * Verify and claim are both inside the steal right, so there is no moment
 * where a half-made lock — a directory created but not yet carrying its owner
 * token — is visible to another stealer. `expected` is the owner token the
 * caller saw when it judged the lock stale; a lock whose token has changed
 * since, or whose mtime is no longer old (a heartbeat, or a brand-new lock),
 * is not the one that was judged and is left alone.
 */
function stealAndClaim(expected: string | null, token: string): boolean {
  if (!tryTakeStealRight()) return false;
  try {
    if (readOwner() !== expected) return false;
    try {
      if (Date.now() - statSync(LOCK_DIR).mtimeMs <= STALE_MS) return false;
    } catch {
      return false; // Gone: its holder released it. Go round again and mkdir.
    }

    const parked = `${LOCK_DIR}.stale-${process.pid}-${randomUUID()}`;
    try {
      renameSync(LOCK_DIR, parked);
    } catch {
      return false;
    }
    rmSync(parked, { recursive: true, force: true });

    try {
      mkdirSync(LOCK_DIR);
    } catch {
      // Somebody took the slot we just freed, fairly, with a plain mkdir.
      return false;
    }
    writeFileSync(OWNER_FILE, token, "utf8");
    return true;
  } finally {
    rmSync(STEAL_DIR, { recursive: true, force: true });
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    const now = new Date();
    try {
      utimesSync(LOCK_DIR, now, now);
    } catch {
      // The lock is gone from under us. Nothing useful to do here; release()
      // will find the token no longer ours and leave it alone.
    }
  }, HEARTBEAT_MS);
  // Never hold the process open for the sake of a heartbeat.
  heartbeat.unref?.();
}

function stopHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

export async function acquireWholeDatabase(): Promise<void> {
  const started = Date.now();
  const token = `${process.pid}-${randomUUID()}`;

  for (;;) {
    let created = false;
    try {
      mkdirSync(LOCK_DIR);
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    if (created) {
      try {
        writeFileSync(OWNER_FILE, token, "utf8");
      } catch (error) {
        // We made the directory but could not claim it. Take it back out
        // rather than leave an ownerless lock for the next worker to wait
        // STALE_MS on.
        rmSync(LOCK_DIR, { recursive: true, force: true });
        throw error;
      }
      ownerToken = token;
      startHeartbeat();
      installExitHook();
      return;
    }

    // Held by somebody. Alive, or wreckage?
    const seen = readOwner();
    let age: number | null = null;
    try {
      age = Date.now() - statSync(LOCK_DIR).mtimeMs;
    } catch {
      continue; // Released while we looked. Try to take it immediately.
    }
    if (age > STALE_MS) {
      if (stealAndClaim(seen, token)) {
          ownerToken = token;
        startHeartbeat();
        installExitHook();
        return;
      }
      continue;
    }

    if (Date.now() - started > ACQUIRE_TIMEOUT_MS) {
      throw new WholeDatabaseLockTimeout(Date.now() - started);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export function releaseWholeDatabase(): void {
  const token = ownerToken;
  stopHeartbeat();
  ownerToken = null;
  if (!token) return;
  // Only ours. If it was stolen while we held it — which means we were stalled
  // for longer than STALE_MS — the directory now belongs to somebody else and
  // removing it would be the very bug this guards against.
  if (readOwner() !== token) return;
  rmSync(LOCK_DIR, { recursive: true, force: true });
}

/**
 * The crash path: a worker that throws its way out of a test, or is told to
 * exit, still gives the lock back. It does not cover SIGKILL — nothing in
 * process can — which is what the staleness steal above is for.
 */
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    try {
      releaseWholeDatabase();
    } catch {
      // Exiting anyway.
    }
  });
}
