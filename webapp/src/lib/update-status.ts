/**
 * What the last automatic update did, as kinboard-self-update.sh records it
 * (RFC-023 §4.11.4): one JSON object in instance_settings under
 * `update_status`, written through the db container after every update that
 * recreated the webapp and after every rollback. Settings shows a rollback
 * until someone dismisses it, and a successful update as a line under the
 * version.
 *
 * The record comes from a shell script, so every field is read defensively:
 * anything missing or of the wrong type is an empty string, and a record that
 * is not an object with a known status is no record at all.
 */

export const UPDATE_STATUS_KEY = "update_status";
/** Written by "Try again now"; the next run or tick of the self-update reads and removes it. */
export const UPDATE_RETRY_KEY = "update_retry";

export type UpdateOutcome = "updated" | "rolled_back" | "rollback_failed";

export interface UpdateStatus {
  status: UpdateOutcome;
  /** When the run finished, ISO 8601. */
  at: string;
  /** The version that ran before, and the one the update brought. */
  from: string;
  to: string;
  /** The services the run recreated, space-separated. */
  services: string;
  /** The verified backup taken before the update: file name, folder on the host, time. */
  backup: string;
  backupDir: string;
  backupAt: string;
  /** The migration that failed partway, when that is why it did not start. */
  migration: string;
  /** A migration failed, or the rollback itself did not come up. */
  severe: boolean;
  /** Where the updater's own log is, on the host. */
  logFile: string;
  /** The last lines the failed containers logged. */
  log: string;
  /** When someone dismissed the notice in Settings, ISO 8601; empty while it shows. */
  dismissedAt: string;
  /** When "Try again now" was pressed and not yet picked up; empty otherwise. */
  retryRequestedAt: string;
}

const OUTCOMES: readonly UpdateOutcome[] = ["updated", "rolled_back", "rollback_failed"];

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The record from its stored text (or an already-parsed value), or null. */
export function parseUpdateStatus(raw: unknown, retryRequestedAt = ""): UpdateStatus | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const status = o.status;
  if (typeof status !== "string" || !OUTCOMES.includes(status as UpdateOutcome)) return null;
  return {
    status: status as UpdateOutcome,
    at: str(o.at),
    from: str(o.from),
    to: str(o.to),
    services: str(o.services),
    backup: str(o.backup),
    backupDir: str(o.backup_dir),
    backupAt: str(o.backup_at),
    migration: str(o.migration),
    severe: o.severe === true,
    logFile: str(o.log_file),
    log: str(o.log),
    dismissedAt: str(o.dismissed_at),
    retryRequestedAt,
  };
}

/** The stored record with dismissed_at set; the rest kept as the script wrote it. */
export function dismissUpdateStatus(raw: string, now: Date): string | null {
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    return JSON.stringify({ ...(o as Record<string, unknown>), dismissed_at: now.toISOString() });
  } catch {
    return null;
  }
}

/** Whether Settings shows the rollback notice at the top. */
export function showsRollbackNotice(s: UpdateStatus | null | undefined): boolean {
  return !!s && s.status !== "updated" && !s.dismissedAt;
}

/** How long a successful update is mentioned under the version. */
export const UPDATED_LINE_DAYS = 7;

/** Whether Settings says "Updated to … " under the version. */
export function showsUpdatedLine(s: UpdateStatus | null | undefined, now: Date): boolean {
  if (!s || s.status !== "updated" || !s.to) return false;
  const at = Date.parse(s.at);
  return Number.isFinite(at) && now.getTime() - at < UPDATED_LINE_DAYS * 24 * 60 * 60 * 1000;
}
