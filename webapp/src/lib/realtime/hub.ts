import postgres from "postgres";

/**
 * The change feed's server half: one LISTEN connection per server process,
 * fanned out to every open `/api/realtime` stream of the family a change
 * belongs to.
 *
 * The database announces each row change on the `kinboard_changes` channel
 * (migrations/084_change_feed.sql). Postgres delivers a NOTIFY only to a
 * session that is listening at the moment it commits; there is no replay. So
 * whenever the connection is lost and comes back, every subscriber is told to
 * `resync` — refetch what it shows — because anything committed in between is
 * gone for good.
 *
 * Kept on `globalThis` so the dev server's hot reload, which re-evaluates this
 * module, reuses the one connection instead of opening another per edit.
 */

export const CHANGE_CHANNEL = "kinboard_changes";

export type ChangeOp = "INSERT" | "UPDATE" | "DELETE";

/** One row change, as the trigger sends it. */
export interface ChangeEvent {
  table: string;
  op: ChangeOp;
  family_id: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

/**
 * `down`: the database connection is lost; changes are not arriving until a
 * `resync` says it is back (and that anything missed must be refetched).
 */
export type HubMessage =
  | { kind: "change"; change: ChangeEvent }
  | { kind: "resync" }
  | { kind: "down" };

type Listener = (message: HubMessage) => void;

export type HubStatus = "idle" | "connecting" | "listening" | "down";

/** Reconnect delays: 0.5 s doubling to 30 s. */
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 30_000;
/**
 * A dead peer can leave a socket that looks open for a long time (a database
 * host that vanished rather than closed the connection). A cheap query on the
 * listening connection finds that out within one interval.
 */
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 10_000;

/** Parse a NOTIFY payload; anything not shaped like a change is dropped. */
export function parseChange(payload: string): ChangeEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.table !== "string" || typeof v.family_id !== "string") return null;
  if (v.op !== "INSERT" && v.op !== "UPDATE" && v.op !== "DELETE") return null;
  const row = (r: unknown) => (r && typeof r === "object" ? (r as Record<string, unknown>) : null);
  return { table: v.table, op: v.op, family_id: v.family_id, new: row(v.new), old: row(v.old) };
}

type Connect = (handlers: {
  onNotify: (payload: string) => void;
  onClose: () => void;
}) => Promise<{ ping: () => Promise<void>; end: () => Promise<void> }>;

/** The real connection: env from the compose file (POSTGRES_*). */
const connectPostgres: Connect = async ({ onNotify, onClose }) => {
  // `onnotify` is the option postgres.js's own `sql.listen()` is built on
  // (src/index.js), missing only from its type declarations. It is used
  // directly so that this module, not the library, owns the connection:
  // `sql.listen()` re-listens after a close once, and when that attempt
  // fails (the database still restarting) it swallows the error and never
  // tries again — a feed that is silently dead until the process restarts.
  const options: postgres.Options<Record<string, never>> & {
    onnotify: (channel: string, payload: string) => void;
  } = {
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || "postgres",
    max: 1,
    idle_timeout: 0,
    max_lifetime: null,
    fetch_types: false,
    keep_alive: 30,
    connect_timeout: 10,
    connection: { application_name: "kinboard-realtime" },
    onnotify: (channel, payload) => {
      if (channel === CHANGE_CHANNEL) onNotify(payload);
    },
    onclose: () => onClose(),
    onnotice: () => {},
  };
  const sql = postgres(options);
  try {
    await sql.unsafe(`LISTEN ${CHANGE_CHANNEL}`);
  } catch (err) {
    await sql.end({ timeout: 0 }).catch(() => {});
    throw err;
  }
  return {
    ping: async () => {
      await sql`select 1`;
    },
    end: () => sql.end({ timeout: 0 }),
  };
};

export class RealtimeHub {
  private readonly byFamily = new Map<string, Set<Listener>>();
  private status: HubStatus = "idle";
  /** Bumped per connection, so callbacks from a torn-down one are ignored. */
  private generation = 0;
  private connection: { ping: () => Promise<void>; end: () => Promise<void> } | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  /** Whether a connection has been up before: the next one is a reconnect. */
  private everListened = false;

