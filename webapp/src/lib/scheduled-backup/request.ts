import { randomBytes } from "node:crypto";
import { parseConfig, type BackupConfig, type ResolvedConfig } from "./schedule";

/**
 * Who may change the scheduled backups, start one, or download the newest,
 * in the order the route asks (as the old database's Delete does, #584):
 *
 *   1. the all-in-one image at all (anything else: 404, as if the route did
 *      not exist);
 *   2. the install's operator (lib/install-operator.ts): the backups are the
 *      install's, every family's data and keys in one file; anyone else 403;
 *   3. a known action, and a well-formed PIN, before the PIN is checked (a
 *      malformed request spends none of the PIN limiter's tries);
 *   4. the settings PIN typed then and there, by verifySettingsPin and its
 *      shared limiter: an unlocked settings screen is not enough to take
 *      every family's data and keys home. A family without a PIN sets one
 *      first;
 *   5. then the action: a schedule the server sets (KINBOARD_BACKUP_SCHEDULE)
 *      is not changed from here (409); a backup already running is not
 *      started twice (409); no backup yet, nothing to download (404).
 *
 * Pure: every dependency comes in, so e2e/scheduled-backup.spec.ts tests each
 * gate against fakes.
 */

export type BackupAction = "save" | "run" | "download";

export interface BackupRequestDeps {
  isAio: () => boolean;
  isOperator: (familyId: string) => Promise<boolean>;
  hasPin: (familyId: string) => Promise<boolean>;
  verifyPin: (familyId: string, pin: string) => Promise<"valid" | "invalid" | "rate_limited">;
  config: () => Promise<ResolvedConfig>;
  save: (cfg: BackupConfig) => Promise<void>;
  runNow: () => Promise<"started" | "busy" | "unavailable">;
  /** A one-time link to the newest backup for this family's session, or null when there is none. */
  issueDownload: (familyId: string) => Promise<{ url: string; file: string } | null>;
  log: (line: string) => void;
}

const MAX_PIN = 32;
const ACTIONS: readonly BackupAction[] = ["save", "run", "download"];

export async function scheduledBackupRequest(
  input: { familyId: string; deviceId: string | null; body: unknown },
  deps: BackupRequestDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!deps.isAio()) return { status: 404, body: { error: "not_found" } };
  if (!(await deps.isOperator(input.familyId))) return { status: 403, body: { error: "not_operator" } };

  const body = (input.body && typeof input.body === "object" ? input.body : {}) as Record<string, unknown>;
  const action = body.action as BackupAction;
  if (!ACTIONS.includes(action)) return { status: 400, body: { error: "invalid_request" } };
  let cfg: BackupConfig | null = null;
  if (action === "save") {
    cfg = parseConfig(body.config);
    if (!cfg) return { status: 400, body: { error: "invalid_config" } };
  }
  const pin = body.pin;
  if (typeof pin !== "string" || pin.length === 0 || pin.length > MAX_PIN) return { status: 400, body: { error: "invalid_request" } };
  // Not "pin_required": the settings screen reads that as "lock again".
  if (!(await deps.hasPin(input.familyId))) return { status: 403, body: { error: "pin_not_set" } };
  const verdict = await deps.verifyPin(input.familyId, pin);
  if (verdict === "rate_limited") return { status: 429, body: { error: "rate_limited" } };
  if (verdict !== "valid") return { status: 403, body: { error: "pin_invalid" } };

  const who = `family ${input.familyId}, device ${input.deviceId ?? "unknown"}`;
  if (action === "save" && cfg) {
    const current = await deps.config();
    if (current.source === "server") return { status: 409, body: { error: "set_by_server" } };
    await deps.save(cfg);
    deps.log(
      `scheduled backups set to ${cfg.frequency}${cfg.frequency === "off" ? "" : ` at ${cfg.time}${cfg.frequency === "weekly" ? ` on day ${cfg.day}` : ""}, keeping ${cfg.keep}`}, by ${who}`,
    );
    return { status: 200, body: { ok: true } };
  }
  if (action === "run") {
    const r = await deps.runNow();
    if (r === "busy") return { status: 409, body: { error: "busy" } };
    if (r === "unavailable") return { status: 404, body: { error: "not_found" } };
    deps.log(`a backup was started from Settings by ${who}`);
    return { status: 202, body: { started: true } };
  }
  const link = await deps.issueDownload(input.familyId);
  if (!link) return { status: 404, body: { error: "no_backup" } };
  deps.log(`the backup ${link.file} was handed out for download to ${who}`);
  return { status: 200, body: { url: link.url } };
}

/* ------------------------------------------------------ download links */

/** How long a download link lives, and it works once. */
export const DOWNLOAD_TTL_MS = 2 * 60_000;

interface Ticket {
  familyId: string;
  dir: string;
  file: string;
  expires: number;
}

const KEY = Symbol.for("kinboard.scheduled-backup.downloads");
function tickets(): Map<string, Ticket> {
  const g = globalThis as { [KEY]?: Map<string, Ticket> };
  g[KEY] ??= new Map();
  return g[KEY];
}

export function issueTicket(familyId: string, dir: string, file: string, now = Date.now()): string {
  const all = tickets();
  for (const [k, t] of all) if (t.expires <= now) all.delete(k);
  const token = randomBytes(24).toString("base64url");
  all.set(token, { familyId, dir, file, expires: now + DOWNLOAD_TTL_MS });
  return token;
}

/** The ticket for a token, used up: only for the family it was issued to, before it expires, once. */
export function redeemTicket(token: unknown, familyId: string, now = Date.now()): { dir: string; file: string } | null {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const all = tickets();
  const t = all.get(token);
  if (!t) return null;
  if (t.familyId !== familyId) return null;
  all.delete(token);
  if (t.expires <= now) return null;
  return { dir: t.dir, file: t.file };
}
