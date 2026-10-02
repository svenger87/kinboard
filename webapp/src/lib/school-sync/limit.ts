import { hitLimit } from "@/lib/rate-limit";
import type { SchoolSyncSetting } from "./sync";

/** One OpenHolidays fetch a minute per family, from any session route (RFC-014 §5.2). */
export function syncLimited(familyId: string): { limited: boolean; retryAfterMs: number } {
  return hitLimit(`school-sync:${familyId}`, 1, 60_000);
}

/** How long the cron leaves a family alone after a failed sync. */
export const RETRY_AFTER_ERROR_MS = 60 * 60 * 1000;

/**
 * A failing family stays due (§5.2), but the cron does not ask again within
 * the hour: the demo runs it every 10 minutes (Ruling 21) and would otherwise
 * send six requests an hour while OpenHolidays is down. A success after the
 * error, or no error at all, means no back-off -- so a freshly reseeded demo
 * family (empty status) is fetched on the next run.
 */
export function backingOff(setting: SchoolSyncSetting, now: Date): boolean {
  if (!setting.last_error_at) return false;
  const failed = Date.parse(setting.last_error_at);
  if (!Number.isFinite(failed)) return false;
  if (setting.last_success_at && Date.parse(setting.last_success_at) >= failed) return false;
  return now.getTime() - failed < RETRY_AFTER_ERROR_MS;
}