  constructor(private readonly connect: Connect = connectPostgres) {}

  getStatus(): HubStatus {
    return this.status;
  }

  subscriberCount(): number {
    let n = 0;
    for (const set of this.byFamily.values()) n += set.size;
    return n;
  }

  /**
   * Receive `familyId`'s changes, and every resync. Starts the connection on
   * the first subscriber. Returns the unsubscribe.
   */
  subscribe(familyId: string, listener: Listener): () => void {
    let set = this.byFamily.get(familyId);
    if (!set) {
      set = new Set();
      this.byFamily.set(familyId, set);
    }
    set.add(listener);
    if (this.status === "idle") this.start();
    else if (this.status === "down") listener({ kind: "down" });

    return () => {
      const current = this.byFamily.get(familyId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.byFamily.delete(familyId);
    };
  }

  /** Hand one NOTIFY payload to the subscribers of its family, and only those. */
  dispatch(payload: string): void {
    const change = parseChange(payload);
    if (!change) return;
    const set = this.byFamily.get(change.family_id);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener({ kind: "change", change });
      } catch {
        // One broken stream must not starve the others.
      }
    }
  }

  private broadcast(message: HubMessage): void {
    for (const set of this.byFamily.values()) {
      for (const listener of [...set]) {
        try {
          listener(message);
        } catch {
          // As above.
        }
      }
    }
  }

  private start(): void {
    this.status = "connecting";
    void this.open();
  }

  private async open(): Promise<void> {
    const gen = ++this.generation;
    try {
      const connection = await this.connect({
        onNotify: (payload) => {
          if (gen === this.generation) this.dispatch(payload);
        },
        onClose: () => {
          if (gen === this.generation) this.lost("connection closed");
        },
      });
      if (gen !== this.generation) {
        await connection.end().catch(() => {});
        return;
      }
      this.connection = connection;
      this.status = "listening";
      this.attempts = 0;
      if (this.everListened) {
        console.info("[realtime] listening again; asking every screen to resync");
        this.broadcast({ kind: "resync" });
      }
      this.everListened = true;
      this.pingTimer = setInterval(() => void this.ping(gen), PING_INTERVAL_MS);
      this.pingTimer.unref?.();
    } catch (err) {
      if (gen !== this.generation) return;
      this.lost(err instanceof Error ? err.message : String(err));
    }
  }

  private async ping(gen: number): Promise<void> {
    const connection = this.connection;
    if (!connection || gen !== this.generation) return;
    try {
      await Promise.race([
        connection.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ping timed out")), PING_TIMEOUT_MS).unref?.(),
        ),
      ]);
    } catch (err) {
      if (gen === this.generation) this.lost(err instanceof Error ? err.message : String(err));
    }
  }

  /** Tear the connection down and try again after a backoff. */
  private lost(reason: string): void {
    this.generation++;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const old = this.connection;
    this.connection = null;
    void old?.end().catch(() => {});

    if (this.status !== "down") this.broadcast({ kind: "down" });
    this.status = "down";
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempts);
    this.attempts++;
    console.warn(`[realtime] not listening (${reason}); retrying in ${delay} ms`);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open();
    }, delay);
    this.retryTimer.unref?.();
  }
}

const globalForHub = globalThis as unknown as { __kinboardRealtimeHub?: RealtimeHub };

/** The process's hub. */
export function getRealtimeHub(): RealtimeHub {
  if (!globalForHub.__kinboardRealtimeHub) {
    globalForHub.__kinboardRealtimeHub = new RealtimeHub();
  }
  return globalForHub.__kinboardRealtimeHub;
}

/**
 * For /api/health: `null` when nothing has asked for the feed since the
 * process started (no screen open, so nothing to report), else whether the
 * LISTEN connection is up.
 */
export function realtimeHealth(): boolean | null {
  const hub = globalForHub.__kinboardRealtimeHub;
  if (!hub || hub.getStatus() === "idle") return null;
  return hub.getStatus() === "listening";
}
