/**
 * A camera put on the wall displays from outside (#335): Home Assistant calls
 * `show_camera` when the doorbell rings, and the screens show that camera full
 * screen for a minute, then go back on their own.
 *
 * Shared by the service (`POST /api/integration/v1/services/show_camera`), the
 * listing (`GET /api/integration/v1/cameras`), the session route the screens
 * read (`/api/camera-takeover`) and the overlay, so the rules live once.
 * Everything that decides something is pure and tested without a stack
 * (e2e/camera-takeover.spec.ts).
 */

import { SETTINGS_KEYS } from "@/lib/settings-keys";
import type { CameraConfig } from "@/types/home-assistant";

/** How long a camera stays up when the call doesn't say: long enough to see who is at the door. */
export const DEFAULT_TAKEOVER_SECONDS = 60;
/** Less than this is a flash, not a look at the door. */
export const MIN_TAKEOVER_SECONDS = 5;
/** Five minutes: past that the wall has become a camera page. */
export const MAX_TAKEOVER_SECONDS = 300;

/**
 * Its own budget on top of the Integration API's per-token write limit, the
 * same as the one on messages (`MESSAGE_RATE_LIMIT`): every call takes over
 * every wall display in the house, so an automation stuck in a loop — or a
 * doorbell a child has found — must not keep flashing them.
 */
export const SHOW_CAMERA_RATE_LIMIT = 5;
export const SHOW_CAMERA_RATE_WINDOW_MS = 10 * 60_000;

/** The family's row in `camera_takeovers`. */
export interface CameraTakeoverRow {
  family_id: string;
  camera_id: string;
  device_ids: string[];
  started_at: string;
  ends_at: string;
}

/** A camera as `show_camera` and `GET /cameras` know it: never its stream URL. */
export interface CameraRef {
  id: string;
  name: string;
}

/** A device as `target_devices` can name it. */
export interface DeviceRef {
  id: string;
  name: string | null;
  is_kiosk: boolean | null;
}

/**
 * `duration` in seconds. Absent means the default minute; anything else must
 * be a whole number in range. A string of digits counts too, because a Home
 * Assistant template renders numbers as text unless told otherwise.
 */
export function parseTakeoverDuration(
  raw: unknown,
): { ok: true; seconds: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, seconds: DEFAULT_TAKEOVER_SECONDS };
  const value = typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? Number(raw) : raw;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_TAKEOVER_SECONDS ||
    value > MAX_TAKEOVER_SECONDS
  ) {
    return {
      ok: false,
      error: `\`duration\` must be a whole number of seconds from ${MIN_TAKEOVER_SECONDS} to ${MAX_TAKEOVER_SECONDS}`,
    };
  }
  return { ok: true, seconds: value };
}

/**
 * `camera` is a camera's id or its exact name, as Settings → Cameras shows it.
 * An id wins when both could match. Never a guess: a name two cameras share is
 * refused rather than picked, and a near miss — other capitals, a typo — is
 * no match.
 */
export function resolveCamera(
  cameras: readonly CameraRef[],
  raw: unknown,
): { ok: true; camera: CameraRef } | { ok: false; error: string } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "`camera` is required: a camera's id or exact name" };
  }
  const ref = raw.trim();
  const byId = cameras.find((c) => c.id === ref);
  if (byId) return { ok: true, camera: byId };
  const byName = cameras.filter((c) => c.name === ref);
  if (byName.length === 1) return { ok: true, camera: byName[0] };
  if (byName.length > 1) {
    return { ok: false, error: `${byName.length} cameras are called "${ref}"; use the id from GET /cameras` };
  }
  return { ok: false, error: `no camera "${ref}"; GET /cameras lists them` };
}

/**
 * Which screens show it. Absent: every kiosk device — the wall displays, not
 * phones. Given: those devices, by id or exact name, and only those, which may
 * include a screen that is not a kiosk. Phones get the push either way; this
 * only picks who shows the camera full screen.
 */
export function resolveTargetDevices(
  devices: readonly DeviceRef[],
  raw: unknown,
): { ok: true; deviceIds: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, deviceIds: devices.filter((d) => d.is_kiosk === true).map((d) => d.id) };
  }
  const refs: unknown[] = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  if (refs.length === 0 || refs.some((r) => typeof r !== "string" || r.trim() === "")) {
    return { ok: false, error: "`target_devices` must be a list of device ids or exact names" };
  }
  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const r of refs as string[]) {
    const ref = r.trim();
    const byId = devices.find((d) => d.id === ref);
    if (byId) {
      ids.add(byId.id);
      continue;
    }
    const byName = devices.filter((d) => d.name === ref);
    if (byName.length > 1) {
      return { ok: false, error: `${byName.length} devices are called "${ref}"; use the id` };
    }
    if (byName.length === 1) ids.add(byName[0].id);
    else unknown.push(ref);
  }
  if (unknown.length > 0) {
    return { ok: false, error: `no device ${unknown.map((u) => `"${u}"`).join(", ")}` };
  }
  return { ok: true, deviceIds: [...ids] };
}

