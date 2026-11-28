/**
 * Scheduled backups of the all-in-one image: the settings, the times they
 * fall on, and whether one is due. Pure: the clock, the time zone, the
 * environment and the stored state all come in, so e2e/scheduled-backup.spec.ts
 * drives every rule with a fake clock.
 *
 * The rules, each tested:
 *
 * - **Off unless switched on.** In Settings → Data & backup (stored in
 *   instance_settings under `scheduled_backup`), or by the server with
 *   KINBOARD_BACKUP_SCHEDULE (`off`, `daily`, `weekly`), plus
 *   KINBOARD_BACKUP_TIME (`HH:MM`, 03:00), KINBOARD_BACKUP_DAY (`mon`…`sun`,
 *   for weekly, Sunday) and KINBOARD_BACKUP_KEEP (1–365, 7). When
 *   KINBOARD_BACKUP_SCHEDULE is set, the server's values win over Settings
 *   entirely, and Settings shows them as set by the server; a value it does
 *   not understand switches the backups off and says why, rather than
 *   guessing.
 * - **The household's time.** `03:00` is 03:00 on the wall clock of the
 *   container's TZ (Europe/Berlin by default), not UTC: a household sets the
 *   hour its server is idle. On the night the clocks go forward a time that
 *   does not exist runs at the first minute that does; on the night they go
 *   back, at the first of the two.
 * - **A missed slot is caught up.** The scheduler looks every few minutes. A
 *   slot that passed while the container was stopped (a NAS that sleeps at
 *   night, an update) runs at the next look, once; slots from before the
 *   schedule was switched on (or changed) never count.
 * - **A failure is retried**, an hour later (ten minutes when the run was cut
 *   off by the container stopping), at most three times per slot; then the
 *   next slot tries again. A failure never stops the schedule.
 */

export type Frequency = "off" | "daily" | "weekly";

export interface BackupConfig {
  frequency: Frequency;
  /** "HH:MM", 24 h, in the container's time zone. */
  time: string;
  /** 0 = Sunday … 6 = Saturday; only weekly reads it. */
  day: number;
  /** How many finished backups are kept; the oldest beyond that are removed after a new one is verified. */
  keep: number;
}

export interface ResolvedConfig extends BackupConfig {
  /** "server": KINBOARD_BACKUP_SCHEDULE is set and wins; "settings": chosen in Settings; "default": neither. */
  source: "server" | "settings" | "default";
  /** Why the server's values were not understood (the backups are then off); null when they were. */
  error: string | null;
}

export const DEFAULT_CONFIG: BackupConfig = { frequency: "off", time: "03:00", day: 0, keep: 7 };
export const MIN_KEEP = 1;
export const MAX_KEEP = 365;
export const MAX_ATTEMPTS_PER_SLOT = 3;
export const RETRY_AFTER_MS = 60 * 60_000;
export const RETRY_AFTER_CUT_OFF_MS = 10 * 60_000;

export const ENV_SCHEDULE = "KINBOARD_BACKUP_SCHEDULE";
export const ENV_TIME = "KINBOARD_BACKUP_TIME";
export const ENV_DAY = "KINBOARD_BACKUP_DAY";
export const ENV_KEEP = "KINBOARD_BACKUP_KEEP";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function parseTime(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

export function parseDay(s: unknown): number | null {
  if (typeof s === "number") return Number.isInteger(s) && s >= 0 && s <= 6 ? s : null;
  if (typeof s !== "string") return null;
  const v = s.trim().toLowerCase();
  if (/^[0-6]$/.test(v)) return Number(v);
  const FULL = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const i = DAYS.indexOf(v);
  if (i >= 0) return i;
  const j = FULL.indexOf(v);
  return j >= 0 ? j : null;
}

export function parseKeep(s: unknown): number | null {
  const n = typeof s === "number" ? s : typeof s === "string" && /^\s*\d{1,4}\s*$/.test(s) ? Number(s) : NaN;
  return Number.isInteger(n) && n >= MIN_KEEP && n <= MAX_KEEP ? n : null;
}

function parseFrequency(s: unknown): Frequency | null {
  if (typeof s !== "string") return null;
  const v = s.trim().toLowerCase();
  return v === "off" || v === "daily" || v === "weekly" ? v : null;
}

/** A config from Settings (the request body, or what is stored): every field checked; null when any is wrong. */
export function parseConfig(input: unknown): BackupConfig | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const frequency = parseFrequency(o.frequency);
  const time = parseTime(o.time);
  const day = parseDay(o.day);
  const keep = parseKeep(o.keep);
  if (frequency === null || time === null || day === null || keep === null) return null;
  return { frequency, time, day, keep };
}

