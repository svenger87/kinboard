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
/**
 * kinboard-updater's held_compose record (RFC-023 §4.11.3), under its own key
 * so that it never replaces a rollback notice still showing. The updater
 * removes it once the hold is over.
 */
export const UPDATE_HOLD_KEY = "update_hold";
/** Written by "Try again now"; the next run or tick of the self-update reads and removes it. */
export const UPDATE_RETRY_KEY = "update_retry";

/**
 * `held_compose`: kinboard-updater found a release whose compose file revision
 * is not the install's file's, and applied nothing (RFC-023 §4.11.3). Settings
 * shows it under the version, with the "older compose file" notice, for as
 * long as the install still runs the file revision it was held for.
 */
export type UpdateOutcome = "updated" | "rolled_back" | "rollback_failed" | "held_compose";

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
  /** held_compose: the compose file revision the install runs, and the one the held release needs ("" when it says none). */
  fileRevision: string;
  neededRevision: string;
}

const OUTCOMES: readonly UpdateOutcome[] = ["updated", "rolled_back", "rollback_failed", "held_compose"];

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
    fileRevision: str(o.file_revision),
    neededRevision: str(o.needed_revision),
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
  return !!s && (s.status === "rolled_back" || s.status === "rollback_failed") && !s.dismissedAt;
}

/**
 * Whether Settings shows that an automatic update is held for a newer compose
 * file: a held_compose record made while the install ran the file revision it
 * still runs (`declared`, KINBOARD_COMPOSE_REVISION). Once the household has
 * replaced the file and started it, the revision differs and the notice goes
 * by itself.
 */
export function showsComposeHold(s: UpdateStatus | null | undefined, declared: string | null | undefined): boolean {
  return !!s && s.status === "held_compose" && !!declared && s.fileRevision === declared;
}

/** How long a successful update is mentioned under the version. */
export const UPDATED_LINE_DAYS = 7;

/** Whether Settings says "Updated to … " under the version. */
export function showsUpdatedLine(s: UpdateStatus | null | undefined, now: Date): boolean {
  if (!s || s.status !== "updated" || !s.to) return false;
  const at = Date.parse(s.at);
  return Number.isFinite(at) && now.getTime() - at < UPDATED_LINE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Who may see and act on the install's updates.
 *
 * The record and "Try again" belong to the install, not to a family, and the
 * app had no notion of an install operator: the settings PIN is per family.
 * On an install with several families (the public demo has many) any of them
 * would otherwise read the update log, the backup folder on the host, and ask
 * the updater to retry. So, in order:
 *
 *   - INSTANCE_ADMIN_FAMILY_ID set: that family, and only that one;
 *   - a family recorded as the operator (instance_settings
 *     `update_operator_family`) that still exists: that one;
 *   - no such record, not a public demo, and exactly one family: that family,
 *     which the caller then records. Recorded, not recounted: anyone who can
 *     reach /api/session/create can add a second family, and counting would
 *     lock the household out of its own notice the moment they did;
 *   - otherwise nobody. Updates of such an install are its operator's to
 *     watch, in the updater's log, or to name with INSTANCE_ADMIN_FAMILY_ID.
 *
 * A demo (KINBOARD_DEMO_FAMILY_CODE) never claims "the only family": its demo
 * family is open to anyone with the published code.
 */
export function decideOperator(
  familyId: string,
  install: {
    familyCount: number;
    /** The recorded operator family, if it still exists; null otherwise. */
    recorded: string | null;
    env: { INSTANCE_ADMIN_FAMILY_ID?: string; KINBOARD_DEMO_FAMILY_CODE?: string };
  },
): { operator: boolean; record: boolean } {
  const admin = install.env.INSTANCE_ADMIN_FAMILY_ID?.trim();
  if (admin) return { operator: familyId === admin, record: false };
  if (install.recorded) return { operator: familyId === install.recorded, record: false };
  if (install.env.KINBOARD_DEMO_FAMILY_CODE?.trim()) return { operator: false, record: false };
  const only = install.familyCount === 1;
  return { operator: only, record: only };
}

/** instance_settings key: the family recorded as the install's operator. */
export const UPDATE_OPERATOR_KEY = "update_operator_family";

/** The record as a family without the settings unlocked may see it: what happened, not the log or the paths. */
export function withoutDetails(s: UpdateStatus): UpdateStatus {
  return { ...s, services: "", backup: "", backupDir: "", logFile: "", log: "" };
}

/** "Try again now" at most this often per install. */
export const RETRY_INTERVAL_MS = 10 * 60 * 1000;
/** instance_settings key holding when "Try again now" was last accepted. */
export const UPDATE_RETRY_LAST_KEY = "update_retry_last";

/** Whether a retry may be accepted now, given when the last one was (ISO, or empty). */
export function retryAllowed(lastAt: string | null | undefined, now: Date): boolean {
  if (!lastAt) return true;
  const last = Date.parse(lastAt);
  if (!Number.isFinite(last)) return true;
  // A timestamp in the future (a clock that jumped back) is no reason to wait.
  if (last > now.getTime()) return true;
  return now.getTime() - last >= RETRY_INTERVAL_MS;
}
