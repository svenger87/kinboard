/**
 * How long a settings unlock lasts.
 *
 * The PIN in front of Settings exists for a physical threat: a wall tablet in a
 * kitchen that anybody in the house — or visiting it — can walk up to and touch.
 * It is not protecting against a network attacker; the session cookie does that.
 *
 * The unlock used to be a bare marker in `sessionStorage`, written on success
 * and never removed. `sessionStorage` lives for the life of the *tab*, and a
 * kiosk's tab is never closed, so the PIN was asked once and then never again.
 * Measured: unlock, go to the dashboard, use the calendar, return to Settings —
 * still open, no prompt. A new tab prompted correctly, which is why this looked
 * fine everywhere except the one device it mattered on.
 *
 * So the unlock now expires two ways, and both are needed:
 *
 *   - **On leaving Settings.** Walking away from the settings screen ends the
 *     visit. This is what stops the board sitting unlocked on the dashboard.
 *   - **After an idle window.** Leaving is not always a navigation — a board
 *     left open on a settings sub-page needs to lapse on its own.
 *
 * The window matches `useReturnToDashboard`'s ten minutes, which is the
 * existing answer to "how long may a wall display sit untouched". Using a
 * different number here would be a second, quieter policy about the same room.
 */

const SESSION_KEY = "kinboard_settings_unlock";

/** Long enough to work through a settings page, short enough to lapse before the next person. */
export const UNLOCK_TTL_MS = 10 * 60 * 1000;

interface UnlockRecord {
  /** Which family was unlocked. A marker that outlives a family switch is not an unlock. */
  familyId: string;
  /** When the unlock was granted or last renewed, epoch ms. */
  at: number;
}

/**
 * Storage access is wrapped because it throws outright in some contexts —
 * private windows with site data blocked, and the thumbnailer. A guard that
 * crashes on read would take the whole settings screen with it.
 */
function read(): UnlockRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" || parsed === null ||
      typeof (parsed as UnlockRecord).familyId !== "string" ||
      typeof (parsed as UnlockRecord).at !== "number"
    ) {
      // Includes the old bare "unlocked" string. An unlock we cannot read the
      // age of is treated as no unlock — the upgrade re-prompts once, which is
      // the safe direction.
      return null;
    }
    return parsed as UnlockRecord;
  } catch {
    return null;
  }
}

/** True only for a live, unexpired unlock belonging to this family. */
export function isUnlocked(familyId: string | undefined, now: number = Date.now()): boolean {
  if (!familyId) return false;
  const record = read();
  if (!record || record.familyId !== familyId) return false;
  // A clock that has gone backwards (a board correcting its time by NTP) must
  // not read as a fresh unlock, so the age is compared in both directions.
  const age = now - record.at;
  return age >= 0 && age < UNLOCK_TTL_MS;
}

export function grantUnlock(familyId: string, now: number = Date.now()): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ familyId, at: now } satisfies UnlockRecord));
  } catch {
    /* Storage unavailable: the unlock lasts for this render only, which is
       inconvenient rather than unsafe. */
  }
}

export function clearUnlock(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

/** Whether a path is inside the area the PIN guards. */
export function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}