/**
 * What applies: the server's variables when KINBOARD_BACKUP_SCHEDULE is set
 * (not empty), otherwise what Settings stored, otherwise off.
 */
export function resolveConfig(env: Record<string, string | undefined>, stored: unknown): ResolvedConfig {
  const raw = (env[ENV_SCHEDULE] ?? "").trim();
  if (raw !== "") {
    const errors: string[] = [];
    const frequency = parseFrequency(raw);
    if (frequency === null) errors.push(`${ENV_SCHEDULE}=${JSON.stringify(raw)} is not off, daily or weekly`);
    const pick = <T,>(name: string, parse: (s: unknown) => T | null, def: T, what: string): T => {
      const v = (env[name] ?? "").trim();
      if (v === "") return def;
      const p = parse(v);
      if (p === null) {
        errors.push(`${name}=${JSON.stringify(v)} is not ${what}`);
        return def;
      }
      return p;
    };
    const time = pick(ENV_TIME, parseTime, DEFAULT_CONFIG.time, "a time like 03:00");
    const day = pick(ENV_DAY, parseDay, DEFAULT_CONFIG.day, "a day (mon … sun)");
    const keep = pick(ENV_KEEP, parseKeep, DEFAULT_CONFIG.keep, `a number from ${MIN_KEEP} to ${MAX_KEEP}`);
    if (errors.length) return { ...DEFAULT_CONFIG, time, day, keep, frequency: "off", source: "server", error: errors.join("; ") };
    return { frequency: frequency as Frequency, time, day, keep, source: "server", error: null };
  }
  let parsed: unknown = stored;
  if (typeof stored === "string") {
    try {
      parsed = JSON.parse(stored);
    } catch {
      parsed = null;
    }
  }
  const c = parseConfig(parsed);
  return c ? { ...c, source: "settings", error: null } : { ...DEFAULT_CONFIG, source: "default", error: null };
}

/* ---------------------------------------------------------- time zones */

interface WallClock {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  min: number;
  wd: number; // 0 = Sunday
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** A time zone Intl knows, or UTC. */
export function safeZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    formatter(tz);
    return tz;
  } catch {
    return "UTC";
  }
}

export function wallClock(ms: number, tz: string): WallClock & { s: number } {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
    s: Number(parts.second),
    wd: DAYS.indexOf(String(parts.weekday).slice(0, 3).toLowerCase()),
  };
}