/**
 * The cameras a family has set up, enabled ones in the order the settings page
 * shows them: id and name, and nothing else. A camera's stream URL names the
 * household's network and often carries its credentials, so it is dropped
 * here rather than trusted to be left out by whoever serialises the result.
 */
export function listableCameras(
  cameras: readonly Partial<Pick<CameraConfig, "id" | "name" | "enabled" | "position">>[] | null | undefined,
): CameraRef[] {
  return [...(cameras ?? [])]
    .filter((c) => c.enabled !== false && typeof c.id === "string" && typeof c.name === "string")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((c) => ({ id: c.id as string, name: c.name as string }));
}

/**
 * The family's cameras as `listableCameras` gives them. Read from the raw
 * `cameras` setting on purpose: once saved, a camera's password lives in
 * integration_secrets, and nothing here needs it.
 */
export async function readCameraRefs(db: any, familyId: string): Promise<CameraRef[]> {
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", SETTINGS_KEYS.cameras)
    .maybeSingle();
  if (error) throw error;
  return listableCameras((data?.value as { cameras?: CameraConfig[] } | null | undefined)?.cameras);
}

/**
 * What this screen should show now, or null: the family's takeover, if this
 * device is one of its screens and the server's clock has not reached
 * `ends_at`. `serverNow` is the screen's clock corrected by its measured
 * offset (useServerClockOffset), never the raw one — a tablet two minutes
 * slow would otherwise keep the camera up for three.
 */
export function activeTakeover(
  row: CameraTakeoverRow | null | undefined,
  deviceId: string | null | undefined,
  serverNow: Date,
): CameraTakeoverRow | null {
  if (!row || !deviceId || !Array.isArray(row.device_ids) || !row.device_ids.includes(deviceId)) return null;
  const ends = Date.parse(row.ends_at);
  if (!Number.isFinite(ends) || serverNow.getTime() >= ends) return null;
  return row;
}

/**
 * The camera a takeover names, from the cameras this screen can show (the
 * enabled ones), or null when it has been removed or disabled since the call.
 * Both the overlay and the screensaver gate go by this, so a takeover whose
 * camera is gone neither shows an empty overlay nor holds the screensaver off
 * with nothing on screen.
 */
export function takeoverCamera<C extends { id: string; enabled?: boolean }>(
  takeover: Pick<CameraTakeoverRow, "camera_id"> | null | undefined,
  cameras: readonly C[],
): C | null {
  if (!takeover) return null;
  return cameras.find((c) => c.id === takeover.camera_id && c.enabled !== false) ?? null;
}

/** Milliseconds left by the server's clock; 0 once it has ended. */
export function takeoverRemainingMs(row: Pick<CameraTakeoverRow, "ends_at">, serverNow: Date): number {
  const ends = Date.parse(row.ends_at);
  return Number.isFinite(ends) ? Math.max(0, ends - serverNow.getTime()) : 0;
}

/**
 * Whether a queued `camera_live` push has outlived its camera. The push says
 * "live on the screens now", so once the takeover it announces has ended it
 * would be false — a processor that runs late, or was down for a while, must
 * drop it rather than send it. `ends_at` is written into the row's data when
 * show_camera queues it; a row without one (or with one that doesn't parse)
 * is given the longest takeover there can be from when it was scheduled, so
 * it can't linger forever either.
 */
export function cameraPushEnded(
  n: { scheduled_for: string; data?: Record<string, unknown> | null },
  now: Date,
): boolean {
  const recorded = typeof n.data?.ends_at === "string" ? Date.parse(n.data.ends_at) : NaN;
  const ends = Number.isFinite(recorded)
    ? recorded
    : Date.parse(n.scheduled_for) + MAX_TAKEOVER_SECONDS * 1000;
  return !Number.isFinite(ends) || now.getTime() >= ends;
}

/**
 * The queued `camera_live` pushes to drop rather than send, by id. A family's
 * newest call is the takeover the screens show — a later call replaces the
 * row, even with a shorter time — so when the newest has ended, every one of
 * that family's camera pushes still queued is out of date with it.
 */
export function endedCameraPushes<
  T extends { id: string; family_id: string; notification_type: string; scheduled_for: string; data?: Record<string, unknown> | null },
>(pending: readonly T[], now: Date): string[] {
  const newest = new Map<string, T>();
  for (const n of pending) {
    if (n.notification_type !== "camera_live") continue;
    const seen = newest.get(n.family_id);
    if (!seen || Date.parse(n.scheduled_for) >= Date.parse(seen.scheduled_for)) newest.set(n.family_id, n);
  }
  return pending
    .filter((n) => n.notification_type === "camera_live" && cameraPushEnded(newest.get(n.family_id)!, now))
    .map((n) => n.id);
}