/** The zone's offset from UTC at an instant, in ms. */
function offsetAt(ms: number, tz: string): number {
  const w = wallClock(ms, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a wall-clock time falls on in a zone. A time the zone skips
 * (the hour the clocks go forward) gives the first instant after the gap; a
 * time it has twice (the hour they go back) gives the first.
 */
export function zonedInstant(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  // Both offsets around the guess: the earlier instant that shows this wall time wins.
  const candidates = new Set([guess - offsetAt(guess - 86_400_000 / 2, tz), guess - offsetAt(guess + 86_400_000 / 2, tz), guess - offsetAt(guess, tz)]);
  const fits = [...candidates].filter((t) => {
    const w = wallClock(t, tz);
    return w.y === y && w.m === m && w.d === d && w.h === h && w.min === min;
  });
  if (fits.length) return Math.min(...fits);
  // Skipped: the first instant whose wall clock is past it.
  const before = Math.min(...candidates);
  for (let t = before - 3 * 3_600_000; t < before + 3 * 3_600_000; t += 60_000) {
    const w = wallClock(t, tz);
    const wall = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
    if (wall > guess) return t;
  }
  return guess - offsetAt(guess, tz);
}

function hm(time: string): [number, number] {
  const [h, m] = time.split(":").map(Number);
  return [h, m];
}

/** The slot of a config on one calendar day in the zone (y-m-d), or null when that day has none. */
function slotOnDay(cfg: BackupConfig, y: number, m: number, d: number, tz: string): number | null {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (cfg.frequency === "off") return null;
  if (cfg.frequency === "weekly" && wd !== cfg.day) return null;
  const [h, min] = hm(cfg.time);
  return zonedInstant(y, m, d, h, min, tz);
}

/** Calendar days around an instant, in the zone, from `from` to `to` days away. */
function* days(ms: number, tz: string, from: number, to: number, step: 1 | -1) {
  const w = wallClock(ms, tz);
  for (let i = step === 1 ? from : to; step === 1 ? i <= to : i >= from; i += step) {
    const dt = new Date(Date.UTC(w.y, w.m - 1, w.d + i));
    yield [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()] as const;
  }
}

/** The latest slot at or before `now`, or null (off). */
export function latestSlot(cfg: BackupConfig, now: number, tz: string): number | null {
  if (cfg.frequency === "off") return null;
  for (const [y, m, d] of days(now, tz, -8, 1, -1)) {
    const t = slotOnDay(cfg, y, m, d, tz);
    if (t !== null && t <= now) return t;
  }
  return null;
}

/** The first slot after `now`, or null (off). */
export function nextSlot(cfg: BackupConfig, now: number, tz: string): number | null {
  if (cfg.frequency === "off") return null;
  for (const [y, m, d] of days(now, tz, -1, 8, 1)) {
    const t = slotOnDay(cfg, y, m, d, tz);
    if (t !== null && t > now) return t;
  }
  return null;
}

/* --------------------------------------------------------------- state */

export interface BackupRecord {
  startedAt: string;
  finishedAt: string;
  file: string;
  dir: string;
  bytes: number;
  trigger: "schedule" | "manual";
}

export interface AttemptRecord {
  startedAt: string;
  /** null while it runs; a record found so after a restart was cut off. */
  finishedAt: string | null;
  ok: boolean | null;
  error: string | null;
  /** It was cut off: the container (or the server) stopped while it ran. */
  cutOff?: boolean;
  trigger: "schedule" | "manual";
}

export interface BackupState {
  /** When the schedule now in force was switched on (or last changed); slots before it never count. */
  armedAt: string | null;
  /** Which schedule armedAt is for (frequency|time|day). */
  armedKey: string | null;
  lastSuccess: BackupRecord | null;
  lastAttempt: AttemptRecord | null;
  /** The slot the attempts below were for, and how many there were. */
  slot: string | null;
  slotAttempts: number;
  /** The first failure since the last success (for the notice). */
  failingSince: string | null;
}

export const EMPTY_STATE: BackupState = {
  armedAt: null,
  armedKey: null,
  lastSuccess: null,
  lastAttempt: null,
  slot: null,
  slotAttempts: 0,
  failingSince: null,
};

/** A stored state, every field checked: anything odd reads as its empty value. */
export function parseState(raw: unknown): BackupState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const trig = (v: unknown): "schedule" | "manual" => (v === "manual" ? "manual" : "schedule");
  const rec = (v: unknown): BackupRecord | null => {
    if (!v || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    if (!str(r.startedAt) || !str(r.file) || !str(r.finishedAt)) return null;
    return { startedAt: r.startedAt as string, finishedAt: r.finishedAt as string, file: r.file as string, dir: str(r.dir) ?? "", bytes: Number(r.bytes) || 0, trigger: trig(r.trigger) };
  };
  const att = (v: unknown): AttemptRecord | null => {
    if (!v || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    if (!str(r.startedAt)) return null;
    return {
      startedAt: r.startedAt as string,
      finishedAt: str(r.finishedAt),
      ok: typeof r.ok === "boolean" ? r.ok : null,
      error: str(r.error),
      ...(r.cutOff === true ? { cutOff: true } : {}),
      trigger: trig(r.trigger),
    };
  };
  return {
    armedAt: str(o.armedAt),
    armedKey: str(o.armedKey),
    lastSuccess: rec(o.lastSuccess),
    lastAttempt: att(o.lastAttempt),
    slot: str(o.slot),
    slotAttempts: Number.isInteger(o.slotAttempts) && (o.slotAttempts as number) >= 0 ? (o.slotAttempts as number) : 0,
    failingSince: str(o.failingSince),
  };
}

const keyOf = (c: BackupConfig) => `${c.frequency}|${c.time}|${c.day}`;

/**
 * The state with the schedule in force armed: switched on or changed now →
 * armedAt is now, so the slots before it don't count; off → disarmed.
 */
export function arm(cfg: BackupConfig, state: BackupState, now: number): BackupState {
  if (cfg.frequency === "off") return state.armedAt === null && state.armedKey === null ? state : { ...state, armedAt: null, armedKey: null };
  const key = keyOf(cfg);
  if (state.armedKey === key && state.armedAt) return state;
  return { ...state, armedAt: new Date(now).toISOString(), armedKey: key };
}

/** A run recorded as started that is not running any more: it was cut off. */
export function markCutOff(state: BackupState, now: number): BackupState {
  const a = state.lastAttempt;
  if (!a || a.finishedAt !== null) return state;
  const at = new Date(now).toISOString();
  return {
    ...state,
    lastAttempt: { ...a, finishedAt: at, ok: false, cutOff: true, error: "cut off: Kinboard stopped while the backup ran (a restart or an update)" },
    failingSince: state.failingSince ?? at,
  };
}

export type Decision =
  | { due: true; slot: number }
  | { due: false; reason: "off" | "invalid" | "not_yet" | "done" | "retry_later" | "gave_up" | "running"; retryAt?: number };

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

export function decide(cfg: ResolvedConfig, state: BackupState, now: number, tz: string): Decision {
  if (cfg.error) return { due: false, reason: "invalid" };
  if (cfg.frequency === "off") return { due: false, reason: "off" };
  if (state.lastAttempt && state.lastAttempt.finishedAt === null) return { due: false, reason: "running" };
  const slot = latestSlot(cfg, now, tz);
  if (slot === null) return { due: false, reason: "not_yet" };
  const armed = ms(state.armedAt);
  if (!Number.isNaN(armed) && slot < armed) return { due: false, reason: "not_yet" };
  const done = ms(state.lastSuccess?.startedAt);
  if (!Number.isNaN(done) && done >= slot) return { due: false, reason: "done" };
  const attempts = state.slot === new Date(slot).toISOString() ? state.slotAttempts : 0;
  if (attempts >= MAX_ATTEMPTS_PER_SLOT) return { due: false, reason: "gave_up" };
  const la = state.lastAttempt;
  if (la && la.ok === false && la.finishedAt) {
    const retryAt = ms(la.finishedAt) + (la.cutOff ? RETRY_AFTER_CUT_OFF_MS : RETRY_AFTER_MS);
    if (!Number.isNaN(retryAt) && now < retryAt && ms(la.startedAt) >= slot) return { due: false, reason: "retry_later", retryAt };
  }
  return { due: true, slot };
}

/** When the next run will start, for Settings: a retry, the next slot, or null (off). */
export function nextRunAt(cfg: ResolvedConfig, state: BackupState, now: number, tz: string): number | null {
  if (cfg.error || cfg.frequency === "off") return null;
  const d = decide(cfg, state, now, tz);
  if (d.due) return now;
  if (d.reason === "retry_later" && d.retryAt) return d.retryAt;
  return nextSlot(cfg, now, tz);
}

/** The state after a run starts. */
export function started(state: BackupState, trigger: "schedule" | "manual", now: number, slot: number | null): BackupState {
  const slotIso = slot === null ? state.slot : new Date(slot).toISOString();
  const attempts = slot === null ? state.slotAttempts : state.slot === slotIso ? state.slotAttempts + 1 : 1;
  return {
    ...state,
    lastAttempt: { startedAt: new Date(now).toISOString(), finishedAt: null, ok: null, error: null, trigger },
    slot: slotIso,
    slotAttempts: attempts,
  };
}

/** The state after a run ends. */
export function finished(
  state: BackupState,
  now: number,
  result: { ok: true; file: string; dir: string; bytes: number } | { ok: false; error: string },
): BackupState {
  const a = state.lastAttempt ?? { startedAt: new Date(now).toISOString(), finishedAt: null, ok: null, error: null, trigger: "manual" as const };
  const at = new Date(now).toISOString();
  if (result.ok) {
    return {
      ...state,
      lastAttempt: { ...a, finishedAt: at, ok: true, error: null },
      lastSuccess: { startedAt: a.startedAt, finishedAt: at, file: result.file, dir: result.dir, bytes: result.bytes, trigger: a.trigger },
      failingSince: null,
    };
  }
  return {
    ...state,
    lastAttempt: { ...a, finishedAt: at, ok: false, error: result.error.slice(0, 1000) },
    failingSince: state.failingSince ?? at,
  };
}
